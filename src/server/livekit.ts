import {
  AccessToken,
  DataPacket_Kind,
  RoomServiceClient,
  TrackSource,
} from 'livekit-server-sdk'
import type { RealtimeEvent } from '@/lib/room-types'
import { runtimeEnv } from './runtime-env'

/** LiveKit room name for a Vionix Watch room code. */
export const lkRoomName = (code: string) => `vionix-${code}`

function config() {
  const url = runtimeEnv('LIVEKIT_URL')
  const key = runtimeEnv('LIVEKIT_API_KEY')
  const secret = runtimeEnv('LIVEKIT_API_SECRET')
  if (!url || !key || !secret) return null
  try {
    const endpoint = new URL(url)
    if (!['wss:', 'ws:', 'https:', 'http:'].includes(endpoint.protocol))
      return null
    if (endpoint.username || endpoint.password) return null
    endpoint.protocol = ['https:', 'wss:'].includes(endpoint.protocol)
      ? 'wss:'
      : 'ws:'
    const wsUrl = endpoint.toString().replace(/\/$/, '')
    return { url: wsUrl, key, secret, httpUrl: wsUrl.replace(/^ws/, 'http') }
  } catch {
    return null
  }
}

export function livekitConfigured() {
  return config() !== null
}

export async function voiceToken(code: string, identity: string, name: string) {
  const c = config()
  if (!c) return null
  const at = new AccessToken(c.key, c.secret, { identity, name, ttl: '6h' })
  at.addGrant({
    room: lkRoomName(code),
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishSources: [
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ],
    // Only the server sends data, so a client can never forge playback or chat.
    canPublishData: false,
    canUpdateOwnMetadata: true,
  })
  return { url: c.url, token: await at.toJwt() }
}

function client() {
  const c = config()
  return c ? new RoomServiceClient(c.httpUrl, c.key, c.secret) : null
}

/** LiveKit room name for a 1:1 call. */
export const callRoomName = (callId: string) => `vionix-call-${callId}`

/** Token for a 1:1 voice/video call: mic + camera + screen, locked to the call's room. */
export async function callToken(
  callId: string,
  identity: string,
  name: string,
) {
  const c = config()
  if (!c) return null
  const at = new AccessToken(c.key, c.secret, { identity, name, ttl: '4h' })
  at.addGrant({
    room: callRoomName(callId),
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishSources: [
      TrackSource.MICROPHONE,
      TrackSource.CAMERA,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ],
    canPublishData: false,
    canUpdateOwnMetadata: true,
  })
  return { url: c.url, token: await at.toJwt() }
}

/** Tears down a call's LiveKit room so both sides disconnect immediately. */
export async function closeCallRoom(callId: string) {
  const c = client()
  if (!c) return
  try {
    await withTimeout(c.deleteRoom(callRoomName(callId)), 2500)
  } catch {
    // Room may never have been created; polling handles the rest.
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), ms),
    ),
  ])

/** Pushes an event to everyone connected to the room. Clients also poll, so failures are non-fatal. */
export async function broadcast(code: string, event: RealtimeEvent) {
  const c = client()
  if (!c) return
  try {
    const data = new TextEncoder().encode(JSON.stringify(event))
    await withTimeout(
      c.sendData(lkRoomName(code), data, DataPacket_Kind.RELIABLE, {
        topic: 'nw',
      }),
      2500,
    )
  } catch {
    // Room may not exist on LiveKit yet (nobody connected); polling covers it.
  }
}

export async function kickParticipant(code: string, identity: string) {
  const c = client()
  if (!c) return
  try {
    await withTimeout(c.removeParticipant(lkRoomName(code), identity), 2500)
  } catch {
    // Not connected to voice; nothing to kick.
  }
}
