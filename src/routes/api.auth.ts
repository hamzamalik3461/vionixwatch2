import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { avatarChoices } from '@/lib/catalog'
import {
  checkPassword,
  normalizeUsername,
  registerProfile,
  verifyLogin,
} from '@/server/auth'
import { isValidAvatar } from '@/server/avatar'
import { handle, HttpError, readJson } from '@/server/http'
import { loginWithOAuth } from '@/server/oauth'
import { verifyOAuthSession } from '@/server/oauth-session'
import {
  createSession,
  destroySession,
  getProfile,
  sanitizeName,
} from '@/server/session'

const input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('register'),
    username: z.string().max(60),
    password: z.string().max(200),
    name: z.string().max(60),
    avatar: z.string().max(200),
  }),
  z.object({
    action: z.literal('login'),
    username: z.string().max(60),
    password: z.string().max(200),
  }),
  z.object({ action: z.literal('logout') }),
  z.object({ action: z.literal('oauth') }),
])

const publicProfile = (p: {
  id: string
  name: string
  avatar: string
  username: string | null
}) => ({ id: p.id, name: p.name, avatar: p.avatar, username: p.username })

export const Route = createFileRoute('/api/auth')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(async () => {
          const body = await readJson(request, input)

          if (body.action === 'logout') {
            const cookie = await destroySession(request)
            return Response.json(
              { profile: null },
              { headers: { 'Set-Cookie': cookie } },
            )
          }

          if (body.action === 'oauth') {
            // The browser completed Google/GitHub sign-in with the identity
            // service; verify the cookie from this specific request server-side.
            const idUser = await verifyOAuthSession(request)
            if (!idUser)
              throw new HttpError(
                401,
                'The sign-in could not be verified — try again.',
              )
            const current = await getProfile(request)
            const { profile, mode } = await loginWithOAuth(current, {
              id: idUser.id,
              email: idUser.email,
              name:
                idUser.name ??
                (typeof idUser.userMetadata?.full_name === 'string'
                  ? idUser.userMetadata.full_name
                  : undefined),
            })
            const headers = new Headers()
            // Switching to a different profile retires this device's session.
            if (!current || current.id !== profile.id) {
              await destroySession(request)
              headers.set('Set-Cookie', await createSession(profile.id))
            }
            return Response.json(
              { profile: publicProfile(profile), mode },
              { headers },
            )
          }

          if (body.action === 'login') {
            const username = normalizeUsername(body.username)
            const profile = await verifyLogin(username, body.password)
            // Retire the guest session this device was using, if any.
            await destroySession(request)
            const cookie = await createSession(profile.id)
            return Response.json(
              { profile: publicProfile(profile) },
              { headers: { 'Set-Cookie': cookie } },
            )
          }

          const username = normalizeUsername(body.username)
          checkPassword(body.password)
          const name = sanitizeName(body.name)
          if (name.length < 2)
            throw new HttpError(
              400,
              'Pick a display name with at least 2 characters.',
            )
          const current = await getProfile(request)
          let avatar = body.avatar
          if (!isValidAvatar(avatar, current?.id ?? null)) {
            // A stale custom-avatar URL (e.g. new device) falls back gracefully.
            if (avatar.startsWith('/api/avatar/')) avatar = avatarChoices[0]
            else throw new HttpError(400, 'Pick one of the avatars')
          }
          const { profile, isNew } = await registerProfile(
            current,
            username,
            body.password,
            name,
            avatar,
          )
          const headers = new Headers()
          if (isNew) headers.set('Set-Cookie', await createSession(profile.id))
          return Response.json(
            { profile: publicProfile(profile) },
            { status: 201, headers },
          )
        }),
    },
  },
})
