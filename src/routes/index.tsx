import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Clock,
  Crown,
  Headphones,
  Lock,
  MessageCircle,
  MessageSquare,
  MonitorPlay,
  PhoneCall,
  Plus,
  Radio,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRoundPlus,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { SiteHeader } from '@/components/shell/SiteHeader'
import { useSocial } from '@/components/social/SocialProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createRoomApi, getLobby, saveSession } from '@/lib/api'
import { avatarChoices } from '@/lib/catalog'
import type { PublicRoomSummary } from '@/lib/room-types'
import {
  forgetRoom,
  normalizeRoomCode,
  sanitizeName,
  saveProfile,
  useProfile,
  useRecentRooms,
} from '@/lib/session'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: Home,
})

type Lobby = { online: number; rooms: PublicRoomSummary[] } | null

/** Live online count + public rooms from real presence, refreshed every 20s. */
function useLobby() {
  const [lobby, setLobby] = useState<Lobby>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () =>
      getLobby()
        .then((l) => alive && (setLobby(l), setFailed(false)))
        .catch(() => alive && setFailed(true))
    void load()
    const t = setInterval(() => void load(), 20_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  return { lobby, failed }
}

function OnlinePill({ count }: { count: number | null }) {
  if (count === null) return <Skeleton className="h-7 w-32 rounded-full" />
  return (
    <div className="flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1.5 text-xs font-semibold backdrop-blur">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      <span className="tabular-nums">{count.toLocaleString()}</span>
      <span className="text-muted-foreground">online now</span>
    </div>
  )
}

function Home() {
  const { lobby, failed } = useLobby()
  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div className="nw-glow nw-breathe pointer-events-none absolute inset-x-0 top-0 h-[44rem]" />
      <div className="nw-grid-bg pointer-events-none absolute inset-x-0 top-0 h-[44rem]" />
      <div className="nw-orb nw-orb-a" aria-hidden="true" />
      <div className="nw-orb nw-orb-b" aria-hidden="true" />

      <SiteHeader />

      <main className="relative z-10">
        <section className="mx-auto grid max-w-content items-center gap-10 px-4 pt-8 pb-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pt-16">
          <div>
            <div className="nw-fade-up mb-5 flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-electric/30 bg-primary/15 px-3 py-1 text-xs font-semibold text-electric">
                <Sparkles className="size-3.5" /> Synced playback · Voice ·
                Friends · Calls
              </div>
              <OnlinePill count={lobby?.online ?? null} />
            </div>
            <h1 className="nw-fade-up nw-d-1 font-display text-5xl leading-[1.02] font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
              Watch together.
              <br />
              <span className="nw-gradient-text nw-gradient-move">
                Perfectly in sync.
              </span>
            </h1>
            <p className="nw-fade-up nw-d-2 mt-6 max-w-xl text-lg text-muted-foreground">
              Spin up a room in one click, drop in a video and invite your crew.
              The host drives playback, everyone stays on the same frame — and
              with an account, your friends, chats and calls follow you even
              outside the room.
            </p>
            <div className="nw-fade-up nw-d-3 mt-8 flex flex-wrap gap-6 text-sm text-muted-foreground">
              <Stat icon={MonitorPlay} label="Frame-accurate sync" />
              <Stat icon={PhoneCall} label="Voice & video calls" />
              <Stat icon={ShieldCheck} label="Host-only controls" />
            </div>
          </div>

          <div className="nw-fade-up nw-d-2">
            <StartCard />
          </div>
        </section>

        <StayConnected />
        <RecentRooms />
        <LiveRooms rooms={lobby?.rooms ?? null} failed={failed} />
        <Features />
        <HowItWorks />
      </main>

      <footer className="relative z-10 border-t">
        <div className="mx-auto flex max-w-content flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <span className="font-display text-sm font-extrabold tracking-[0.18em]">
            VIONIX<span className="nw-gradient-text">&nbsp;WATCH</span>
          </span>
          <p>Movie nights, watch parties and finals — together.</p>
        </div>
      </footer>
    </div>
  )
}

