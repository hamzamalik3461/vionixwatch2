import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRight, KeyRound, Sparkles, UserRoundPlus } from 'lucide-react'
import { toast } from 'sonner'
import { AvatarPicker } from '@/components/AvatarPicker'
import { SiteHeader } from '@/components/shell/SiteHeader'
import { UserAvatar } from '@/components/social/CallOverlay'
import { useSocial } from '@/components/social/SocialProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { loginAccount, registerAccount, uploadAvatar } from '@/lib/api'
import { avatarChoices } from '@/lib/catalog'
import { saveProfile, sanitizeName, useProfile } from '@/lib/session'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { account, refreshAccount } = useSocial()
  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div className="nw-glow nw-breathe pointer-events-none absolute inset-x-0 top-0 h-[36rem]" />
      <div className="nw-grid-bg pointer-events-none absolute inset-x-0 top-0 h-[36rem]" />
      <div className="nw-orb nw-orb-a" aria-hidden="true" />
      <div className="nw-orb nw-orb-b" aria-hidden="true" />
      <SiteHeader />
      <main className="relative z-10 mx-auto flex max-w-content flex-col items-center px-4 pt-6 pb-20 sm:px-6">
        {account?.username ? (
          <SignedInCard
            name={account.name}
            username={account.username}
            id={account.id}
            avatar={account.avatar}
          />
        ) : (
          <AuthCard onDone={() => void refreshAccount()} />
        )}
      </main>
    </div>
  )
}

function SignedInCard(props: {
  id: string
  name: string
  username: string
  avatar: string
}) {
  return (
    <div className="nw-panel nw-fade-up w-full max-w-md rounded-3xl border p-7 text-center shadow-2xl shadow-primary/10">
      <UserAvatar user={props} size="xl" className="mx-auto" />
      <h1 className="mt-4 font-display text-2xl font-bold">You're signed in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {props.name} · @{props.username}
      </p>
      <div className="mt-6 grid gap-2">
        <Button asChild size="lg" className="font-bold">
          <Link to="/friends">
            Go to friends <ArrowRight className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link to="/">Back home</Link>
        </Button>
      </div>
    </div>
  )
}

function ProviderIcon({ provider }: { provider: 'google' | 'github' }) {
  if (provider === 'google')
    return (
      <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A11.99 11.99 0 0 0 12 24Z"
        />
        <path
          fill="#FBBC05"
          d="M5.28 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28v-3.1H1.27a11.99 11.99 0 0 0 0 10.76l4.01-3.1Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.69 1.27 6.62l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77Z"
        />
      </svg>
    )
  return (
    <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .3a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .3Z"
      />
    </svg>
  )
}

