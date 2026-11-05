import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { profiles } from '../../db/schema.js'
import { avatarChoices } from '@/lib/catalog'
import { sanitizeName, type SessionProfile } from './session'

/** The verified fields we use from a Google / GitHub sign-in. */
export type OAuthIdentity = {
  /** Stable subject id issued by the identity service. */
  id: string
  email?: string
  name?: string
}

const USERNAME_MAX = 20

/** Derives a valid, unused username from the provider's name or email. */
async function pickUsername(idUser: OAuthIdentity) {
  const raw = (idUser.name || idUser.email?.split('@')[0] || 'viewer')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, USERNAME_MAX)
  const base = raw.length >= 3 ? raw : `viewer_${raw}`.slice(0, USERNAME_MAX)
  for (let i = 0; i < 25; i++) {
    const suffix = i === 0 ? '' : String(Math.floor(Math.random() * 10_000))
    const candidate = base.slice(0, USERNAME_MAX - suffix.length) + suffix
    const [taken] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.username, candidate))
      .limit(1)
    if (!taken) return candidate
  }
  return `viewer_${Math.random().toString(36).slice(2, 10)}`
}

export type OAuthResult = {
  profile: SessionProfile
  /** 'signed-in': existing linked account · 'linked': added to this device's
   *  account · 'created': brand-new account (or a guest upgraded in place). */
  mode: 'signed-in' | 'linked' | 'created'
}

/**
 * Turns a verified OAuth sign-in into an app account. Matches strictly on the
 * identity's stable subject id (never by email, so an unverified address can't
 * take over an account). A guest on this device is upgraded in place, keeping
 * their room history — same as password registration.
 */
export async function loginWithOAuth(
  current: SessionProfile | null,
  idUser: OAuthIdentity,
): Promise<OAuthResult> {
  const [existing] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.oauthSub, idUser.id))
    .limit(1)
  if (existing) return { profile: existing, mode: 'signed-in' }

  const email = idUser.email ?? null

  // Attach the identity to the profile already on this device (guest or
  // password account that has no provider linked yet).
  if (current && !current.oauthSub) {
    const wasGuest = !current.username
    const [row] = await db
      .update(profiles)
      .set({
        oauthSub: idUser.id,
        email,
        ...(wasGuest ? { username: await pickUsername(idUser) } : {}),
      })
      .where(eq(profiles.id, current.id))
      .returning()
    return { profile: row, mode: wasGuest ? 'created' : 'linked' }
  }

  // Fresh account for this identity.
  const cleaned = sanitizeName(idUser.name ?? idUser.email?.split('@')[0] ?? '')
  const name = cleaned.length >= 2 ? cleaned : 'Viewer'
  const avatar = avatarChoices[Math.floor(Math.random() * avatarChoices.length)]
  const [row] = await db
    .insert(profiles)
    .values({
      username: await pickUsername(idUser),
      name,
      avatar,
      oauthSub: idUser.id,
      email,
    })
    .returning()
  return { profile: row, mode: 'created' }
}
