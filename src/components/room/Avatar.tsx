import { Crown } from 'lucide-react'
import { isImageAvatar, type Member } from '@/lib/catalog'
import { cn } from '@/lib/utils'

export function Avatar({
  member,
  size = 'md',
  showStatus = true,
}: {
  member: Pick<
    Member,
    'avatar' | 'color' | 'online' | 'speaking' | 'role' | 'name'
  >
  size?: 'sm' | 'md' | 'lg'
  showStatus?: boolean
}) {
  const dims = {
    sm: 'size-7 text-sm',
    md: 'size-9 text-base',
    lg: 'size-14 text-2xl',
  }[size]
  return (
    <div className="relative shrink-0">
      <div
        className={cn(
          'grid place-items-center overflow-hidden rounded-full',
          dims,
          member.speaking && 'nw-speaking',
        )}
        style={{
          background: `color-mix(in oklch, ${member.color} 35%, var(--secondary))`,
        }}
        aria-hidden="true"
      >
        {isImageAvatar(member.avatar) ? (
          <img
            src={member.avatar}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          member.avatar
        )}
      </div>
      {member.role === 'owner' && (
        <Crown
          className="absolute -top-2 left-1/2 size-3.5 -translate-x-1/2 fill-warning text-warning drop-shadow"
          aria-label="Room host"
        />
      )}
      {showStatus && (
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-sidebar',
            member.online ? 'bg-success' : 'bg-muted-foreground',
          )}
          aria-label={member.online ? 'Online' : 'Offline'}
        />
      )}
    </div>
  )
}
