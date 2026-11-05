import { useState } from 'react'
import { Copy, Crown, DoorOpen, Link2, Lock, Power, Unlock } from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { RoomState } from './useRoom'

export async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error(`Couldn't copy — ${text}`)
  }
}

export function inviteUrl(code: string) {
  return typeof window === 'undefined'
    ? `/room/${code}`
    : `${window.location.origin}/room/${code}`
}

export function SettingsPanel({
  room,
  code,
}: {
  room: RoomState
  code: string
}) {
  const { settings, isOwner, actions, owner, actualOwner } = room
  const navigate = useNavigate()
  const fromSettings = () => ({
    name: settings.name,
    description: settings.description,
    visibility: settings.visibility,
    capacity: settings.capacity,
    password: '',
    removePassword: false,
  })
  const [draft, setDraft] = useState(fromSettings)
  const [saving, setSaving] = useState(false)

  // Re-sync the form when the server settings change.
  const key = `${settings.name}|${settings.description}|${settings.visibility}|${settings.capacity}|${settings.hasPassword}`
  const [syncedKey, setSyncedKey] = useState(key)
  if (syncedKey !== key) {
    setSyncedKey(key)
    setDraft(fromSettings())
  }

  const dirty =
    draft.name !== settings.name ||
    draft.description !== settings.description ||
    draft.visibility !== settings.visibility ||
    draft.password !== '' ||
    draft.removePassword ||
    draft.capacity !== settings.capacity

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const name = draft.name.trim()
    if (name.length < 2 || name.length > 40) {
      toast.error('Room name must be 2–40 characters')
      return
    }
    if (draft.password && draft.password.length < 4) {
      toast.error('Passwords need at least 4 characters')
      return
    }
    const capacity = Math.min(50, Math.max(2, Math.round(draft.capacity) || 2))
    setSaving(true)
    const ok = await actions.updateSettings({
      name,
      capacity,
      visibility: draft.visibility,
      description: draft.description.slice(0, 200),
      ...(draft.password
        ? { password: draft.password }
        : draft.removePassword
          ? { password: '' }
          : {}),
    })
    setSaving(false)
    if (ok) toast.success('Room settings saved')
  }

  return (
    <div className="space-y-5 overflow-y-auto p-3">
      <div className="rounded-xl border bg-secondary/40 p-3">
        <p className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
          Invite
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-background px-2.5 py-2 text-xs">
            {inviteUrl(code)}
          </code>
          <Button
            size="icon-sm"
            variant="secondary"
            aria-label="Copy invite link"
            onClick={() => void copy(inviteUrl(code), 'Invite link')}
          >
            <Link2 />
          </Button>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="font-mono text-sm font-bold tracking-widest">
            {code}
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void copy(code, 'Room code')}
          >
            <Copy /> Copy code
          </Button>
        </div>
      </div>

      {isOwner ? (
        <>
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div className="flex items-center gap-2.5">
              {settings.locked ? (
                <Lock className="size-4 text-warning" />
              ) : (
                <Unlock className="size-4 text-muted-foreground" />
              )}
              <div>
                <Label htmlFor="lock">Lock room</Label>
                <p className="text-xs text-muted-foreground">
                  New people can't join while locked
                </p>
              </div>
            </div>
            <Switch
              id="lock"
              checked={settings.locked}
              onCheckedChange={(v) => {
                void actions
                  .updateSettings({ locked: v })
                  .then(
                    (ok) => ok && toast(v ? 'Room locked 🔒' : 'Room unlocked'),
                  )
              }}
            />
          </div>

          <form onSubmit={save} className="space-y-3">
            <h3 className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
              Room settings
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="s-name">Room name</Label>
              <Input
                id="s-name"
                value={draft.name}
                maxLength={40}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-desc">Description</Label>
              <Textarea
                id="s-desc"
                rows={2}
                maxLength={200}
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="s-private">Private room</Label>
              <Switch
                id="s-private"
                checked={draft.visibility === 'private'}
                onCheckedChange={(v) =>
                  setDraft({ ...draft, visibility: v ? 'private' : 'public' })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-pass">Password</Label>
                <Input
                  id="s-pass"
                  type="password"
                  placeholder={
                    settings.hasPassword && !draft.removePassword
                      ? 'Unchanged'
                      : 'None'
                  }
                  maxLength={64}
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      password: e.target.value,
                      removePassword: false,
                    })
                  }
                />
                {settings.hasPassword && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        password: '',
                        removePassword: !draft.removePassword,
                      })
                    }
                  >
                    {draft.removePassword ? 'Keep password' : 'Remove password'}
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-cap">Capacity</Label>
                <Input
                  id="s-cap"
                  type="number"
                  min={2}
                  max={50}
                  value={draft.capacity}
                  onChange={(e) =>
                    setDraft({ ...draft, capacity: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={!dirty || saving}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </form>

          <div className="space-y-2 border-t pt-4">
            <h3 className="text-[11px] font-bold tracking-wider text-destructive uppercase">
              Danger zone
            </h3>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" className="w-full">
                  <Power /> End room for everyone
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>End this room?</DialogTitle>
                  <DialogDescription>
                    Playback stops and everyone is disconnected from video,
                    voice and chat. This can't be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Keep room open</Button>
                  </DialogClose>
                  <Button variant="destructive" onClick={actions.endRoom}>
                    End room
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border p-3 text-sm">
            <p className="font-display font-bold">{settings.name}</p>
            {settings.description && (
              <p className="mt-1 text-muted-foreground">
                {settings.description}
              </p>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <dt className="text-muted-foreground">Host</dt>
              <dd className="flex items-center gap-1 font-semibold">
                <Crown className="size-3 text-warning" /> {owner?.name}
              </dd>
              <dt className="text-muted-foreground">Visibility</dt>
              <dd className="font-semibold capitalize">
                {settings.visibility}
              </dd>
              <dt className="text-muted-foreground">Capacity</dt>
              <dd className="font-semibold">{settings.capacity}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-semibold">
                {settings.locked ? 'Locked' : 'Open'}
              </dd>
              <dt className="text-muted-foreground">Password</dt>
              <dd className="font-semibold">
                {settings.hasPassword ? 'Yes' : 'No'}
              </dd>
            </dl>
          </div>
          {actualOwner && (
            <p className="rounded-lg bg-warning/10 p-2 text-xs text-warning">
              You're previewing the participant view. Turn off preview in the
              header to get your host controls back.
            </p>
          )}
        </div>
      )}

      <Button
        variant="outline"
        className="w-full"
        onClick={() => void navigate({ to: '/' })}
      >
        <DoorOpen /> Leave room
      </Button>
    </div>
  )
}
