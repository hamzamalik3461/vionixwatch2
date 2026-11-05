import { useCallback, useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Check,
  Clock,
  Heart,
  LogIn,
  MessageCircle,
  MoreVertical,
  Phone,
  Search,
  UserRoundMinus,
  UserRoundPlus,
  Video,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { SiteHeader } from '@/components/shell/SiteHeader'
import { UserAvatar } from '@/components/social/CallOverlay'
import { useSocial } from '@/components/social/SocialProvider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  friendAction,
  getFriends,
  openThreadApi,
  sendFriendRequestApi,
} from '@/lib/api'
import type { ApiFriend, FriendsResponse } from '@/lib/social-types'

export const Route = createFileRoute('/friends')({
  component: FriendsPage,
})

function useFriends(enabled: boolean) {
  const [data, setData] = useState<FriendsResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const load = useCallback(() => {
    if (!enabled) return
    getFriends()
      .then((d) => {
        setData(d)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [enabled])
  useEffect(() => {
    load()
    if (!enabled) return
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [enabled, load])
  return { data, failed, reload: load }
}

function FriendsPage() {
  const { account, accountReady, startCall, callPhase, refreshPulse } =
    useSocial()
  const navigate = useNavigate()
  const signedIn = Boolean(account?.username)
  const { data, failed, reload } = useFriends(signedIn)

  async function message(friend: ApiFriend) {
    try {
      const { threadId } = await openThreadApi(friend.id)
      void navigate({ to: '/messages/$threadId', params: { threadId } })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the chat')
    }
  }

  async function call(friend: ApiFriend, kind: 'voice' | 'video') {
    if (callPhase !== 'idle') {
      toast.error('You are already in a call.')
      return
    }
    try {
      const { threadId } = await openThreadApi(friend.id)
      await startCall(threadId, kind, friend)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the call')
    }
  }

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div className="nw-glow nw-breathe pointer-events-none absolute inset-x-0 top-0 h-[30rem]" />
      <div className="nw-orb nw-orb-b" aria-hidden="true" />
      <SiteHeader />
      <main className="relative z-10 mx-auto max-w-content px-4 pb-20 sm:px-6">
        <div className="nw-fade-up mb-8">
          <p className="text-xs font-bold tracking-[0.2em] text-electric uppercase">
            Your people
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">
            Friends
          </h1>
        </div>

        {!accountReady ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : !signedIn ? (
          <SignInNudge />
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
            <div className="space-y-8">
              <Requests data={data} reload={reload} refresh={refreshPulse} />
              <FriendList
                data={data}
                failed={failed}
                onMessage={message}
                onCall={call}
                reload={reload}
              />
            </div>
            <AddFriendCard
              onSent={() => {
                reload()
                refreshPulse()
              }}
            />
          </div>
        )}
      </main>
    </div>
  )
}

function SignInNudge() {
  return (
    <div className="nw-panel nw-fade-up mx-auto max-w-md rounded-3xl border p-8 text-center">
      <Heart className="nw-float mx-auto size-10 text-primary" />
      <h2 className="mt-4 font-display text-xl font-bold">
        Friends need an account
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Create a free account to add friends, message them any time and start
        voice or video calls.
      </p>
      <Button asChild size="lg" className="mt-6 font-bold">
        <Link to="/login">
          <LogIn className="size-4" /> Sign in or create account
        </Link>
      </Button>
    </div>
  )
}

function AddFriendCard({ onSent }: { onSent: () => void }) {
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const u = username.trim().replace(/^@/, '')
    if (!u) return
    setBusy(true)
    try {
      const res = await sendFriendRequestApi(u)
      toast.success(
        res.accepted
          ? `You and ${res.friend.name} are now friends!`
          : `Request sent to @${u}`,
      )
      setUsername('')
      onSent()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send that')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="nw-fade-up nw-d-1 h-fit">
      <div className="nw-panel relative rounded-3xl border p-5 shadow-xl shadow-primary/10">
        <div className="absolute -inset-px -z-10 rounded-3xl bg-gradient-to-br from-primary/30 via-transparent to-electric/20 blur-lg" />
        <h2 className="flex items-center gap-2 font-display font-bold">
          <UserRoundPlus className="size-4 text-electric" /> Add a friend
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask for their username, then send a request.
        </p>
        <form onSubmit={send} className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@username"
              aria-label="Friend's username"
              className="h-11 pl-9"
            />
          </div>
          <Button
            type="submit"
            disabled={busy || !username.trim()}
            className="h-11 font-bold"
          >
            Send
          </Button>
        </form>
      </div>
    </aside>
  )
}

function Requests({
  data,
  reload,
  refresh,
}: {
  data: FriendsResponse | null
  reload: () => void
  refresh: () => void
}) {
  if (!data || (data.incoming.length === 0 && data.outgoing.length === 0))
    return null

  async function act(
    action: 'accept' | 'decline' | 'cancel',
    id: string,
    name: string,
  ) {
    try {
      await friendAction(action, id)
      toast.success(
        action === 'accept'
          ? `You and ${name} are now friends!`
          : action === 'decline'
            ? 'Request declined'
            : 'Request canceled',
      )
      reload()
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  return (
    <section className="nw-fade-up">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold">
        <Clock className="size-4 text-electric" /> Pending
        {data.incoming.length > 0 && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
            {data.incoming.length}
          </span>
        )}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.incoming.map((r) => (
          <div
            key={r.id}
            className="nw-pop flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4"
          >
            <UserAvatar user={r} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{r.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                @{r.username} wants to be friends
              </p>
            </div>
            <Button
              size="icon-sm"
              aria-label={`Accept ${r.name}`}
              className="rounded-full bg-success text-background hover:bg-success/90"
              onClick={() => void act('accept', r.id, r.name)}
            >
              <Check />
            </Button>
            <Button
              size="icon-sm"
              variant="secondary"
              aria-label={`Decline ${r.name}`}
              className="rounded-full"
              onClick={() => void act('decline', r.id, r.name)}
            >
              <X />
            </Button>
          </div>
        ))}
        {data.outgoing.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-3 rounded-2xl border border-dashed p-4"
          >
            <UserAvatar user={r} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{r.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                Waiting for @{r.username}…
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => void act('cancel', r.id, r.name)}
            >
              Cancel
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}

function FriendList({
  data,
  failed,
  onMessage,
  onCall,
  reload,
}: {
  data: FriendsResponse | null
  failed: boolean
  onMessage: (f: ApiFriend) => Promise<void>
  onCall: (f: ApiFriend, kind: 'voice' | 'video') => Promise<void>
  reload: () => void
}) {
  async function remove(f: ApiFriend) {
    try {
      await friendAction('remove', f.id)
      toast.success(`Removed ${f.name} from your friends`)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove them')
    }
  }

  if (!data)
    return failed ? (
      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Couldn't load your friends right now.
      </div>
    ) : (
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    )

  if (data.friends.length === 0)
    return (
      <div className="nw-fade-up rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        <Heart className="nw-float mx-auto mb-3 size-8 text-primary" />
        <p className="font-semibold text-foreground">No friends yet</p>
        <p className="mt-1">
          Send a request with their username and start watching, chatting and
          calling together.
        </p>
      </div>
    )

  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-bold">
        All friends{' '}
        <span className="text-sm font-normal text-muted-foreground">
          · {data.friends.length}
        </span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.friends.map((f, i) => (
          <div
            key={f.id}
            className={`nw-fade-up nw-d-${Math.min(i % 4, 3)} group flex items-center gap-3 rounded-2xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 motion-reduce:transition-none`}
          >
            <UserAvatar user={f} withStatus />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{f.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                @{f.username} · {f.online ? 'online' : 'offline'}
              </p>
            </div>
            <Button
              size="icon-sm"
              variant="secondary"
              className="rounded-full"
              aria-label={`Message ${f.name}`}
              onClick={() => void onMessage(f)}
            >
              <MessageCircle />
            </Button>
            <Button
              size="icon-sm"
              variant="secondary"
              className="rounded-full"
              aria-label={`Voice call ${f.name}`}
              onClick={() => void onCall(f, 'voice')}
            >
              <Phone />
            </Button>
            <Button
              size="icon-sm"
              variant="secondary"
              className="rounded-full"
              aria-label={`Video call ${f.name}`}
              onClick={() => void onCall(f, 'video')}
            >
              <Video />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="rounded-full text-muted-foreground"
                  aria-label={`More options for ${f.name}`}
                >
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => void remove(f)}
                >
                  <UserRoundMinus /> Remove friend
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>
    </section>
  )
}
