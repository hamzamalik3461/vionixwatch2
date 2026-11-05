import { useCallback, useEffect, useRef } from 'react'

/**
 * The subset of HTMLVideoElement the player's sync loop drives. A plain
 * <video> satisfies it; YouTubeMedia adapts a YT.Player to it so shared
 * playback sync works identically for both.
 */
export type MediaLike = {
  readonly readyState: number
  readonly duration: number
  currentTime: number
  readonly paused: boolean
  playbackRate: number
  muted: boolean
  volume: number
  play: () => Promise<void>
  pause: () => void
}

/* Minimal typings for the YouTube IFrame API (loaded at runtime). */
type YTPlayer = {
  playVideo: () => void
  pauseVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getDuration: () => number
  getVideoLoadedFraction: () => number
  setPlaybackRate: (rate: number) => void
  setVolume: (volume: number) => void
  mute: () => void
  unMute: () => void
  isMuted: () => boolean
  getPlayerState: () => number
  getIframe: () => HTMLIFrameElement
  getAvailableQualityLevels: () => string[]
  getPlaybackQuality: () => string
  setPlaybackQuality: (quality: string) => void
  setPlaybackQualityRange?: (min: string, max: string) => void
  loadModule: (module: string) => void
  unloadModule: (module: string) => void
  setOption: (module: string, option: string, value: unknown) => void
  getOptions: () => string[]
  getOption: (module: string, option: string) => unknown
  destroy: () => void
}

type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      width: string
      height: string
      videoId: string
      playerVars: Record<string, string | number>
      events: {
        onApiChange: () => void
        onReady: () => void
        onStateChange: (e: { data: number }) => void
        onError: () => void
      }
    },
  ) => YTPlayer
  PlayerState: {
    ENDED: number
    PLAYING: number
    PAUSED: number
    BUFFERING: number
    CUED: number
  }
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null

function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        prev?.()
        resolve(window.YT as YTNamespace)
      }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    })
  }
  return apiPromise
}

/** YouTube only honors preset rates; the sync nudge rounds to the nearest one. */
const YT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

/** YouTube quality level names → human labels. */
export const YT_QUALITY_LABELS: Record<string, string> = {
  highres: '4K+',
  hd2160: '2160p (4K)',
  hd1440: '1440p',
  hd1080: '1080p',
  hd720: '720p',
  large: '480p',
  medium: '360p',
  small: '240p',
  tiny: '144p',
}

/** Offered until the player reports the video's real levels. */
export const YT_QUALITY_FALLBACK = ['hd1080', 'hd720', 'large', 'medium']

/**
 * YouTube picks the stream to match the player's layout size (the official
 * setPlaybackQuality API is only a hint these days). Rendering the iframe at
 * the chosen resolution and scaling it to fit the box is what actually steers
 * the quality, so each level maps to the pixel size that elicits it.
 */
const YT_QUALITY_SIZE: Record<string, [number, number]> = {
  highres: [3840, 2160],
  hd2160: [3840, 2160],
  hd1440: [2560, 1440],
  hd1080: [1920, 1080],
  hd720: [1280, 720],
  large: [854, 480],
  medium: [640, 360],
  small: [426, 240],
  tiny: [256, 144],
}

class YouTubeMedia implements MediaLike {
  #p: YTPlayer
  #rate = 1
  #muted = false
  #volume = 0.8

  constructor(player: YTPlayer) {
    this.#p = player
  }

  get readyState() {
    return 1
  }

  get duration() {
    const d = this.#p.getDuration()
    return d > 0 ? d : Infinity
  }

  get currentTime() {
    return this.#p.getCurrentTime()
  }

  set currentTime(t: number) {
    this.#p.seekTo(Math.max(0, t), true)
  }

  get paused() {
    const s = this.#p.getPlayerState()
    return s !== 1 /* PLAYING */ && s !== 3 /* BUFFERING */
  }

  get playbackRate() {
    return this.#rate
  }

  set playbackRate(r: number) {
    const nearest = YT_RATES.reduce((a, b) =>
      Math.abs(b - r) < Math.abs(a - r) ? b : a,
    )
    if (nearest !== this.#rate) {
      this.#rate = nearest
      this.#p.setPlaybackRate(nearest)
    }
  }

