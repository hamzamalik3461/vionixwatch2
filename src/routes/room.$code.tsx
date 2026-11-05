import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Crown,
  Eye,
  Headphones,
  KeyRound,
  Link2,
  Lock,
  MessageSquare,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  Power,
  Settings,
  Users,
} from 'lucide-react'

import { Logo } from '@/components/brand/Logo'
import { AvatarPicker } from '@/components/AvatarPicker'
import { Avatar } from '@/components/room/Avatar'
import { ChatPanel } from '@/components/room/ChatPanel'
import { MembersPanel } from '@/components/room/MembersPanel'
import { Playlist } from '@/components/room/Playlist'
import { ScreenShareView } from '@/components/room/ScreenShareView'
import { SettingsPanel, copy, inviteUrl } from '@/components/room/SettingsPanel'
import { useRoom, type RoomState } from '@/components/room/useRoom'
import { useVoice } from '@/components/room/useVoice'
import { VideoPlayer } from '@/components/room/VideoPlayer'
import { VoicePanel, VoiceStatusPill } from '@/components/room/VoicePanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { avatarChoices, type Member } from '@/lib/catalog'
import { normalizeRoomCode, sanitizeName } from '@/lib/session'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/room/$code')({
  head: ({ params }) => ({
    meta: [{ title: `Room ${params.code.toUpperCase()} · Vionix Watch` }],
  }),
  component: RoomPage,
})

function RoomPage() {
  const { code: rawCode } = Route.useParams()
  const code = normalizeRoomCode(rawCode)
  if (!code) return <InvalidRoom />
  return <Room code={code} />
}

function Room({ code }: { code: string }) {
  const room = useRoom(code)

  switch (room.phase) {
    case 'loading':
      return <RoomSkeleton />
    case 'notFound':
      return <InvalidRoom />
    case 'ended':
      return <RoomEnded />
    case 'needsProfile':
      return <JoinGate room={room} code={code} />
    case 'needsPassword':
      return <PasswordGate room={room} code={code} />
    case 'locked':
      return (
        <Blocked
          title="This room is locked"
          text="The host locked the room, so new people can't join right now."
        />
      )
    case 'full':
      return (
        <Blocked
          title="This room is full"
          text="Every seat is taken. Try again in a bit."
        />
      )
    case 'removed':
      return (
        <Blocked
          title="You were removed"
          text="The host removed you from this room."
        />
      )
    case 'error':
      return (
        <Blocked
          title="Couldn't open the room"
          text={room.phaseError ?? 'Something went wrong.'}
          retry
        />
      )
    default:
      return <RoomView room={room} code={code} />
  }
}

