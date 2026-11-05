import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ApiError,
  getRoomState,
  roomAction,
  saveSession,
  uploadAvatar,
} from '@/lib/api'
import {
  colorFor,
  type ChatMessage,
  type Member,
  type RoomSettings,
  type Video,
} from '@/lib/catalog'
import type {
  ApiPlayback,
  ApiProfile,
  RealtimeEvent,
  RoomStateResponse,
} from '@/lib/room-types'
import {
  loadProfile,
  rememberRoom,
  saveProfile,
  type Profile,
} from '@/lib/session'
import { playSound } from '@/lib/sounds'

/**
 * Room state, backed by the Vionix Watch API (Netlify Database).
 *
 * Every action is a server call; the server checks ownership against the
 * database. Updates arrive two ways: an instant push over the LiveKit data
 * channel (see useVoice → `onRealtime`) and a 3-second poll that also acts as
 * the presence heartbeat, so the room keeps working if realtime drops.
 */

export type Reaction = { id: string; emoji: string; x: number }

export type RoomPhase =
  | 'loading'
  | 'notFound'
  | 'ended'
  | 'needsProfile'
  | 'needsPassword'
  | 'locked'
  | 'full'
  | 'removed'
  | 'error'
  | 'ready'

const POLL_MS = 3000

function toMember(m: RoomStateResponse['members'][number]): Member {
  return {
    ...m,
    color: colorFor(m.id),
    inVoice: false,
    muted: false,
    deafened: false,
    speaking: false,
  }
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong'
}

