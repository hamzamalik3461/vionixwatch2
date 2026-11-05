import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  expireStaleCalls,
  liveCallForThread,
  loadDmMessages,
  markRead,
  requireThread,
  sendDm,
  toApiCall,
} from '@/server/dms'
import { toFriend } from '@/server/friends'
import { handle, HttpError, readJson } from '@/server/http'
import { requireAccount } from '@/server/session'
import type { ThreadResponse } from '@/lib/social-types'

const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('message'), text: z.string().max(1000) }),
  z.object({ action: z.literal('read'), lastId: z.number().int().min(0) }),
])

export const Route = createFileRoute('/api/dms/$id')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handle(async () => {
          const me = await requireAccount(request)
          const { thread, other } = await requireThread(params.id, me.id)
          await expireStaleCalls(me.id)
          const after = Number(
            new URL(request.url).searchParams.get('after') ?? '0',
          )
          const live = await liveCallForThread(thread.id)
          const res: ThreadResponse = {
            serverNow: Date.now(),
            thread: { id: thread.id },
            friend: toFriend(other),
            messages: await loadDmMessages(
              thread.id,
              Number.isFinite(after) && after > 0 ? after : 0,
            ),
            call: live ? toApiCall(live) : null,
          }
          return Response.json(res)
        }),
      POST: ({ request, params }) =>
        handle(async () => {
          const me = await requireAccount(request)
          const { thread } = await requireThread(params.id, me.id)
          const body = await readJson(request, input)
          if (body.action === 'read') {
            await markRead(me.id, thread.id, body.lastId)
            return Response.json({ ok: true })
          }
          const text = body.text.trim().slice(0, 1000)
          if (!text) throw new HttpError(400, 'Say something first')
          const message = await sendDm(me, thread, text)
          return Response.json({ message }, { status: 201 })
        }),
    },
  },
})
