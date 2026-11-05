import { randomInt } from 'node:crypto'
import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import {
  profiles,
  roomMembers,
  roomMessages,
  roomPlayback,
  roomVideos,
  rooms,
} from '../../db/schema.js'
import type {
  ApiMember,
  ApiMessage,
  ApiPlayback,
  ApiRoomInfo,
  ApiVideo,
  Membership,
  RoomStateResponse,
} from '@/lib/room-types'
import { HttpError } from './http'
import type { SessionProfile } from './session'

export type RoomRow = typeof rooms.$inferSelect

/** A member counts as gone after this long without a heartbeat. */
const STALE_MS = 90_000
/** A tab that closed (beacon) is announced as gone after this grace period, so refreshes stay quiet. */
const LEAVE_GRACE_MS = 8_000

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function newRoomCode() {
  const pick = (n: number) =>
    Array.from(
      { length: n },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join('')
  return `${pick(4)}-${pick(3)}`
}

export function normalizeCode(raw: string) {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return s.length === 7 ? `${s.slice(0, 4)}-${s.slice(4)}` : null
}

export async function findRoom(rawCode: string) {
  const code = normalizeCode(rawCode)
  if (!code) throw new HttpError(404, 'Room not found')
  const [room] = await db
    .select()
    .from(rooms)
    .where(eq(rooms.code, code))
    .limit(1)
  if (!room) throw new HttpError(404, 'Room not found')
  return room
}

export async function getMembership(roomId: string, profileId: string) {
  const [m] = await db
    .select()
    .from(roomMembers)
    .where(
      and(eq(roomMembers.roomId, roomId), eq(roomMembers.profileId, profileId)),
    )
    .limit(1)
  return m ?? null
}

/** Throws unless the caller is an active member of a live room. */
export async function requireMember(room: RoomRow, profile: SessionProfile) {
  if (room.endedAt) throw new HttpError(410, 'This room has ended')
  const m = await getMembership(room.id, profile.id)
  if (!m || m.removed) throw new HttpError(403, 'You are not in this room')
  return m
}

/** Owner check always runs against the database, never the client's claim. */
export async function requireOwner(room: RoomRow, profile: SessionProfile) {
  await requireMember(room, profile)
  if (room.ownerId !== profile.id)
    throw new HttpError(403, 'Only the host can do that')
}

export async function systemMessage(roomId: string, text: string) {
  await db.insert(roomMessages).values({ roomId, type: 'system', text })
}

/** Records a heartbeat; announces a (re)join when the member was away. */
export async function heartbeat(room: RoomRow, profile: SessionProfile) {
  const [prev] = await db
    .select({ present: roomMembers.present })
    .from(roomMembers)
    .where(
      and(
        eq(roomMembers.roomId, room.id),
        eq(roomMembers.profileId, profile.id),
      ),
    )
    .limit(1)
  await db
    .update(roomMembers)
    .set({ lastSeenAt: new Date(), leftAt: null, present: true })
    .where(
      and(
        eq(roomMembers.roomId, room.id),
        eq(roomMembers.profileId, profile.id),
      ),
    )
  if (prev && !prev.present) {
    await systemMessage(room.id, `${profile.name} joined the room`)
    return true
  }
  return false
}

/** Marks members who closed their tab or went silent as gone, and posts the leave notice once. */
export async function sweepPresence(roomId: string) {
  const now = Date.now()
  const gone = await db
    .update(roomMembers)
    .set({ present: false })
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        eq(roomMembers.present, true),
        eq(roomMembers.removed, false),
        or(
          lt(roomMembers.lastSeenAt, new Date(now - STALE_MS)),
          lt(roomMembers.leftAt, new Date(now - LEAVE_GRACE_MS)),
        ),
      ),
    )
    .returning({ profileId: roomMembers.profileId })
  if (!gone.length) return false
  const names = await db
    .select({ id: profiles.id, name: profiles.name })
    .from(profiles)
    .where(
      inArray(
        profiles.id,
        gone.map((g) => g.profileId),
      ),
    )
  for (const n of names) await systemMessage(roomId, `${n.name} left the room`)
  return true
}

export function toPlayback(row: typeof roomPlayback.$inferSelect): ApiPlayback {
  return {
    videoId: row.videoId,
    playing: row.playing,
    position: row.position,
    rate: row.rate,
    subtitle: row.subtitle,
    audio: row.audio,
    updatedAt: row.updatedAt.getTime(),
  }
}

async function countPresent(roomId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(roomMembers)
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        eq(roomMembers.present, true),
        eq(roomMembers.removed, false),
      ),
    )
  return r?.n ?? 0
}

