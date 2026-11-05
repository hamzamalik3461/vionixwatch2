import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Clapperboard,
  Captions,
  Languages,
  Settings2,
  Crown,
  Expand,
  Gauge,
  Loader2,
  Lock,
  Maximize,
  Minimize,
  Pause,
  Play,
  RectangleHorizontal,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { playbackSpeeds } from '@/lib/catalog'
import { parseYouTubeId } from '@/lib/youtube'
import { AddContent } from './AddContent'
import {
  YT_QUALITY_FALLBACK,
  YT_QUALITY_LABELS,
  YouTubeSurface,
  type MediaLike,
} from './YouTubeSurface'
import { formatTime } from '@/lib/session'
import { cn } from '@/lib/utils'
import type HlsPlayer from 'hls.js'
import type { RoomState } from './useRoom'

type Props = {
  room: RoomState
  theater: boolean
  onToggleTheater: () => void
  sinkId: string
  deafened: boolean
}

const HOST_ONLY = 'Only the host controls shared playback'

/** Menu entries offered for YouTube before the player reports real levels. */
const ytQualityOptions = (levels: string[] = YT_QUALITY_FALLBACK) =>
  levels
    .filter((l) => l in YT_QUALITY_LABELS)
    .map((l) => ({ value: l, label: YT_QUALITY_LABELS[l] }))

