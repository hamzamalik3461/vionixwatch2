import { useEffect, useRef } from 'react'
import {
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
} from 'lucide-react'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import { colorFor, isImageAvatar } from '@/lib/catalog'
import { formatTime } from '@/lib/session'
import type { ApiFriend } from '@/lib/social-types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSocial } from './SocialProvider'

export function UserAvatar({
  user,
  size = 'md',
  withStatus = false,
  className,
}: {
  user: Pick<ApiFriend, 'id' | 'name' | 'avatar'> & { online?: boolean }
  size?: 'sm' | 'md' | 'lg' | 'xl'
  withStatus?: boolean
  className?: string
}) {
  const dims = {
    sm: 'size-8 text-base',
    md: 'size-10 text-lg',
    lg: 'size-14 text-2xl',
    xl: 'size-24 text-5xl',
  }[size]
  return (
    <div className={cn('relative shrink-0', className)}>
      <div
        className={cn(
          'grid place-items-center overflow-hidden rounded-full',
          dims,
        )}
        style={{
          background: `color-mix(in oklch, ${colorFor(user.id)} 35%, var(--secondary))`,
        }}
        aria-hidden="true"
      >
        {isImageAvatar(user.avatar) ? (
          <img
            src={user.avatar}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          user.avatar
        )}
      </div>
      {withStatus && (
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background',
            user.online ? 'bg-success' : 'bg-muted-foreground',
          )}
          aria-label={user.online ? 'Online' : 'Offline'}
        />
      )}
    </div>
  )
}