  get muted() {
    return this.#muted
  }

  set muted(m: boolean) {
    this.#muted = m
    if (m) this.#p.mute()
    else this.#p.unMute()
  }

  get volume() {
    return this.#volume
  }

  set volume(v: number) {
    this.#volume = v
    this.#p.setVolume(Math.round(v * 100))
  }

  play() {
    this.#p.playVideo()
    // YouTube gives no promise; detect an autoplay block by checking state
    // shortly after, and reject the way a <video> would so the caller's
    // muted-autoplay fallback kicks in.
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        const s = this.#p.getPlayerState()
        if (s === 1 || s === 3 || s === 0) resolve()
        else reject(new DOMException('Autoplay was blocked', 'NotAllowedError'))
      }, 600)
    })
  }

  pause() {
    this.#p.pauseVideo()
  }
}

type Props = {
  videoId: string
  label: string
  /** 'auto' or a YouTube level name from YT_QUALITY_LABELS (local-only). */
  quality: string
  subtitle: string
  nativeSettings: boolean
  onSubtitles: (tracks: { value: string; label: string }[]) => void
  onMedia: (media: MediaLike | null) => void
  onTime: (seconds: number) => void
  onDuration: (seconds: number) => void
  onBuffered: (seconds: number) => void
  onLoading: (loading: boolean) => void
  onCanPlay: () => void
  onEnded: () => void
  onError: (message: string) => void
  /** The quality levels this video actually offers, once known. */
  onQualities: (levels: string[]) => void
  /** The level YouTube is currently serving. */
  onQuality: (level: string) => void
  onClick: () => void
}

/**
 * Renders the synced YouTube player. The iframe sits behind a click shield so
 * the room's own controls (host-gated) drive playback, not YouTube's UI.
 */
