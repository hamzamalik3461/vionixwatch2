import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  listFriends,
  removeFriend,
  sendFriendRequest,
} from '@/server/friends'
import { handle, readJson } from '@/server/http'
import { requireAccount } from '@/server/session'

const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), username: z.string().max(60) }),
  z.object({ action: z.literal('accept'), profileId: z.uuid() }),
  z.object({ action: z.literal('decline'), profileId: z.uuid() }),
  z.object({ action: z.literal('cancel'), profileId: z.uuid() }),
  z.object({ action: z.literal('remove'), profileId: z.uuid() }),
])

export const Route = createFileRoute('/api/friends')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(async () => {
          const me = await requireAccount(request)
          return Response.json(await listFriends(me.id))
        }),
      POST: ({ request }) =>
        handle(async () => {
          const me = await requireAccount(request)
          const body = await readJson(request, input)
          if (body.action === 'request') {
            const result = await sendFriendRequest(me.id, body.username)
            return Response.json(result, { status: 201 })
          }
          if (body.action === 'accept')
            await acceptFriendRequest(me.id, body.profileId)
          else if (body.action === 'decline')
            await declineFriendRequest(me.id, body.profileId)
          else if (body.action === 'cancel')
            await cancelFriendRequest(me.id, body.profileId)
          else await removeFriend(me.id, body.profileId)
          return Response.json({ ok: true })
        }),
    },
  },
})
