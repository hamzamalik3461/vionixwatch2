import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  Room as LkRoom,
  LocalTrackPublication,
  LocalVideoTrack,
  RemoteParticipant,
  RemoteVideoTrack,
} from 'livekit-client'
import { ApiError, roomAction } from '@/lib/api'
import type { RealtimeEvent } from '@/lib/room-types'
import { playSound } from '@/lib/sounds'
import type { RoomState } from './useRoom'

/**
 * LiveKit layer. Everyone in the room holds one LiveKit connection:
 *  - it receives server-pushed realtime events (playback, chat, members)
 *    over the data channel, and
 *  - joining voice publishes the mic and subscribes to everyone else's audio.
 * Watching without voice never subscribes to audio — except a shared screen,
 * which every member sees.
 */

export type VoiceStatus = 'disconnected' | 'connecting' | 'connected'
export type RealtimeStatus =
  'connecting' | 'connected' | 'reconnecting' | 'unavailable'
export type VoiceParticipant = {
  muted: boolean
  deafened: boolean
  speaking: boolean
}
export type RemoteScreen = { track: RemoteVideoTrack; by: string }

export function useVoice(room: RoomState) {
  const { actions, phase, code } = room
  const profileId = room.profile?.id
  const [status, setStatus] = useState<VoiceStatus>('disconnected')
  const [realtime, setRealtime] = useState<RealtimeStatus>('connecting')
  const [participants, setParticipants] = useState<
    Map<string, VoiceParticipant>
  >(new Map())
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  const [inputId, setInputId] = useState('')
  const [outputId, setOutputIdState] = useState('')
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [localScreen, setLocalScreen] = useState<LocalVideoTrack | null>(null)
  const [remoteScreen, setRemoteScreen] = useState<RemoteScreen | null>(null)
  const [canShare, setCanShare] = useState(false)

  const lk = useRef<LkRoom | null>(null)
  const inVoice = useRef(false)
  const deafRef = useRef(false)
  const mutedRef = useRef(false)
  const sharingRef = useRef(false)
  const rosterRef = useRef<Set<string>>(new Set())
  const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null)
  const onRealtime = useRef(actions.onRealtime)
  const refresh = useRef(actions.refresh)
  useEffect(() => {
    onRealtime.current = actions.onRealtime
    refresh.current = actions.refresh
  }, [actions])

  useEffect(() => {
    // Screen capture is unavailable on most phones; hide the button there.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only capability probe
    setCanShare(typeof navigator.mediaDevices?.getDisplayMedia === 'function')
  }, [])

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const list = await navigator.mediaDevices.enumerateDevices()
    setInputs(list.filter((d) => d.kind === 'audioinput'))
    setOutputs(list.filter((d) => d.kind === 'audiooutput'))
  }, [])

  const stopMeter = useCallback(() => {
    if (!meter.current) return
    cancelAnimationFrame(meter.current.raf)
    void meter.current.ctx.close().catch(() => {})
    meter.current = null
    setLevel(0)
  }, [])

  const startMeter = useCallback(
    (track: MediaStreamTrack) => {
      stopMeter()
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const m = { ctx, raf: 0 }
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        setLevel(mutedRef.current ? 0 : Math.min(1, avg / 60))
        m.raf = requestAnimationFrame(tick)
      }
      tick()
      meter.current = m
    },
    [stopMeter],
  )

  /** Rebuilds the voice roster from LiveKit participants (anyone with a mic track is in voice). */
  const recompute = useCallback(async () => {
    const r = lk.current
    if (!r) {
      rosterRef.current = new Set()
      return setParticipants(new Map())
    }
    const { Track } = await import('livekit-client')
    const next = new Map<string, VoiceParticipant>()
    const all = [r.localParticipant, ...r.remoteParticipants.values()]
    for (const p of all) {
      const pub = p.getTrackPublication(Track.Source.Microphone)
      if (!pub) continue
      next.set(p.identity, {
        muted: pub.isMuted,
        deafened: p.attributes?.deafened === '1',
        speaking: p.isSpeaking && !pub.isMuted,
      })
    }
    // Chime when someone else joins or leaves voice while you're in it.
    const prev = rosterRef.current
    const me = r.localParticipant.identity
    if (inVoice.current && prev.has(me)) {
      for (const id of next.keys())
        if (!prev.has(id) && id !== me) playSound('member-join')
      for (const id of prev)
        if (!next.has(id) && id !== me) playSound('member-leave')
    }
    rosterRef.current = new Set(next.keys())
    setParticipants(next)
  }, [])

  const subscribeAll = useCallback(async (on: boolean) => {
    const r = lk.current
    if (!r) return
    const { Track } = await import('livekit-client')
    for (const p of r.remoteParticipants.values()) {
      const pub = p.getTrackPublication(Track.Source.Microphone)
      pub?.setSubscribed(on)
      p.setVolume(deafRef.current ? 0 : 1)
    }
  }, [])

  // One LiveKit connection for the lifetime of the room view.
  useEffect(() => {
    if (phase !== 'ready' || !profileId) return
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | null = null

    const scheduleRetry = (ms: number) => {
      if (cancelled || retry) return
      retry = setTimeout(() => {
        retry = null
        void connect()
      }, ms)
    }

    const connect = async () => {
      try {
        const [{ Room, RoomEvent, DisconnectReason, Track }, t] =
          await Promise.all([
            import('livekit-client'),
            roomAction<{ url: string; token: string }>(code, 'voice-token'),
          ])
        if (cancelled) return
        const r = new Room({
          adaptiveStream: false,
          dynacast: false,
          disconnectOnPageLeave: true,
        })
        if (cancelled) return
        lk.current = r
        const update = () => void recompute()
        const isScreenSource = (source: unknown) =>
          source === Track.Source.ScreenShare ||
          source === Track.Source.ScreenShareAudio
        /** A shared screen is for the whole room, voice or not. */
        const subscribeScreens = () => {
          for (const p of r.remoteParticipants.values())
            for (const pub of p.trackPublications.values())
              if (isScreenSource(pub.source)) pub.setSubscribed(true)
        }
        r.on(RoomEvent.DataReceived, (payload, participant) => {
          if (participant) return // only trust server-sent packets
          try {
            onRealtime.current(
              JSON.parse(new TextDecoder().decode(payload)) as RealtimeEvent,
            )
          } catch {
            /* ignore malformed packet */
          }
        })
          .on(RoomEvent.ParticipantConnected, update)
          .on(RoomEvent.ParticipantDisconnected, update)
          .on(RoomEvent.TrackPublished, (pub, p: RemoteParticipant) => {
            if (inVoice.current && pub.source === Track.Source.Microphone) {
              pub.setSubscribed(true)
              p.setVolume(deafRef.current ? 0 : 1)
            }
            if (isScreenSource(pub.source)) pub.setSubscribed(true)
            update()
          })
          .on(RoomEvent.TrackUnpublished, update)
          .on(RoomEvent.TrackMuted, update)
          .on(RoomEvent.TrackUnmuted, update)
          .on(RoomEvent.LocalTrackPublished, (pub) => {
            if (pub.source === Track.Source.ScreenShare) {
              sharingRef.current = true
              setSharing(true)
              setLocalScreen((pub.track as LocalVideoTrack | undefined) ?? null)
            }
            update()
          })
          .on(RoomEvent.LocalTrackUnpublished, (pub) => {
            // Also fires when sharing is stopped from the browser's own bar.
            if (pub.source === Track.Source.ScreenShare) {
              sharingRef.current = false
              setSharing(false)
              setLocalScreen(null)
            }
            update()
          })
          .on(RoomEvent.ActiveSpeakersChanged, update)
          .on(RoomEvent.ParticipantAttributesChanged, update)
          .on(RoomEvent.TrackSubscribed, (track, pub, p) => {
            if (track.kind === Track.Kind.Audio) {
              const el = track.attach()
              el.dataset.nwVoice = '1'
              document.body.appendChild(el)
              p.setVolume(deafRef.current ? 0 : 1)
              return
            }
            if (pub.source === Track.Source.ScreenShare)
              setRemoteScreen({
                track: track as RemoteVideoTrack,
                by: p.identity,
              })
          })
          .on(RoomEvent.TrackUnsubscribed, (track, pub) => {
            track.detach().forEach((el) => el.remove())
            if (pub.source === Track.Source.ScreenShare)
              setRemoteScreen((cur) => (cur?.track === track ? null : cur))
          })
          .on(RoomEvent.Reconnecting, () => {
            setRealtime('reconnecting')
            if (inVoice.current) setStatus('connecting')
          })
          .on(RoomEvent.Reconnected, () => {
            setRealtime('connected')
            if (inVoice.current) setStatus('connected')
            void refresh.current()
          })
          .on(RoomEvent.Disconnected, (reason) => {
            if (cancelled || lk.current !== r) return
            lk.current = null
            inVoice.current = false
            sharingRef.current = false
            stopMeter()
            setStatus('disconnected')
            setParticipants(new Map())
            setSharing(false)
            setLocalScreen(null)
            setRemoteScreen(null)
            rosterRef.current = new Set()
            document
              .querySelectorAll('[data-nw-voice]')
              .forEach((el) => el.remove())
            if (cancelled) return
            if (
              reason === DisconnectReason.PARTICIPANT_REMOVED ||
              reason === DisconnectReason.ROOM_DELETED
            ) {
              void refresh.current()
              return
            }
            setRealtime('reconnecting')
            scheduleRetry(3000)
          })
        await r.connect(t.url, t.token, { autoSubscribe: false })
        if (cancelled) {
          void r.disconnect()
          return
        }
        setRealtime('connected')
        subscribeScreens()
        update()
      } catch (e) {
        if (cancelled) return
        const failed = lk.current
        lk.current = null
        void failed?.disconnect()
        if (e instanceof ApiError && e.status === 503) {
          setRealtime('unavailable')
          return
        }
        setRealtime('reconnecting')
        scheduleRetry(5000)
      }
    }
    void connect()

    return () => {
      cancelled = true
      if (retry) clearTimeout(retry)
      void lk.current?.disconnect()
      lk.current = null
      stopMeter()
    }
  }, [phase, profileId, code, recompute, stopMeter])

  const micPub = useCallback(async (): Promise<
    LocalTrackPublication | undefined
  > => {
    const { Track } = await import('livekit-client')
    return lk.current?.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )
  }, [])

  const join = useCallback(async () => {
    const r = lk.current
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Your browser does not support microphone access.')
      return
    }
    if (!r || realtime !== 'connected') {
      setError(
        realtime === 'unavailable'
          ? 'Voice is not configured on this site yet.'
          : 'Still connecting to the voice server — try again in a moment.',
      )
      return
    }
    setError(null)
    setStatus('connecting')
    try {
      await r.startAudio()
      const pub = await r.localParticipant.setMicrophoneEnabled(true, {
        deviceId: inputId || undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      })
      // Joining while muted keeps the track published but muted, so you still show as in voice.
      if (mutedRef.current) await r.localParticipant.setMicrophoneEnabled(false)
      inVoice.current = true
      await r.localParticipant
        .setAttributes({ deafened: deafRef.current ? '1' : '0' })
        .catch(() => {})
      await subscribeAll(true)
      const mst = pub?.track?.mediaStreamTrack
      if (mst) startMeter(mst)
      setStatus('connected')
      playSound('voice-join')
      void recompute()
      await refreshDevices()
      toast.success('Connected to voice')
    } catch (e) {
      inVoice.current = false
      setStatus('disconnected')
      const name = (e as DOMException).name
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone found. Plug one in or pick another device.'
            : 'Could not start your microphone.',
      )
    }
  }, [inputId, realtime, recompute, refreshDevices, startMeter, subscribeAll])

  const leave = useCallback(async () => {
    const r = lk.current
    inVoice.current = false
    stopMeter()
    setStatus('disconnected')
    // Leaving voice also ends your screen share.
    if (r && sharingRef.current)
      await r.localParticipant.setScreenShareEnabled(false).catch(() => {})
    const pub = await micPub()
    if (r && pub?.track)
      await r.localParticipant.unpublishTrack(pub.track, true).catch(() => {})
    await subscribeAll(false)
    playSound('voice-leave')
    void recompute()
  }, [micPub, recompute, stopMeter, subscribeAll])

  /** Starts/stops sharing your screen with the whole room. */
  const toggleShare = useCallback(async () => {
    const r = lk.current
    if (!r || !inVoice.current) return
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

  const setMic = useCallback(async (enabled: boolean) => {
    const r = lk.current
    if (!r || !inVoice.current) return
    await r.localParticipant
      .setMicrophoneEnabled(enabled)
      .catch(() => toast.error('Could not change your mic'))
  }, [])

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    void setMic(!next)
    // Unmuting while deafened also undeafens, like Discord.
    if (!next && deafRef.current) {
      deafRef.current = false
      setDeafened(false)
      void lk.current?.localParticipant
        .setAttributes({ deafened: '0' })
        .catch(() => {})
      void subscribeAll(true)
    }
  }, [setMic, subscribeAll])

  const toggleDeafen = useCallback(() => {
    const next = !deafRef.current
    deafRef.current = next
    setDeafened(next)
    if (next && !mutedRef.current) {
      mutedRef.current = true
      setMuted(true)
      void setMic(false)
    }
    void lk.current?.localParticipant
      .setAttributes({ deafened: next ? '1' : '0' })
      .catch(() => {})
    void subscribeAll(inVoice.current)
  }, [setMic, subscribeAll])

  const chooseInput = useCallback(
    async (id: string) => {
      setInputId(id)
      const r = lk.current
      if (!r || !inVoice.current) return
      try {
        await r.switchActiveDevice('audioinput', id)
        const pub = await micPub()
        const mst = pub?.track?.mediaStreamTrack
        if (mst) startMeter(mst)
        toast.success('Microphone switched')
      } catch {
        toast.error('Could not switch microphone')
      }
    },
    [micPub, startMeter],
  )

  const setOutputId = useCallback((id: string) => {
    setOutputIdState(id)
    void lk.current?.switchActiveDevice('audiooutput', id).catch(() => {})
  }, [])

  // Browser online/offline hints; LiveKit handles the actual reconnection.
  useEffect(() => {
    const off = () => setOnline(false)
    const on = () => setOnline(true)
    window.addEventListener('offline', off)
    window.addEventListener('online', on)
    return () => {
      window.removeEventListener('offline', off)
      window.removeEventListener('online', on)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async device query
    void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
    return () =>
      navigator.mediaDevices?.removeEventListener?.(
        'devicechange',
        refreshDevices,
      )
  }, [refreshDevices])

  return {
    status,
    realtime,
    participants,
    online,
    muted,
    deafened,
    level,
    error,
    inputs,
    outputs,
    inputId,
    outputId,
    sharing,
    localScreen,
    remoteScreen,
    canShare,
    join,
    leave,
    toggleMute,
    toggleDeafen,
    toggleShare,
    chooseInput,
    setOutputId,
  }
}

export type VoiceState = ReturnType<typeof useVoice>
