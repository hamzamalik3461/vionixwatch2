import { createFileRoute } from '@tanstack/react-router'
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/index.js'
import { roomMembers, roomPlayback, rooms } from '../../db/schema.js'
import type { PublicRoomSummary } from '@/lib/room-types'
import { handle, HttpError, readJson } from '@/server/http'
import { hashPassword } from '@/server/password'
import { newRoomCode, systemMessage } from '@/server/rooms'
import { requireProfile } from '@/server/session'

const createInput = z.object({
  name: z.string().trim().max(40),
  visibility: z.enum(['public', 'private']),
  password: z.string().max(64).optional(),
})

export const Route = createFileRoute('/api/rooms')({
  server: {
    handlers: {
      /** Public lobby + live online count, both from real presence. */
      GET: () =>
        handle(async () => {
          const [online] = await db
            .select({
              n: sql<number>`count(distinct ${roomMembers.profileId})::int`,
            })
            .from(roomMembers)
            .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
            .where(
              and(
                eq(roomMembers.present, true),
                eq(roomMembers.removed, false),
                isNull(rooms.endedAt),
              ),
            )
          const rows = await db
            .select({
              code: rooms.code,
              name: rooms.name,
              capacity: rooms.capacity,
              locked: rooms.locked,
              passwordHash: rooms.passwordHash,
              members: sql<number>`count(${roomMembers.profileId})::int`,
              watching: sql<
                string | null
              >`(select v.title from room_videos v join room_playback p on p.video_id = v.id where p.room_id = ${rooms.id})`,
              thumbnail: sql<
                string | null
              >`(select v.thumbnail from room_videos v join room_playback p on p.video_id = v.id where p.room_id = ${rooms.id})`,
            })
            .from(rooms)
            .innerJoin(
              roomMembers,
              and(
                eq(roomMembers.roomId, rooms.id),
                eq(roomMembers.present, true),
                eq(roomMembers.removed, false),
              ),
            )
            .where(
              and(
                eq(rooms.visibility, 'public'),
                isNull(rooms.endedAt),
                gte(rooms.updatedAt, new Date(Date.now() - 7 * 86400_000)),
              ),
            )
            .groupBy(rooms.id)
            .orderBy(desc(sql`count(${roomMembers.profileId})`))
            .limit(6)
          const list: PublicRoomSummary[] = rows.map((r) => ({
            code: r.code,
            name: r.name,
            watching: r.watching ?? 'Picking something to watch',
            members: r.members,
            capacity: r.capacity,
            locked: r.locked || Boolean(r.passwordHash),
            thumbnail:
              r.thumbnail ?? 'linear-gradient(135deg, #24305e, #3b1d6e)',
          }))
          return Response.json({ online: online?.n ?? 0, rooms: list })
        }),

      POST: ({ request }) =>
        handle(async () => {
          const profile = await requireProfile(request)
          const body = await readJson(request, createInput)
          const password =
            body.visibility === 'private' ? body.password?.trim() : undefined
          if (password && password.length < 4)
            throw new HttpError(
              400,
              'Room passwords need at least 4 characters.',
            )

          const [recent] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(rooms)
            .where(
              and(
                eq(rooms.ownerId, profile.id),
                gte(rooms.createdAt, new Date(Date.now() - 10 * 60_000)),
              ),
            )
          if ((recent?.n ?? 0) >= 8)
            throw new HttpError(
              429,
              'You are creating rooms too quickly. Try again in a few minutes.',
            )

          let room: typeof rooms.$inferSelect | undefined
          for (let i = 0; i < 5 && !room; i++) {
            const inserted = await db
              .insert(rooms)
              .values({
                code: newRoomCode(),
                name:
                  body.name.length >= 2 ? body.name : `${profile.name}'s room`,
                description: 'Grab snacks. Host has the remote.',
                visibility: body.visibility,
                passwordHash: password ? hashPassword(password) : null,
                ownerId: profile.id,
              })
              .onConflictDoNothing()
              .returning()
            room = inserted[0]
          }
          if (!room)
            throw new HttpError(500, 'Could not create a room code. Try again.')

          await db
            .insert(roomMembers)
            .values({ roomId: room.id, profileId: profile.id })
          // The queue starts empty; the player shows the add/upload screen instead.
          await db
            .insert(roomPlayback)
            .values({ roomId: room.id, videoId: null })
          await systemMessage(room.id, `${profile.name} created the room`)
          return Response.json({ code: room.code }, { status: 201 })
        }),
    },
  },
})
