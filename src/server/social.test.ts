// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/** Runs the real social API routes against an in-memory Postgres with the real migrations. */
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
// No LiveKit in tests: call tickets come back without tokens, which is fine.
vi.stubEnv('LIVEKIT_URL', '')

const { Route: sessionRoute } = await import('@/routes/api.session')
const { Route: authRoute } = await import('@/routes/api.auth')
const { Route: friendsRoute } = await import('@/routes/api.friends')
const { Route: dmsRoute } = await import('@/routes/api.dms')
const { Route: dmRoute } = await import('@/routes/api.dms.$id')
const { Route: callsRoute } = await import('@/routes/api.calls')

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

const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]

async function newGuest(name: string) {
  const res = await handlers(sessionRoute).POST({
    request: req('/api/session', undefined, { name, avatar: '🦉' }),
    params: {},
  })
  expect(res.status).toBe(200)
  return cookieOf(res)
}

const auth = (body: unknown, cookie?: string) =>
  handlers(authRoute).POST({
    request: req('/api/auth', cookie, body),
    params: {},
  })

/** Creates a fresh registered account and returns its cookie + profile. */
async function newAccount(username: string, name: string) {
  const res = await auth({
    action: 'register',
    username,
    password: 'secret123',
    name,
    avatar: '🦊',
  })
  expect(res.status).toBe(201)
  const { profile } = (await res.json()) as {
    profile: { id: string; username: string }
  }
  return { cookie: cookieOf(res), profile }
}

const friends = (cookie: string, body?: unknown) =>
  body === undefined
    ? handlers(friendsRoute).GET({
        request: req('/api/friends', cookie),
        params: {},
      })
    : handlers(friendsRoute).POST({
        request: req('/api/friends', cookie, body),
        params: {},
      })

const dms = (cookie: string, body?: unknown) =>
  body === undefined
    ? handlers(dmsRoute).GET({ request: req('/api/dms', cookie), params: {} })
    : handlers(dmsRoute).POST({
        request: req('/api/dms', cookie, body),
        params: {},
      })

const dm = (id: string, cookie: string, body?: unknown, after = 0) =>
  body === undefined
    ? handlers(dmRoute).GET({
        request: req(`/api/dms/${id}?after=${after}`, cookie),
        params: { id },
      })
    : handlers(dmRoute).POST({
        request: req(`/api/dms/${id}`, cookie, body),
        params: { id },
      })

const calls = (cookie: string, body?: unknown) =>
  body === undefined
    ? handlers(callsRoute).GET({
        request: req('/api/calls', cookie),
        params: {},
      })
    : handlers(callsRoute).POST({
        request: req('/api/calls', cookie, body),
        params: {},
      })

const json = async <T>(res: Response) => (await res.json()) as T

describe('accounts', () => {
  it('upgrades a guest, enforces unique usernames and logs in from a new device', async () => {
    const guest = await newGuest('Casey')
    const before = await json<{ profile: { id: string } }>(
      await handlers(sessionRoute).GET({
        request: req('/api/session', guest),
        params: {},
      }),
    )

    // Registering on a guest session keeps the same profile id.
    const reg = await auth(
      {
        action: 'register',
        username: 'Casey_01',
        password: 'secret123',
        name: 'Casey',
        avatar: '🦉',
      },
      guest,
    )
    expect(reg.status).toBe(201)
    const regBody = await json<{ profile: { id: string; username: string } }>(
      reg,
    )
    expect(regBody.profile.id).toBe(before.profile.id)
    expect(regBody.profile.username).toBe('casey_01')

    // The session now reports the username.
    const session = await json<{ profile: { username: string } }>(
      await handlers(sessionRoute).GET({
        request: req('/api/session', guest),
        params: {},
      }),
    )
    expect(session.profile.username).toBe('casey_01')

    // Usernames are unique.
    expect(
      (
        await auth({
          action: 'register',
          username: 'casey_01',
          password: 'different1',
          name: 'Impostor',
          avatar: '🦊',
        })
      ).status,
    ).toBe(409)

    // Wrong password fails; right password signs in from a fresh device.
    expect(
      (
        await auth({
          action: 'login',
          username: 'casey_01',
          password: 'nope00',
        })
      ).status,
    ).toBe(401)
    const login = await auth({
      action: 'login',
      username: 'casey_01',
      password: 'secret123',
    })
    expect(login.status).toBe(200)
    const device2 = cookieOf(login)
    const s2 = await json<{ profile: { id: string } }>(
      await handlers(sessionRoute).GET({
        request: req('/api/session', device2),
        params: {},
      }),
    )
    expect(s2.profile.id).toBe(before.profile.id)

    // The first device still works (sessions are per device)…
    expect(
      (
        await json<{ profile: { id: string } | null }>(
          await handlers(sessionRoute).GET({
            request: req('/api/session', guest),
            params: {},
          }),
        )
      ).profile?.id,
    ).toBe(before.profile.id)

    // …until logout kills that device's session.
    const out = await auth({ action: 'logout' }, device2)
    expect(out.status).toBe(200)
    expect(
      (
        await json<{ profile: unknown }>(
          await handlers(sessionRoute).GET({
            request: req('/api/session', device2),
            params: {},
          }),
        )
      ).profile,
    ).toBeNull()

    // Short or malformed usernames are rejected.
    expect(
      (
        await auth({
          action: 'register',
          username: 'x',
          password: 'secret123',
          name: 'Shorty',
          avatar: '🦊',
        })
      ).status,
    ).toBe(400)
  })
})