function RoomView({ room: base, code }: { room: RoomState; code: string }) {
  const voice = useVoice(base)
  const [theater, setTheater] = useState(false)
  // Merge live voice state (from LiveKit) into the member list.
  const room = useMemo(() => {
    const merge = (m: Member): Member => {
      const v = voice.participants.get(m.id)
      return v ? { ...m, inVoice: true, ...v } : m
    }
    return {
      ...base,
      members: base.members.map(merge),
      me: base.me && merge(base.me),
    }
  }, [base, voice.participants])
  const online = room.members.filter((m) => m.online).length

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="flex items-center gap-3 px-3 py-2.5 sm:px-5">
          <Logo className="[&>span]:hidden sm:[&>span]:inline" />
          <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 truncate font-display text-sm font-bold sm:text-base">
              {room.settings.name}
              {room.settings.locked && (
                <Lock
                  className="size-3.5 shrink-0 text-warning"
                  aria-label="Locked"
                />
              )}
            </h1>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <button
                type="button"
                className="font-mono tracking-wider hover:text-foreground"
                onClick={() => void copy(code, 'Room code')}
                aria-label={`Copy room code ${code}`}
              >
                {code}
              </button>
              <span className="flex items-center gap-1">
                <Users className="size-3" /> {online}
              </span>
              <span className="hidden sm:inline">
                <VoiceStatusPill voice={voice} />
              </span>
            </p>
          </div>

          {room.actualOwner && (
            <div className="hidden items-center gap-2 rounded-full border px-3 py-1 md:flex">
              <Eye className="size-3.5 text-muted-foreground" />
              <Label htmlFor="preview" className="text-xs">
                Preview as guest
              </Label>
              <Switch
                id="preview"
                checked={room.previewAsGuest}
                onCheckedChange={room.actions.setPreviewAsGuest}
              />
            </div>
          )}

          {room.isOwner ? (
            <span className="hidden items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-xs font-bold text-warning sm:flex">
              <Crown className="size-3.5" /> Host
            </span>
          ) : (
            <span className="hidden items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-semibold sm:flex">
              Guest
            </span>
          )}

          <Button
            size="sm"
            onClick={() => void copy(inviteUrl(code), 'Invite link')}
          >
            <Link2 /> <span className="hidden sm:inline">Invite</span>
          </Button>
        </div>
      </header>

      <main
        className={cn(
          'grid flex-1 gap-4 p-3 sm:p-5',
          theater ? 'grid-cols-1' : 'lg:grid-cols-[minmax(0,1fr)_380px]',
        )}
      >
        <div className="min-w-0 space-y-4">
          <ScreenShareView room={room} voice={voice} />
          <VideoPlayer
            room={room}
            theater={theater}
            onToggleTheater={() => setTheater((t) => !t)}
            sinkId={voice.outputId}
            deafened={voice.deafened}
          />
          <NowWatching room={room} />
          {!theater && <Playlist room={room} />}
        </div>

        <aside
          aria-label="Room sidebar"
          className={cn(
            'flex h-[70svh] min-h-[28rem] flex-col overflow-hidden rounded-2xl border bg-sidebar lg:sticky lg:top-[4.5rem] lg:h-[calc(100svh-6rem)]',
            theater && 'lg:static lg:h-[32rem]',
          )}
        >
          <Tabs
            defaultValue="chat"
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <TabsList className="m-2 grid grid-cols-4">
              <TabsTrigger value="chat" aria-label="Chat">
                <MessageSquare /> <span className="hidden sm:inline">Chat</span>
              </TabsTrigger>
              <TabsTrigger value="members" aria-label="Members">
                <Users /> <span className="hidden sm:inline">{online}</span>
              </TabsTrigger>
              <TabsTrigger value="voice" aria-label="Voice">
                <Headphones />
                <span className="hidden sm:inline">
                  {room.members.filter((m) => m.inVoice && m.online).length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="settings" aria-label="Settings">
                <Settings />
              </TabsTrigger>
            </TabsList>
            <TabsContent value="chat" className="min-h-0 flex-1">
              <ChatPanel room={room} />
            </TabsContent>
            <TabsContent
              value="members"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <MembersPanel room={room} />
            </TabsContent>
            <TabsContent
              value="voice"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <VoicePanel room={room} voice={voice} />
            </TabsContent>
            <TabsContent
              value="settings"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <SettingsPanel room={room} code={code} />
            </TabsContent>
          </Tabs>

          {/* Discord-style self bar */}
          {room.me && (
            <div className="flex items-center gap-2.5 border-t bg-background/40 px-3 py-2">
              <Avatar member={room.me} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{room.me.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {voice.status === 'connected'
                    ? voice.muted
                      ? 'Muted'
                      : 'Voice on'
                    : 'Watching'}
                </p>
              </div>
              {voice.status === 'connected' ? (
                <>
                  <Button
                    size="icon-sm"
                    variant={voice.muted ? 'destructive' : 'ghost'}
                    aria-label={voice.muted ? 'Unmute' : 'Mute'}
                    onClick={voice.toggleMute}
                  >
                    {voice.muted ? <MicOffIcon /> : <MicIcon />}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Leave voice"
                    onClick={() => void voice.leave()}
                  >
                    <Power />
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void voice.join()}
                  disabled={
                    voice.status === 'connecting' ||
                    voice.realtime !== 'connected'
                  }
                >
                  <Headphones /> Join
                </Button>
              )}
            </div>
          )}
        </aside>
      </main>
    </div>
  )
}

function NowWatching({ room }: { room: RoomState }) {
  const { current, owner, settings } = room
  if (!current) return null
  return (
    <div className="flex flex-wrap items-center gap-3 px-1">
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-display text-xl font-bold">
          {current.title}
        </h2>
        <p className="truncate text-sm text-muted-foreground">
          {settings.description || 'Watching together'} · hosted by{' '}
          <span className="font-semibold text-warning">{owner?.name}</span>
        </p>
      </div>
      {!room.isOwner && (
        <p className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
          <Lock className="size-3" /> Playback is controlled by the host
        </p>
      )}
    </div>
  )
}

