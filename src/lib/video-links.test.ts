import { describe, expect, it } from 'vitest'
import { parseVideoLink } from './video-links'

const USER_ID = 'E211FEHc1q3r02ocxpusWOBKbJnJvwYDuM8mA01NL01DFo'

describe('parseVideoLink', () => {
  it('turns a Mux watch link (player.mux.com) into its stream URL', () => {
    const r = parseVideoLink(`https://player.mux.com/${USER_ID}`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.video.src).toBe(`https://stream.mux.com/${USER_ID}.m3u8`)
    expect(r.video.kind).toBe('mux')
    expect(r.video.title).toBe('Mux video')
  })

  it('keeps the title from a player link that carries one', () => {
    const r = parseVideoLink(
      `https://player.mux.com/${USER_ID}?metadata-video-title=Movie%20Night`,
    )
    expect(r.ok && r.video.title).toBe('Movie Night')
    expect(r.ok && r.video.src).toBe(`https://stream.mux.com/${USER_ID}.m3u8`)
  })

  it('handles player links with trailing slash or extra path', () => {
    const r = parseVideoLink(`https://player.mux.com/${USER_ID}/`)
    expect(r.ok && r.video.src).toBe(`https://stream.mux.com/${USER_ID}.m3u8`)
  })

  it('rejects a player link without a playback id', () => {
    const r = parseVideoLink('https://player.mux.com/')
    expect(r.ok).toBe(false)
  })

  it('normalizes a bare stream.mux.com link to .m3u8', () => {
    const r = parseVideoLink(`https://stream.mux.com/${USER_ID}`)
    expect(r.ok && r.video.src).toBe(`https://stream.mux.com/${USER_ID}.m3u8`)
    expect(r.ok && r.video.kind).toBe('mux')
  })

  it('keeps an explicit stream.mux.com .m3u8 link as-is', () => {
    const r = parseVideoLink(`https://stream.mux.com/${USER_ID}.m3u8`)
    expect(r.ok && r.video.src).toBe(`https://stream.mux.com/${USER_ID}.m3u8`)
  })

  it('classifies direct files and HLS links', () => {
    expect(parseVideoLink('https://cdn.example.com/movie.mp4')).toMatchObject({
      ok: true,
      video: { kind: 'mp4', title: 'movie' },
    })
    expect(parseVideoLink('https://cdn.example.com/show.webm')).toMatchObject({
      ok: true,
      video: { kind: 'mp4' },
    })
    expect(
      parseVideoLink('https://cdn.example.com/live/playlist.m3u8'),
    ).toMatchObject({ ok: true, video: { kind: 'hls' } })
  })

  it('recognizes YouTube links', () => {
    const r = parseVideoLink('https://youtu.be/dQw4w9WgXcQ')
    expect(r.ok && r.video.kind).toBe('youtube')
    expect(r.ok && r.video.src).toContain('dQw4w9WgXcQ')
  })

  it('rejects insecure, invalid and unsupported links', () => {
    expect(parseVideoLink('http://cdn.example.com/movie.mp4').ok).toBe(false)
    expect(parseVideoLink('not a url').ok).toBe(false)
    expect(parseVideoLink('https://example.com/page.html').ok).toBe(false)
    expect(parseVideoLink('https://example.com/').ok).toBe(false)
  })
})