function VideoSurface({
  track,
  mirrored,
  contain,
  className,
  label,
}: {
  track: LocalVideoTrack | RemoteVideoTrack
  mirrored?: boolean
  contain?: boolean
  className?: string
  label: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return (
    <video
      ref={ref}
      aria-label={label}
      muted={mirrored}
      playsInline
      className={cn(
        'h-full w-full',
        contain ? 'object-contain' : 'object-cover',
        mirrored && '-scale-x-100',
        className,
      )}
    />
  )
}

/** Slides in when a friend is calling; hidden while already in a call. */
export function IncomingCallBanner() {
  const { pulse, callPhase, acceptIncoming, declineIncoming } = useSocial()
  const incoming = pulse?.incoming ?? null
  if (!incoming || callPhase !== 'idle') return null
  return (
    <div
      role="alertdialog"
      aria-label={`Incoming ${incoming.kind} call from ${incoming.from.name}`}
      className="nw-slide-down fixed inset-x-0 top-4 z-[90] mx-auto w-[min(26rem,calc(100vw-2rem))]"
    >
      <div className="nw-panel flex items-center gap-3 rounded-2xl border p-3 shadow-2xl shadow-primary/20 backdrop-blur">
        <div className="nw-pulse-ring rounded-full">
          <UserAvatar user={incoming.from} size="lg" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{incoming.from.name}</p>
          <p className="text-sm text-muted-foreground">
            Incoming {incoming.kind === 'video' ? 'video' : 'voice'} call…
          </p>
        </div>
        <Button
          size="icon"
          aria-label="Decline call"
          variant="destructive"
          className="rounded-full"
          onClick={() => void declineIncoming()}
        >
          <PhoneOff />
        </Button>
        <Button
          size="icon"
          aria-label="Accept call"
          className="nw-ring-glow rounded-full bg-success text-background hover:bg-success/90"
          onClick={() => void acceptIncoming()}
        >
          {incoming.kind === 'video' ? <Video /> : <Phone />}
        </Button>
      </div>
    </div>
  )
}

/** Full-screen in-call UI. Lives at the root so it survives navigation. */
export function CallOverlay() {
  const {
    callPhase,
    currentCall,
    callPeer,
    callMuted,
    callCamOn,
    callSharing,
    callSeconds,
    peerJoined,
    localVideo,
    remoteVideo,
    remoteScreen,
    hangUp,
    toggleCallMute,
    toggleCamera,
    toggleCallScreenShare,
  } = useSocial()
  if (callPhase === 'idle' || !callPeer || !currentCall) return null

  const statusText =
    callPhase === 'outgoing'
      ? 'Ringing…'
      : callPhase === 'connecting' || !peerJoined
        ? 'Connecting…'
        : formatTime(callSeconds)
  // Screen share takes the stage; the camera drops to a thumbnail beside yours.
  const stage = remoteScreen ?? remoteVideo
  const canShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function'

  return (
    <div
      role="dialog"
      aria-label={`${currentCall.kind === 'video' ? 'Video' : 'Voice'} call with ${callPeer.name}`}
      className="nw-fade-in fixed inset-0 z-[95] flex h-dvh flex-col bg-background/95 backdrop-blur-md"
    >
      <div className="mx-auto flex h-full w-full max-w-5xl min-w-0 flex-1 flex-col p-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:p-6">
        {/* Stage */}
        <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-2xl border bg-black/80 shadow-2xl shadow-primary/10 sm:rounded-3xl">
          {stage ? (
            <VideoSurface
              track={stage}
              contain
              label={
                remoteScreen
                  ? `${callPeer.name}'s screen`
                  : `${callPeer.name}'s camera`
              }
            />
          ) : (
            <div className="nw-glow flex h-full flex-col items-center justify-center gap-4">
              <div
                className={cn(
                  'rounded-full',
                  callPhase !== 'active' && 'nw-pulse-ring',
                )}
              >
                <UserAvatar user={callPeer} size="xl" />
              </div>
              <div className="text-center">
                <p className="font-display text-2xl font-bold">
                  {callPeer.name}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  @{callPeer.username}
                </p>
              </div>
            </div>
          )}

          {/* Thumbnails: your camera, plus theirs when a screen has the stage. */}
          <div className="absolute top-2 right-2 flex flex-col items-end gap-2 sm:top-3 sm:right-3">
            {localVideo && (
              <div className="aspect-video w-28 overflow-hidden rounded-lg border bg-black shadow-lg sm:w-44 sm:rounded-xl">
                <VideoSurface track={localVideo} mirrored label="Your camera" />
              </div>
            )}
            {remoteScreen && remoteVideo && (
              <div className="aspect-video w-28 overflow-hidden rounded-lg border bg-black shadow-lg sm:w-44 sm:rounded-xl">
                <VideoSurface
                  track={remoteVideo}
                  label={`${callPeer.name}'s camera`}
                />
              </div>
            )}
          </div>

          <div className="absolute top-2 left-2 flex max-w-[calc(100%-8.5rem)] flex-col items-start gap-1 sm:top-3 sm:left-3">
            <span className="rounded-full bg-black/60 px-3 py-1 text-sm font-semibold text-white tabular-nums">
              {stage ? `${callPeer.name} · ${statusText}` : statusText}
            </span>
            {callSharing && (
              <span className="rounded-full bg-primary/80 px-3 py-1 text-xs font-semibold text-white">
                You are sharing your screen
              </span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-2.5 pt-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] sm:gap-3 sm:pt-4">
          <Button
            size="icon-lg"
            variant={callMuted ? 'destructive' : 'secondary'}
            className="size-12 rounded-full sm:size-14"
            aria-label={callMuted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={callMuted}
            onClick={toggleCallMute}
          >
            {callMuted ? (
              <MicOff className="size-5 sm:size-6" />
            ) : (
              <Mic className="size-5 sm:size-6" />
            )}
          </Button>
          <Button
            size="icon-lg"
            variant={callCamOn ? 'secondary' : 'outline'}
            className="size-12 rounded-full sm:size-14"
            aria-label={callCamOn ? 'Turn camera off' : 'Turn camera on'}
            aria-pressed={callCamOn}
            onClick={() => void toggleCamera()}
          >
            {callCamOn ? (
              <Video className="size-5 sm:size-6" />
            ) : (
              <VideoOff className="size-5 sm:size-6" />
            )}
          </Button>
          {canShare && (
            <Button
              size="icon-lg"
              variant={callSharing ? 'default' : 'secondary'}
              className="size-12 rounded-full sm:size-14"
              aria-label={
                callSharing ? 'Stop sharing your screen' : 'Share your screen'
              }
              aria-pressed={callSharing}
              onClick={() => void toggleCallScreenShare()}
            >
              <MonitorUp className="size-5 sm:size-6" />
            </Button>
          )}
          <Button
            size="icon-lg"
            variant="destructive"
            className="size-12 rounded-full shadow-lg shadow-destructive/40 sm:size-14"
            aria-label="Hang up"
            onClick={() => void hangUp()}
          >
            <PhoneOff className="size-5 sm:size-6" />
          </Button>
        </div>
      </div>
    </div>
  )
}
