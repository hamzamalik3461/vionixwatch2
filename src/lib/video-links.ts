import { parseYouTubeId, youtubeWatchUrl } from './youtube'

/** What the "add a video link" form sends to the queue API. */
export type VideoLinkInput = {
  title: string
  src: string
  kind: 'mp4' | 'hls' | 'mux' | 'youtube'
  duration: number
  thumbnail: string
}

export type VideoLinkResult =
  { ok: true; video: VideoLinkInput } | { ok: false; error: string }

const THUMB = 'linear-gradient(135deg, #3b0d08, #1a0503)'
/** Mux playback IDs are URL-safe alphanumeric tokens. */
const MUX_PLAYBACK_ID = /^[A-Za-z0-9]{8,256}$/

/**
 * Turns anything a host might paste — YouTube link, Mux watch/stream link,
 * direct MP4/WebM or HLS URL — into a queue entry, or a friendly error.
 */
export function parseVideoLink(raw: string): VideoLinkResult {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, error: 'Enter a valid https:// video URL' }
  }
  if (url.protocol !== 'https:')
    return { ok: false, error: 'Only secure https:// links are supported' }

  const ytId = parseYouTubeId(url.toString())
  if (ytId)
    return {
      ok: true,
      video: {
        title: 'YouTube video',
        src: youtubeWatchUrl(ytId),
        kind: 'youtube',
        duration: 0,
        thumbnail: THUMB,
      },
    }

  const host = url.hostname.toLowerCase()

  // A Mux watch-page link (player.mux.com/<playback-id>) plays the same
  // stream as stream.mux.com/<playback-id>.m3u8.
  if (host === 'player.mux.com') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? ''
    if (!MUX_PLAYBACK_ID.test(id))
      return {
        ok: false,
        error: 'That Mux player link is missing its playback id',
      }
    const title = url.searchParams.get('metadata-video-title')?.trim()
    return {
      ok: true,
      video: {
        title: title?.slice(0, 120) || 'Mux video',
        src: `https://stream.mux.com/${id}.m3u8`,
        kind: 'mux',
        duration: 0,
        thumbnail: THUMB,
      },
    }
  }

  const mux = host === 'stream.mux.com'
  // A bare playback-id Mux link streams via its .m3u8 form.
  if (mux && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}.m3u8`
  }
  const path = url.pathname.toLowerCase()
  const kind =
    mux || path.endsWith('.m3u8')
      ? 'hls'
      : path.endsWith('.mp4') || path.endsWith('.webm')
        ? 'mp4'
        : null
  if (!kind)
    return {
      ok: false,
      error: 'Use a YouTube, direct .mp4/.webm, .m3u8 or Mux link',
    }
  return {
    ok: true,
    video: {
      title:
        decodeURIComponent(path.split('/').pop() ?? 'Video').replace(
          /\.[^.]+$/,
          '',
        ) || 'Video',
      src: url.toString(),
      kind: mux ? 'mux' : kind,
      duration: 0,
      thumbnail: THUMB,
    },
  }
}
