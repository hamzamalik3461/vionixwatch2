import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { profiles } from '../../db/schema.js'
import { HttpError } from './http'
import { hashPassword, verifyPassword } from './password'
import type { SessionProfile } from './session'

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export function normalizeUsername(raw: string) {
  const u = raw.trim().toLowerCase().replace(/^@/, '')
  if (!USERNAME_RE.test(u))
    throw new HttpError(
      400,
      'Usernames are 3–20 characters: lowercase letters, numbers and _',
    )
  return u
}

export function checkPassword(pw: string) {
  if (pw.length < 6)
    throw new HttpError(400, 'Passwords need at least 6 characters.')
  if (pw.length > 128) throw new HttpError(400, 'That password is too long.')
}

export async function findByUsername(username: string) {
  const [row] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.username, username))
    .limit(1)
  return row ?? null
}

/**
 * Attaches a username + password to a profile (upgrading a guest keeps their
 * room history), or verifies credentials for login.
 */
export async function registerProfile(
  current: SessionProfile | null,
  username: string,
  password: string,
  name: string,
  avatar: string,
) {
  if (current?.username)
    throw new HttpError(400, 'You already have an account on this device.')
  if (await findByUsername(username))
    throw new HttpError(409, 'That username is taken — try another.')
  const passwordHash = hashPassword(password)
  if (current) {
    const [row] = await db
      .update(profiles)
      .set({ username, passwordHash, name, avatar })
      .where(eq(profiles.id, current.id))
      .returning()
    return { profile: row, isNew: false as const }
  }
  const [row] = await db
    .insert(profiles)
    .values({ username, passwordHash, name, avatar })
    .returning()
  return { profile: row, isNew: true as const }
}

export async function verifyLogin(username: string, password: string) {
  const row = await findByUsername(username)
  if (!row?.passwordHash || !verifyPassword(password, row.passwordHash))
    throw new HttpError(401, 'Wrong username or password.')
  return row
}
