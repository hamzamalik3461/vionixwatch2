// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/** Runs the real API routes against an in-memory Postgres loaded with the real migrations. */
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
// No LiveKit in tests: broadcasts are skipped, clients fall back to polling.
vi.stubEnv('LIVEKIT_URL', '')

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
  return new Request(`http://x${path}`, {
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
const state = async (code: string, cookie: string, after = 0) =>
  (
    await handlers(stateRoute).GET({
      request: req(`/api/rooms/${code}?after=${after}`, cookie),
      params: { code },
    })
  ).json()

describe('room API', () => {
  it('syncs chat, playback and permissions between two people', async () => {
    const host = await newUser('Hosty')
    const guest = await newUser('Guesty')

    const created = await handlers(roomsRoute).POST({
      request: req('/api/rooms', host, {
        name: 'Movie night',
        visibility: 'public',
      }),
      params: {},
    })
    expect(created.status).toBe(201)
    const { code } = (await created.json()) as { code: string }

    // Guest isn't a member until joining.
    expect((await state(code, guest)).membership).toBe('none')
    expect((await act(code, 'join', guest)).status).toBe(200)

    // Chat from the guest is visible to the host.
    expect(
      (await act(code, 'message', guest, { text: 'hello host' })).status,
    ).toBe(200)
    const hs = await state(code, host)
    expect(hs.members.map((m: { name: string }) => m.name).sort()).toEqual([
      'Guesty',
      'Hosty',
    ])
    expect(
      hs.messages.some(
        (m: { text: string; authorName: string }) =>
          m.text === 'hello host' && m.authorName === 'Guesty',
      ),
    ).toBe(true)
    expect(
      hs.messages.some(
        (m: { text: string }) => m.text === 'Guesty joined the room',
      ),
    ).toBe(true)

    // New rooms start with an empty queue and nothing selected.
    expect(hs.playlist).toEqual([])
    expect(hs.playback.videoId).toBeNull()

    // Guests can't add to the queue; the host can, and the first video is auto-selected.
    const video = {
      op: 'add',
      title: 'Movie',
      src: 'https://example.com/movie.mp4',
      kind: 'mp4',
      duration: 120,
      thumbnail: 'linear-gradient(135deg, #000, #111)',
    }
    expect((await act(code, 'queue', guest, video)).status).toBe(403)
    expect((await act(code, 'queue', host, video)).status).toBe(200)
    const withVideo = await state(code, host)
    const videoId = withVideo.playlist[0].id
    expect(withVideo.playback.videoId).toBe(videoId)
    expect(withVideo.playback.playing).toBe(false)

    // Host plays, then pauses at 10s: everyone must stop at exactly 10s.
    expect(
      (await act(code, 'playback', host, { op: 'play', position: 0 })).status,
    ).toBe(200)
    expect(
      (await act(code, 'playback', host, { op: 'pause', position: 10 })).status,
    ).toBe(200)
    const gs = await state(code, guest)
    expect(gs.playback).toMatchObject({
      videoId,
      playing: false,
      position: 10,
      rate: 1,
    })
    expect((await state(code, host)).playback).toMatchObject({
      playing: false,
      position: 10,
    })

    // Track choices are host-only, persisted, and tied to the active video.
    const tracks = {
      op: 'tracks',
      videoId,
      position: 10,
      subtitle: '1',
      audio: '2',
    }
    expect((await act(code, 'playback', guest, tracks)).status).toBe(403)
    expect((await act(code, 'playback', host, tracks)).status).toBe(200)
    expect((await state(code, guest)).playback).toMatchObject({
      subtitle: '1',
      audio: '2',
      position: 10,
      playing: false,
    })
    expect(
      (
        await act(code, 'playback', host, {
          ...tracks,
          videoId: '00000000-0000-4000-8000-000000000000',
        })
      ).status,
    ).toBe(409)
    expect(
      (await act(code, 'playback', host, { op: 'select', videoId })).status,
    ).toBe(200)
    expect((await state(code, guest)).playback).toMatchObject({
      subtitle: 'off',
      audio: 'default',
    })

    // Host resumes and seeks; guest stays on the shared state.
    expect(
      (await act(code, 'playback', host, { op: 'seek', position: 42 })).status,
    ).toBe(200)
    expect(
      (await act(code, 'playback', host, { op: 'play', position: 42 })).status,
    ).toBe(200)
    expect((await state(code, guest)).playback).toMatchObject({
      playing: true,
      position: 42,
    })

    // Guest can't control playback, the queue or settings.
    expect(
      (await act(code, 'playback', guest, { op: 'pause', position: 0 })).status,
    ).toBe(403)
    expect((await act(code, 'settings', guest, { locked: true })).status).toBe(
      403,
    )
    expect((await state(code, guest)).playback.playing).toBe(true)

    // Incremental fetch only returns newer messages.
    const last = Math.max(...gs.messages.map((m: { id: number }) => m.id))
    await act(code, 'message', host, { text: 'popcorn ready' })
    const inc = await state(code, guest, last)
    expect(inc.messages.map((m: { text: string }) => m.text)).toEqual([
      'popcorn ready',
    ])

    // Chat is rate limited.
    const results = []
    for (let i = 0; i < 8; i++)
      results.push(
        (await act(code, 'message', guest, { text: `spam ${i}` })).status,
      )
    expect(results).toContain(429)

    // Uploads without Mux configured fail politely for the host.
    vi.stubEnv('MUX_TOKEN_ID', '')
    vi.stubEnv('MUX_TOKEN_SECRET', '')
    expect(
      (await act(code, 'upload-url', host, { title: 'My clip' })).status,
    ).toBe(503)
    vi.unstubAllEnvs()

    // Removed members lose access.
    const gid = gs.me.id
    expect(
      (await act(code, 'member', host, { op: 'remove', profileId: gid }))
        .status,
    ).toBe(200)
    expect((await state(code, guest)).membership).toBe('removed')
    expect(
      (await act(code, 'message', guest, { text: 'still here?' })).status,
    ).toBe(403)
  })

  it('enforces room passwords server-side', async () => {
    const host = await newUser('Owner')
    const guest = await newUser('Visitor')
    const created = await handlers(roomsRoute).POST({
      request: req('/api/rooms', host, {
        name: 'Secret',
        visibility: 'private',
        password: 'popcorn',
      }),
      params: {},
    })
    const { code } = (await created.json()) as { code: string }
    expect((await act(code, 'join', guest)).status).toBe(401)
    expect((await act(code, 'join', guest, { password: 'nope' })).status).toBe(
      401,
    )
    expect(
      (await act(code, 'join', guest, { password: 'popcorn' })).status,
    ).toBe(200)
    expect((await state(code, guest)).membership).toBe('member')
  })
})

describe('presence', () => {
  it('announces when a member closes their tab', async () => {
    const host = await newUser('Stay')
    const guest = await newUser('Goer')
    const created = await handlers(roomsRoute).POST({
      request: req('/api/rooms', host, {
        name: 'Presence',
        visibility: 'public',
      }),
      params: {},
    })
    const { code } = (await created.json()) as { code: string }
    await act(code, 'join', guest)
    await act(code, 'leave', guest)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 10_000)
    const s = await state(code, host)
    vi.useRealTimers()
    expect(
      s.messages.some((m: { text: string }) => m.text === 'Goer left the room'),
    ).toBe(true)
    expect(
      s.members.find((m: { name: string }) => m.name === 'Goer').online,
    ).toBe(false)
  })
})

describe('uploads (Mux pipeline, simulated Mux API)', () => {
  it('mints an upload URL, tracks processing and queues the finished video', async () => {
    vi.stubEnv('MUX_TOKEN_ID', 'test-id')
    vi.stubEnv('MUX_TOKEN_SECRET', 'test-secret')
    let passthrough = ''
    let uploadPolls = 0
    let assetPolls = 0
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.startsWith('https://api.mux.com')) return realFetch(input, init)
      const json = (data: unknown) => Promise.resolve(Response.json({ data }))
      if (url.endsWith('/uploads') && init?.method === 'POST') {
        passthrough = (
          JSON.parse(String(init.body)) as {
            new_asset_settings: { passthrough: string }
          }
        ).new_asset_settings.passthrough
        return json({
          id: 'up_1',
          url: 'https://storage.mux.example/put/up_1',
        })
      }
      if (url.includes('/uploads/up_1')) {
        uploadPolls++
        return json(
          uploadPolls === 1
            ? { status: 'waiting' }
            : { status: 'asset_created', asset_id: 'as_1' },
        )
      }
      if (url.includes('/assets/as_1')) {
        assetPolls++
        return json(
          assetPolls === 1
            ? { status: 'preparing' }
            : {
                status: 'ready',
                duration: 12.4,
                passthrough,
                playback_ids: [{ id: 'pb123', policy: 'public' }],
              },
        )
      }
      throw new Error(`unexpected mux call: ${url}`)
    })

    try {
      const host = await newUser('Uploader')
      const created = await handlers(roomsRoute).POST({
        request: req('/api/rooms', host, {
          name: 'Upload room',
          visibility: 'public',
        }),
        params: {},
      })
      const { code } = (await created.json()) as { code: string }

      // Owner gets a direct-upload URL; the title travels in the passthrough.
      const up = await act(code, 'upload-url', host, { title: 'My clip' })
      expect(up.status).toBe(200)
      const { uploadId, url } = (await up.json()) as {
        uploadId: string
        url: string
      }
      expect(uploadId).toBe('up_1')
      expect(url).toContain('https://storage.mux.example')

      // Poll: still uploading → processing → ready (video inserted exactly once).
      const poll = async () =>
        (await (
          await act(code, 'upload-status', host, { uploadId })
        ).json()) as { status: string }
      expect((await poll()).status).toBe('waiting')
      expect((await poll()).status).toBe('processing')
      expect((await poll()).status).toBe('ready')
      expect((await poll()).status).toBe('ready')

      const s = await state(code, host)
      expect(s.playlist).toHaveLength(1)
      expect(s.playlist[0]).toMatchObject({
        title: 'My clip',
        src: 'https://stream.mux.com/pb123.m3u8',
        kind: 'mux',
        duration: 12,
        addedBy: 'Uploader',
      })
      // The empty room auto-selects the uploaded video for everyone.
      expect(s.playback.videoId).toBe(s.playlist[0].id)
      expect(
        s.messages.some(
          (m: { text: string }) => m.text === 'Uploader uploaded “My clip”',
        ),
      ).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      vi.stubEnv('LIVEKIT_URL', '')
    }
  })
})

