/** YouTube link parsing shared by the browser (add form) and the server (queue validation). */

const ID_RE = /^[A-Za-z0-9_-]{11}$/

/**
 * Extracts the 11-character video id from any common YouTube link form:
 * watch?v=, youtu.be/, /shorts/, /live/, /embed/ — or returns null.
 */
export function parseYouTubeId(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\.|^m\./, '')
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0]
    return ID_RE.test(id) ? id : null
  }
  if (
    host !== 'youtube.com' &&
    host !== 'music.youtube.com' &&
    host !== 'youtube-nocookie.com'
  )
    return null
  const v = u.searchParams.get('v')
  if (v && ID_RE.test(v)) return v
  const m = u.pathname.match(
    /^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/,
  )
  return m ? m[1] : null
}

export const youtubeWatchUrl = (id: string) =>
  `https://www.youtube.com/watch?v=${id}`

export const youtubeThumbnail = (id: string) =>
  `url("https://i.ytimg.com/vi/${id}/hqdefault.jpg") center / cover no-repeat, linear-gradient(135deg, #1a0503, #3b0d08)`