/** Friends, messages and calls — the life outside the room. */
function StayConnected() {
  const { account } = useSocial()
  const signedIn = Boolean(account?.username)
  const cards = [
    {
      icon: UserRoundPlus,
      title: 'Add your people',
      body: 'Find friends by username, accept requests and keep your crew in one place.',
      to: signedIn ? '/friends' : '/login',
      cta: signedIn ? 'Open friends' : 'Create account',
    },
    {
      icon: MessageCircle,
      title: 'Chat any time',
      body: 'Direct messages work outside rooms too — pick up the conversation whenever.',
      to: signedIn ? '/messages' : '/login',
      cta: signedIn ? 'Open messages' : 'Sign in',
    },
    {
      icon: PhoneCall,
      title: 'Call voice or video',
      body: 'One tap turns a chat into a crystal-clear voice or face-to-face video call.',
      to: signedIn ? '/friends' : '/login',
      cta: signedIn ? 'Call a friend' : 'Get started',
    },
  ] as const
  return (
    <section className="mx-auto max-w-content px-4 pb-16 sm:px-6">
      <SectionHeading
        eyebrow="Beyond the room"
        title="Your crew, even between movie nights"
      />
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((c, i) => (
          <Link
            key={c.title}
            to={c.to}
            className={`nw-fade-up nw-d-${i + 1} group relative overflow-hidden rounded-2xl border bg-card p-6 transition-all hover:-translate-y-1 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10 motion-reduce:transition-none`}
          >
            <div className="absolute -top-10 -right-10 size-28 rounded-full bg-primary/10 blur-2xl transition-all group-hover:bg-primary/20" />
            <div className="mb-4 grid size-11 place-items-center rounded-xl bg-primary/15 text-electric transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <c.icon className="size-5" />
            </div>
            <h3 className="font-display font-bold">{c.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-electric">
              {c.cta}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function Stat({ icon: Icon, label }: { icon: typeof Users; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-electric" />
      {label}
    </div>
  )
}

function StartCard() {
  const navigate = useNavigate()
  const { profile, ready } = useProfile()
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(avatarChoices[0])
  const [roomName, setRoomName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Prefill once the saved profile loads.
  const [prefilled, setPrefilled] = useState<typeof profile>(null)
  if (profile && prefilled !== profile) {
    setPrefilled(profile)
    setName(profile.name)
    setAvatar(profile.avatar)
  }

  function requireName() {
    const clean = sanitizeName(name)
    if (clean.length < 2) {
      setNameError('Pick a username with at least 2 characters.')
      return null
    }
    setNameError(null)
    saveProfile({ name: clean, avatar })
    return clean
  }

  async function createRoom() {
    const clean = requireName()
    if (!clean) return
    if (isPrivate && password && password.length < 4) {
      toast.error('Room passwords need at least 4 characters.')
      return
    }
    setCreating(true)
    try {
      await saveSession(clean, avatar)
      const { code: newCode } = await createRoomApi({
        name: roomName.trim().slice(0, 40),
        visibility: isPrivate ? 'private' : 'public',
        password: isPrivate && password ? password : undefined,
      })
      toast.success(`Room ${newCode} created`, {
        description: 'Share the invite link to bring your crew in.',
      })
      void navigate({ to: '/room/$code', params: { code: newCode } })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the room')
      setCreating(false)
    }
  }

  async function joinRoom(e: React.FormEvent) {
    e.preventDefault()
    const clean = requireName()
    if (!clean) return
    await saveSession(clean, avatar).catch(() => {})
    const normalized = normalizeRoomCode(code)
    if (!normalized) {
      setCodeError('Room codes look like ABCD-123 — or paste an invite link.')
      return
    }
    setCodeError(null)
    void navigate({ to: '/room/$code', params: { code: normalized } })
  }

  return (
    <div className="nw-panel relative rounded-3xl border p-5 shadow-2xl shadow-primary/10 sm:p-7">
      <div className="absolute -inset-px -z-10 rounded-3xl bg-gradient-to-br from-primary/40 via-transparent to-electric/30 blur-xl" />
      <h2 className="font-display text-xl font-bold">Get started</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        No account needed — pick a name and you're in. Or{' '}
        <Link to="/login" className="font-semibold text-electric underline">
          sign in
        </Link>{' '}
        for friends, messages and calls.
      </p>

      <div className="mt-5 space-y-2">
        <Label htmlFor="username">Username</Label>
        {ready ? (
          <Input
            id="username"
            value={name}
            maxLength={24}
            placeholder="e.g. nightowl"
            aria-invalid={Boolean(nameError)}
            onChange={(e) => setName(e.target.value)}
            className="h-11"
          />
        ) : (
          <Skeleton className="h-11 w-full" />
        )}
        {nameError && (
          <p className="text-xs text-destructive" role="alert">
            {nameError}
          </p>
        )}
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium">Avatar</legend>
        <div className="flex flex-wrap gap-2">
          {avatarChoices.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAvatar(a)}
              aria-label={`Avatar ${a}`}
              aria-pressed={avatar === a}
              className={cn(
                'grid size-9 place-items-center rounded-xl border bg-secondary text-lg transition-all hover:-translate-y-0.5 hover:border-primary/60 motion-reduce:transition-none',
                avatar === a &&
                  'border-primary bg-primary/20 ring-2 ring-primary/40',
              )}
            >
              {a}
            </button>
          ))}
        </div>
      </fieldset>

      <Tabs defaultValue="create" className="mt-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="create">
            <Plus className="size-4" /> Create room
          </TabsTrigger>
          <TabsTrigger value="join">
            <ArrowRight className="size-4" /> Join room
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="room-name">Room name (optional)</Label>
            <Input
              id="room-name"
              value={roomName}
              maxLength={40}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="Friday movie night"
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border bg-secondary/50 px-3 py-2.5">
            <div>
              <Label htmlFor="private">Private room</Label>
              <p className="text-xs text-muted-foreground">
                Hidden from the lobby, invite only
              </p>
            </div>
            <Switch
              id="private"
              checked={isPrivate}
              onCheckedChange={setIsPrivate}
            />
          </div>
          {isPrivate && (
            <div className="space-y-2">
              <Label htmlFor="room-pass">Password (optional)</Label>
              <Input
                id="room-pass"
                type="password"
                value={password}
                maxLength={64}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 4 characters"
              />
            </div>
          )}
          <Button
            size="lg"
            className="h-12 w-full text-base font-bold shadow-lg shadow-primary/30"
            onClick={() => void createRoom()}
            disabled={creating}
          >
            <Plus className="size-5" /> {creating ? 'Creating…' : 'Create room'}
          </Button>
        </TabsContent>

        <TabsContent value="join" className="mt-4">
          <form onSubmit={joinRoom} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="room-code">Room code or invite link</Label>
              <Input
                id="room-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="NOVA-7K2"
                aria-invalid={Boolean(codeError)}
                className="h-11 font-mono tracking-widest uppercase"
              />
              {codeError && (
                <p className="text-xs text-destructive" role="alert">
                  {codeError}
                </p>
              )}
            </div>
            <Button
              type="submit"
              size="lg"
              variant="secondary"
              className="h-12 w-full text-base font-bold"
            >
              Join room <ArrowRight className="size-5" />
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SectionHeading({
  eyebrow,
  title,
  id,
}: {
  eyebrow: string
  title: string
  id?: string
}) {
  return (
    <div id={id} className="mb-6 scroll-mt-20">
      <p className="text-xs font-bold tracking-[0.2em] text-electric uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-1 font-display text-2xl font-bold sm:text-3xl">
        {title}
      </h2>
    </div>
  )
}

function timeAgo(ts: number) {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function RecentRooms() {
  const [rooms, setRooms] = useRecentRooms()

  return (
    <section className="mx-auto max-w-content px-4 pb-16 sm:px-6">
      <SectionHeading eyebrow="Jump back in" title="Recently joined rooms" />
      {rooms === null ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : rooms.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Clock className="mx-auto mb-2 size-5" />
          Rooms you create or join show up here.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((r) => (
            <div
              key={r.code}
              className="group relative flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/50"
            >
              <div className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-primary/40 to-electric/30">
                {r.owner ? (
                  <Crown className="size-5 text-warning" />
                ) : (
                  <Users className="size-5" />
                )}
              </div>
              <Link
                to="/room/$code"
                params={{ code: r.code }}
                className="min-w-0 flex-1 after:absolute after:inset-0 after:rounded-2xl"
              >
                <p className="truncate font-semibold">{r.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {r.code} · {timeAgo(r.joinedAt)}
                </p>
              </Link>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${r.name} from recent rooms`}
                className="relative z-10 opacity-60 group-hover:opacity-100"
                onClick={() => {
                  forgetRoom(r.code)
                  setRooms((list) =>
                    (list ?? []).filter((x) => x.code !== r.code),
                  )
                }}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function LiveRooms({
  rooms,
  failed,
}: {
  rooms: PublicRoomSummary[] | null
  failed: boolean
}) {
  return (
    <section className="mx-auto max-w-content px-4 pb-20 sm:px-6">
      <SectionHeading eyebrow="Live now" title="Public rooms" />
      {rooms === null && failed ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Couldn't load public rooms right now.
        </div>
      ) : rooms === null ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
          ))}
        </div>
      ) : rooms.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Radio className="mx-auto mb-2 size-5" />
          No public rooms are live right now. Create one and it shows up here.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {rooms.map((r) => (
            <Link
              key={r.code}
              to="/room/$code"
              params={{ code: r.code }}
              className="group overflow-hidden rounded-2xl border bg-card transition-all hover:-translate-y-1 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10 motion-reduce:transition-none"
            >
              <div
                className="relative aspect-video"
                style={{ background: r.thumbnail }}
              >
                <div className="absolute inset-0 grid place-items-center opacity-70 transition-opacity group-hover:opacity-100">
                  <MonitorPlay className="size-10 text-white/80" />
                </div>
                <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">
                  <Radio className="size-3 text-destructive" /> LIVE
                </span>
                {r.locked && (
                  <span className="absolute top-3 right-3 rounded-full bg-black/60 p-1.5 text-white">
                    <Lock
                      className="size-3.5"
                      aria-label="Password protected"
                    />
                  </span>
                )}
              </div>
              <div className="p-4">
                <p className="font-semibold">{r.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {r.watching}
                </p>
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" /> {r.members}/{r.capacity}
                  </span>
                  <span className="ml-auto font-mono">{r.code}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

const features = [
  {
    icon: MonitorPlay,
    title: 'Synchronized player',
    body: 'Direct links and adaptive streams stay on the same frame for everyone, with drift correction and mid-movie joins.',
  },
  {
    icon: Crown,
    title: 'Host-controlled playback',
    body: 'Only the room owner can play, pause, seek, change speed or switch videos — enforced on the server too.',
  },
  {
    icon: Headphones,
    title: 'Voice channel',
    body: 'Join voice, mute, deafen and pick devices. Speaking rings show who is talking. Prefer silence? Just watch.',
  },
  {
    icon: MessageSquare,
    title: 'Live chat & reactions',
    body: 'Real-time chat with join/leave notices and floating emoji reactions over the player.',
  },
  {
    icon: UserRoundPlus,
    title: 'Friends',
    body: 'Add friends by username, see who is online, and keep your crew together between watch parties.',
  },
  {
    icon: MessageCircle,
    title: 'Direct messages',
    body: 'Chat one-on-one any time — no room required. Unread badges keep you in the loop.',
  },
  {
    icon: PhoneCall,
    title: 'Voice & video calls',
    body: 'Ring a friend straight from a chat. Crisp audio, face-to-face video, one tap to hang up.',
  },
  {
    icon: Upload,
    title: 'Upload your own',
    body: 'Drag and drop a video file. It is processed for adaptive streaming and lands in the room playlist.',
  },
  {
    icon: Lock,
    title: 'Private & locked rooms',
    body: 'Password-protect rooms, cap capacity, lock the door mid-session, or transfer ownership.',
  },
]

function Features() {
  return (
    <section className="mx-auto max-w-content px-4 pb-20 sm:px-6">
      <SectionHeading
        id="features"
        eyebrow="Features"
        title="Everything a watch party needs"
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f, i) => (
          <div
            key={f.title}
            className={`nw-fade-up nw-d-${(i % 3) + 1} group rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 motion-reduce:transition-none`}
          >
            <div className="mb-4 grid size-11 place-items-center rounded-xl bg-primary/15 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <f.icon className="size-5" />
            </div>
            <h3 className="font-display font-bold">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const steps = [
  {
    title: 'Create a room',
    body: 'Pick a username and hit Create. You get a unique code and invite link.',
  },
  {
    title: 'Invite your crew',
    body: 'Share the link or the code. Friends join in seconds — no account needed.',
  },
  {
    title: 'Queue a video',
    body: 'Paste a video link or upload a file. Build a playlist for the night.',
  },
  {
    title: 'Press play together',
    body: 'You drive playback, everyone stays in sync. Hop in voice and react live.',
  },
]

function HowItWorks() {
  return (
    <section className="mx-auto max-w-content px-4 pb-24 sm:px-6">
      <SectionHeading
        id="how"
        eyebrow="How it works"
        title="Four steps to movie night"
      />
      <ol className="grid gap-4 md:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="relative rounded-2xl border bg-card p-6">
            <span className="font-mono text-4xl font-bold text-primary/40">
              0{i + 1}
            </span>
            <h3 className="mt-2 font-display font-bold">{s.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