export function useRoom(code: string) {
  const [phase, setPhase] = useState<RoomPhase>('loading')
  const [phaseError, setPhaseError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ApiProfile | null>(null)
  const [suggestedProfile, setSuggestedProfile] = useState<Profile | null>(null)
  const [state, setState] = useState<RoomStateResponse | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [playback, setPlayback] = useState<ApiPlayback | null>(null)
  const [previewAsGuest, setPreviewAsGuest] = useState(false)

  const cursor = useRef(0)
  const seen = useRef(new Set<number>())
  const clock = useRef({ offset: 0, rtt: Infinity, at: 0 })
  const inflight = useRef(false)
  const again = useRef(false)
  const playbackRef = useRef<ApiPlayback | null>(null)

  /** Current time on the server's clock (ms). */
  const serverNow = useCallback(() => Date.now() + clock.current.offset, [])

  const pushReaction = useCallback((emoji: string) => {
    const r = {
      id: `${Date.now()}-${Math.random()}`,
      emoji,
      x: 10 + Math.random() * 80,
    }
    setReactions((list) => [...list.slice(-20), r])
    setTimeout(
      () => setReactions((list) => list.filter((x) => x.id !== r.id)),
      2500,
    )
  }, [])

  const acceptPlayback = useCallback(
    (pb: ApiPlayback | null, force = false) => {
      if (!pb) return
      const cur = playbackRef.current
      // Ignore stale responses that started before a newer change.
      if (!force && cur && pb.updatedAt < cur.updatedAt) return
      playbackRef.current = pb
      setPlayback(pb)
    },
    [],
  )

  const ingestMessages = useCallback(
    (
      incoming: RoomStateResponse['messages'],
      serverTime: number,
      fromPoll: boolean,
    ) => {
      const fresh = incoming.filter((m) => !seen.current.has(m.id))
      for (const m of incoming) {
        seen.current.add(m.id)
        if (fromPoll) cursor.current = Math.max(cursor.current, m.id)
      }
      if (!fresh.length) return
      for (const m of fresh) {
        if (m.type === 'reaction' && serverTime - m.at < 8000)
          pushReaction(m.text)
        // Soft chime for people coming and going (recent events only).
        if (m.type === 'system' && serverTime - m.at < 8000) {
          if (m.text.endsWith('joined the room')) playSound('member-join')
          else if (m.text.endsWith('left the room')) playSound('member-leave')
        }
      }
      const chat = fresh.filter(
        (m): m is typeof m & { type: 'user' | 'system' } =>
          m.type !== 'reaction',
      )
      if (chat.length)
        setMessages((list) =>
          [...list, ...chat].sort((a, b) => a.id - b.id).slice(-300),
        )
    },
    [pushReaction],
  )

  const apply = useCallback(
    (s: RoomStateResponse) => {
      setState(s)
      setProfile(s.me)
      if (s.room.ended) return setPhase('ended')
      if (s.membership === 'removed') return setPhase('removed')
      if (s.membership !== 'member') return
      acceptPlayback(s.playback)
      ingestMessages(s.messages, s.serverNow, true)
      setPhase('ready')
    },
    [acceptPlayback, ingestMessages],
  )

  const fetchState = useCallback(async () => {
    const t0 = Date.now()
    const s = await getRoomState(code, cursor.current)
    const t1 = Date.now()
    const rtt = t1 - t0
    const c = clock.current
    // Keep the lowest-latency clock sample; refresh it every minute.
    if (rtt <= c.rtt * 1.2 || t1 - c.at > 60_000) {
      clock.current = { offset: s.serverNow - (t0 + t1) / 2, rtt, at: t1 }
    }
    return s
  }, [code])

  /** Pulls fresh state now. Calls made while a fetch runs are coalesced. */
  const refresh = useCallback(async () => {
    if (inflight.current) {
      again.current = true
      return
    }
    inflight.current = true
    try {
      do {
        again.current = false
        apply(await fetchState())
      } while (again.current)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setPhase('notFound')
    } finally {
      inflight.current = false
    }
  }, [apply, fetchState])

  /** Join attempt for a non-member. Resolves to the resulting phase. */
  const tryJoin = useCallback(
    async (password?: string) => {
      try {
        await roomAction(code, 'join', password ? { password } : {})
        cursor.current = 0
        apply(await fetchState())
        return true
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0
        if (status === 401) setPhase('needsPassword')
        else if (status === 423) setPhase('locked')
        else if (status === 409) setPhase('full')
        else if (status === 403) setPhase('removed')
        else if (status === 410) setPhase('ended')
        else {
          setPhaseError(errorMessage(e))
          setPhase('error')
        }
        if (password && status === 401) toast.error(errorMessage(e))
        return false
      }
    },
    [apply, code, fetchState],
  )

  const enter = useCallback(async () => {
    try {
      let s = await fetchState()
      if (s.room.ended) return apply(s)
      if (!s.me) {
        const local = loadProfile()
        setSuggestedProfile(local)
        if (!local) {
          setState(s)
          return setPhase('needsProfile')
        }
        // Returning visitor: recreate the server session from the saved profile.
        await saveSession(local.name, local.avatar)
        s = await fetchState()
      }
      if (s.membership === 'none') {
        setState(s)
        setProfile(s.me)
        await tryJoin()
        return
      }
      apply(s)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return setPhase('notFound')
      setPhaseError(errorMessage(e))
      setPhase('error')
    }
  }, [apply, fetchState, tryJoin])

  useEffect(() => {
    // Async load; state is only set after the network responds.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void enter()
  }, [enter])

  // Poll (heartbeat + fallback sync) while in the room.
  useEffect(() => {
    if (phase !== 'ready') return
    const t = setInterval(() => void refresh(), POLL_MS)
    const onVisible = () =>
      document.visibilityState === 'visible' && void refresh()
    const onLeave = () => {
      navigator.sendBeacon?.(
        `/api/rooms/${code}/leave`,
        new Blob(['{}'], { type: 'application/json' }),
      )
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    window.addEventListener('pagehide', onLeave)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      window.removeEventListener('pagehide', onLeave)
      onLeave() // in-app navigation away (e.g. "Leave room")
    }
  }, [phase, refresh, code])

  const me = useMemo(() => {
    const row = state?.members.find((m) => m.id === profile?.id)
    return row ? toMember(row) : undefined
  }, [state?.members, profile?.id])

  // Remember the room once inside.
  const rememberedRef = useRef(false)
  useEffect(() => {
    if (phase !== 'ready' || !state || rememberedRef.current) return
    rememberedRef.current = true
    rememberRoom({
      code,
      name: state.room.name,
      joinedAt: Date.now(),
      owner: state.room.ownerId === profile?.id,
    })
  }, [phase, state, code, profile?.id])

  const members = useMemo(
    () => (state?.members ?? []).map(toMember),
    [state?.members],
  )
  const actualOwner = Boolean(profile && state?.room.ownerId === profile.id)
  const isOwner = actualOwner && !previewAsGuest
  const owner = members.find((m) => m.role === 'owner')
  const playlist: Video[] = useMemo(
    () => state?.playlist ?? [],
    [state?.playlist],
  )
  const current =
    playlist.find((v) => v.id === playback?.videoId) ?? playlist[0]
  const currentIndex = playlist.findIndex((v) => v.id === current?.id)
  const settings: RoomSettings = {
    name: state?.room.name ?? `Room ${code}`,
    description: state?.room.description ?? '',
    visibility: state?.room.visibility ?? 'public',
    hasPassword: state?.room.hasPassword ?? false,
    capacity: state?.room.capacity ?? 12,
    locked: state?.room.locked ?? false,
  }

  /** Where shared playback should be right now, in seconds. */
  const expectedPosition = useCallback(() => {
    const pb = playbackRef.current
    if (!pb) return 0
    if (!pb.playing) return pb.position
    return (
      pb.position +
      ((Date.now() + clock.current.offset - pb.updatedAt) / 1000) * pb.rate
    )
  }, [])

  const actions = useMemo(() => {
    /** Runs a host action. The check here is a UI hint only — the server rejects non-owners regardless. */
    const run = (fn: () => Promise<unknown> | void) => {
      if (!isOwner) return
      void Promise.resolve()
        .then(fn)
        .catch((e: unknown) => {
          toast.error(errorMessage(e))
          void refresh()
        })
    }

    const sendPlayback = async (
      body: Record<string, unknown>,
      optimistic?: Partial<ApiPlayback>,
    ) => {
      const base = playbackRef.current
      if (base && optimistic) {
        const next = {
          ...base,
          ...optimistic,
          updatedAt: Date.now() + clock.current.offset,
        }
        playbackRef.current = next
        setPlayback(next)
      }
      const res = await roomAction<{ playback: ApiPlayback }>(
        code,
        'playback',
        body,
      )
      acceptPlayback(res.playback, true)
    }

    const pos = () => Math.max(0, expectedPosition())
    const select = (id: string) =>
      sendPlayback(
        { op: 'select', videoId: id },
        {
          videoId: id,
          position: 0,
          playing: true,
          subtitle: 'off',
          audio: 'default',
        },
      )

    return {
      play: () =>
        run(() => {
          const p = pos()
          return sendPlayback(
            { op: 'play', position: p },
            { playing: true, position: p },
          )
        }),
      pause: () =>
        run(() => {
          const p = pos()
          return sendPlayback(
            { op: 'pause', position: p },
            { playing: false, position: p },
          )
        }),
      seek: (t: number) =>
        run(() => {
          const p = Math.max(0, t)
          return sendPlayback({ op: 'seek', position: p }, { position: p })
        }),
      setRate: (r: number) =>
        run(() => {
          const p = pos()
          return sendPlayback(
            { op: 'rate', position: p, rate: r },
            { rate: r, position: p },
          )
        }),
      setTracks: (subtitle: string, audio: string) =>
        run(() => {
          const videoId = playbackRef.current?.videoId
          if (!videoId) return
          const p = pos()
          return sendPlayback(
            { op: 'tracks', videoId, position: p, subtitle, audio },
            { subtitle, audio, position: p },
          )
        }),
      selectVideo: (id: string) => run(() => select(id)),
      next: () =>
        run(() => {
          const n = playlist[currentIndex + 1]
          return n ? select(n.id) : undefined
        }),
      previous: () =>
        run(() => {
          const p = playlist[currentIndex - 1]
          return p ? select(p.id) : undefined
        }),
      /** Host finished the last video: stop at the end. */
      finish: (at: number) =>
        run(() =>
          sendPlayback(
            { op: 'pause', position: at },
            { playing: false, position: at },
          ),
        ),
      addVideo: (v: Omit<Video, 'id' | 'addedBy'>) =>
        run(async () => {
          await roomAction(code, 'queue', {
            op: 'add',
            ...v,
            duration: Math.round(v.duration),
          })
          toast.success('Added to the queue')
          await refresh()
        }),
      removeVideo: (id: string) =>
        run(async () => {
          await roomAction(code, 'queue', { op: 'remove', videoId: id })
          await refresh()
        }),
      moveVideo: (id: string, dir: -1 | 1) =>
        run(async () => {
          await roomAction(code, 'queue', { op: 'move', videoId: id, dir })
          await refresh()
        }),
      updateSettings: async (
        patch: Partial<Omit<RoomSettings, 'hasPassword'>> & {
          password?: string
        },
      ) => {
        if (!isOwner) return false
        try {
          await roomAction(code, 'settings', patch)
          await refresh()
          return true
        } catch (e) {
          toast.error(errorMessage(e))
          return false
        }
      },
      removeMember: (id: string) =>
        run(async () => {
          await roomAction(code, 'member', { op: 'remove', profileId: id })
          await refresh()
        }),
      transferOwnership: (id: string) =>
        run(async () => {
          await roomAction(code, 'member', {
            op: 'transfer',
            profileId: id,
          })
          setPreviewAsGuest(false)
          await refresh()
        }),
      endRoom: () =>
        run(async () => {
          await roomAction(code, 'end')
          setPhase('ended')
        }),
      // Participant-level actions (anyone in the room).
      sendMessage: async (text: string) => {
        const clean = text.trim().slice(0, 500)
        if (!clean) return true
        try {
          const res = await roomAction<{
            message: RoomStateResponse['messages'][number]
          }>(code, 'message', {
            text: clean,
          })
          if (res.message)
            ingestMessages(
              [res.message],
              Date.now() + clock.current.offset,
              false,
            )
          return true
        } catch (e) {
          toast.error(errorMessage(e))
          return false
        }
      },
      react: (emoji: string) => {
        void roomAction<{ message: RoomStateResponse['messages'][number] }>(
          code,
          'react',
          { emoji },
        )
          .then(
            (res) =>
              res.message &&
              ingestMessages(
                [res.message],
                Date.now() + clock.current.offset,
                false,
              ),
          )
          .catch((e: unknown) => toast.error(errorMessage(e)))
      },
      /** Join gate: create the server session (uploading a custom avatar if picked), then join. */
      submitProfile: async (p: Profile, customImage?: string) => {
        try {
          const { profile: saved } = await saveSession(p.name, p.avatar)
          let avatar = p.avatar
          if (customImage) {
            try {
              avatar = (await uploadAvatar(customImage)).avatar
            } catch (e) {
              // Join anyway; the picked emoji still applies.
              toast.error(errorMessage(e))
            }
          }
          saveProfile({ name: p.name, avatar })
          setProfile({ ...saved, avatar })
          return await tryJoin()
        } catch (e) {
          toast.error(errorMessage(e))
          return false
        }
      },
      unlockWithPassword: (pw: string) => tryJoin(pw),
      setPreviewAsGuest,
      /** Server-pushed events from the LiveKit data channel. */
      onRealtime: (ev: RealtimeEvent) => {
        if (ev.t === 'playback') acceptPlayback(ev.playback)
        else void refresh()
      },
      refresh,
    }
  }, [
    isOwner,
    refresh,
    code,
    acceptPlayback,
    expectedPosition,
    playlist,
    currentIndex,
    ingestMessages,
    tryJoin,
  ])

  return {
    code,
    phase,
    phaseError,
    ready: phase !== 'loading',
    profile,
    suggestedProfile,
    me,
    owner,
    members,
    settings,
    isOwner,
    actualOwner,
    previewAsGuest,
    playlist,
    current,
    currentIndex,
    playback,
    playing: playback?.playing ?? false,
    rate: playback?.rate ?? 1,
    expectedPosition,
    serverNow,
    messages,
    reactions,
    actions,
  }
}

export type RoomState = ReturnType<typeof useRoom>
