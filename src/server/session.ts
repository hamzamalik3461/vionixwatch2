import { createHash, randomBytes } from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { profiles, sessions } from '../../db/schema.js'
import { HttpError } from './http'

const COOKIE = 'nw_sid'
const MAX_AGE = 60 * 60 * 24 * 365

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

function readCookie(request: Request) {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === COOKIE) return decodeURIComponent(v.join('='))
  }
  return null
}

const cookieFor = (token: string, maxAge = MAX_AGE) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`

export type SessionProfile = typeof profiles.$inferSelect

/** The profile behind the httpOnly session cookie, or null. */
export async function getProfile(
  request: Request,
): Promise<SessionProfile | null> {
  const token = readCookie(request)
  if (!token || token.length < 32 || token.length > 128) return null
  const [row] = await db
    .select({ profile: profiles })
    .from(sessions)
    .innerJoin(profiles, eq(profiles.id, sessions.profileId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1)
  if (!row) return null
  // Keep a coarse last-seen for friend presence without writing on every request.
  if (Date.now() - row.profile.lastSeenAt.getTime() > 45_000) {
    const seenAt = new Date()
    await db
      .update(profiles)
      .set({ lastSeenAt: seenAt })
      .where(eq(profiles.id, row.profile.id))
    return { ...row.profile, lastSeenAt: seenAt }
  }
  return row.profile
}

export async function requireProfile(request: Request) {
  const p = await getProfile(request)
  if (!p) throw new HttpError(401, 'Pick a username first')
  return p
}

/** Like requireProfile, but only satisfied by a registered account. */
export async function requireAccount(request: Request) {
  const p = await requireProfile(request)
  if (!p.username)
    throw new HttpError(401, 'Sign in to use friends and messages')
  return p as SessionProfile & { username: string }
}

/** Opens a new session (device) for an existing profile. */
export async function createSession(profileId: string) {
  const token = randomBytes(32).toString('base64url')
  await db.insert(sessions).values({ tokenHash: hashToken(token), profileId })
  return cookieFor(token)
}

/** Creates a new anonymous profile and returns the Set-Cookie header for it. */
export async function createProfile(name: string, avatar: string) {
  const [row] = await db.insert(profiles).values({ name, avatar }).returning()
  const cookie = await createSession(row.id)
  return { profile: row, cookie }
}

/** Ends the current session; returns the expired Set-Cookie header. */
export async function destroySession(request: Request) {
  const token = readCookie(request)
  if (token && token.length >= 32 && token.length <= 128)
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
  return cookieFor('', 0)
}

/** Drops sessions that have not been used for over a year. Best effort. */
export async function sweepSessions() {
  const cutoff = new Date(Date.now() - MAX_AGE * 1000)
  await db.delete(sessions).where(lt(sessions.createdAt, cutoff))
}

export function sanitizeName(input: string) {
  return input
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .trim()
    .slice(0, 24)
}
