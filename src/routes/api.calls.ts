import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  acceptCall,
  declineCall,
  endCall,
  expireStaleCalls,
  incomingCall,
  pulseCall,
  requireThread,
  startCall,
  toApiCall,
  unreadTotal,
} from '@/server/dms'
import { listFriends } from '@/server/friends'
import { handle, readJson } from '@/server/http'
import { callToken, closeCallRoom } from '@/server/livekit'
import { requireAccount } from '@/server/session'
import type { SocialPulse } from '@/lib/social-types'

const input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    threadId: z.uuid(),
    kind: z.enum(['voice', 'video']),
  }),
  z.object({ action: z.literal('accept'), callId: z.uuid() }),
  z.object({ action: z.literal('decline'), callId: z.uuid() }),
  z.object({ action: z.literal('end'), callId: z.uuid() }),
])

export const Route = createFileRoute('/api/calls')({
  server: {
    handlers: {
      /** Light poll behind the header: badges + the incoming-call banner. */
      GET: ({ request }) =>
        handle(async () => {
          const me = await requireAccount(request)
          const { incoming: requests } = await listFriends(me.id)
          const res: SocialPulse = {
            incoming: await incomingCall(me.id),
            call: await pulseCall(me.id),
            unread: await unreadTotal(me.id),
            requests: requests.length,
          }
          return Response.json(res)
        }),
      POST: ({ request }) =>
        handle(async () => {
          const me = await requireAccount(request)
          const body = await readJson(request, input)

          if (body.action === 'start') {
            const { thread } = await requireThread(body.threadId, me.id)
            const call = await startCall(me, thread, body.kind)
            const ticket = await callToken(call.id, me.id, me.name)
            return Response.json(
              { call: toApiCall(call), ...(ticket ?? {}) },
              { status: 201 },
            )
          }

          if (body.action === 'accept') {
            const { call } = await acceptCall(me, body.callId)
            const ticket = await callToken(call.id, me.id, me.name)
            return Response.json({ call: toApiCall(call), ...(ticket ?? {}) })
          }

          if (body.action === 'decline') {
            const { call } = await declineCall(me, body.callId)
            await closeCallRoom(call.id)
            return Response.json({ call: toApiCall(call) })
          }

          const { call } = await endCall(me, body.callId)
          await closeCallRoom(call.id)
          await expireStaleCalls(me.id)
          return Response.json({ call: toApiCall(call) })
        }),
    },
  },
})
