import { createFileRoute } from '@tanstack/react-router'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/index.js'
import {
  profiles,
  roomMembers,
  roomMessages,
  roomPlayback,
  roomVideos,
  rooms,
} from '../../db/schema.js'
import { reactionEmojis } from '@/lib/catalog'
import {
  parseYouTubeId,
  youtubeThumbnail,
  youtubeWatchUrl,
} from '@/lib/youtube'
import { fetchYouTubeTitle } from '@/server/youtube'
import {
  broadcast,
  kickParticipant,
  livekitConfigured,
  voiceToken,
} from '@/server/livekit'
import { handle, HttpError, readJson } from '@/server/http'
import {
  createDirectUpload,
  getAsset,
  getUpload,
  muxConfigured,
} from '@/server/mux'
import { hashPassword, verifyPassword } from '@/server/password'
import {
  findRoom,
  getMembership,
  loadMessages,
  recentMessageCount,
  requireMember,
  requireOwner,
  systemMessage,
  toPlayback,
  type RoomRow,
} from '@/server/rooms'
import { requireProfile, type SessionProfile } from '@/server/session'

type Ctx = { request: Request; room: RoomRow; profile: SessionProfile }
const ok = (data: object = { ok: true }) => Response.json(data)
const sync = (room: RoomRow) => broadcast(room.code, { t: 'sync' })
/** First video added to an idle room becomes the current one (without autoplay). */
async function selectIfIdle(room: RoomRow, videoId: string) {
  await db
    .update(roomPlayback)
    .set({ videoId, position: 0, updatedAt: new Date() })
    .where(and(eq(roomPlayback.roomId, room.id), isNull(roomPlayback.videoId)))
}

const touch = (room: RoomRow) =>
  db.update(rooms).set({ updatedAt: new Date() }).where(eq(rooms.id, room.id))

const position = z.number().finite().min(0).max(86_400)

const playbackInput = z.discriminatedUnion('op', [
  z.object({ op: z.literal('play'), position }),
  z.object({ op: z.literal('pause'), position }),
  z.object({ op: z.literal('seek'), position }),
  z.object({
    op: z.literal('rate'),
    position,
    rate: z.number().min(0.25).max(2),
  }),
  z.object({
    op: z.literal('tracks'),
    position,
    videoId: z.uuid(),
    subtitle: z.string().max(200),
    audio: z.string().max(200),
  }),
  z.object({ op: z.literal('select'), videoId: z.uuid() }),
])

const queueInput = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    title: z.string().trim().min(1).max(120),
    src: z
      .url()
      .max(2000)
      .refine(
        (u) => u.startsWith('https://'),
        'Only https:// links are supported',
      ),
    kind: z.enum(['mp4', 'hls', 'mux', 'youtube']),
    duration: z.number().int().min(0).max(86_400),
    thumbnail: z
      .string()
      .max(200)
      .regex(/^linear-gradient\([#0-9a-z,\s%.()]+\)$/i),
  }),
  z.object({ op: z.literal('remove'), videoId: z.uuid() }),
  z.object({
    op: z.literal('move'),
    videoId: z.uuid(),
    dir: z.union([z.literal(-1), z.literal(1)]),
  }),
])

const settingsInput = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  description: z.string().trim().max(200).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  /** New password; empty string removes it. Omit to keep the current one. */
  password: z.string().max(64).optional(),
  capacity: z.number().int().min(2).max(50).optional(),
  locked: z.boolean().optional(),
})

