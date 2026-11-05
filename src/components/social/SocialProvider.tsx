import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { Room as LkRoom, RemoteVideoTrack } from 'livekit-client'
import type { LocalVideoTrack } from 'livekit-client'
import {
  callAction,
  getAccount,
  getPulse,
  oauthAccount,
  startCallApi,
  type CallTicketResponse,
} from '@/lib/api'
import { saveProfile } from '@/lib/session'
import { playSound, startRing, unlockSounds } from '@/lib/sounds'
import type {
  AccountProfile,
  ApiCall,
  ApiFriend,
  CallKind,
  SocialPulse,
} from '@/lib/social-types'
import { CallOverlay, IncomingCallBanner } from './CallOverlay'

export type CallPhase = 'idle' | 'outgoing' | 'connecting' | 'active'

export type SocialContextValue = {
  account: AccountProfile | null
  accountReady: boolean
  refreshAccount: () => Promise<void>
  pulse: SocialPulse | null
  refreshPulse: () => void
  callPhase: CallPhase
  currentCall: ApiCall | null
  callPeer: ApiFriend | null
  callMuted: boolean
  callCamOn: boolean
  callSharing: boolean
  callSeconds: number
  peerJoined: boolean
  localVideo: LocalVideoTrack | null
  remoteVideo: RemoteVideoTrack | null
  remoteScreen: RemoteVideoTrack | null
  startCall: (
    threadId: string,
    kind: CallKind,
    peer: ApiFriend,
  ) => Promise<void>
  acceptIncoming: () => Promise<void>
  declineIncoming: () => Promise<void>
  hangUp: () => Promise<void>
  toggleCallMute: () => void
  toggleCamera: () => Promise<void>
  toggleCallScreenShare: () => Promise<void>
}

const SocialContext = createContext<SocialContextValue | null>(null)

export function useSocial() {
  const ctx = useContext(SocialContext)
  if (!ctx) throw new Error('useSocial must be used inside SocialProvider')
  return ctx
}

/**
 * Mounted once at the root: owns the signed-in account, the light social poll
 * (unread, friend requests, ringing calls) and the LiveKit call connection,
 * so a call keeps going while you move between pages.
 */
