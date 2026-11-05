// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/** Runs the OAuth account logic against an in-memory Postgres with the real migrations. */
vi.mock('../../db/index.js', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const schema = await import('../../db/schema')
  const client = new PGlite()
  const dir = join(process.cwd(), 'netlify/database/migrations')
  for (const m of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, m, 'migration.sql'), 'utf8')
    for (const stmt of sql.split('--> statement-breakpoint'))
      if (stmt.trim()) await client.exec(stmt)
  }
  return { db: drizzle({ client, schema }) }
})
vi.stubEnv('LIVEKIT_URL', '')
vi.mock('@netlify/identity', () => ({
  getIdentityConfig: () => ({
    url: 'https://identity.example/.netlify/identity',
  }),
}))

const { loginWithOAuth } = await import('./oauth')
const { db } = await import('../../db/index.js')
const { profiles } = await import('../../db/schema')
const { Route: authRoute } = await import('@/routes/api.auth')

type Handler = (ctx: {
  request: Request
  params: Record<string, string>
}) => Promise<Response>
const handlers = (r: unknown) =>
  (r as { options: { server: { handlers: Record<string, Handler> } } }).options
    .server.handlers

describe('OAuth sign-in (Google / GitHub)', () => {
  it('creates a fresh account from a new identity', async () => {
    const { profile, mode } = await loginWithOAuth(null, {
      id: 'google-sub-1',
      email: 'jane.doe@gmail.com',
      name: 'Jane Doe',
    })
    expect(mode).toBe('created')
    expect(profile.username).toBe('jane_doe')
    expect(profile.name).toBe('Jane Doe')
    expect(profile.email).toBe('jane.doe@gmail.com')
    expect(profile.oauthSub).toBe('google-sub-1')
  })

  it('signs the same identity back into the same account', async () => {
    const first = await loginWithOAuth(null, {
      id: 'github-sub-2',
      email: 'sam@example.com',
      name: 'Sam',
    })
    const again = await loginWithOAuth(null, { id: 'github-sub-2' })
    expect(again.mode).toBe('signed-in')
    expect(again.profile.id).toBe(first.profile.id)
  })

  it('deduplicates usernames with a suffix', async () => {
    const twin = await loginWithOAuth(null, {
      id: 'google-sub-3',
      email: 'jane.doe@othermail.com',
      name: 'Jane Doe',
    })
    expect(twin.profile.username).not.toBe('jane_doe')
    expect(twin.profile.username).toMatch(/^jane_doe\d+$/)
  })

  it('upgrades the guest on this device in place, keeping their id', async () => {
    const [guest] = await db
      .insert(profiles)
      .values({ name: 'Night Owl', avatar: '🦉' })
      .returning()
    const { profile, mode } = await loginWithOAuth(guest, {
      id: 'google-sub-4',
      email: 'owl@gmail.com',
      name: 'Night Owl',
    })
    expect(mode).toBe('created')
    expect(profile.id).toBe(guest.id)
    expect(profile.username).toBe('night_owl')
    expect(profile.name).toBe('Night Owl') // display name untouched
  })

  it('links the identity to a signed-in password account', async () => {
    const [acct] = await db
      .insert(profiles)
      .values({
        name: 'Rex',
        avatar: '🦖',
        username: 'rex',
        passwordHash: 'x',
      })
      .returning()
    const { profile, mode } = await loginWithOAuth(acct, {
      id: 'github-sub-5',
      email: 'rex@example.com',
    })
    expect(mode).toBe('linked')
    expect(profile.id).toBe(acct.id)
    expect(profile.username).toBe('rex') // handle unchanged
    expect(profile.oauthSub).toBe('github-sub-5')
  })

  it('rejects the API action when no verified identity session exists', async () => {
    const res = await handlers(authRoute).POST({
      request: new Request('http://x/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'oauth' }),
      }),
      params: {},
    })
    expect(res.status).toBe(401)
  })

  it('exchanges the verified request cookie for an app session without runtime context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          id: 'identity-route-subject',
          email: 'route@example.com',
          user_metadata: { full_name: 'Route Viewer' },
        }),
      ),
    )
    try {
      const res = await handlers(authRoute).POST({
        request: new Request('https://app.example/api/auth', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: 'nf_jwt=test-session',
          },
          body: JSON.stringify({ action: 'oauth' }),
        }),
        params: {},
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('set-cookie')).toMatch(/^nw_sid=/)
      expect(await res.json()).toMatchObject({
        mode: 'created',
        profile: { name: 'Route Viewer', username: 'route_viewer' },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
