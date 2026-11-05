/**
 * Tiny synthesized UI sounds (WebAudio, no audio files).
 * Join/leave chimes, message pings and call ring loops. Browsers only allow
 * audio after a user gesture, so `unlockSounds()` hooks the first interaction
 * and every play silently no-ops if the context isn't running yet.
 */

export type SoundName =
  | 'voice-join'
  | 'voice-leave'
  | 'member-join'
  | 'member-leave'
  | 'message'
  | 'call-connect'
  | 'call-end'

let ctx: AudioContext | null = null
let master: GainNode | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext
    if (!AC) return null
    try {
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = 0.5
      master.connect(ctx.destination)
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  return ctx.state === 'running' ? ctx : null
}

/** Call once on the client: resumes the audio context on the first gesture. */
export function unlockSounds() {
  if (typeof window === 'undefined') return
  const unlock = () => {
    const AC = window.AudioContext
    if (!AC) return
    if (!ctx) {
      try {
        ctx = new AC()
        master = ctx.createGain()
        master.gain.value = 0.5
        master.connect(ctx.destination)
      } catch {
        return
      }
    }
    void ctx.resume().catch(() => {})
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock, { passive: true })
}

/** One enveloped note. Times are relative to "now" in seconds. */
function note(
  c: AudioContext,
  freq: number,
  start: number,
  duration: number,
  peak = 0.22,
  type: OscillatorType = 'sine',
) {
  if (!master) return
  const t0 = c.currentTime + start
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain).connect(master)
  osc.start(t0)
  osc.stop(t0 + duration + 0.05)
}

const PATTERNS: Record<SoundName, (c: AudioContext) => void> = {
  // Rising two-note chime, like entering a channel.
  'voice-join': (c) => {
    note(c, 523.25, 0, 0.18)
    note(c, 783.99, 0.1, 0.28)
  },
  // The reverse on the way out.
  'voice-leave': (c) => {
    note(c, 659.25, 0, 0.18)
    note(c, 440, 0.1, 0.28)
  },
  'member-join': (c) => {
    note(c, 660, 0, 0.12, 0.16)
    note(c, 880, 0.07, 0.16, 0.16)
  },
  'member-leave': (c) => {
    note(c, 587, 0, 0.12, 0.14)
    note(c, 392, 0.07, 0.18, 0.14)
  },
  // Soft, quick DM ping.
  message: (c) => {
    note(c, 880, 0, 0.1, 0.14, 'triangle')
    note(c, 1174.7, 0.08, 0.2, 0.14, 'triangle')
  },
  // Quick major arpeggio when a call connects.
  'call-connect': (c) => {
    note(c, 523.25, 0, 0.12)
    note(c, 659.25, 0.08, 0.12)
    note(c, 783.99, 0.16, 0.25)
  },
  // Low double thud when it ends.
  'call-end': (c) => {
    note(c, 330, 0, 0.16, 0.2)
    note(c, 262, 0.14, 0.3, 0.2)
  },
}

export function playSound(name: SoundName) {
  const c = audio()
  if (!c) return
  try {
    PATTERNS[name](c)
  } catch {
    /* never let a sound break the UI */
  }
}

/**
 * Looping ring tone. `incoming` is a bright double-ring, `outgoing` a soft
 * ringback. Returns a stop function; always call it (safe to call twice).
 */
export function startRing(kind: 'incoming' | 'outgoing') {
  let stopped = false
  const burst = () => {
    const c = audio()
    if (!c) return
    try {
      if (kind === 'incoming') {
        for (let i = 0; i < 2; i++) {
          const o = i * 0.42
          note(c, 932, o, 0.16, 0.18, 'triangle')
          note(c, 1244.5, o + 0.14, 0.2, 0.18, 'triangle')
        }
      } else {
        note(c, 440, 0, 0.9, 0.08)
        note(c, 480, 0, 0.9, 0.08)
      }
    } catch {
      /* ignore */
    }
  }
  burst()
  const timer = setInterval(burst, kind === 'incoming' ? 2400 : 3200)
  return () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
  }
}
