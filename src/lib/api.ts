import type {
  ApiProfile,
  PublicRoomSummary,
  RoomStateResponse,
} from './room-types'
import type {
  AccountProfile,
  ApiCall,
  ApiDmMessage,
  ApiFriend,
  ApiThreadSummary,
  CallKind,
  FriendsResponse,
  SocialPulse,
  ThreadResponse,
} from './social-types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch {
    throw new ApiError(0, 'Network error — check your connection')
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok)
    throw new ApiError(res.status, data.error ?? 'Something went wrong')
  return data
}

export const getSession = () =>
  api<{ profile: ApiProfile | null }>('/api/session')
export const saveSession = (name: string, avatar: string) =>
  api<{ profile: ApiProfile }>('/api/session', { name, avatar })
/** Uploads a custom avatar image (data URL); returns its serving URL. */
export const uploadAvatar = (image: string) =>
  api<{ avatar: string }>('/api/avatar', { image })
export const createRoomApi = (input: {
  name: string
  visibility: 'public' | 'private'
  password?: string
}) => api<{ code: string }>('/api/rooms', input)
export const getLobby = () =>
  api<{ online: number; rooms: PublicRoomSummary[] }>('/api/rooms')
export const getRoomState = (code: string, after: number) =>
  api<RoomStateResponse>(`/api/rooms/${code}?after=${after}`)
export const roomAction = <T = { ok: true }>(
  code: string,
  action: string,
  body: unknown = {},
) => api<T>(`/api/rooms/${code}/${action}`, body)

/* ------------------------- accounts, friends, DMs ------------------------- */

export const getAccount = () =>
  api<{ profile: AccountProfile | null }>('/api/session')
export const registerAccount = (input: {
  username: string
  password: string
  name: string
  avatar: string
}) =>
  api<{ profile: AccountProfile }>('/api/auth', {
    action: 'register',
    ...input,
  })
export const loginAccount = (username: string, password: string) =>
  api<{ profile: AccountProfile }>('/api/auth', {
    action: 'login',
    username,
    password,
  })
export const logoutAccount = () =>
  api<{ profile: null }>('/api/auth', { action: 'logout' })
/** Exchanges a completed Google/GitHub sign-in for an app session. */
export const oauthAccount = () =>
  api<{ profile: AccountProfile; mode: 'signed-in' | 'linked' | 'created' }>(
    '/api/auth',
    { action: 'oauth' },
  )

export const getFriends = () => api<FriendsResponse>('/api/friends')
export const sendFriendRequestApi = (username: string) =>
  api<{ accepted: boolean; friend: ApiFriend }>('/api/friends', {
    action: 'request',
    username,
  })
export const friendAction = (
  action: 'accept' | 'decline' | 'cancel' | 'remove',
  profileId: string,
) => api<{ ok: true }>('/api/friends', { action, profileId })

export const getThreads = () => api<{ threads: ApiThreadSummary[] }>('/api/dms')
export const openThreadApi = (friendId: string) =>
  api<{ threadId: string }>('/api/dms', { friendId })
export const getThread = (id: string, after = 0) =>
  api<ThreadResponse>(`/api/dms/${id}?after=${after}`)
export const sendDmApi = (id: string, text: string) =>
  api<{ message: ApiDmMessage }>(`/api/dms/${id}`, {
    action: 'message',
    text,
  })
export const markReadApi = (id: string, lastId: number) =>
  api<{ ok: true }>(`/api/dms/${id}`, { action: 'read', lastId })

export const getPulse = () => api<SocialPulse>('/api/calls')
export type CallTicketResponse = { call: ApiCall; url?: string; token?: string }
export const startCallApi = (threadId: string, kind: CallKind) =>
  api<CallTicketResponse>('/api/calls', { action: 'start', threadId, kind })
export const callAction = (
  action: 'accept' | 'decline' | 'end',
  callId: string,
) => api<CallTicketResponse>('/api/calls', { action, callId })
