// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { livekitConfigured, voiceToken, callToken } from './livekit'
import { createDirectUpload, muxConfigured } from './mux'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function configure(url = 'https://media.example.test/') {
  const values: Record<string, string> = {
    LIVEKIT_URL: url,
    LIVEKIT_API_KEY: 'test-key',
    LIVEKIT_API_SECRET: 'test-signing-secret-at-least-32-characters',
    MUX_TOKEN_ID: 'test-id',
    MUX_TOKEN_SECRET: 'test-secret',
  }
  vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } })
}

describe('media service runtime configuration', () => {
  it('reads Netlify runtime variables and scopes room and call grants', async () => {
    vi.stubEnv('LIVEKIT_URL', '')
    configure()
    expect(livekitConfigured()).toBe(true)
    const room = await voiceToken('ABCD', 'member', 'Viewer')
    const call = await callToken('call-id', 'member', 'Viewer')
    expect(room?.url).toBe('wss://media.example.test')
    const claims = (token: string) =>
      JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    expect(claims(room!.token).video).toMatchObject({
      room: 'vionix-ABCD',
      canPublishData: false,
      canPublishSources: ['microphone', 'screen_share', 'screen_share_audio'],
    })
    expect(claims(call!.token).video.room).toBe('vionix-call-call-id')
  })

  it('rejects invalid LiveKit endpoint protocols', () => {
    configure('ftp://media.example.test')
    expect(livekitConfigured()).toBe(false)
  })

  it('creates direct uploads using invocation-scoped Mux configuration', async () => {
    configure()
    expect(muxConfigured()).toBe(true)
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        data: { id: 'up', url: 'https://upload.example.test' },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    expect(
      await createDirectUpload(
        { r: 'room', t: 'Clip', by: 'Viewer' },
        'https://watch.example.test',
      ),
    ).toEqual({ uploadId: 'up', url: 'https://upload.example.test' })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.cors_origin).toBe('https://watch.example.test')
    expect(body.new_asset_settings.playback_policy).toEqual(['public'])
  })

  it('converts Mux network failures to a safe retryable service error', async () => {
    configure()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network failure')),
    )
    await expect(
      createDirectUpload(
        { r: 'room', t: 'Clip', by: 'Viewer' },
        'https://watch.example.test',
      ),
    ).rejects.toMatchObject({ status: 502 })
  })
})
