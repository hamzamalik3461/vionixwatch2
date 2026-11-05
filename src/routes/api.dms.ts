import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { listThreads, openThread } from '@/server/dms'
import { handle, readJson } from '@/server/http'
import { requireAccount } from '@/server/session'

const input = z.object({ friendId: z.uuid() })

export const Route = createFileRoute('/api/dms')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(async () => {
          const me = await requireAccount(request)
          return Response.json({ threads: await listThreads(me.id) })
        }),
      /** Opens (or finds) the conversation with a friend. */
      POST: ({ request }) =>
        handle(async () => {
          const me = await requireAccount(request)
          const body = await readJson(request, input)
          const thread = await openThread(me.id, body.friendId)
          return Response.json({ threadId: thread.id }, { status: 201 })
        }),
    },
  },
})