export async function roomInfo(room: RoomRow): Promise<ApiRoomInfo> {
  return {
    code: room.code,
    name: room.name,
    description: room.description,
    visibility: room.visibility === 'private' ? 'private' : 'public',
    hasPassword: Boolean(room.passwordHash),
    capacity: room.capacity,
    locked: room.locked,
    ended: Boolean(room.endedAt),
    ownerId: room.ownerId,
    memberCount: await countPresent(room.id),
  }
}

export async function loadPlaylist(roomId: string): Promise<ApiVideo[]> {
  const rows = await db
    .select()
    .from(roomVideos)
    .where(eq(roomVideos.roomId, roomId))
    .orderBy(asc(roomVideos.sort), asc(roomVideos.createdAt))
  return rows.map((v) => ({
    id: v.id,
    title: v.title,
    src: v.src,
    kind:
      v.kind === 'hls' || v.kind === 'mux' || v.kind === 'youtube'
        ? v.kind
        : 'mp4',
    duration: v.duration,
    thumbnail: v.thumbnail,
    addedBy: v.addedBy,
  }))
}

export async function loadMessages(
  roomId: string,
  after: number,
): Promise<ApiMessage[]> {
  const base = db
    .select({
      id: roomMessages.id,
      type: roomMessages.type,
      authorId: roomMessages.profileId,
      authorName: profiles.name,
      authorAvatar: profiles.avatar,
      text: roomMessages.text,
      createdAt: roomMessages.createdAt,
    })
    .from(roomMessages)
    .leftJoin(profiles, eq(profiles.id, roomMessages.profileId))
  const rows =
    after > 0
      ? await base
          .where(
            and(eq(roomMessages.roomId, roomId), gt(roomMessages.id, after)),
          )
          .orderBy(asc(roomMessages.id))
          .limit(200)
      : (
          await base
            .where(
              and(
                eq(roomMessages.roomId, roomId),
                sql`${roomMessages.type} <> 'reaction'`,
              ),
            )
            .orderBy(desc(roomMessages.id))
            .limit(100)
        ).reverse()
  return rows.map((r) => ({
    id: r.id,
    type:
      r.type === 'system'
        ? 'system'
        : r.type === 'reaction'
          ? 'reaction'
          : 'user',
    authorId: r.authorId,
    authorName: r.authorName,
    authorAvatar: r.authorAvatar,
    text: r.text,
    at: r.createdAt.getTime(),
  }))
}

export async function buildState(
  room: RoomRow,
  profile: SessionProfile | null,
  after: number,
): Promise<RoomStateResponse> {
  const membership: Membership = profile
    ? await getMembership(room.id, profile.id).then((m) =>
        !m ? 'none' : m.removed ? 'removed' : 'member',
      )
    : 'none'
  const me = profile
    ? { id: profile.id, name: profile.name, avatar: profile.avatar }
    : null
  const info = await roomInfo(room)
  if (membership !== 'member' || room.endedAt) {
    return {
      serverNow: Date.now(),
      room: info,
      me,
      membership,
      members: [],
      playlist: [],
      playback: null,
      messages: [],
    }
  }

  const memberRows = await db
    .select({
      id: profiles.id,
      name: profiles.name,
      avatar: profiles.avatar,
      present: roomMembers.present,
    })
    .from(roomMembers)
    .innerJoin(profiles, eq(profiles.id, roomMembers.profileId))
    .where(
      and(
        eq(roomMembers.roomId, room.id),
        eq(roomMembers.removed, false),
        // Keep recent offline members visible, drop long-gone ones.
        or(
          eq(roomMembers.present, true),
          gte(roomMembers.lastSeenAt, new Date(Date.now() - 6 * 3600_000)),
        ),
      ),
    )
    .orderBy(asc(roomMembers.joinedAt))
  const members: ApiMember[] = memberRows.map((m) => ({
    id: m.id,
    name: m.name,
    avatar: m.avatar,
    role: m.id === room.ownerId ? 'owner' : 'participant',
    online: m.present,
  }))

  const [pb] = await db
    .select()
    .from(roomPlayback)
    .where(eq(roomPlayback.roomId, room.id))
    .limit(1)
  return {
    serverNow: Date.now(),
    room: info,
    me,
    membership,
    members,
    playlist: await loadPlaylist(room.id),
    playback: pb ? toPlayback(pb) : null,
    messages: await loadMessages(room.id, after),
  }
}

/** Simple sliding-window rate limit over rows already stored. */
export async function recentMessageCount(
  roomId: string,
  profileId: string,
  type: string,
  windowMs: number,
) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(roomMessages)
    .where(
      and(
        eq(roomMessages.roomId, roomId),
        eq(roomMessages.profileId, profileId),
        eq(roomMessages.type, type),
        gte(roomMessages.createdAt, new Date(Date.now() - windowMs)),
      ),
    )
  return r?.n ?? 0
}
