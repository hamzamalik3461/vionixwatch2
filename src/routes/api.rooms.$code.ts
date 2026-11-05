import { createFileRoute } from '@tanstack/react-router'
import {
  buildState,
  findRoom,
  heartbeat,
  getMembership,
  sweepPresence,
} from '@/server/rooms'
import { broadcast } from '@/server/livekit'
import { handle } from '@/server/http'
import { getProfile } from '@/server/session'

export const Route = createFileRoute('/api/rooms/$code')({
  server: {
    handlers: {
      /**
       * Room state + heartbeat. `?after=<messageId>` returns only newer messages.
       * Non-members only get the public room info (for the join/password gate).
       */
      GET: ({ request, params }) =>
        handle(async () => {
          const room = await findRoom(params.code)
          const profile = await getProfile(request)
          const after = Math.max(
            0,
            Number(new URL(request.url).searchParams.get('after')) || 0,
          )
          if (profile && !room.endedAt) {
            const m = await getMembership(room.id, profile.id)
            const rejoined =
              m && !m.removed ? await heartbeat(room, profile) : false
            const swept = await sweepPresence(room.id)
            if (rejoined || swept) await broadcast(room.code, { t: 'sync' })
          }
          return Response.json(await buildState(room, profile, after), {
            headers: { 'Cache-Control': 'no-store' },
          })
        }),
    },
  },
})