export function VideoPlayer({
  room,
  theater,
  onToggleTheater,
  sinkId,
  deafened,
}: Props) {
  const {
    current,
    playing,
    rate,
    playback,
    expectedPosition,
    isOwner,
    actions,
    reactions,
  } = room
  const videoRef = useRef<HTMLVideoElement>(null)
  const ytMediaRef = useRef<MediaLike | null>(null)
  const ytId = current?.kind === 'youtube' ? parseYouTubeId(current.src) : null
  const isYouTube = Boolean(ytId)
  const [playerElement, setPlayerElement] = useState<HTMLDivElement | null>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(current?.duration ?? 0)
  const [buffered, setBuffered] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [scrub, setScrub] = useState<number | null>(null)
  const [chrome, setChrome] = useState(true)
  /** Browser blocked autoplay with sound, so we play muted until the viewer taps. */
  const [autoMuted, setAutoMuted] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Local quality preference (per viewer, like volume — never shared).
  const hlsRef = useRef<HlsPlayer | null>(null)
  const [subtitles, setSubtitles] = useState<
    { value: string; label: string }[]
  >([])
  const [audioTracks, setAudioTracks] = useState<
    { value: string; label: string }[]
  >([])
  const [youtubeSettings, setYoutubeSettings] = useState(false)
  const subtitle = playback?.subtitle ?? 'off'
  const audio = playback?.audio ?? 'default'
  const [quality, setQuality] = useState('auto')
  const [ytQuality, setYtQuality] = useState<string | null>(null)
  const [qualities, setQualities] = useState<
    { value: string; label: string }[]
  >(() => (current?.kind === 'youtube' ? ytQualityOptions() : []))

  function changeQuality(q: string) {
    setQuality(q)
    // HLS: pick the matching level (−1 = adaptive). YouTube applies via props.
    if (!isYouTube && hlsRef.current)
      hlsRef.current.currentLevel = q === 'auto' ? -1 : Number(q)
  }

  // HLS / Mux streams: use native HLS (Safari) or hls.js elsewhere. Keyed on
  // the video's id/src strings — `current` itself is a fresh object on every
  // poll, and re-running this on each poll would tear the player down mid-play.
  const srcUrl = current?.src
  const srcKind = current?.kind
  const currentId = current?.id
  useEffect(() => {
    const v = videoRef.current
    if (!v || !srcUrl || !srcKind || srcKind === 'youtube') return
    const isHls =
      srcUrl.includes('.m3u8') ||
      ((srcKind === 'hls' || srcKind === 'mux') &&
        !/\.(mp4|webm)(\?|#|$)/i.test(srcUrl))
    if (!isHls) {
      v.src = srcUrl
      return
    }
    let destroyed = false
    let hls: HlsPlayer | null = null
    let netRetries = 0
    let mediaRetries = 0
    void import('hls.js').then(({ default: Hls }) => {
      if (destroyed) return
      if (!Hls.isSupported()) {
        // No MSE here (e.g. iOS Safari): use the browser's own HLS player.
        // Native is only ever the fallback — Chrome answers "maybe" to the
        // HLS mime type without reliably playing it, so asking first and
        // trusting the answer breaks uploads on every Chromium browser.
        if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = srcUrl
        else setError('This browser cannot play HLS streams.')
        return
      }
      const instance = new Hls({ enableWorker: true })
      instance.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        // Transient hiccups (e.g. a stream that only just finished
        // processing): retry a few times before giving up.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && netRetries < 3) {
          netRetries += 1
          setTimeout(() => {
            if (!destroyed) instance.startLoad()
          }, 1000 * netRetries)
          return
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
          mediaRetries += 1
          instance.recoverMediaError()
          return
        }
        setLoading(false)
        setError(
          'The stream could not be loaded. Check that the link is public and valid.',
        )
      })
      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        const seen = new Set<string>()
        setQualities(
          instance.levels
            .map((l, i) => ({
              value: String(i),
              label: l.height
                ? `${l.height}p`
                : `${Math.round(l.bitrate / 1000)} kbps`,
              height: l.height ?? 0,
            }))
            .sort((a, b) => b.height - a.height)
            .filter((q) => {
              if (seen.has(q.label)) return false
              seen.add(q.label)
              return true
            })
            .map(({ value, label }) => ({ value, label })),
        )
      })
      instance.loadSource(srcUrl)
      instance.attachMedia(v)
      hlsRef.current = instance
      hls = instance
    })
    return () => {
      destroyed = true
      if (hlsRef.current === hls) hlsRef.current = null
      hls?.destroy()
    }
  }, [currentId, srcUrl, srcKind])

  // Discover tracks again as manifests and native media metadata arrive.
  useEffect(() => {
    if (isYouTube) return
    const update = () => {
      const hls = hlsRef.current
      const v = videoRef.current as
        | (HTMLVideoElement & {
            audioTracks?: {
              length: number
              [index: number]: {
                language: string
                label: string
                enabled: boolean
              }
            }
          })
        | null
      if (!v) return
      const subs = hls
        ? hls.subtitleTracks.map((t, i) => ({
            value: String(i),
            label: t.name || t.lang || `Subtitles ${i + 1}`,
          }))
        : Array.from(v.textTracks)
            .filter((t) => t.kind === 'subtitles' || t.kind === 'captions')
            .map((t, i) => ({
              value: String(i),
              label: t.label || t.language || `Subtitles ${i + 1}`,
            }))
      const nativeAudio = v.audioTracks
      const audios = hls
        ? hls.audioTracks.map((t, i) => ({
            value: String(i),
            label: t.name || t.lang || `Audio ${i + 1}`,
          }))
        : Array.from({ length: nativeAudio?.length ?? 0 }, (_, i) => ({
            value: String(i),
            label:
              nativeAudio![i].label ||
              nativeAudio![i].language ||
              `Audio ${i + 1}`,
          }))
      setSubtitles((prev) =>
        JSON.stringify(prev) === JSON.stringify(subs) ? prev : subs,
      )
      setAudioTracks((prev) =>
        JSON.stringify(prev) === JSON.stringify(audios) ? prev : audios,
      )
      const subIndex = subs.some((t) => t.value === subtitle)
        ? Number(subtitle)
        : -1
      if (hls) {
        if (hls.subtitleTrack !== subIndex) hls.subtitleTrack = subIndex
        hls.subtitleDisplay = subIndex >= 0
        const audioIndex = audio === 'default' ? 0 : Number(audio)
        if (audios[audioIndex] && hls.audioTrack !== audioIndex)
          hls.audioTrack = audioIndex
      } else {
        Array.from(v.textTracks)
          .filter((t) => t.kind === 'subtitles' || t.kind === 'captions')
          .forEach((t, i) => {
            t.mode = i === subIndex ? 'showing' : 'disabled'
          })
        if (nativeAudio)
          for (let i = 0; i < nativeAudio.length; i++)
            nativeAudio[i].enabled =
              i === (audio === 'default' ? 0 : Number(audio))
      }
    }
    update()
    const timer = setInterval(update, 700)
    return () => clearInterval(timer)
  }, [isYouTube, currentId, subtitle, audio])

  /**
   * Keep the element on the shared timeline. Everyone (host included) follows
   * the server clock: small drift is corrected by nudging the speed, larger
   * drift (or a seek / mid-video join / reconnect) by jumping.
   */
  const sync = useCallback(() => {
    const v: MediaLike | null = isYouTube
      ? ytMediaRef.current
      : videoRef.current
    if (!v || !playback || v.readyState < 1) return
    const dur = Number.isFinite(v.duration) ? v.duration : Infinity
    const target = Math.min(expectedPosition(), Math.max(0, dur - 0.1))
    const drift = v.currentTime - target
    if (!playback.playing) {
      if (!v.paused) v.pause()
      if (Math.abs(drift) > 0.3) v.currentTime = target
      v.playbackRate = playback.rate
      return
    }
    if (target >= dur - 0.2) return // finished; don't restart from 0
    if (Math.abs(drift) > 1.5) {
      v.currentTime = target
      v.playbackRate = playback.rate
    } else if (Math.abs(drift) > 0.25) {
      v.playbackRate = playback.rate * (drift > 0 ? 0.92 : 1.08)
    } else {
      v.playbackRate = playback.rate
    }
    if (v.paused) {
      v.play().catch((err: DOMException) => {
        if (err.name !== 'NotAllowedError') return
        // Autoplay with sound blocked: play muted so we stay in sync.
        v.muted = true
        setMuted(true)
        setAutoMuted(true)
        void v.play().catch(() => {})
      })
    }
  }, [playback, expectedPosition, isYouTube])

  useEffect(() => {
    sync()
    const t = setInterval(sync, 1000)
    return () => clearInterval(t)
  }, [sync, current?.id])

  useEffect(() => {
    const v = isYouTube ? ytMediaRef.current : videoRef.current
    if (!v) return
    v.volume = volume
    v.muted = muted || deafened
  }, [volume, muted, deafened, isYouTube])

  useEffect(() => {
    const v = videoRef.current as
      (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (v?.setSinkId && sinkId) void v.setSinkId(sinkId).catch(() => {})
  }, [sinkId])

  // Reset per-video UI state when the shared video changes.
  const [shownId, setShownId] = useState(current?.id)
  if (shownId !== current?.id) {
    setShownId(current?.id)
    setError(null)
    setLoading(true)
    setTime(0)
    setDuration(current?.duration ?? 0)
    setQuality('auto')
    setYtQuality(null)
    setSubtitles([])
    setAudioTracks([])
    setYoutubeSettings(false)
    setQualities(current?.kind === 'youtube' ? ytQualityOptions() : [])
  }

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  function poke() {
    setChrome(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setChrome(false), 2800)
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void playerElement?.requestFullscreen?.()
  }

  function onKey(e: React.KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input,button,[role=menu]'))
      return
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault()
      if (playing) actions.pause()
      else actions.play()
    } else if (e.key === 'ArrowRight') actions.seek(time + 10)
    else if (e.key === 'ArrowLeft') actions.seek(time - 10)
    else if (e.key === 'f') toggleFullscreen()
    else if (e.key === 'm') setMuted((m) => !m)
  }

  const pct = duration ? ((scrub ?? time) / duration) * 100 : 0
  const bufPct = duration ? (buffered / duration) * 100 : 0
  const VolIcon =
    muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  if (!current) {
    return (
      <div className="relative grid aspect-video place-items-center overflow-hidden rounded-2xl border bg-black">
        <div className="nw-glow nw-breathe pointer-events-none absolute inset-0" />
        <div className="nw-fade-up relative z-10 w-full max-w-lg space-y-4 px-6 text-center">
          <Clapperboard className="nw-float mx-auto size-12 text-electric" />
          <div>
            <h3 className="font-display text-xl font-bold">
              Nothing is playing yet
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {isOwner
                ? 'Paste a video link or upload a file to start the show.'
                : 'Hang tight — the host is picking something to watch.'}
            </p>
          </div>
          {isOwner && (
            <div className="text-left">
              <AddContent room={room} />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={setPlayerElement}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerMove={poke}
      onPointerDown={poke}
      onMouseLeave={() => playing && setChrome(false)}
      aria-label={`Video player: ${current.title}`}
      className={cn(
        'group/player relative overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-primary',
        fullscreen ? 'h-full w-full' : 'rounded-2xl border',
        !fullscreen &&
          (theater ? 'aspect-video max-h-[78svh]' : 'aspect-video'),
      )}
    >
      {ytId ? (
        <YouTubeSurface
          key={current.id}
          videoId={ytId}
          label={`Embedded player: ${current.title}`}
          quality={youtubeSettings ? 'auto' : quality}
          subtitle={subtitle}
          nativeSettings={youtubeSettings && isOwner}
          onSubtitles={setSubtitles}
          onQualities={(levels) => {
            const list = ytQualityOptions(levels)
            if (list.length) setQualities(list)
          }}
          onQuality={setYtQuality}
          onMedia={(m) => {
            ytMediaRef.current = m
            if (m) {
              m.volume = volume
              m.muted = muted || deafened
            }
          }}
          onTime={setTime}
          onDuration={setDuration}
          onBuffered={setBuffered}
          onLoading={setLoading}
          onCanPlay={() => {
            setLoading(false)
            sync()
          }}
          onEnded={() => {
            if (!isOwner) return
            if (room.currentIndex < room.playlist.length - 1) actions.next()
            else actions.finish(Number.isFinite(duration) ? duration : 0)
          }}
          onError={(msg) => {
            setLoading(false)
            setError(msg)
          }}
          onClick={() => (playing ? actions.pause() : actions.play())}
        />
      ) : (
        <video
          ref={videoRef}
          key={current.id}
          playsInline
          preload="auto"
          className="absolute inset-0 size-full object-contain"
          onClick={() => (playing ? actions.pause() : actions.play())}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onProgress={(e) => {
            const b = e.currentTarget.buffered
            if (b.length) setBuffered(b.end(b.length - 1))
          }}
          onWaiting={() => setLoading(true)}
          onLoadedData={sync}
          onCanPlay={() => {
            setLoading(false)
            sync()
          }}
          onPlaying={() => setLoading(false)}
          onEnded={(e) => {
            if (!isOwner) return
            if (room.currentIndex < room.playlist.length - 1) actions.next()
            else actions.finish(e.currentTarget.duration || 0)
          }}
          onError={() => {
            // hls.js drives this element through MSE and handles (often
            // recovers from) its media errors itself — don't surface those.
            if (hlsRef.current) return
            setLoading(false)
            setError(
              'This video could not be loaded. The link may be broken or the format is not supported.',
            )
          }}
        />
      )}
      {/* Floating reactions */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        {reactions.map((r) => (
          <span
            key={r.id}
            className="nw-reaction absolute bottom-20 text-3xl"
            style={{ left: `${r.x}%` }}
          >
            {r.emoji}
          </span>
        ))}
      </div>

      {autoMuted && muted && (
        <button
          type="button"
          onClick={() => {
            setMuted(false)
            setAutoMuted(false)
          }}
          className="absolute top-16 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-black"
        >
          <VolumeX className="size-4" /> Tap to unmute
        </button>
      )}

      {loading && !error && (
        <div className="absolute inset-0 grid place-items-center bg-black/30">
          <Loader2 className="size-12 animate-spin text-primary motion-reduce:animate-none" />
          <span className="sr-only">Loading video</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="absolute inset-0 grid place-items-center bg-black/85 p-6 text-center"
        >
          <div className="max-w-sm space-y-3">
            <AlertTriangle className="mx-auto size-10 text-warning" />
            <p className="font-semibold">Playback error</p>
            <p className="text-sm text-muted-foreground">{error}</p>
            {isOwner && room.playlist.length > 1 && (
              <Button size="sm" onClick={() => actions.next()}>
                Skip to next video
              </Button>
            )}
          </div>
        </div>
      )}

      {!playing && !loading && !error && (
        <button
          type="button"
          onClick={() => actions.play()}
          disabled={!isOwner}
          aria-label="Play"
          className="absolute top-1/2 left-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary/90 shadow-2xl shadow-primary/50 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:bg-black/60 motion-reduce:transition-none"
        >
          {isOwner ? (
            <Play className="ml-1 size-9 fill-white text-white" />
          ) : (
            <span className="flex flex-col items-center text-[10px] font-semibold text-white/80">
              <Pause className="size-7" />
              Host paused
            </span>
          )}
        </button>
      )}

      {/* Top bar */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent p-4 transition-opacity motion-reduce:transition-none',
          chrome || !playing ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="min-w-0">
          <p className="truncate font-display font-bold text-white">
            {current.title}
          </p>
          <p className="text-xs text-white/70">
            {current.kind.toUpperCase()} · {formatTime(duration)}
          </p>
        </div>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold',
            isOwner
              ? 'bg-warning/20 text-warning'
              : 'bg-success/20 text-success',
          )}
        >
          {isOwner ? (
            <>
              <Crown className="size-3" /> You have the remote
            </>
          ) : (
            <>
              <span className="size-1.5 rounded-full bg-success" /> Synced with
              host
            </>
          )}
        </span>
      </div>

      {isYouTube && youtubeSettings && isOwner && (
        <Button
          size="sm"
          className="absolute top-16 right-4 z-20"
          onClick={() => setYoutubeSettings(false)}
        >
          Done with YouTube settings
        </Button>
      )}
      {/* Controls */}
      <div
        className={cn(
          isYouTube && youtubeSettings && isOwner && 'hidden',
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pt-10 pb-3 transition-opacity motion-reduce:transition-none sm:px-4',
          chrome || !playing
            ? 'opacity-100'
            : 'opacity-0 focus-within:opacity-100',
        )}
      >
        <div className="group/seek relative mb-2 h-4">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/20 transition-all group-hover/seek:h-1.5">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white/25"
              style={{ width: `${bufPct}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-electric"
              style={{ width: `${pct}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={scrub ?? time}
            disabled={!isOwner}
            aria-label="Seek"
            aria-valuetext={`${formatTime(scrub ?? time)} of ${formatTime(duration)}`}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={() => {
              if (scrub !== null) actions.seek(scrub)
              setScrub(null)
            }}
            onKeyUp={() => {
              if (scrub !== null) actions.seek(scrub)
              setScrub(null)
            }}
            className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 text-white sm:gap-2">
          <HostButton
            isOwner={isOwner}
            label="Previous video"
            onClick={actions.previous}
            disabled={room.currentIndex <= 0}
          >
            <SkipBack />
          </HostButton>
          <HostButton
            isOwner={isOwner}
            label="Back 10 seconds"
            onClick={() => actions.seek(time - 10)}
          >
            <RotateCcw />
          </HostButton>
          <HostButton
            isOwner={isOwner}
            label={playing ? 'Pause' : 'Play'}
            onClick={() => (playing ? actions.pause() : actions.play())}
            primary
          >
            {playing ? (
              <Pause className="fill-current" />
            ) : (
              <Play className="fill-current" />
            )}
          </HostButton>
          <HostButton
            isOwner={isOwner}
            label="Forward 10 seconds"
            onClick={() => actions.seek(time + 10)}
          >
            <RotateCw />
          </HostButton>
          <HostButton
            isOwner={isOwner}
            label="Next video"
            onClick={actions.next}
            disabled={room.currentIndex >= room.playlist.length - 1}
          >
            <SkipForward />
          </HostButton>

          <div className="group/vol ml-1 flex items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-white hover:bg-white/10 hover:text-white"
              aria-label={muted ? 'Unmute (local)' : 'Mute (local)'}
              onClick={() => setMuted((m) => !m)}
            >
              <VolIcon />
            </Button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              aria-label="Your volume"
              onChange={(e) => {
                setVolume(Number(e.target.value))
                setMuted(false)
              }}
              className="nw-range hidden w-20 sm:block"
            />
          </div>

          <span className="ml-1 font-mono text-xs tabular-nums text-white/80">
            {formatTime(scrub ?? time)} / {formatTime(duration)}
          </span>

          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-white hover:bg-white/10 hover:text-white"
                      aria-label="Playback speed"
                    >
                      <Gauge />{' '}
                      <span className="hidden text-xs sm:inline">{rate}×</span>
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Playback speed</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                container={playerElement}
                align="end"
                className="w-48"
              >
                <DropdownMenuLabel className="flex items-center justify-between">
                  Shared speed {!isOwner && <Lock className="size-3" />}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={String(rate)}
                  onValueChange={(v) => actions.setRate(Number(v))}
                >
                  {playbackSpeeds.map((s) => (
                    <DropdownMenuRadioItem
                      key={s}
                      value={String(s)}
                      disabled={!isOwner}
                    >
                      {s === 1 ? 'Normal' : `${s}×`}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Video quality"
                  className="text-white hover:bg-white/10 hover:text-white"
                >
                  <Settings2 />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                container={playerElement}
                align="end"
                className="w-48"
              >
                <DropdownMenuLabel className="flex items-center justify-between gap-2">
                  Quality
                  {isYouTube && ytQuality && YT_QUALITY_LABELS[ytQuality] && (
                    <span className="text-xs font-normal text-muted-foreground">
                      now {YT_QUALITY_LABELS[ytQuality]}
                    </span>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={quality}
                  onValueChange={changeQuality}
                >
                  <DropdownMenuRadioItem value="auto">
                    Auto
                  </DropdownMenuRadioItem>
                  {qualities.map((q) => (
                    <DropdownMenuRadioItem key={q.value} value={q.value}>
                      {q.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                {current.kind === 'mp4' && (
                  <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                    Single-quality MP4 source
                  </p>
                )}
                {current.kind === 'youtube' && (
                  <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                    Only changes your own stream. The source may still adapt it
                    to your connection.
                  </p>
                )}
                {(current.kind === 'hls' || current.kind === 'mux') &&
                  qualities.length === 0 && (
                    <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                      This browser picks the stream quality automatically.
                    </p>
                  )}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Subtitles"
                  className={cn(
                    'text-white hover:bg-white/10 hover:text-white',
                    subtitle !== 'off' && 'bg-white/20',
                  )}
                >
                  <Captions />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                container={playerElement}
                align="end"
                className="w-56"
              >
                <DropdownMenuLabel>
                  Shared subtitles{' '}
                  {!isOwner && <Lock className="inline size-3" />}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={subtitle}
                  onValueChange={(v) => actions.setTracks(v, audio)}
                >
                  <DropdownMenuRadioItem value="off" disabled={!isOwner}>
                    Off
                  </DropdownMenuRadioItem>
                  {isYouTube && (
                    <DropdownMenuRadioItem value="on" disabled={!isOwner}>
                      On (video default)
                    </DropdownMenuRadioItem>
                  )}
                  {subtitles.map((t) => (
                    <DropdownMenuRadioItem
                      key={t.value}
                      value={t.value}
                      disabled={!isOwner}
                    >
                      {t.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                {!subtitles.length && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    {isYouTube
                      ? 'Captions must be available on this YouTube video.'
                      : 'No subtitle tracks exposed by this video. Uploads need a stream with subtitle tracks.'}
                  </p>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Audio language"
                  className="text-white hover:bg-white/10 hover:text-white"
                >
                  <Languages />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                container={playerElement}
                align="end"
                className="w-64"
              >
                <DropdownMenuLabel>
                  Audio language{' '}
                  {!isOwner && <Lock className="inline size-3" />}
                </DropdownMenuLabel>
                {isYouTube ? (
                  <div className="space-y-2 px-2 py-1">
                    <p className="text-xs text-muted-foreground">
                      YouTube only allows audio language changes in its own
                      settings. This choice applies to your player only.
                    </p>
                    <Button
                      size="sm"
                      disabled={!isOwner}
                      onClick={() => setYoutubeSettings((v) => !v)}
                    >
                      {youtubeSettings
                        ? 'Hide YouTube settings'
                        : 'Show YouTube settings'}
                    </Button>
                  </div>
                ) : (
                  <>
                    <DropdownMenuRadioGroup
                      value={audio}
                      onValueChange={(v) => actions.setTracks(subtitle, v)}
                    >
                      <DropdownMenuRadioItem
                        value="default"
                        disabled={!isOwner}
                      >
                        Original / default
                      </DropdownMenuRadioItem>
                      {audioTracks.map((t) => (
                        <DropdownMenuRadioItem
                          key={t.value}
                          value={t.value}
                          disabled={!isOwner}
                        >
                          {t.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                    {audioTracks.length < 2 && (
                      <p className="px-2 py-1 text-xs text-muted-foreground">
                        No alternate audio languages exposed by this video. Only
                        tracks included in the playback stream can be selected.
                      </p>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleTheater}
              aria-pressed={theater}
              aria-label={theater ? 'Exit theater mode' : 'Theater mode'}
              className="hidden text-white hover:bg-white/10 hover:text-white lg:inline-flex"
            >
              {theater ? <RectangleHorizontal /> : <Expand />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="text-white hover:bg-white/10 hover:text-white"
            >
              {fullscreen ? <Minimize /> : <Maximize />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HostButton({
  isOwner,
  label,
  onClick,
  children,
  disabled,
  primary,
}: {
  isOwner: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  primary?: boolean
}) {
  const btn = (
    <Button
      variant="ghost"
      size={primary ? 'icon' : 'icon-sm'}
      aria-label={isOwner ? label : `${label} (host only)`}
      disabled={!isOwner || disabled}
      onClick={onClick}
      className={cn(
        'text-white hover:bg-white/10 hover:text-white',
        primary && 'bg-white/10',
        !isOwner && !primary && 'hidden sm:inline-flex',
      )}
    >
      {children}
    </Button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(!isOwner && !primary && 'hidden sm:inline-flex')}>
          {btn}
        </span>
      </TooltipTrigger>
      <TooltipContent>{isOwner ? label : HOST_ONLY}</TooltipContent>
    </Tooltip>
  )
}