function OAuthButtons() {
  const [busy, setBusy] = useState<'google' | 'github' | null>(null)

  async function start(provider: 'google' | 'github') {
    setBusy(provider)
    try {
      const { oauthLogin } = await import('@netlify/identity')
      oauthLogin(provider) // Redirects to the provider — never returns.
    } catch (error) {
      // Identity signals successful navigation by throwing after setting href.
      if (
        error instanceof Error &&
        error.message === 'Redirecting to OAuth provider'
      )
        return
      toast.error(
        `Sign-in with ${provider === 'google' ? 'Google' : 'GitHub'} isn't available right now. You can still use a username below.`,
      )
      setBusy(null)
    }
  }

  return (
    <div className="mb-5">
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={busy !== null}
          onClick={() => void start('google')}
          className="h-11 font-semibold"
        >
          <ProviderIcon provider="google" />
          {busy === 'google' ? 'Opening…' : 'Google / Gmail'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={busy !== null}
          onClick={() => void start('github')}
          className="h-11 font-semibold"
        >
          <ProviderIcon provider="github" />
          {busy === 'github' ? 'Opening…' : 'GitHub'}
        </Button>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        One click — your watch history as a guest carries over.
      </p>
      <div className="mt-4 flex items-center gap-3" role="separator">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium text-muted-foreground uppercase">
          or use a username
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}

function AuthCard({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const [tab, setTab] = useState('login')

  // Sign in state
  const [liUser, setLiUser] = useState('')
  const [liPass, setLiPass] = useState('')
  const [liBusy, setLiBusy] = useState(false)

  // Register state
  const [reUser, setReUser] = useState('')
  const [rePass, setRePass] = useState('')
  const [reName, setReName] = useState('')
  const [avatar, setAvatar] = useState(avatarChoices[0])
  // A freshly picked photo is held locally and uploaded right after registering.
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [reBusy, setReBusy] = useState(false)

  // Prefill display name/avatar from the guest profile once loaded.
  const [prefilled, setPrefilled] = useState<typeof profile>(null)
  if (profile && prefilled !== profile) {
    setPrefilled(profile)
    if (!reName) setReName(profile.name)
    setAvatar(profile.avatar)
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setLiBusy(true)
    try {
      const { profile: p } = await loginAccount(liUser.trim(), liPass)
      saveProfile({ name: p.name, avatar: p.avatar })
      onDone()
      toast.success(`Welcome back, ${p.name}!`)
      void navigate({ to: '/friends' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign in')
      setLiBusy(false)
    }
  }

  async function register(e: React.FormEvent) {
    e.preventDefault()
    const clean = sanitizeName(reName)
    if (clean.length < 2) {
      toast.error('Pick a display name with at least 2 characters.')
      return
    }
    setReBusy(true)
    try {
      // The auth API only accepts emoji or an already-owned image URL.
      const safeAvatar =
        pendingImage && !avatarChoices.includes(avatar)
          ? avatarChoices[0]
          : avatar
      const { profile: p } = await registerAccount({
        username: reUser.trim(),
        password: rePass,
        name: clean,
        avatar: safeAvatar,
      })
      let finalAvatar = p.avatar
      if (pendingImage) {
        try {
          finalAvatar = (await uploadAvatar(pendingImage)).avatar
        } catch {
          toast.error('Your photo could not be uploaded — try it again later.')
        }
      }
      saveProfile({ name: p.name, avatar: finalAvatar })
      onDone()
      toast.success(`Account created — welcome, ${p.name}!`)
      void navigate({ to: '/friends' })
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not create the account',
      )
      setReBusy(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="nw-fade-up mb-6 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-electric/30 bg-primary/15 px-3 py-1 text-xs font-semibold text-electric">
          <Sparkles className="size-3.5" /> Friends · Messages · Calls
        </div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          One account.
          <span className="nw-gradient-text nw-gradient-move"> Your crew.</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add friends, chat any time and call them with voice or video — even
          outside a watch room.
        </p>
      </div>

      <div className="nw-panel nw-fade-up nw-d-1 relative rounded-3xl border p-5 shadow-2xl shadow-primary/10 sm:p-7">
        <div className="absolute -inset-px -z-10 rounded-3xl bg-gradient-to-br from-primary/40 via-transparent to-electric/30 blur-xl" />
        <OAuthButtons />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">
              <KeyRound className="size-4" /> Sign in
            </TabsTrigger>
            <TabsTrigger value="register">
              <UserRoundPlus className="size-4" /> Create account
            </TabsTrigger>
          </TabsList>

          <TabsContent value="login" className="mt-5">
            <form onSubmit={signIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="li-user">Username</Label>
                <Input
                  id="li-user"
                  value={liUser}
                  autoComplete="username"
                  placeholder="e.g. nightowl"
                  onChange={(e) => setLiUser(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="li-pass">Password</Label>
                <Input
                  id="li-pass"
                  type="password"
                  value={liPass}
                  autoComplete="current-password"
                  onChange={(e) => setLiPass(e.target.value)}
                  className="h-11"
                />
              </div>
              <Button
                type="submit"
                size="lg"
                disabled={liBusy || !liUser || !liPass}
                className="h-12 w-full text-base font-bold shadow-lg shadow-primary/30"
              >
                {liBusy ? 'Signing in…' : 'Sign in'}{' '}
                <ArrowRight className="size-5" />
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="register" className="mt-5">
            <form onSubmit={register} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="re-user">Username</Label>
                <Input
                  id="re-user"
                  value={reUser}
                  autoComplete="username"
                  placeholder="lowercase letters, numbers, _"
                  onChange={(e) => setReUser(e.target.value)}
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Friends add you by this handle. 3–20 characters.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="re-pass">Password</Label>
                <Input
                  id="re-pass"
                  type="password"
                  value={rePass}
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                  onChange={(e) => setRePass(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="re-name">Display name</Label>
                <Input
                  id="re-name"
                  value={reName}
                  maxLength={24}
                  placeholder="What friends see"
                  onChange={(e) => setReName(e.target.value)}
                  className="h-11"
                />
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Avatar</legend>
                <AvatarPicker
                  size="sm"
                  value={pendingImage ?? avatar}
                  onPick={(a) => {
                    setAvatar(a)
                    setPendingImage(null)
                  }}
                  onImage={setPendingImage}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Pick an emoji or upload your own picture.
                </p>
              </fieldset>
              <Button
                type="submit"
                size="lg"
                disabled={reBusy || !reUser || !rePass || !reName}
                className="h-12 w-full text-base font-bold shadow-lg shadow-primary/30"
              >
                {reBusy ? 'Creating…' : 'Create account'}{' '}
                <ArrowRight className="size-5" />
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Been here as a guest? Your rooms stay with your new account.
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