describe('friends', () => {
  it('runs the full request → accept → remove lifecycle', async () => {
    const a = await newAccount('alice', 'Alice')
    const b = await newAccount('bob', 'Bob')

    // Guests can't use the friends API.
    const guest = await newGuest('Visitor')
    expect((await friends(guest)).status).toBe(401)

    // Bad targets.
    expect(
      (await friends(a.cookie, { action: 'request', username: 'nobody' }))
        .status,
    ).toBe(404)
    expect(
      (await friends(a.cookie, { action: 'request', username: 'alice' }))
        .status,
    ).toBe(400)

    // Request with an @ prefix lands with Bob.
    expect(
      (await friends(a.cookie, { action: 'request', username: '@bob' })).status,
    ).toBe(201)
    // Duplicate request is blocked.
    expect(
      (await friends(a.cookie, { action: 'request', username: 'bob' })).status,
    ).toBe(400)

    const bobView = await json<{
      incoming: { id: string; username: string }[]
      friends: unknown[]
    }>(await friends(b.cookie))
    expect(bobView.incoming.map((r) => r.username)).toEqual(['alice'])

    // The pending request shows up in Bob's pulse badge.
    const pulse = await json<{ requests: number }>(await calls(b.cookie))
    expect(pulse.requests).toBe(1)

    // Accept → both sides list each other.
    expect(
      (
        await friends(b.cookie, {
          action: 'accept',
          profileId: bobView.incoming[0].id,
        })
      ).status,
    ).toBe(200)
    const aliceView = await json<{ friends: { username: string }[] }>(
      await friends(a.cookie),
    )
    expect(aliceView.friends.map((f) => f.username)).toEqual(['bob'])

    // A crossing request auto-accepts: carol asks dave after dave asked carol.
    const c = await newAccount('carol', 'Carol')
    const d = await newAccount('dave', 'Dave')
    await friends(d.cookie, { action: 'request', username: 'carol' })
    const crossed = await json<{ accepted: boolean }>(
      await friends(c.cookie, { action: 'request', username: 'dave' }),
    )
    expect(crossed.accepted).toBe(true)

    // Remove: alice drops bob, both lists empty.
    expect(
      (
        await friends(a.cookie, {
          action: 'remove',
          profileId: b.profile.id,
        })
      ).status,
    ).toBe(200)
    expect(
      (await json<{ friends: unknown[] }>(await friends(a.cookie))).friends,
    ).toEqual([])
    expect(
      (await json<{ friends: unknown[] }>(await friends(b.cookie))).friends,
    ).toEqual([])
  })
})

describe('direct messages', () => {
  it('chats between friends with unread counts and read markers', async () => {
    const a = await newAccount('eve', 'Eve')
    const b = await newAccount('finn', 'Finn')
    const s = await newAccount('stranger', 'Stranger')

    // DMs require friendship.
    expect((await dms(a.cookie, { friendId: s.profile.id })).status).toBe(403)

    await friends(a.cookie, { action: 'request', username: 'finn' })
    const bView = await json<{ incoming: { id: string }[] }>(
      await friends(b.cookie),
    )
    await friends(b.cookie, {
      action: 'accept',
      profileId: bView.incoming[0].id,
    })

    // Opening twice returns the same thread.
    const t1 = await json<{ threadId: string }>(
      await dms(a.cookie, { friendId: b.profile.id }),
    )
    const t2 = await json<{ threadId: string }>(
      await dms(b.cookie, { friendId: a.profile.id }),
    )
    expect(t1.threadId).toBe(t2.threadId)
    const tid = t1.threadId

    // A stranger can't read it.
    expect((await dm(tid, s.cookie)).status).toBe(404)

    // Eve writes, Finn reads it with an unread badge first.
    expect(
      (await dm(tid, a.cookie, { action: 'message', text: 'hey finn!' }))
        .status,
    ).toBe(201)
    const finnPulse = await json<{ unread: number }>(await calls(b.cookie))
    expect(finnPulse.unread).toBe(1)

    const thread = await json<{
      messages: { id: number; text: string }[]
      friend: { username: string }
    }>(await dm(tid, b.cookie))
    expect(thread.friend.username).toBe('eve')
    expect(thread.messages.map((m) => m.text)).toEqual(['hey finn!'])

    // Reading clears the badge.
    await dm(tid, b.cookie, {
      action: 'read',
      lastId: thread.messages[0].id,
    })
    expect((await json<{ unread: number }>(await calls(b.cookie))).unread).toBe(
      0,
    )

    // Incremental fetch only returns newer messages.
    await dm(tid, b.cookie, { action: 'message', text: 'hi eve' })
    const inc = await json<{ messages: { text: string }[] }>(
      await dm(tid, a.cookie, undefined, thread.messages[0].id),
    )
    expect(inc.messages.map((m) => m.text)).toEqual(['hi eve'])

    // The thread list shows the conversation and its last message.
    const list = await json<{
      threads: { id: string; lastMessage: { text: string } | null }[]
    }>(await dms(a.cookie))
    expect(list.threads).toHaveLength(1)
    expect(list.threads[0].lastMessage?.text).toBe('hi eve')

    // Text chat is rate limited.
    const statuses = []
    for (let i = 0; i < 10; i++)
      statuses.push(
        (await dm(tid, a.cookie, { action: 'message', text: `spam ${i}` }))
          .status,
      )
    expect(statuses).toContain(429)
  })
})

