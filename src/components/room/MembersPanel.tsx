import {
  Crown,
  Headphones,
  HeadphoneOff,
  MicOff,
  MoreVertical,
  UserMinus,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Member } from '@/lib/catalog'
import { Avatar } from './Avatar'
import type { RoomState } from './useRoom'

export function MembersPanel({ room }: { room: RoomState }) {
  const { members, isOwner, actions, settings } = room
  const online = members.filter((m) => m.online)
  const offline = members.filter((m) => !m.online)

  return (
    <div className="space-y-5 overflow-y-auto p-3">
      <p className="px-1 text-xs text-muted-foreground">
        {online.length} / {settings.capacity} seats filled
      </p>
      <Group
        title={`Online — ${online.length}`}
        members={online}
        meId={room.me?.id}
        canManage={isOwner}
        actions={actions}
      />
      {offline.length > 0 && (
        <Group
          title={`Offline — ${offline.length}`}
          members={offline}
          meId={room.me?.id}
          canManage={isOwner}
          actions={actions}
        />
      )}
    </div>
  )
}

function Group({
  title,
  members,
  canManage,
  actions,
  meId,
}: {
  title: string
  members: Member[]
  meId?: string
  canManage: boolean
  actions: RoomState['actions']
}) {
  return (
    <div>
      <h3 className="mb-1.5 px-1 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      <ul className="space-y-0.5">
        {members.map((m) => (
          <li
            key={m.id}
            className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-secondary/60"
          >
            <Avatar member={m} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                <span
                  className={m.role === 'owner' ? 'text-warning' : undefined}
                >
                  {m.name}
                </span>
                {m.id === meId && (
                  <span className="text-xs font-normal text-muted-foreground">
                    (you)
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {m.role === 'owner'
                  ? 'Host'
                  : m.online
                    ? m.inVoice
                      ? 'In voice'
                      : 'Watching'
                    : 'Offline'}
              </p>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              {m.inVoice && m.deafened && (
                <HeadphoneOff
                  className="size-3.5 text-destructive"
                  aria-label="Deafened"
                />
              )}
              {m.inVoice && m.muted && (
                <MicOff
                  className="size-3.5 text-destructive"
                  aria-label="Muted"
                />
              )}
              {m.inVoice && !m.muted && (
                <Headphones
                  className="size-3.5 text-success"
                  aria-label="In voice"
                />
              )}
            </div>
            {canManage && m.id !== meId && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Manage ${m.name}`}
                  >
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      actions.transferOwnership(m.id)
                    }}
                  >
                    <Crown /> Make host
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      actions.removeMember(m.id)
                    }}
                  >
                    <UserMinus /> Remove from room
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
