import { useEffect, useRef } from 'react'
import { MonitorUp, MonitorX } from 'lucide-react'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import { Button } from '@/components/ui/button'
import type { RoomState } from './useRoom'
import type { VoiceState } from './useVoice'

/**
 * Shown above the player while someone shares their screen.
 * Everyone in the room sees it, whether or not they joined voice.
 */
export function ScreenShareView({
  room,
  voice,
}: {
  room: RoomState
  voice: VoiceState
}) {
  const remote = voice.remoteScreen
  const track: RemoteVideoTrack | LocalVideoTrack | null =
    remote?.track ?? voice.localScreen
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !track) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])

  if (!track) return null
  const sharer = remote
    ? (room.members.find((m) => m.id === remote.by)?.name ?? 'Someone')
    : null

  return (
    <div className="nw-fade-up relative overflow-hidden rounded-2xl border bg-black shadow-2xl shadow-primary/10">
      <video
        ref={ref}
        muted={!remote}
        playsInline
        aria-label={sharer ? `${sharer}'s screen` : 'Your shared screen'}
        className="max-h-[70svh] min-h-40 w-full bg-black object-contain"
      />
      <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
        <MonitorUp className="size-3.5 text-electric" />
        {sharer
          ? `${sharer} is sharing their screen`
          : 'You are sharing your screen'}
      </div>
      {!remote && (
        <Button
          size="sm"
          variant="destructive"
          className="absolute top-1.5 right-2"
          onClick={() => void voice.toggleShare()}
        >
          <MonitorX /> Stop sharing
        </Button>
      )}
    </div>
  )
}
