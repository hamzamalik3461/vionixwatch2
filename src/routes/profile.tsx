import { useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { BadgeCheck, ImagePlus, LogIn, Save } from 'lucide-react'
import { toast } from 'sonner'
import { AvatarPicker, fileToAvatarDataUrl } from '@/components/AvatarPicker'
import { SiteHeader } from '@/components/shell/SiteHeader'
import { UserAvatar } from '@/components/social/CallOverlay'
import { useSocial } from '@/components/social/SocialProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { saveSession, uploadAvatar } from '@/lib/api'
import { sanitizeName, saveProfile } from '@/lib/session'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const { account, accountReady, refreshAccount } = useSocial()
  return (
    <div className="relative min-h-svh overflow-x-hidden">
      <div className="nw-glow nw-breathe pointer-events-none absolute inset-x-0 top-0 h-[30rem]" />
      <div className="nw-orb nw-orb-a" aria-hidden="true" />
      <SiteHeader />
      <main className="relative z-10 mx-auto max-w-reading px-4 pb-20 sm:px-6">
        <div className="nw-fade-up mb-8">
          <p className="text-xs font-bold tracking-[0.2em] text-electric uppercase">
            Your identity
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">
            Profile
          </h1>
        </div>
        {!accountReady ? (
          <Skeleton className="h-80 rounded-3xl" />
        ) : !account ? (
          <div className="nw-panel nw-fade-up rounded-3xl border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Pick a name on the home page, or sign in to manage your account.
            </p>
            <Button asChild size="lg" className="mt-6 font-bold">
              <Link to="/login">
                <LogIn className="size-4" /> Sign in
              </Link>
            </Button>
          </div>
        ) : (
          <ProfileCard
            account={account}
            onSaved={() => void refreshAccount()}
          />
        )}
      </main>
    </div>
  )
}

function ProfileCard({
  account,
  onSaved,
}: {
  account: { id: string; name: string; avatar: string; username: string | null }
  onSaved: () => void
}) {
  const [name, setName] = useState(account.name)
  const [avatar, setAvatar] = useState(account.avatar)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dirty = name !== account.name || avatar !== account.avatar

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const clean = sanitizeName(name)
    if (clean.length < 2) {
      toast.error('Pick a display name with at least 2 characters.')
      return
    }
    setBusy(true)
    try {
      await saveSession(clean, avatar)
      saveProfile({ name: clean, avatar })
      onSaved()
      toast.success('Profile saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  /** Uploads the downscaled picture and applies it immediately. */
  async function applyImage(dataUrl: string) {
    setUploading(true)
    try {
      const { avatar: url } = await uploadAvatar(dataUrl)
      setAvatar(url)
      saveProfile({ name, avatar: url })
      onSaved()
      toast.success('Avatar updated')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not upload that image',
      )
    } finally {
      setUploading(false)
    }
  }

  async function pickFile(file: File | undefined) {
    if (!file) return
    try {
      await applyImage(await fileToAvatarDataUrl(file))
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not use that image',
      )
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <form
      onSubmit={save}
      className="nw-panel nw-fade-up relative rounded-3xl border p-6 shadow-2xl shadow-primary/10 sm:p-8"
    >
      <div className="absolute -inset-px -z-10 rounded-3xl bg-gradient-to-br from-primary/30 via-transparent to-electric/20 blur-lg" />
      <div className="flex flex-wrap items-center gap-4">
        <UserAvatar user={{ id: account.id, name, avatar }} size="xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-xl font-bold">
            {name || '—'}
          </p>
          {account.username ? (
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <BadgeCheck className="size-4 text-electric" /> @
              {account.username}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Guest ·{' '}
              <Link to="/login" className="text-electric underline">
                create an account
              </Link>{' '}
              to keep this identity
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus className="size-4" />
          {uploading ? 'Uploading…' : 'Change avatar'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className="sr-only"
          aria-label="Upload avatar image"
          onChange={(e) => void pickFile(e.target.files?.[0])}
        />
      </div>

      <div className="mt-6 space-y-2">
        <Label htmlFor="display-name">Display name</Label>
        <Input
          id="display-name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          className="h-11"
        />
      </div>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium">Avatar</legend>
        <AvatarPicker
          value={avatar}
          onPick={setAvatar}
          onImage={applyImage}
          busy={uploading}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Upload your own picture (it shows everywhere — rooms, chat, calls) or
          pick an emoji. Uploads apply right away; name changes still need Save.
        </p>
      </fieldset>

      <Button
        type="submit"
        size="lg"
        disabled={!dirty || busy}
        className="mt-6 w-full font-bold shadow-lg shadow-primary/30 sm:w-auto"
      >
        <Save className="size-4" /> {busy ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  )
}
