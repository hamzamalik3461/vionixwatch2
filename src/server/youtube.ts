/** Server-side YouTube metadata lookup (no API key needed). */

/**
 * Best-effort title lookup via the public oEmbed endpoint. Returns null on
 * any failure or timeout so adding a video never blocks on YouTube.
 */
export async function fetchYouTubeTitle(id: string): Promise<string | null> {
  try {
    const watch = `https://www.youtube.com/watch?v=${id}`
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`,
      { signal: AbortSignal.timeout(4000) },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { title?: unknown }
    return typeof data.title === 'string' && data.title.trim()
      ? data.title.trim().slice(0, 120)
      : null
  } catch {
    return null
  }
}
