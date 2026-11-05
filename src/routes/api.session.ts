import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/index.js'
import { profiles } from '../../db/schema.js'
import { avatarChoices } from '@/lib/catalog'
import { isValidAvatar } from '@/server/avatar'
import { handle, HttpError, readJson } from '@/server/http'
import { createProfile, getProfile, sanitizeName } from '@/server/session'

const input = z.object({
  name: z.string().max(60),
  avatar: z.string().max(200),
})

export const Route = createFileRoute('/api/session')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(async () => {
          const p = await getProfile(request)
          return Response.json({
            profile: p
              ? {
                  id: p.id,
                  name: p.name,
                  avatar: p.avatar,
                  username: p.username,
                }
              : null,
          })
        }),
      /** Creates the anonymous identity (httpOnly cookie) or updates its name/avatar. */
      POST: ({ request }) =>
        handle(async () => {
          const body = await readJson(request, input)
          const name = sanitizeName(body.name)
          if (name.length < 2)
            throw new HttpError(
              400,
              'Pick a username with at least 2 characters.',
            )
          const existing = await getProfile(request)
          let avatar = body.avatar
          if (!isValidAvatar(avatar, existing?.id ?? null)) {
            // A stale custom-avatar URL (e.g. new device) falls back gracefully.
            if (avatar.startsWith('/api/avatar/')) avatar = avatarChoices[0]
            else throw new HttpError(400, 'Pick one of the avatars')
          }
          if (existing) {
            await db
              .update(profiles)
              .set({ name, avatar })
              .where(eq(profiles.id, existing.id))
            return Response.json({
              profile: {
                id: existing.id,
                name,
                avatar,
                username: existing.username,
              },
            })
          }
          const { profile, cookie } = await createProfile(name, avatar)
          return Response.json(
            {
              profile: {
                id: profile.id,
                name: profile.name,
                avatar: profile.avatar,
                username: profile.username,
              },
            },
            { headers: { 'Set-Cookie': cookie } },
          )
        }),
    },
  },
})
