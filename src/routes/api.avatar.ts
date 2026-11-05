import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/index.js'
import { profiles } from '../../db/schema.js'
import { saveAvatarImage } from '@/server/avatar'
import { handle, readJson } from '@/server/http'
import { requireProfile } from '@/server/session'

// ~2 MB of image → ~2.8 MB of base64 plus the data: prefix.
const input = z.object({ image: z.string().max(3_000_000) })

export const Route = createFileRoute('/api/avatar')({
  server: {
    handlers: {
      /** Uploads a custom avatar image for the signed-in profile. */
      POST: ({ request }) =>
        handle(async () => {
          const profile = await requireProfile(request)
          const { image } = await readJson(request, input)
          const avatar = await saveAvatarImage(profile.id, image)
          await db
            .update(profiles)
            .set({ avatar })
            .where(eq(profiles.id, profile.id))
          return Response.json({ avatar })
        }),
    },
  },
})
