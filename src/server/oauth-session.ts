import { getIdentityConfig } from '@netlify/identity'
import { z } from 'zod'

const identityUser = z.object({
  id: z.string().min(1),
  email: z.string().optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
})

/** Verify the incoming request with Identity, without relying on runtime globals. */
export async function verifyOAuthSession(request: Request) {
  const cookie = request.headers.get('cookie') ?? ''
  const match = /(?:^|;\s*)nf_jwt=([^;]+)/.exec(cookie)
  const config = getIdentityConfig()
  if (!match || !config?.url) return null

  try {
    const response = await fetch(`${config.url.replace(/\/$/, '')}/user`, {
      headers: { Authorization: `Bearer ${decodeURIComponent(match[1])}` },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
      cache: 'no-store',
    })
    if (!response.ok) return null
    const parsed = identityUser.safeParse(await response.json())
    if (!parsed.success) return null
    const user = parsed.data
    return {
      id: user.id,
      email: user.email,
      name:
        typeof user.user_metadata?.full_name === 'string'
          ? user.user_metadata.full_name
          : typeof user.user_metadata?.name === 'string'
            ? user.user_metadata.name
            : undefined,
      userMetadata: user.user_metadata,
    }
  } catch {
    return null
  }
}
