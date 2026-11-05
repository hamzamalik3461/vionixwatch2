import { useEffect, useRef, useState } from 'react'
import { ArrowDown, Info, SendHorizontal, Smile } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { reactionEmojis } from '@/lib/catalog'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import type { RoomState } from './useRoom'

function clock(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ChatPanel({ room }: { room: RoomState }) {
  const { messages, members, actions } = room
  const [text, setText] = useState('')
  const [atBottom, setAtBottom] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const lastSent = useRef(0)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const el = scroller.current
    if (el && atBottom) el.scrollTop = el.scrollHeight
  }, [messages, atBottom])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    // Client-side throttle; the server enforces its own rate limit.
    if (sending || Date.now() - lastSent.current < 600) return
    lastSent.current = Date.now()
    const draft = text
    setText('')
    setSending(true)
    const ok = await actions.sendMessage(draft)
    setSending(false)
    if (!ok) setText(draft)
    setAtBottom(true)
  }

  const byId = new Map(members.map((m) => [m.id, m]))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
        }}
        className="relative min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 && (
          <p className="pt-8 text-center text-sm text-muted-foreground">
            No messages yet. Say hi 👋
          </p>
        )}
        {messages.map((m, i) => {
          if (m.type === 'system') {
            return (
              <p
                key={m.id}
                className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"
              >
                <Info className="size-3" /> {m.text}
              </p>
            )
          }
          const author = byId.get(m.authorId ?? '') ?? {
            name: m.authorName ?? 'Former member',
            avatar: m.authorAvatar ?? '👤',
            color: 'gray',
            online: false,
            speaking: false,
            role: 'participant' as const,
          }
          const prev = messages[i - 1]
          const grouped =
            prev?.type === 'user' &&
            prev.authorId === m.authorId &&
            m.at - prev.at < 120000
          return (
            <div key={m.id} className={cn('flex gap-2.5', grouped && '-mt-2')}>
              <div className="w-8 shrink-0">
                {!grouped && (
                  <Avatar
                    member={{ ...author, speaking: false }}
                    size="sm"
                    showStatus={false}
                  />
                )}
              </div>
              <div className="min-w-0">
                {!grouped && (
                  <p className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        author.role === 'owner' && 'text-warning',
                      )}
                    >
                      {author.name}
                    </span>
                    <time className="text-[10px] text-muted-foreground">
                      {clock(m.at)}
                    </time>
                  </p>
                )}
                <p className="text-sm break-words text-foreground/90">
                  {m.text}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      {!atBottom && (
        <Button
          size="xs"
          variant="secondary"
          className="mx-auto -mt-9 mb-2 shadow"
          onClick={() => setAtBottom(true)}
        >
          <ArrowDown /> New messages
        </Button>
      )}
      <div
        className="flex gap-1 border-t px-3 pt-2"
        role="group"
        aria-label="Reactions"
      >
        {reactionEmojis.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => actions.react(e)}
            aria-label={`React ${e}`}
            className="grid size-8 place-items-center rounded-lg text-lg transition-transform hover:-translate-y-0.5 hover:bg-secondary motion-reduce:transition-none"
          >
            {e}
          </button>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2 p-3">
        <div className="relative flex-1">
          <Smile className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message the room"
            aria-label="Chat message"
            className="pl-9"
          />
        </div>
        <Button
          type="submit"
          size="icon"
          aria-label="Send message"
          disabled={!text.trim()}
        >
          <SendHorizontal />
        </Button>
      </form>
    </div>
  )
}
