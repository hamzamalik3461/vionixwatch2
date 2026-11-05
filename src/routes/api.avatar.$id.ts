import { createFileRoute } from '@tanstack/react-router'
import { readAvatarImage, isUuid } from '@/server/avatar'

export const Route = createFileRoute('/api/avatar/$id')({
  server: {
    handlers: {
      /** Serves an uploaded avatar image. URLs carry a ?v= stamp, so cache hard. */
      GET: async ({ params }) => {
        if (!isUuid(params.id))
          return Response.json({ error: 'Not found' }, { status: 404 })
        try {
          const img = await readAvatarImage(params.id)
          if (!img)
            return Response.json({ error: 'Not found' }, { status: 404 })
          return new Response(new Uint8Array(img.bytes), {
            headers: {
              'Content-Type': img.contentType,
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          })
        } catch {
          return Response.json({ error: 'Not available' }, { status: 503 })
        }
      },
    },
  },
})
