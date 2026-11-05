import { useEffect, useState } from 'react'

/**
 * Local-only session helpers (username, avatar, recently joined rooms).
 * Read localStorage inside effects so SSR and the first client render match.
 */

export type Profile = { name: string; avatar: string }
export type RecentRoom = {
  code: string
  name: string
  joinedAt: number
  owner: boolean
}

const PROFILE_KEY = 'vionix.profile'
const RECENT_KEY = 'vionix.recent'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateRoomCode() {
  const pick = (n: number) =>
    Array.from(
      { length: n },
      () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
    ).join('')
  return `${pick(4)}-${pick(3)}`
}

export function normalizeRoomCode(input: string) {
  const raw = input
    .trim()
    .toUpperCase()
    .replace(/.*\/ROOM\//, '') // accept a pasted invite link
    .replace(/[^A-Z0-9]/g, '')
  if (raw.length !== 7) return null
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

export function sanitizeName(input: string) {
  return input
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .trim()
    .slice(0, 24)
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function saveProfile(profile: Profile) {
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
}

export function loadProfile(): Profile | null {
  return readJSON<Profile | null>(PROFILE_KEY, null)
}

export function rememberRoom(room: RecentRoom) {
  const list = readJSON<RecentRoom[]>(RECENT_KEY, []).filter(
    (r) => r.code !== room.code,
  )
  list.unshift(room)
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)))
}

export function forgetRoom(code: string) {
  const list = readJSON<RecentRoom[]>(RECENT_KEY, []).filter(
    (r) => r.code !== code,
  )
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(list))
}

export function useRecentRooms() {
  const [rooms, setRooms] = useState<RecentRoom[] | null>(null)
  useEffect(() => {
    // localStorage is client-only, so it's read after hydration (see AGENTS.md).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRooms(readJSON<RecentRoom[]>(RECENT_KEY, []))
  }, [])
  return [rooms, setRooms] as const
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only localStorage read
    setProfile(loadProfile())
    setReady(true)
  }, [])
  return { profile, setProfile, ready }
}

export function formatTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00'
  const s = Math.floor(totalSeconds % 60)
  const m = Math.floor((totalSeconds / 60) % 60)
  const h = Math.floor(totalSeconds / 3600)
  const ss = s.toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
