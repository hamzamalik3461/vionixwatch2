// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyOAuthSession } from './oauth-session'

vi.mock('@netlify/identity', () => ({
  getIdentityConfig: () => ({
    url: 'https://identity.example/.netlify/identity',
  }),
}))

afterEach(() => vi.unstubAllGlobals())

describe('request-scoped OAuth verification', () => {
  it('verifies the request cookie with the configured Identity service', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: 'verified-subject',
        email: 'viewer@example.com',
        user_metadata: { full_name: 'Viewer' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = await verifyOAuthSession(
      new Request('https://untrusted.example/api/auth', {
        headers: { cookie: 'other=value; nf_jwt=test-session' },
      }),
    )
    expect(user).toMatchObject({ id: 'verified-subject', name: 'Viewer' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://identity.example/.netlify/identity/user',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-session' },
      }),
    )
  })

  it('rejects a missing cookie without contacting Identity', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(
      await verifyOAuthSession(new Request('https://app.example/api/auth')),
    ).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([401, 403, 500])(
    'rejects an Identity response with status %s',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(null, { status })),
      )
      expect(
        await verifyOAuthSession(
          new Request('https://app.example/api/auth', {
            headers: { cookie: 'nf_jwt=invalid-session' },
          }),
        ),
      ).toBeNull()
    },
  )

  it('rejects malformed user data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ email: 'viewer@example.com' })),
    )
    expect(
      await verifyOAuthSession(
        new Request('https://app.example/api/auth', {
          headers: { cookie: 'nf_jwt=test-session' },
        }),
      ),
    ).toBeNull()
  })
})
