import { getStore } from '@netlify/blobs'
import { avatarChoices } from '@/lib/catalog'
import { HttpError } from './http'

/**
 * Custom avatar images. The browser downscales the picture to a small square
 * and sends it as a data URL; it is stored as-is in Netlify Blobs (one blob
 * per profile) and served back from `/api/avatar/<profileId>`. The profile's
 * `avatar` column then holds that URL instead of an emoji.
 */

const STORE = 'avatars'
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const DATA_URL_RE =
  /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/=]+)$/

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const CUSTOM_AVATAR_RE =
  /^\/api\/avatar\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?v=\d+)?$/

export const isUuid = (s: string) => UUID_RE.test(s)

/**
 * An avatar value is valid when it is one of the emoji choices, or the
 * requester's own uploaded-image URL (so nobody can claim someone else's
 * upload, and a brand-new session can't reference an image that isn't theirs).
 */
export function isValidAvatar(avatar: string, ownProfileId: string | null) {
  if (avatarChoices.includes(avatar)) return true
  const m = CUSTOM_AVATAR_RE.exec(avatar)
  return Boolean(m && ownProfileId && m[1] === ownProfileId)
}

/** Stores the uploaded image and returns the URL to put in `profiles.avatar`. */
export async function saveAvatarImage(profileId: string, dataUrl: string) {
  const m = DATA_URL_RE.exec(dataUrl)
  if (!m)
    throw new HttpError(400, 'Upload a PNG, JPEG, WebP, GIF or AVIF image.')
  // Base64 is ~4/3 of the raw size; reject before decoding anything.
  if (m[2].length * 0.75 > MAX_IMAGE_BYTES)
    throw new HttpError(400, 'That image is too large — keep it under 2 MB.')
  await getStore(STORE).set(profileId, dataUrl)
  return `/api/avatar/${profileId}?v=${Date.now()}`
}

/** Reads a stored avatar back as bytes + content type, or null. */
export async function readAvatarImage(profileId: string) {
  const stored = await getStore(STORE).get(profileId, { type: 'text' })
  if (!stored) return null
  const m = DATA_URL_RE.exec(stored)
  if (!m) return null
  return {
    contentType: m[1],
    bytes: Buffer.from(m[2], 'base64'),
  }
}
