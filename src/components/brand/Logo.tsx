import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt=""
      aria-hidden="true"
      width={32}
      height={32}
      className={cn(
        'size-8 rounded-lg object-cover ring-1 ring-electric/40',
        className,
      )}
    />
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        'flex items-center gap-2.5 rounded-lg focus-visible:outline-2',
        className,
      )}
      aria-label="Vionix Watch home"
    >
      <LogoMark />
      <span className="font-display text-lg font-extrabold tracking-[0.18em]">
        VIONIX<span className="nw-gradient-text">&nbsp;WATCH</span>
      </span>
    </Link>
  )
}
