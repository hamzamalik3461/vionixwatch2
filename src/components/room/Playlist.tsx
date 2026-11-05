import {
  ChevronDown,
  ChevronUp,
  ListVideo,
  Lock,
  Play,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatTime } from '@/lib/session'
import { cn } from '@/lib/utils'
import { AddContent } from './AddContent'
import type { RoomState } from './useRoom'

export function Playlist({ room }: { room: RoomState }) {
  const { playlist, current, isOwner, actions } = room

  return (
    <section
      aria-labelledby="queue-heading"
      className="rounded-2xl border bg-card p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id="queue-heading"
          className="flex items-center gap-2 font-display font-bold"
        >
          <ListVideo className="size-4 text-electric" /> Up next
          <span className="text-xs font-normal text-muted-foreground">
            {playlist.length} in queue
          </span>
        </h2>
        {!isOwner && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" /> Host manages the queue
          </span>
        )}
      </div>

      {isOwner && (
        <div className="mb-3">
          <AddContent room={room} />
        </div>
      )}

      <ol className="space-y-2">
        {playlist.length === 0 && (
          <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            The queue is empty
            {isOwner
              ? ' — add a link or upload a file above.'
              : '. The host will add something soon.'}
          </li>
        )}
        {playlist.map((v, i) => {
          const active = v.id === current?.id
          return (
            <li
              key={v.id}
              className={cn(
                'group flex items-center gap-3 rounded-xl border p-2 transition-colors',
                active
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-transparent hover:bg-secondary/60',
              )}
            >
              <button
                type="button"
                disabled={!isOwner || active}
                onClick={() => actions.selectVideo(v.id)}
                aria-label={`Play ${v.title}`}
                className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg disabled:cursor-default sm:w-28"
                style={{ background: v.thumbnail }}
              >
                <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                  {isOwner && !active && (
                    <Play className="size-5 fill-white text-white" />
                  )}
                </span>
                {active && (
                  <span className="absolute bottom-1 left-1 rounded bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                    NOW
                  </span>
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{v.title}</p>
                <p className="text-xs text-muted-foreground">
                  {v.kind.toUpperCase()}
                  {v.duration ? ` · ${formatTime(v.duration)}` : ''} · added by{' '}
                  {v.addedBy}
                </p>
              </div>
              {isOwner && (
                <div className="flex items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => actions.moveVideo(v.id, -1)}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move down"
                    disabled={i === playlist.length - 1}
                    onClick={() => actions.moveVideo(v.id, 1)}
                  >
                    <ChevronDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${v.title}`}
                    disabled={active}
                    onClick={() => actions.removeVideo(v.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
