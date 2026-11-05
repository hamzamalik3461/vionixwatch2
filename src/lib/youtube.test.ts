import { describe, expect, it } from 'vitest'
import { parseYouTubeId, youtubeWatchUrl } from './youtube'

describe('parseYouTubeId', () => {
  it('extracts the id from common link forms', () => {
    const id = 'dQw4w9WgXcQ'
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=43s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://music.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://youtu.be/${id}?si=share-junk`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
    ]) {
      expect(parseYouTubeId(url), url).toBe(id)
    }
  })

  it('rejects everything else', () => {
    for (const url of [
      'https://www.youtube.com/',
      'https://www.youtube.com/feed/trending',
      'https://www.youtube.com/watch?v=tooShort',
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'https://notyoutube.com/dQw4w9WgXcQ',
      'not a url',
      'https://youtu.be/',
    ]) {
      expect(parseYouTubeId(url), url).toBeNull()
    }
  })

  it('builds the canonical watch URL', () => {
    expect(youtubeWatchUrl('dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
  })
})
