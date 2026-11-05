/** Wire types for accounts, friends, direct messages and 1:1 calls. */

export type AccountProfile = {
  id: string
  name: string
  avatar: string
  username: string | null
}

export type ApiFriend = {
  id: string
  name: string
  avatar: string
  username: string
  online: boolean
}

export type ApiFriendRequest = {
  id: string
  name: string
  avatar: string
  username: string
  at: number
}

export type FriendsResponse = {
  friends: ApiFriend[]
  incoming: ApiFriendRequest[]
  outgoing: ApiFriendRequest[]
}

export type ApiDmMessage = {
  id: number
  kind: 'text' | 'call'
  senderId: string | null
  text: string
  at: number
}

export type ApiThreadSummary = {
  id: string
  friend: ApiFriend
  lastMessage: { text: string; kind: 'text' | 'call'; mine: boolean } | null
  lastMessageAt: number
  unread: number
}

export type CallKind = 'voice' | 'video'
export type CallStatus = 'ringing' | 'active' | 'ended' | 'declined' | 'missed'

export type ApiCall = {
  id: string
  threadId: string
  callerId: string
  kind: CallKind
  status: CallStatus
  at: number
}

export type ThreadResponse = {
  serverNow: number
  thread: { id: string }
  friend: ApiFriend
  messages: ApiDmMessage[]
  call: ApiCall | null
}

export type IncomingCall = ApiCall & { from: ApiFriend }

/** One light poll that powers header badges and the call banner. */
export type SocialPulse = {
  incoming: IncomingCall | null
  call: ApiCall | null
  unread: number
  requests: number
}

export type CallTicket = { call: ApiCall; url: string; token: string } | null