const actions: Record<string, (ctx: Ctx) => Promise<Response>> = {
  /** Joins the room after password, lock and capacity checks. */
  async join({ request, room, profile }) {
    const { password } = await readJson(
      request,
      z.object({ password: z.string().max(64).optional() }),
    )
    if (room.endedAt) throw new HttpError(410, 'This room has ended')
    const existing = await getMembership(room.id, profile.id)
    if (existing?.removed)
      throw new HttpError(403, 'The host removed you from this room')
    if (!existing) {
      if (room.locked && room.ownerId !== profile.id)
        throw new HttpError(423, 'The host locked this room')
      if (
        room.passwordHash &&
        !verifyPassword(password ?? '', room.passwordHash)
      ) {
        throw new HttpError(
          401,
          password ? 'Wrong password' : 'This room needs a password',
        )
      }
      const [count] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(roomMembers)
        .where(
          and(
            eq(roomMembers.roomId, room.id),
            eq(roomMembers.present, true),
            eq(roomMembers.removed, false),
          ),
        )
      if ((count?.n ?? 0) >= room.capacity)
        throw new HttpError(409, 'This room is full')
      await db
        .insert(roomMembers)
        .values({ roomId: room.id, profileId: profile.id })
        .onConflictDoNothing()
      await systemMessage(room.id, `${profile.name} joined the room`)
      await sync(room)
    }
    return ok()
  },

  /** Sent with sendBeacon when the tab closes; the leave notice follows after a short grace period. */
  async leave({ room, profile }) {
    await db
      .update(roomMembers)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(roomMembers.roomId, room.id),
          eq(roomMembers.profileId, profile.id),
        ),
      )
    return ok()
  },

  async message({ request, room, profile }) {
    await requireMember(room, profile)
    const { text } = await readJson(
      request,
      z.object({ text: z.string().trim().min(1).max(500) }),
    )
    if ((await recentMessageCount(room.id, profile.id, 'user', 10_000)) >= 6) {
      throw new HttpError(429, 'Slow down a little')
    }
    const [row] = await db
      .insert(roomMessages)
      .values({
        roomId: room.id,
        profileId: profile.id,
        type: 'user',
        text,
      })
      .returning()
    await sync(room)
    return ok({ message: (await loadMessages(room.id, row.id - 1))[0] })
  },

  async react({ request, room, profile }) {
    await requireMember(room, profile)
    const { emoji } = await readJson(
      request,
      z.object({
        emoji: z
          .string()
          .refine((e) => reactionEmojis.includes(e), 'Unknown reaction'),
      }),
    )
    if (
      (await recentMessageCount(room.id, profile.id, 'reaction', 10_000)) >= 10
    ) {
      throw new HttpError(429, 'Too many reactions')
    }
    const [row] = await db
      .insert(roomMessages)
      .values({
        roomId: room.id,
        profileId: profile.id,
        type: 'reaction',
        text: emoji,
      })
      .returning()
    await sync(room)
    return ok({ message: (await loadMessages(room.id, row.id - 1))[0] })
  },

  /** Owner-only shared playback. The server stamps the time so every client computes the same position. */
  async playback({ request, room, profile }) {
    await requireOwner(room, profile)
    const body = await readJson(request, playbackInput)
    const now = new Date()
    let patch: Partial<typeof roomPlayback.$inferInsert>
    if (body.op === 'select') {
      const [v] = await db
        .select({ id: roomVideos.id })
        .from(roomVideos)
        .where(
          and(eq(roomVideos.id, body.videoId), eq(roomVideos.roomId, room.id)),
        )
      if (!v) throw new HttpError(404, 'That video is not in the queue')
      patch = {
        videoId: v.id,
        position: 0,
        playing: true,
        subtitle: 'off',
        audio: 'default',
      }
    } else if (body.op === 'tracks') {
      const [active] = await db
        .select()
        .from(roomPlayback)
        .where(eq(roomPlayback.roomId, room.id))
      if (active?.videoId !== body.videoId)
        throw new HttpError(409, 'The video has changed')
      patch = {
        subtitle: body.subtitle,
        audio: body.audio,
        position: body.position,
      }
    } else if (body.op === 'rate') {
      patch = { rate: body.rate, position: body.position }
    } else {
      patch = {
        position: body.position,
        ...(body.op === 'seek' ? {} : { playing: body.op === 'play' }),
      }
    }
    const [row] = await db
      .insert(roomPlayback)
      .values({ roomId: room.id, ...patch, updatedAt: now })
      .onConflictDoUpdate({
        target: roomPlayback.roomId,
        set: { ...patch, updatedAt: now },
      })
      .returning()
    const playback = toPlayback(row)
    await broadcast(room.code, {
      t: 'playback',
      playback,
      serverNow: Date.now(),
    })
    return ok({ playback, serverNow: Date.now() })
  },

  async queue({ request, room, profile }) {
    await requireOwner(room, profile)
    const body = await readJson(request, queueInput)
    if (body.op === 'add') {
      let { title, src, thumbnail } = body
      if (body.kind === 'youtube') {
        const ytId = parseYouTubeId(src)
        if (!ytId) throw new HttpError(400, 'Not a valid YouTube link')
        src = youtubeWatchUrl(ytId)
        thumbnail = youtubeThumbnail(ytId)
        title = (await fetchYouTubeTitle(ytId)) ?? title
      }
      const [count] = await db
        .select({
          n: sql<number>`count(*)::int`,
          max: sql<number>`coalesce(max(${roomVideos.sort}), -1)::int`,
        })
        .from(roomVideos)
        .where(eq(roomVideos.roomId, room.id))
      if ((count?.n ?? 0) >= 100) throw new HttpError(400, 'The queue is full')
      const [added] = await db
        .insert(roomVideos)
        .values({
          roomId: room.id,
          title,
          src,
          kind: body.kind,
          duration: body.duration,
          thumbnail,
          addedBy: profile.name,
          sort: (count?.max ?? -1) + 1,
        })
        .returning({ id: roomVideos.id })
      await selectIfIdle(room, added.id)
      await systemMessage(
        room.id,
        `${profile.name} added “${title}” to the queue`,
      )
    } else if (body.op === 'remove') {
      const [pb] = await db
        .select()
        .from(roomPlayback)
        .where(eq(roomPlayback.roomId, room.id))
      if (pb?.videoId === body.videoId)
        throw new HttpError(400, 'You cannot remove the video that is playing')
      await db
        .delete(roomVideos)
        .where(
          and(eq(roomVideos.id, body.videoId), eq(roomVideos.roomId, room.id)),
        )
    } else {
      const list = await db
        .select({ id: roomVideos.id })
        .from(roomVideos)
        .where(eq(roomVideos.roomId, room.id))
        .orderBy(asc(roomVideos.sort), asc(roomVideos.createdAt))
      const i = list.findIndex((v) => v.id === body.videoId)
      const j = i + body.dir
      if (i >= 0 && j >= 0 && j < list.length) {
        ;[list[i], list[j]] = [list[j], list[i]]
        for (const [k, v] of list.entries()) {
          await db
            .update(roomVideos)
            .set({ sort: k })
            .where(eq(roomVideos.id, v.id))
        }
      }
    }
    await sync(room)
    return ok()
  },

  async settings({ request, room, profile }) {
    await requireOwner(room, profile)
    const body = await readJson(request, settingsInput)
    const { password, ...rest } = body
    const patch: Partial<typeof rooms.$inferInsert> = {
      ...rest,
      updatedAt: new Date(),
    }
    if (password !== undefined) {
      const pw = password.trim()
      if (pw && pw.length < 4)
        throw new HttpError(400, 'Passwords need at least 4 characters')
      patch.passwordHash = pw ? hashPassword(pw) : null
    }
    await db.update(rooms).set(patch).where(eq(rooms.id, room.id))
    if (body.locked !== undefined && body.locked !== room.locked) {
      await systemMessage(
        room.id,
        body.locked ? 'The room is now locked' : 'The room is now unlocked',
      )
    }
    await sync(room)
    return ok()
  },

  async member({ request, room, profile }) {
    await requireOwner(room, profile)
    const body = await readJson(
      request,
      z.object({ op: z.enum(['remove', 'transfer']), profileId: z.uuid() }),
    )
    if (body.profileId === profile.id) throw new HttpError(400, 'That is you')
    const target = await getMembership(room.id, body.profileId)
    if (!target || target.removed)
      throw new HttpError(404, 'That member is not in the room')
    const [who] = await db
      .select({ name: profiles.name })
      .from(profiles)
      .where(eq(profiles.id, body.profileId))
    const name = who?.name ?? 'Someone'
    if (body.op === 'remove') {
      await db
        .update(roomMembers)
        .set({ removed: true, present: false })
        .where(
          and(
            eq(roomMembers.roomId, room.id),
            eq(roomMembers.profileId, body.profileId),
          ),
        )
      await kickParticipant(room.code, body.profileId)
      await systemMessage(room.id, `${name} was removed from the room`)
    } else {
      await db
        .update(rooms)
        .set({ ownerId: body.profileId, updatedAt: new Date() })
        .where(eq(rooms.id, room.id))
      await systemMessage(room.id, `${name} is now the host 👑`)
    }
    await sync(room)
    return ok()
  },

  async end({ room, profile }) {
    await requireOwner(room, profile)
    await db
      .update(rooms)
      .set({ endedAt: new Date(), updatedAt: new Date() })
      .where(eq(rooms.id, room.id))
    await db
      .update(roomPlayback)
      .set({ playing: false, updatedAt: new Date() })
      .where(eq(roomPlayback.roomId, room.id))
    await sync(room)
    return ok()
  },

  /** Owner-only: a Mux direct-upload URL the browser PUTs the file to. */
  async 'upload-url'({ request, room, profile }) {
    await requireOwner(room, profile)
    if (!muxConfigured())
      throw new HttpError(503, 'Uploads are not configured on this site yet')
    const { title } = await readJson(
      request,
      z.object({ title: z.string().trim().min(1).max(80) }),
    )
    const origin = request.headers.get('origin') ?? new URL(request.url).origin
    const upload = await createDirectUpload(
      { r: room.id, t: title, by: profile.name },
      origin,
    )
    return ok(upload)
  },

  /** Polled after the PUT finishes. When Mux is done, the video joins the queue. */
  async 'upload-status'({ request, room, profile }) {
    await requireOwner(room, profile)
    const { uploadId } = await readJson(
      request,
      z.object({ uploadId: z.string().min(1).max(300) }),
    )
    const upload = await getUpload(uploadId)
    if (upload.status === 'waiting' || !upload.asset_id) {
      if (
        upload.status === 'errored' ||
        upload.status === 'cancelled' ||
        upload.status === 'timed_out'
      ) {
        return ok({ status: 'errored' })
      }
      return ok({
        status: upload.status === 'asset_created' ? 'processing' : 'waiting',
      })
    }
    const asset = await getAsset(upload.asset_id)
    if (asset.status === 'errored') return ok({ status: 'errored' })
    const playbackId = asset.playback_ids?.find(
      (p) => p.policy === 'public',
    )?.id
    if (asset.status !== 'ready' || !playbackId)
      return ok({ status: 'processing' })

    let pass: { r?: string; t?: string; by?: string } = {}
    try {
      pass = JSON.parse(asset.passthrough ?? '{}') as typeof pass
    } catch {
      /* ignore */
    }
    if (pass.r !== room.id)
      throw new HttpError(404, 'That upload belongs to another room')

    const src = `https://stream.mux.com/${playbackId}.m3u8`
    const [existing] = await db
      .select({ id: roomVideos.id })
      .from(roomVideos)
      .where(and(eq(roomVideos.roomId, room.id), eq(roomVideos.src, src)))
    if (!existing) {
      const [count] = await db
        .select({
          max: sql<number>`coalesce(max(${roomVideos.sort}), -1)::int`,
        })
        .from(roomVideos)
        .where(eq(roomVideos.roomId, room.id))
      const [added] = await db
        .insert(roomVideos)
        .values({
          roomId: room.id,
          title: pass.t ?? 'Uploaded video',
          src,
          kind: 'mux',
          duration: Math.round(asset.duration ?? 0),
          thumbnail: `url("https://image.mux.com/${playbackId}/thumbnail.webp?time=1") center / cover no-repeat, linear-gradient(135deg, #1a0503, #3b0d08)`,
          addedBy: pass.by ?? profile.name,
          sort: (count?.max ?? -1) + 1,
        })
        .returning({ id: roomVideos.id })
      await selectIfIdle(room, added.id)
      await systemMessage(
        room.id,
        `${pass.by ?? profile.name} uploaded “${pass.t ?? 'a video'}”`,
      )
      await sync(room)
    }
    return ok({ status: 'ready' })
  },

  /** LiveKit token, scoped to this room, for members only. */
  async 'voice-token'({ room, profile }) {
    await requireMember(room, profile)
    if (!livekitConfigured())
      throw new HttpError(503, 'Voice is not configured on this site yet')
    const t = await voiceToken(room.code, profile.id, profile.name)
    return ok(t ?? {})
  },
}

export const Route = createFileRoute('/api/rooms/$code/$action')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(async () => {
          if (!Object.hasOwn(actions, params.action))
            throw new HttpError(404, 'Unknown action')
          const room = await findRoom(params.code)
          const profile = await requireProfile(request)
          const res = await actions[params.action]({
            request,
            room,
            profile,
          })
          if (
            !['leave', 'voice-token', 'upload-status'].includes(params.action)
          )
            await touch(room)
          return res
        }),
    },
  },
})
