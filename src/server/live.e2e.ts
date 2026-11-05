import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * Live two-user flow with REAL LiveKit credentials: voice tokens are minted
 * against the real LiveKit project and realtime broadcasts hit the real
 * LiveKit API. The database is in-memory Postgres built from the real
 * migrations (the sandbox's database connection is read-only, so writes can
 * only be exercised against a deployed branch). See vitest.live.config.ts.
 */

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

const { Route: sessionRoute } = await import('@/routes/api.session')
const { Route: roomsRoute } = await import('@/routes/api.rooms')
const { Route: stateRoute } = await import('@/routes/api.rooms.$code')
const { Route: actionRoute } = await import('@/routes/api.rooms.$code.$action')

type Handler = (ctx: {
  request: Request
  params: Record<string, string>
}) => Promise<Response>
const handlers = (r: unknown) =>
  (r as { options: { server: { handlers: Record<string, Handler> } } }).options
    .server.handlers

function req(path: string, cookie?: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(cookie ? { cookie } : {}),
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function newUser(name: string) {
  const res = await handlers(sessionRoute).POST({
    request: req('/api/session', undefined, { name, avatar: '🦉' }),
    params: {},
  })
  expect(res.status).toBe(200)
  return res.headers.get('set-cookie')!.split(';')[0]
}

const act = (
  code: string,
  action: string,
  cookie: string,
  body: unknown = {},
) =>
  handlers(actionRoute).POST({
    request: req(`/api/rooms/${code}/${action}`, cookie, body),
    params: { code, action },
  })
const state = async (code: string, cookie: string) =>
  (
    await handlers(stateRoute).GET({
      request: req(`/api/rooms/${code}?after=0`, cookie),
      params: { code },
    })
  ).json()

describe('live: real database + real LiveKit', () => {
  it('runs the full two-user room flow', async () => {
    const host = await newUser('HostLive')
    const guest = await newUser('GuestLive')

    const created = await handlers(roomsRoute).POST({
      request: req('/api/rooms', host, {
        name: 'Live sync test',
        visibility: 'public',
      }),
      params: {},
    })
    expect(created.status).toBe(201)
    const { code } = (await created.json()) as { code: string }
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{3}$/)

    expect((await act(code, 'join', guest)).status).toBe(200)
    const empty = await state(code, guest)
    expect(empty.playlist).toEqual([])
    expect(empty.playback.videoId).toBeNull()

    // Queue: guests blocked, host's first video auto-selected.
    const video = {
      op: 'add',
      title: 'Big Buck Bunny',
      src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      kind: 'mp4',
      duration: 596,
      thumbnail: 'linear-gradient(135deg, #000, #111)',
    }
    expect((await act(code, 'queue', guest, video)).status).toBe(403)
    expect((await act(code, 'queue', host, video)).status).toBe(200)
    const withVideo = await state(code, host)
    expect(withVideo.playback.videoId).toBe(withVideo.playlist[0].id)

    // Pause at 10s stops everyone at exactly 10s.
    expect(
      (await act(code, 'playback', host, { op: 'play', position: 0 })).status,
    ).toBe(200)
    expect(
      (await act(code, 'playback', host, { op: 'pause', position: 10 })).status,
    ).toBe(200)
    const atTen = await state(code, guest)
    expect(atTen.playback).toMatchObject({ playing: false, position: 10 })

    // Guests cannot drive playback or settings.
    expect(
      (await act(code, 'playback', guest, { op: 'play', position: 0 })).status,
    ).toBe(403)
    expect(
      (await act(code, 'playback', guest, { op: 'seek', position: 99 })).status,
    ).toBe(403)
    expect((await act(code, 'settings', guest, { locked: true })).status).toBe(
      403,
    )
    expect((await state(code, guest)).playback).toMatchObject({
      playing: false,
      position: 10,
    })

    // Chat both ways with real author identities.
    expect(
      (await act(code, 'message', guest, { text: 'hello from guest' })).status,
    ).toBe(200)
    expect(
      (await act(code, 'message', host, { text: 'hi guest' })).status,
    ).toBe(200)
    const hs = await state(code, host)
    expect(
      hs.messages.some(
        (m: { text: string; authorName: string }) =>
          m.text === 'hello from guest' && m.authorName === 'GuestLive',
      ),
    ).toBe(true)
    expect(hs.members.filter((m: { online: boolean }) => m.online).length).toBe(
      2,
    )

    // Real LiveKit voice tokens for both members (requires LIVEKIT_* env).
    const vt = await act(code, 'voice-token', host, {})
    expect(vt.status).toBe(200)
    const token = (await vt.json()) as { url: string; token: string }
    expect(token.url.startsWith('wss://')).toBe(true)
    expect(token.token.length).toBeGreaterThan(100)
    expect((await act(code, 'voice-token', guest, {})).status).toBe(200)

    // Upload endpoint: owner-gated; works when Mux is configured, 503 otherwise.
    expect(
      (await act(code, 'upload-url', guest, { title: 'sneaky' })).status,
    ).toBe(403)
    const up = await act(code, 'upload-url', host, { title: 'Live clip' })
    expect([200, 503]).toContain(up.status)

    // End of show.
    expect((await act(code, 'end', host)).status).toBe(200)
    expect((await state(code, guest)).room.ended).toBe(true)
  })
})