export function YouTubeSurface({
  videoId,
  label,
  onClick,
  quality,
  subtitle,
  nativeSettings,
  ...rest
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const qualityRef = useRef(quality)
  const subtitleRef = useRef(subtitle)
  const applySubtitles = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    try {
      if (subtitleRef.current === 'off') {
        // Clear the selected track as well as unloading the module. YouTube can
        // restore a saved/default track when captions load asynchronously.
        // Check module availability to avoid an unload → API-change loop.
        if (p.getOptions().includes('captions')) {
          p.setOption('captions', 'track', {})
          p.unloadModule('captions')
        }
      } else {
        p.loadModule('captions')
        if (subtitleRef.current !== 'on')
          p.setOption('captions', 'track', {
            languageCode: subtitleRef.current,
          })
      }
    } catch {
      /* Caption module is still loading. */
    }
  }, [])
  useEffect(() => {
    subtitleRef.current = subtitle
    applySubtitles()
  }, [subtitle, applySubtitles])
  // Latest callbacks without re-creating the player on each render.
  const cb = useRef(rest)
  useEffect(() => {
    cb.current = rest
  })

  /** Sizes the iframe for the chosen quality (see YT_QUALITY_SIZE). */
  const applyQuality = useCallback(() => {
    const player = playerRef.current
    const host = hostRef.current
    if (!player || !host) return
    const iframe = (() => {
      try {
        return player.getIframe()
      } catch {
        return null
      }
    })()
    if (!iframe) return
    const q = qualityRef.current
    const dims = YT_QUALITY_SIZE[q]
    const s = iframe.style
    try {
      if (!dims) {
        // Auto: let YouTube size the stream to the real player box.
        s.position = ''
        s.left = ''
        s.top = ''
        s.width = '100%'
        s.height = '100%'
        s.transform = ''
        s.transformOrigin = ''
        player.setPlaybackQuality('default')
        return
      }
      const [w, h] = dims
      const cw = host.clientWidth
      const ch = host.clientHeight
      if (!cw || !ch) return
      const scale = Math.min(cw / w, ch / h)
      s.position = 'absolute'
      s.left = '0'
      s.top = '0'
      s.width = `${w}px`
      s.height = `${h}px`
      s.transformOrigin = '0 0'
      s.transform = `translate(${(cw - w * scale) / 2}px, ${(ch - h * scale) / 2}px) scale(${scale})`
      player.setPlaybackQuality(q)
      player.setPlaybackQualityRange?.(q, q)
    } catch {
      // Player mid-teardown.
    }
  }, [])

  useEffect(() => {
    qualityRef.current = quality
    applyQuality()
  }, [quality, applyQuality])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let player: YTPlayer | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    let lastLevels = ''
    let lastQuality = ''
    // YT.Player replaces its target node, so give it a non-React-managed one.
    const target = document.createElement('div')
    target.className = 'size-full'
    host.appendChild(target)
    // Re-fit the forced-quality iframe when the player box resizes
    // (theater mode, fullscreen, window resizes).
    const ro = new ResizeObserver(() => applyQuality())
    ro.observe(host)

    void loadYouTubeApi().then((api) => {
      if (disposed) return
      player = new api.Player(target, {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          ...(subtitleRef.current !== 'off' ? { cc_load_policy: 1 } : {}),
          disablekb: 1,
          rel: 0,
          fs: 0,
          playsinline: 1,
          iv_load_policy: 3,
          origin: window.location.origin,
        },
        events: {
          onApiChange: () => {
            if (disposed || !player) return
            try {
              const tracks = player.getOption('captions', 'tracklist') as
                | {
                    languageCode: string
                    languageName?: string
                    displayName?: string
                  }[]
                | undefined
              if (Array.isArray(tracks))
                cb.current.onSubtitles(
                  tracks.map((t) => ({
                    value: t.languageCode,
                    label: t.displayName || t.languageName || t.languageCode,
                  })),
                )
              // Do not reload/unload here: that triggers another API change.
              if (subtitleRef.current !== 'off' && subtitleRef.current !== 'on')
                player.setOption('captions', 'track', {
                  languageCode: subtitleRef.current,
                })
              // Track lists are not exposed by every embed. Enforce Off even
              // when the module loads without reporting any tracks.
              if (subtitleRef.current === 'off') applySubtitles()
            } catch {
              /* This video has no caption module. */
            }
          },
          onReady: () => {
            if (disposed || !player) return
            playerRef.current = player
            cb.current.onMedia(new YouTubeMedia(player))
            applyQuality()
            applySubtitles()
            const d = player.getDuration()
            if (d > 0) cb.current.onDuration(d)
            cb.current.onCanPlay()
          },
          onStateChange: (e) => {
            if (disposed) return
            const S = api.PlayerState
            if (e.data === S.BUFFERING) cb.current.onLoading(true)
            else if (
              e.data === S.PLAYING ||
              e.data === S.PAUSED ||
              e.data === S.CUED
            )
              cb.current.onLoading(false)
            if (e.data === S.PLAYING && subtitleRef.current === 'off')
              applySubtitles()
            if (e.data === S.ENDED) cb.current.onEnded()
          },
          onError: () =>
            !disposed &&
            cb.current.onError(
              'This video cannot be played here. It may be private, removed, or embedding is disabled for it.',
            ),
        },
      })
      poll = setInterval(() => {
        if (disposed || !player) return
        try {
          cb.current.onTime(player.getCurrentTime())
          const d = player.getDuration()
          if (d > 0) {
            cb.current.onDuration(d)
            cb.current.onBuffered(player.getVideoLoadedFraction() * d)
          }
          const levels = player.getAvailableQualityLevels()
          const key = levels.join()
          if (key && key !== lastLevels) {
            lastLevels = key
            cb.current.onQualities(levels)
          }
          const q = player.getPlaybackQuality()
          if (q && q !== lastQuality) {
            lastQuality = q
            cb.current.onQuality(q)
          }
        } catch {
          // Player mid-teardown; the next tick is cleared by cleanup.
        }
      }, 500)
    })

    return () => {
      disposed = true
      if (poll) clearInterval(poll)
      ro.disconnect()
      playerRef.current = null
      cb.current.onMedia(null)
      try {
        player?.destroy()
      } catch {
        // Already gone.
      }
      target.remove()
    }
  }, [videoId, applyQuality, applySubtitles])

  return (
    <div className="absolute inset-0" aria-label={label}>
      <div ref={hostRef} className="relative size-full overflow-hidden" />
      {/* Click shield: keeps playback host-controlled and blocks YouTube's own UI. */}
      {!nativeSettings && (
        <div
          className="absolute inset-0"
          onClick={onClick}
          role="presentation"
        />
      )}
    </div>
  )
}
