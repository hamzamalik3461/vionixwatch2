/** Wire types shared by the API routes and the browser. */

export type Role = 'owner' | 'participant'

export type ApiProfile = { id: string; name: string; avatar: string }

export type ApiMember = {
  id: string
  name: string
  avatar: string
  role: Role
  online: boolean
}

export type ApiVideo = {
  id: string
  title: string
  src: string
  kind: 'mp4' | 'hls' | 'mux' | 'youtube'
  duration: number
  thumbnail: string
  addedBy: string
}

export type ApiMessage = {
  id: number
  type: 'user' | 'system' | 'reaction'
  authorId: string | null
  authorName: string | null
  authorAvatar: string | null
  text: string
  at: number
}

export type ApiPlayback = {
  videoId: string | null
  playing: boolean
  position: number
  rate: number
  subtitle: string
  audio: string
  /** Server epoch ms when `position` was true. */
  updatedAt: number
}

export type ApiRoomInfo = {
  code: string
  name: string
  description: string
  visibility: 'public' | 'private'
  hasPassword: boolean
  capacity: number
  locked: boolean
  ended: boolean
  ownerId: string
  memberCount: number
}

export type Membership = 'member' | 'none' | 'removed'

export type RoomStateResponse = {
  serverNow: number
  room: ApiRoomInfo
  me: ApiProfile | null
  membership: Membership
  members: ApiMember[]
  playlist: ApiVideo[]
  playback: ApiPlayback | null
  messages: ApiMessage[]
}

export type PublicRoomSummary = {
  code: string
  name: string
  watching: string
  members: number
  capacity: number
  locked: boolean
  thumbnail: string
}

/** Messages the server pushes over the LiveKit data channel. */
export type RealtimeEvent =
  { t: 'sync' } | { t: 'playback'; playback: ApiPlayback; serverNow: number }