export function SocialProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<AccountProfile | null>(null)
  const [accountReady, setAccountReady] = useState(false)
  const [pulse, setPulse] = useState<SocialPulse | null>(null)

  const [callPhase, setCallPhase] = useState<CallPhase>('idle')
  const [currentCall, setCurrentCall] = useState<ApiCall | null>(null)
  const [callPeer, setCallPeer] = useState<ApiFriend | null>(null)
  const [callMuted, setCallMuted] = useState(false)
  const [callCamOn, setCallCamOn] = useState(false)
  const [callSharing, setCallSharing] = useState(false)
  const [callSeconds, setCallSeconds] = useState(0)
  const [peerJoined, setPeerJoined] = useState(false)
  const [localVideo, setLocalVideo] = useState<LocalVideoTrack | null>(null)
  const [remoteVideo, setRemoteVideo] = useState<RemoteVideoTrack | null>(null)
  const [remoteScreen, setRemoteScreen] = useState<RemoteVideoTrack | null>(
    null,
  )

  const lk = useRef<LkRoom | null>(null)
  const callRef = useRef<ApiCall | null>(null)
  const phaseRef = useRef<CallPhase>('idle')
  const endingRef = useRef(false)
  const sharingRef = useRef(false)
  useEffect(() => {
    phaseRef.current = callPhase
    callRef.current = currentCall
  }, [callPhase, currentCall])

  // Browsers only allow sound after a gesture; arm the unlock listeners once.
  useEffect(() => {
    unlockSounds()
  }, [])

  const refreshAccount = useCallback(async () => {
    try {
      const { profile } = await getAccount()
      setAccount(profile)
    } catch {
      setAccount(null)
    } finally {
      setAccountReady(true)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async session fetch
    void refreshAccount()
  }, [refreshAccount])

  const navigate = useNavigate()

  const callbackStarted = useRef(false)

  // Google / GitHub sign-in returns to the site with a token in the URL hash.
  // Verify it, then exchange it for a regular app session.
  useEffect(() => {
    if (
      !/(access|confirmation|recovery|invite)_token=|error=/.test(
        window.location.hash,
      )
    )
      return
    if (callbackStarted.current) return
    callbackStarted.current = true
    void (async () => {
      try {
        const params = new URLSearchParams(window.location.hash.slice(1))
        if (params.has('error')) {
          window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search,
          )
          throw new Error(
            'Google or GitHub sign-in was cancelled or could not complete. Please try again.',
          )
        }
        const { handleAuthCallback } = await import('@netlify/identity')
        const result = await handleAuthCallback()
        if (result?.type !== 'oauth' || !result.user) return
        const { profile, mode } = await oauthAccount()
        saveProfile({ name: profile.name, avatar: profile.avatar })
        await refreshAccount()
        toast.success(
          mode === 'created'
            ? `Welcome, ${profile.name} — your account is ready!`
            : mode === 'linked'
              ? 'Sign-in connected to your account.'
              : `Welcome back, ${profile.name}!`,
        )
        void navigate({ to: '/friends' })
      } catch (err) {
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : 'Sign-in did not complete — try again.',
        )
      }
    })()
    // Run once on mount: the hash is only present right after the redirect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Local teardown only — the server call row is handled by the caller. */
  const teardown = useCallback(() => {
    const r = lk.current
    lk.current = null
    endingRef.current = false
    sharingRef.current = false
    if (r) void r.disconnect().catch(() => {})
    document.querySelectorAll('[data-nw-call]').forEach((el) => el.remove())
    if (phaseRef.current !== 'idle') playSound('call-end')
    setCallPhase('idle')
    setCurrentCall(null)
    setCallPeer(null)
    setCallMuted(false)
    setCallCamOn(false)
    setCallSharing(false)
    setCallSeconds(0)
    setPeerJoined(false)
    setLocalVideo(null)
    setRemoteVideo(null)
    setRemoteScreen(null)
  }, [])

  /** Connects to the call's LiveKit room and publishes mic (+ camera for video). */
  const connect = useCallback(
    async (ticket: CallTicketResponse, kind: CallKind) => {
      if (!ticket.url || !ticket.token) {
        toast.error('Calling is not configured on this site yet.')
        return false
      }
      const { Room, RoomEvent, Track } = await import('livekit-client')
      const r = new Room({ disconnectOnPageLeave: true })
      lk.current = r
      r.on(RoomEvent.ParticipantConnected, () => {
        setPeerJoined(true)
        setCallPhase('active')
      })
        .on(RoomEvent.ParticipantDisconnected, () => {
          // 1:1 call: the other side leaving ends it.
          if (!endingRef.current) {
            endingRef.current = true
            const c = callRef.current
            if (c) void callAction('end', c.id).catch(() => {})
            toast.info('Call ended')
            teardown()
          }
        })
        .on(RoomEvent.TrackSubscribed, (track, pub) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach()
            el.dataset.nwCall = '1'
            document.body.appendChild(el)
          } else if (pub.source === Track.Source.ScreenShare) {
            setRemoteScreen(track as RemoteVideoTrack)
          } else if (track.kind === Track.Kind.Video) {
            setRemoteVideo(track as RemoteVideoTrack)
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track, pub) => {
          track.detach().forEach((el) => el.remove())
          if (pub.source === Track.Source.ScreenShare) setRemoteScreen(null)
          else if (track.kind === Track.Kind.Video) setRemoteVideo(null)
        })
        .on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.source === Track.Source.ScreenShare) {
            sharingRef.current = true
            setCallSharing(true)
          }
        })
        .on(RoomEvent.LocalTrackUnpublished, (pub) => {
          // Also fires when sharing is stopped from the browser's own bar.
          if (pub.source === Track.Source.ScreenShare) {
            sharingRef.current = false
            setCallSharing(false)
          }
        })
        .on(RoomEvent.Disconnected, () => {
          if (lk.current !== r) return
          if (!endingRef.current) {
            endingRef.current = true
            toast.info('Call ended')
          }
          teardown()
        })
      try {
        await r.connect(ticket.url, ticket.token)
        await r.startAudio().catch(() => {})
        await r.localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
        })
        if (kind === 'video') {
          const pub = await r.localParticipant.setCameraEnabled(true)
          setLocalVideo((pub?.track as LocalVideoTrack | undefined) ?? null)
          setCallCamOn(true)
        }
        if (r.remoteParticipants.size > 0) {
          setPeerJoined(true)
          setCallPhase('active')
        }
        return true
      } catch (e) {
        const name = (e as DOMException).name
        toast.error(
          name === 'NotAllowedError'
            ? 'Microphone or camera access was blocked. Allow it in your browser settings and try again.'
            : 'Could not connect to the call.',
        )
        void r.disconnect().catch(() => {})
        lk.current = null
        return false
      }
    },
    [teardown],
  )

  const startCall = useCallback(
    async (threadId: string, kind: CallKind, peer: ApiFriend) => {
      if (phaseRef.current !== 'idle') {
        toast.error('You are already in a call.')
        return
      }
      try {
        const ticket = await startCallApi(threadId, kind)
        setCurrentCall(ticket.call)
        setCallPeer(peer)
        setCallPhase('outgoing')
        const ok = await connect(ticket, kind)
        if (!ok) {
          void callAction('end', ticket.call.id).catch(() => {})
          teardown()
        }
      } catch (e) {
        teardown()
        toast.error(e instanceof Error ? e.message : 'Could not start the call')
      }
    },
    [connect, teardown],
  )

  const acceptIncoming = useCallback(async () => {
    const inc = pulse?.incoming
    if (!inc) return
    try {
      const ticket = await callAction('accept', inc.id)
      setCurrentCall(ticket.call)
      setCallPeer(inc.from)
      setCallPhase('connecting')
      setPulse((p) => (p ? { ...p, incoming: null } : p))
      const ok = await connect(ticket, inc.kind)
      if (!ok) {
        void callAction('end', ticket.call.id).catch(() => {})
        teardown()
      }
    } catch (e) {
      teardown()
      toast.error(e instanceof Error ? e.message : 'Could not join the call')
    }
  }, [connect, pulse, teardown])

  const declineIncoming = useCallback(async () => {
    const inc = pulse?.incoming
    if (!inc) return
    setPulse((p) => (p ? { ...p, incoming: null } : p))
    await callAction('decline', inc.id).catch(() => {})
  }, [pulse])

  const hangUp = useCallback(async () => {
    const c = callRef.current
    endingRef.current = true
    if (c) await callAction('end', c.id).catch(() => {})
    teardown()
  }, [teardown])

  const toggleCallMute = useCallback(() => {
    setCallMuted((m) => {
      const next = !m
      void lk.current?.localParticipant
        .setMicrophoneEnabled(!next)
        .catch(() => {})
      return next
    })
  }, [])

  const toggleCamera = useCallback(async () => {
    const r = lk.current
    if (!r) return
    const next = !callCamOn
    try {
      const pub = await r.localParticipant.setCameraEnabled(next)
      setLocalVideo(
        next ? ((pub?.track as LocalVideoTrack | undefined) ?? null) : null,
      )
      setCallCamOn(next)
    } catch {
      toast.error('Could not switch your camera.')
    }
  }, [callCamOn])

  const toggleCallScreenShare = useCallback(async () => {
    const r = lk.current
    if (!r) return
    try {
      await r.localParticipant.setScreenShareEnabled(!sharingRef.current, {
        audio: true,
      })
    } catch (e) {
      // Cancelling the browser's share picker is not an error.
      if ((e as DOMException).name !== 'NotAllowedError')
        toast.error('Could not share your screen.')
    }
  }, [])

  // Ring while an outgoing call is unanswered.
  useEffect(() => {
    if (callPhase !== 'outgoing') return
    return startRing('outgoing')
  }, [callPhase])

  // Ring while a friend is calling (banner showing, not yet in a call).
  const incomingId = pulse?.incoming?.id ?? null
  useEffect(() => {
    if (!incomingId || callPhase !== 'idle') return
    return startRing('incoming')
  }, [incomingId, callPhase])

  // Chime once when the call actually connects.
  const wasActive = useRef(false)
  useEffect(() => {
    if (callPhase === 'active' && !wasActive.current) playSound('call-connect')
    wasActive.current = callPhase === 'active'
  }, [callPhase])

  /** The social pulse: badges, ringing calls and outgoing-call state changes. */
  const lastUnread = useRef<number | null>(null)
  const refreshPulse = useCallback(() => {
    if (!account?.username) return
    getPulse()
      .then((p) => {
        setPulse(p)
        // Ping when new unread messages arrive anywhere on the site.
        if (lastUnread.current !== null && p.unread > lastUnread.current)
          playSound('message')
        lastUnread.current = p.unread
        // Outgoing call resolved remotely (declined / missed / picked up elsewhere).
        const mine = callRef.current
        if (mine && phaseRef.current !== 'idle') {
          const remote = p.call?.id === mine.id ? p.call : null
          // A poll that raced the call's creation can miss it; don't end a fresh call.
          if (!remote && Date.now() - mine.at < 15_000) return
          const status = remote?.status ?? 'ended'
          if (
            status === 'declined' ||
            status === 'missed' ||
            status === 'ended'
          ) {
            endingRef.current = true
            toast.info(
              status === 'declined'
                ? 'They declined the call.'
                : status === 'missed'
                  ? 'No answer.'
                  : 'Call ended',
            )
            teardown()
          }
        }
      })
      .catch(() => {})
  }, [account?.username, teardown])

  useEffect(() => {
    if (!account?.username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears stale data on sign-out
      setPulse(null)
      return
    }
    refreshPulse()
    const busy = callPhase !== 'idle'
    const t = setInterval(refreshPulse, busy ? 2500 : 5000)
    return () => clearInterval(t)
  }, [account?.username, callPhase, refreshPulse])

  // Call timer.
  useEffect(() => {
    if (callPhase !== 'active') return
    const t = setInterval(() => setCallSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [callPhase])

  const value: SocialContextValue = {
    account,
    accountReady,
    refreshAccount,
    pulse,
    refreshPulse,
    callPhase,
    currentCall,
    callPeer,
    callMuted,
    callCamOn,
    callSharing,
    callSeconds,
    peerJoined,
    localVideo,
    remoteVideo,
    remoteScreen,
    startCall,
    acceptIncoming,
    declineIncoming,
    hangUp,
    toggleCallMute,
    toggleCamera,
    toggleCallScreenShare,
  }

  return (
    <SocialContext.Provider value={value}>
      {children}
      <IncomingCallBanner />
      <CallOverlay />
    </SocialContext.Provider>
  )
}