describe('calls', () => {
  let pairNo = 0
  async function pair() {
    pairNo++
    const a = await newAccount(`caller${pairNo}`, 'Caller')
    const b = await newAccount(`callee${pairNo}`, 'Callee')
    await friends(a.cookie, { action: 'request', username: b.profile.username })
    const bView = await json<{ incoming: { id: string }[] }>(
      await friends(b.cookie),
    )
    await friends(b.cookie, {
      action: 'accept',
      profileId: bView.incoming[0].id,
    })
    const { threadId } = await json<{ threadId: string }>(
      await dms(a.cookie, { friendId: b.profile.id }),
    )
    return { a, b, threadId }
  }

  it('rings, connects and ends a call', async () => {
    const { a, b, threadId } = await pair()

    const started = await json<{ call: { id: string; status: string } }>(
      await calls(a.cookie, { action: 'start', threadId, kind: 'video' }),
    )
    expect(started.call.status).toBe('ringing')

    // Only one live call per conversation.
    expect(
      (await calls(a.cookie, { action: 'start', threadId, kind: 'voice' }))
        .status,
    ).toBe(409)

    // Callee sees it ringing; the caller does not get their own ring.
    const inc = await json<{ incoming: { id: string; kind: string } | null }>(
      await calls(b.cookie),
    )
    expect(inc.incoming?.id).toBe(started.call.id)
    expect(inc.incoming?.kind).toBe('video')
    expect(
      (await json<{ incoming: unknown }>(await calls(a.cookie))).incoming,
    ).toBeNull()

    // The caller can't accept their own call.
    expect(
      (await calls(a.cookie, { action: 'accept', callId: started.call.id }))
        .status,
    ).toBe(400)

    const accepted = await json<{ call: { status: string } }>(
      await calls(b.cookie, { action: 'accept', callId: started.call.id }),
    )
    expect(accepted.call.status).toBe('active')

    const ended = await json<{ call: { status: string } }>(
      await calls(a.cookie, { action: 'end', callId: started.call.id }),
    )
    expect(ended.call.status).toBe('ended')

    // The call left a log line in the chat.
    const thread = await json<{ messages: { kind: string; text: string }[] }>(
      await dm(threadId, b.cookie),
    )
    expect(thread.messages.some((m) => m.kind === 'call')).toBe(true)
  })

  it('handles declined and missed calls', async () => {
    const { a, b, threadId } = await pair()

    const started = await json<{ call: { id: string } }>(
      await calls(a.cookie, { action: 'start', threadId, kind: 'voice' }),
    )
    const declined = await json<{ call: { status: string } }>(
      await calls(b.cookie, { action: 'decline', callId: started.call.id }),
    )
    expect(declined.call.status).toBe('declined')
    // A declined call stops ringing for the callee.
    expect(
      (await json<{ incoming: unknown }>(await calls(b.cookie))).incoming,
    ).toBeNull()

    // An unanswered ring expires into a missed call.
    const again = await json<{ call: { id: string } }>(
      await calls(a.cookie, { action: 'start', threadId, kind: 'voice' }),
    )
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60_000)
    const pulse = await json<{
      incoming: unknown
      call: { id: string; status: string } | null
    }>(await calls(b.cookie))
    vi.useRealTimers()
    expect(pulse.incoming).toBeNull()
    if (pulse.call?.id === again.call.id)
      expect(pulse.call.status).toBe('missed')
    const thread = await json<{ messages: { text: string }[] }>(
      await dm(threadId, b.cookie),
    )
    expect(thread.messages.some((m) => m.text === 'Missed voice call')).toBe(
      true,
    )
  })
})