describe('YouTube links (simulated oEmbed)', () => {
  it('canonicalizes the link, fetches the title and rejects non-video URLs', async () => {
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.startsWith('https://www.youtube.com/oembed'))
        return realFetch(input, init)
      return Promise.resolve(
        Response.json({ title: 'Never Gonna Give You Up' }),
      )
    })

    try {
      const host = await newUser('Tuber')
      const created = await handlers(roomsRoute).POST({
        request: req('/api/rooms', host, {
          name: 'YT room',
          visibility: 'public',
        }),
        params: {},
      })
      const { code } = (await created.json()) as { code: string }

      // A share link (youtu.be) is stored as the canonical watch URL with the real title.
      const add = await act(code, 'queue', host, {
        op: 'add',
        title: 'YouTube video',
        src: 'https://youtu.be/dQw4w9WgXcQ?si=abc123',
        kind: 'youtube',
        duration: 0,
        thumbnail: 'linear-gradient(135deg, #3b0d08, #1a0503)',
      })
      expect(add.status).toBe(200)
      const s = await state(code, host)
      expect(s.playlist).toHaveLength(1)
      expect(s.playlist[0]).toMatchObject({
        title: 'Never Gonna Give You Up',
        src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        kind: 'youtube',
      })
      expect(s.playlist[0].thumbnail).toContain(
        'i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      )
      // The empty room auto-selects it.
      expect(s.playback.videoId).toBe(s.playlist[0].id)

      // A YouTube URL that isn't a video is rejected.
      const bad = await act(code, 'queue', host, {
        op: 'add',
        title: 'Nope',
        src: 'https://www.youtube.com/feed/trending',
        kind: 'youtube',
        duration: 0,
        thumbnail: 'linear-gradient(135deg, #3b0d08, #1a0503)',
      })
      expect(bad.status).toBe(400)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the client title when oEmbed is unreachable', async () => {
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.startsWith('https://www.youtube.com/oembed'))
        return realFetch(input, init)
      return Promise.reject(new Error('offline'))
    })

    try {
      const host = await newUser('Offline')
      const created = await handlers(roomsRoute).POST({
        request: req('/api/rooms', host, {
          name: 'Offline room',
          visibility: 'public',
        }),
        params: {},
      })
      const { code } = (await created.json()) as { code: string }
      const add = await act(code, 'queue', host, {
        op: 'add',
        title: 'YouTube video',
        src: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        kind: 'youtube',
        duration: 0,
        thumbnail: 'linear-gradient(135deg, #3b0d08, #1a0503)',
      })
      expect(add.status).toBe(200)
      const s = await state(code, host)
      expect(s.playlist[0]).toMatchObject({
        title: 'YouTube video',
        src: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        kind: 'youtube',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
