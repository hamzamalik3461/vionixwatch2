import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YouTubeSurface } from './YouTubeSurface'

describe('YouTube subtitle control', () => {
  let events: {
    onReady: () => void
    onApiChange: () => void
    onStateChange: (event: { data: number }) => void
  }
  let playerVars: Record<string, string | number>
  let modules: string[]
  const setOption = vi.fn()
  const unloadModule = vi.fn(() => {
    modules = []
  })
  const loadModule = vi.fn(() => {
    modules = ['captions']
  })

  const props = {
    videoId: 'abcdefghijk',
    label: 'Test video',
    quality: 'auto',
    subtitle: 'on',
    nativeSettings: false,
    onSubtitles: vi.fn(),
    onMedia: vi.fn(),
    onTime: vi.fn(),
    onDuration: vi.fn(),
    onBuffered: vi.fn(),
    onLoading: vi.fn(),
    onCanPlay: vi.fn(),
    onEnded: vi.fn(),
    onError: vi.fn(),
    onQualities: vi.fn(),
    onQuality: vi.fn(),
    onClick: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    modules = ['captions']
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    window.YT = {
      Player: class {
        constructor(
          _el: HTMLElement,
          options: { events: typeof events; playerVars: typeof playerVars },
        ) {
          events = options.events
          playerVars = options.playerVars
        }
        getOptions = () => modules
        // Some embeds do not expose a track list at all.
        getOption = () => undefined
        setOption = setOption
        loadModule = loadModule
        unloadModule = unloadModule
        getIframe = () => document.createElement('iframe')
        setPlaybackQuality = vi.fn()
        getDuration = () => 100
        destroy = vi.fn()
      } as unknown as NonNullable<Window['YT']>['Player'],
      PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
    }
  })

  afterEach(() => {
    delete window.YT
    vi.unstubAllGlobals()
  })

  async function ready() {
    await waitFor(() => expect(events).toBeDefined())
    act(() => events.onReady())
  }

  it('clears the active track when switched off and can enable captions again', async () => {
    const view = render(<YouTubeSurface {...props} />)
    await ready()
    expect(loadModule).toHaveBeenCalledWith('captions')
    view.rerender(<YouTubeSurface {...props} subtitle="off" />)
    expect(setOption).toHaveBeenCalledWith('captions', 'track', {})
    expect(unloadModule).toHaveBeenCalledTimes(1)
    act(() => events.onApiChange())
    expect(unloadModule).toHaveBeenCalledTimes(1)
    view.rerender(<YouTubeSurface {...props} subtitle="en" />)
    expect(loadModule).toHaveBeenCalledTimes(2)
    expect(setOption).toHaveBeenLastCalledWith('captions', 'track', {
      languageCode: 'en',
    })
    view.unmount()
  })

  it('disables late-loading captions without requiring a track list', async () => {
    const view = render(<YouTubeSurface {...props} subtitle="off" />)
    await ready()
    expect(playerVars.cc_load_policy).toBeUndefined()
    modules = ['captions']
    act(() => events.onApiChange())
    expect(unloadModule).toHaveBeenCalledTimes(2)
    modules = ['captions']
    act(() => events.onStateChange({ data: 1 }))
    expect(unloadModule).toHaveBeenCalledTimes(3)
    view.unmount()
  })
})
