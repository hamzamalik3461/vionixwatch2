import { useCallback, useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Clapperboard,
  LogIn,
  MessageCircle,
  Phone,
  UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { SiteHeader } from '@/components/shell/SiteHeader'
import { UserAvatar } from '@/components/social/CallOverlay'
import { useSocial } from '@/components/social/SocialProvider'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { createRoomApi, getThreads } from '@/lib/api'
import type { ApiThreadSummary } from '@/lib/social-types'

export const Route = createFileRoute('/messages')({
  component: MessagesPage,
})

function timeAgo(ts: number) {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.round(hrs / 24)}d`
}

function MessagesPage() {
  const { account, accountReady } = useSocial()
  const signedIn = Boolean(account?.username)
  const [threads, setThreads] = useState<ApiThreadSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  /** One tap from your inbox to a fresh watch room you can share. */
  async function createWatchRoom() {
    if (!account || creating) return
    setCreating(true)
    try {
      const { code } = await createRoomApi({
        name: `${account.name}'s watch room`,
        visibility: 'private',
      })
      toast.success('Room created — share the invite link with friends!')
      void navigate({ to: '/room/$code', params: { code } })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the room')
      setCreating(false)
    }
  }

  const load = useCallback(() => {
    if (!signedIn) return
    getThreads()
      .then((d) => {
        setThreads(d.threads)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [signedIn])

  useEffect(() => {
    load()
    if (!signedIn) return
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [load, signedIn])

  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div className="nw-glow nw-breathe pointer-events-none absolute inset-x-0 top-0 h-[30rem]" />
      <div className="nw-orb nw-orb-a" aria-hidden="true" />
      <SiteHeader />
      <main className="relative z-10 mx-auto max-w-reading px-4 pb-20 sm:px-6">
        <div className="nw-fade-up mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-electric uppercase">
              Direct messages
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">
              Messages
            </h1>
          </div>
          {signedIn && (
            <Button
              onClick={() => void createWatchRoom()}
              disabled={creating}
              className="font-bold shadow-lg shadow-primary/30"
            >
              <Clapperboard className="size-4" />
              {creating ? 'Creating…' : 'Create watch room'}
            </Button>
          )}
        </div>

        {!accountReady ? (
          <ThreadSkeletons />
        ) : !signedIn ? (
          <div className="nw-panel nw-fade-up rounded-3xl border p-8 text-center">
            <MessageCircle className="nw-float mx-auto size-10 text-primary" />
            <h2 className="mt-4 font-display text-xl font-bold">
              Messages need an account
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to chat with friends any time — even when you're not in a
              room together.
            </p>
            <Button asChild size="lg" className="mt-6 font-bold">
              <Link to="/login">
                <LogIn className="size-4" /> Sign in or create account
              </Link>
            </Button>
          </div>
        ) : threads === null ? (
          failed ? (
            <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Couldn't load your messages right now.
            </div>
          ) : (
            <ThreadSkeletons />
          )
        ) : threads.length === 0 ? (
          <div className="nw-fade-up rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            <UsersRound className="nw-float mx-auto mb-3 size-8 text-primary" />
            <p className="font-semibold text-foreground">
              No conversations yet
            </p>
            <p className="mt-1">
              Open your friends list and hit the message button to start one.
            </p>
            <Button asChild variant="secondary" className="mt-5">
              <Link to="/friends">Go to friends</Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {threads.map((t, i) => (
              <li key={t.id} className={`nw-fade-up nw-d-${Math.min(i, 3)}`}>
                <Link
                  to="/messages/$threadId"
                  params={{ threadId: t.id }}
                  className="group flex items-center gap-3 rounded-2xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 motion-reduce:transition-none"
                >
                  <UserAvatar user={t.friend} withStatus />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-semibold">{t.friend.name}</p>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {timeAgo(t.lastMessageAt)}
                      </span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {t.lastMessage ? (
                        <>
                          {t.lastMessage.kind === 'call' && (
                            <Phone className="mr-1 inline size-3.5" />
                          )}
                          {t.lastMessage.mine && 'You: '}
                          {t.lastMessage.text}
                        </>
                      ) : (
                        'Say hi 👋'
                      )}
                    </p>
                  </div>
                  {t.unread > 0 && (
                    <span className="nw-pop grid min-w-6 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground tabular-nums">
                      {t.unread > 99 ? '99+' : t.unread}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function ThreadSkeletons() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 rounded-2xl" />
      ))}
    </div>
  )
}
