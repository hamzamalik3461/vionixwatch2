import { Link, useNavigate } from '@tanstack/react-router'
import {
  LogIn,
  LogOut,
  MessageCircle,
  Settings2,
  UserRound,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Logo } from '@/components/brand/Logo'
import { UserAvatar } from '@/components/social/CallOverlay'
import { useSocial } from '@/components/social/SocialProvider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { logoutAccount } from '@/lib/api'
import { cn } from '@/lib/utils'

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="nw-pop absolute -top-1.5 -right-2 grid min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground tabular-nums">
      {count > 9 ? '9+' : count}
    </span>
  )
}

/** Top navigation shared by every page outside the watch room. */
export function SiteHeader({ className }: { className?: string }) {
  const { account, accountReady, pulse, refreshAccount } = useSocial()
  const navigate = useNavigate()

  async function logout() {
    try {
      await logoutAccount()
      // Also end any Google/GitHub broker session, best effort.
      void import('@netlify/identity').then((m) => m.logout()).catch(() => {})
      await refreshAccount()
      toast.success('Signed out')
      void navigate({ to: '/' })
    } catch {
      toast.error('Could not sign out')
    }
  }

  return (
    <header
      className={cn(
        'relative z-20 mx-auto flex max-w-content items-center justify-between gap-3 px-4 py-5 sm:px-6',
        className,
      )}
    >
      <Logo />
      <nav className="flex items-center gap-1.5 sm:gap-2">
        {account?.username && (
          <>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="relative text-muted-foreground hover:text-foreground"
            >
              <Link to="/friends">
                <Users className="size-4" />
                <span className="hidden sm:inline">Friends</span>
                <NavBadge count={pulse?.requests ?? 0} />
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="relative text-muted-foreground hover:text-foreground"
            >
              <Link to="/messages">
                <MessageCircle className="size-4" />
                <span className="hidden sm:inline">Messages</span>
                <NavBadge count={pulse?.unread ?? 0} />
              </Link>
            </Button>
          </>
        )}
        {!accountReady ? (
          <Skeleton className="size-9 rounded-full" />
        ) : account?.username ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Account menu"
              className="rounded-full transition-transform hover:scale-105 focus-visible:outline-2 motion-reduce:transition-none"
            >
              <UserAvatar user={account} withStatus size="md" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="flex flex-col">
                <span className="truncate">{account.name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  @{account.username}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/friends">
                  <Users /> Friends
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/messages">
                  <MessageCircle /> Messages
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/profile">
                  <Settings2 /> Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void logout()}
              >
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <>
            {account && (
              <span className="hidden items-center gap-1.5 text-sm text-muted-foreground md:flex">
                <UserRound className="size-4" />
                {account.name}
              </span>
            )}
            <Button asChild size="sm" className="font-bold">
              <Link to="/login">
                <LogIn className="size-4" /> Sign in
              </Link>
            </Button>
          </>
        )}
      </nav>
    </header>
  )
}