function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-svh place-items-center px-4 py-10">
      <div className="nw-glow nw-breathe pointer-events-none absolute inset-0" />
      <div className="nw-panel nw-fade-up relative w-full max-w-md rounded-3xl border p-6 shadow-2xl shadow-primary/10 sm:p-8">
        <Logo className="mb-6" />
        {children}
      </div>
    </div>
  )
}

function JoinGate({ room, code }: { room: RoomState; code: string }) {
  const [name, setName] = useState(room.suggestedProfile?.name ?? '')
  const [avatar, setAvatar] = useState(
    room.suggestedProfile?.avatar ?? avatarChoices[0],
  )
  // A freshly picked photo is held locally and uploaded right after joining.
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const clean = sanitizeName(name)
    if (clean.length < 2) {
      setError('Pick a username with at least 2 characters.')
      return
    }
    setBusy(true)
    // The session API only accepts emoji or an already-owned image URL.
    const safeAvatar =
      pendingImage && !avatarChoices.includes(avatar)
        ? avatarChoices[0]
        : avatar
    await room.actions.submitProfile(
      { name: clean, avatar: safeAvatar },
      pendingImage ?? undefined,
    )
    setBusy(false)
  }

  return (
    <GateShell>
      <p className="text-xs font-bold tracking-[0.2em] text-electric uppercase">
        You're invited
      </p>
      <h1 className="mt-1 font-display text-2xl font-bold">
        {room.settings.name}
      </h1>
      <p className="mt-1 font-mono text-sm text-muted-foreground">{code}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="gate-name">Your username</Label>
          <Input
            id="gate-name"
            autoFocus
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(error)}
          />
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <div role="group" aria-label="Avatar">
          <AvatarPicker
            size="sm"
            value={pendingImage ?? avatar}
            onPick={(a) => {
              setAvatar(a)
              setPendingImage(null)
            }}
            onImage={setPendingImage}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Pick an emoji or upload your own picture.
          </p>
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={busy}
          className="h-12 w-full font-bold shadow-lg shadow-primary/30"
        >
          {busy ? 'Joining…' : 'Join room'}
        </Button>
      </form>
    </GateShell>
  )
}

function PasswordGate({ room, code }: { room: RoomState; code: string }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <GateShell>
      <KeyRound className="size-8 text-warning" />
      <h1 className="mt-3 font-display text-2xl font-bold">
        {room.settings.name}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Room <span className="font-mono">{code}</span> is password protected.
      </p>
      <form
        className="mt-6 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!pw) return
          setBusy(true)
          const ok = await room.actions.unlockWithPassword(pw)
          setBusy(false)
          if (!ok) setError(true)
        }}
      >
        <Label htmlFor="gate-pw">Password</Label>
        <Input
          id="gate-pw"
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          aria-invalid={error}
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Checking…' : 'Enter room'}
        </Button>
      </form>
    </GateShell>
  )
}

function RoomEnded() {
  return (
    <GateShell>
      <Power className="size-8 text-destructive" />
      <h1 className="mt-3 font-display text-2xl font-bold">
        This room has ended
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The host closed the room. Thanks for watching together.
      </p>
      <Button asChild className="mt-6 w-full">
        <Link to="/">Back to Vionix Watch</Link>
      </Button>
    </GateShell>
  )
}

function Blocked({
  title,
  text,
  retry,
}: {
  title: string
  text: string
  retry?: boolean
}) {
  return (
    <GateShell>
      <Lock className="size-8 text-warning" />
      <h1 className="mt-3 font-display text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{text}</p>
      <div className="mt-6 flex gap-2">
        {retry && (
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => window.location.reload()}
          >
            Try again
          </Button>
        )}
        <Button asChild className="flex-1">
          <Link to="/">Back to Vionix Watch</Link>
        </Button>
      </div>
    </GateShell>
  )
}

function InvalidRoom() {
  return (
    <GateShell>
      <h1 className="font-display text-2xl font-bold">Room not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        There's no room with that code. Room codes look like{' '}
        <span className="font-mono">ABCD-123</span>.
      </p>
      <Button asChild className="mt-6 w-full">
        <Link to="/">Go home</Link>
      </Button>
    </GateShell>
  )
}

function RoomSkeleton() {
  return (
    <div
      className="flex min-h-svh flex-col"
      aria-busy="true"
      aria-label="Loading room"
    >
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="ml-auto h-8 w-24" />
      </div>
      <div className="grid flex-1 gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Skeleton className="aspect-video w-full rounded-2xl" />
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-[70svh] rounded-2xl" />
      </div>
    </div>
  )
}
