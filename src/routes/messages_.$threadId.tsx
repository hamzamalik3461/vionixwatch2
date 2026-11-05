import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  Clapperboard,
  Phone,
  PhoneCall,
  SendHorizonal,
  Video,
} from 'lucide-react'
import { toast } from 'sonner'
import { UserAvatar } from '@/components/social/CallOverlay'
import { useSocial } from '@/components/social/SocialProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { createRoomApi, getThread, markReadApi, sendDmApi } from '@/lib/api'
import { playSound } from '@/lib/sounds'
import type {
  ApiCall,
  ApiDmMessage,
  ApiFriend,
  ThreadResponse,
} from '@/lib/social-types'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/messages_/$threadId')({
  component: ThreadPage,
})

/** Poll-based DM state with incremental fetches and read markers. */
function useThread(threadId: string, enabled: boolean, myId?: string) {
  const [friend, setFriend] = useState<ApiFriend | null>(null)
  const [messages, setMessages] = useState<ApiDmMessage[] | null>(null)
  const [liveCall, setLiveCall] = useState<ApiCall | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastId = useRef(0)
  const lastRead = useRef(0)
  const myIdRef = useRef(myId)
  useEffect(() => {
    myIdRef.current = myId
  }, [myId])

  const apply = useCallback((res: ThreadResponse, incremental: boolean) => {
    setFriend(res.friend)
    setLiveCall(res.call)
    // Ping for fresh messages from the other side while the chat is open.
    if (
      incremental &&
      res.messages.some(
        (m) =>
          m.kind === 'text' && m.senderId && m.senderId !== myIdRef.current,
      )
    )
      playSound('message')
    setMessages((prev) => {
      const base = incremental && prev ? prev : []
      const merged = [...base]
      for (const m of res.messages)
        if (!merged.some((x) => x.id === m.id)) merged.push(m)
      merged.sort((a, b) => a.id - b.id)
      return merged
    })
    const maxId = res.messages.reduce(
      (a, m) => Math.max(a, m.id),
      lastId.current,
    )
    lastId.current = maxId
    if (maxId > lastRead.current) {
      lastRead.current = maxId
      void markReadApi(res.thread.id, maxId).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let alive = true
    lastId.current = 0
    lastRead.current = 0
    const load = async (incremental: boolean) => {
      try {
        const res = await getThread(threadId, incremental ? lastId.current : 0)
        if (alive) {
          apply(res, incremental)
          setError(null)
        }
      } catch (e) {
        if (alive && !incremental)
          setError(e instanceof Error ? e.message : 'Could not load the chat')
      }
    }
    void load(false)
    const t = setInterval(() => void load(true), 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [threadId, enabled, apply])

  const push = useCallback((m: ApiDmMessage) => {
    setMessages((prev) => {
      if (prev?.some((x) => x.id === m.id)) return prev
      return [...(prev ?? []), m].sort((a, b) => a.id - b.id)
    })
    lastId.current = Math.max(lastId.current, m.id)
    lastRead.current = Math.max(lastRead.current, m.id)
  }, [])

  return { friend, messages, liveCall, error, push }
}

function dayLabel(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

/** Renders message text with URLs (e.g. watch-room invites) as links. */
function MessageText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            className="font-semibold break-all underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

function ThreadPage() {
  const { threadId } = Route.useParams()
  const { account, accountReady, startCall, callPhase, currentCall } =
    useSocial()
  const signedIn = Boolean(account?.username)
  const { friend, messages, liveCall, error, push } = useThread(
    threadId,
    signedIn,
    account?.id,
  )
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [creatingRoom, setCreatingRoom] = useState(false)
  const navigate = useNavigate()
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // Stick to the bottom as new messages come in (unless scrolled up).
  useEffect(() => {
    const el = scroller.current
    if (el && atBottom.current)
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
  }, [messages])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const { message } = await sendDmApi(threadId, text)
      push(message)
      setDraft('')
      atBottom.current = true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send that')
    } finally {
      setSending(false)
    }
  }

  async function call(kind: 'voice' | 'video') {
    if (!friend) return
    if (callPhase !== 'idle') {
      toast.error('You are already in a call.')
      return
    }
    await startCall(threadId, kind, friend)
  }

  /** Creates a room, drops the invite link into the chat, and heads there. */
  async function watchTogether() {
    if (!friend || creatingRoom) return
    setCreatingRoom(true)
    try {
      const { code } = await createRoomApi({
        name: `${account?.name ?? 'Movie night'} × ${friend.name}`,
        visibility: 'private',
      })
      const url = `${window.location.origin}/room/${code}`
      const { message } = await sendDmApi(
        threadId,
        `🎬 Let's watch together — join my room: ${url}`,
      )
      push(message)
      atBottom.current = true
      toast.success('Room created — invite sent!')
      void navigate({ to: '/room/$code', params: { code } })
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not create the room',
      )
      setCreatingRoom(false)
    }
  }

  const callBusy =
    callPhase !== 'idle' ||
    (liveCall !== null && liveCall.id !== currentCall?.id)

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      {/* Chat header */}
      <header className="relative z-10 border-b bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-reading items-center gap-2 px-3 py-3 sm:px-4">
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            aria-label="Back to messages"
          >
            <Link to="/messages">
              <ArrowLeft />
            </Link>
          </Button>
          {friend ? (
            <>
              <UserAvatar user={friend} withStatus size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display font-bold">{friend.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  @{friend.username} · {friend.online ? 'online' : 'offline'}
                </p>
              </div>
              <Button
                size="icon"
                variant="secondary"
                className="rounded-full"
                aria-label={`Start a watch room with ${friend.name}`}
                disabled={creatingRoom}
                onClick={() => void watchTogether()}
              >
                <Clapperboard />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                className="rounded-full"
                aria-label={`Voice call ${friend.name}`}
                disabled={callBusy}
                onClick={() => void call('voice')}
              >
                <Phone />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                className="rounded-full"
                aria-label={`Video call ${friend.name}`}
                disabled={callBusy}
                onClick={() => void call('video')}
              >
                <Video />
              </Button>
            </>
          ) : (
            <Skeleton className="h-10 flex-1 rounded-xl" />
          )}
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="relative flex-1 overflow-y-auto"
      >
        <div className="nw-glow pointer-events-none absolute inset-x-0 top-0 h-48 opacity-50" />
        <div className="mx-auto flex max-w-reading flex-col gap-1 px-3 py-6 sm:px-4">
          {!accountReady || (messages === null && !error) ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-2/3 rounded-2xl" />
              <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
              <Skeleton className="h-10 w-1/2 rounded-2xl" />
            </div>
          ) : !signedIn ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              <Link
                to="/login"
                className="font-semibold text-electric underline"
              >
                Sign in
              </Link>{' '}
              to read this conversation.
            </p>
          ) : error ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {error}
            </p>
          ) : messages && messages.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <p className="text-3xl">👋</p>
              <p className="mt-2">
                This is the start of your conversation
                {friend ? ` with ${friend.name}` : ''}.
              </p>
            </div>
          ) : (
            messages?.map((m, i) => {
              const prev = messages[i - 1]
              const mine = m.senderId === account?.id
              const newDay =
                !prev ||
                new Date(prev.at).toDateString() !==
                  new Date(m.at).toDateString()
              return (
                <div key={m.id}>
                  {newDay && (
                    <p className="my-4 text-center text-xs font-semibold text-muted-foreground">
                      {dayLabel(m.at)}
                    </p>
                  )}
                  {m.kind === 'call' ? (
                    <p className="my-2 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                      <PhoneCall className="size-3.5" /> {m.text} ·{' '}
                      {clock(m.at)}
                    </p>
                  ) : (
                    <div
                      className={cn(
                        'nw-pop flex max-w-[85%] flex-col sm:max-w-[70%]',
                        mine ? 'ml-auto items-end' : 'items-start',
                      )}
                    >
                      <div
                        className={cn(
                          'rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap shadow-sm',
                          mine
                            ? 'rounded-br-md bg-primary text-primary-foreground'
                            : 'rounded-bl-md border bg-card',
                        )}
                      >
                        <MessageText text={m.text} />
                      </div>
                      <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">
                        {clock(m.at)}
                      </span>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Composer */}
      <footer className="border-t bg-card/60 backdrop-blur">
        <form
          onSubmit={send}
          className="mx-auto flex max-w-reading items-center gap-2 px-3 py-3 sm:px-4"
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={friend ? `Message ${friend.name}` : 'Message'}
            aria-label="Message"
            maxLength={1000}
            disabled={!signedIn}
            className="h-11 rounded-full px-4"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={!draft.trim() || sending || !signedIn}
            className="size-11 rounded-full shadow-lg shadow-primary/30"
          >
            <SendHorizonal />
          </Button>
        </form>
      </footer>
    </div>
  )
}
