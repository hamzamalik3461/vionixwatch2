/**
 * Static product data: client-side types for the room UI, avatar choices,
 * playback speeds and reaction emojis. Everything live (members, chat,
 * playback, rooms) comes from the API.
 */

export type Role = 'owner' | 'participant'

export type Member = {
  id: string
  name: string
  avatar: string // emoji avatar
  color: string // CSS color for avatar background
  role: Role
  online: boolean
  inVoice: boolean
  muted: boolean
  deafened: boolean
  speaking: boolean
}

export type Video = {
  id: string
  title: string
  src: string
  kind: 'mp4' | 'hls' | 'mux' | 'youtube'
  duration: number // seconds
  thumbnail: string // CSS gradient used as poster art
  addedBy: string
}

export type ChatMessage = {
  id: number
  type: 'user' | 'system'
  authorId: string | null
  authorName: string | null
  authorAvatar: string | null
  text: string
  at: number // epoch ms
}

export type RoomSettings = {
  name: string
  description: string
  visibility: 'public' | 'private'
  hasPassword: boolean
  capacity: number
  locked: boolean
}

export const avatarChoices = [
  '🦉',
  '🐺',
  '🦊',
  '🐉',
  '👾',
  '🛸',
  '🌙',
  '⚡',
  '🎮',
  '🐼',
  '🦇',
  '🔮',
]

/** True when an avatar value is an uploaded image (URL or local preview) rather than an emoji. */
export const isImageAvatar = (avatar: string) =>
  avatar.startsWith('/api/avatar/') || avatar.startsWith('data:image/')

export const playbackSpeeds = [0.5, 0.75, 1, 1.25, 1.5, 2]

export const reactionEmojis = ['🔥', '😂', '😱', '❤️', '👏', '💀']

const MEMBER_COLORS = [
  'oklch(0.62 0.24 295)',
  'oklch(0.72 0.17 235)',
  'oklch(0.76 0.17 155)',
  'oklch(0.82 0.16 80)',
  'oklch(0.65 0.22 15)',
  'oklch(0.7 0.2 330)',
]

/** Stable avatar color per member id. */
export function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return MEMBER_COLORS[Math.abs(h) % MEMBER_COLORS.length]
}
