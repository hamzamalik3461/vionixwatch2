import {
  AlertTriangle,
  HeadphoneOff,
  Headphones,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Volume2,
  WifiOff,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import type { RoomState } from './useRoom'
import type { VoiceState } from './useVoice'

export function VoiceStatusPill({ voice }: { voice: VoiceState }) {
  const map = {
    connected: ['bg-success', 'Voice connected'],
    connecting: [
      'bg-warning animate-pulse motion-reduce:animate-none',
      voice.online ? 'Connecting…' : 'Reconnecting…',
    ],
    disconnected: ['bg-muted-foreground', 'Not in voice'],
  } as const
  const [dot, label] = map[voice.status]
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold">
      <span className={cn('size-2 rounded-full', dot)} /> {label}
    </span>
  )
}

export function VoicePanel({
  room,
  voice,
}: {
  room: RoomState
  voice: VoiceState
}) {
  const inVoice = room.members.filter((m) => m.inVoice && m.online)
  const connected = voice.status === 'connected'

  return (
    <div className="space-y-4 overflow-y-auto p-3">
      <div className="rounded-xl border bg-secondary/40 p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-1.5 font-display text-sm font-bold">
              <Volume2 className="size-4 text-electric" /> Lounge
            </p>
            <p className="text-xs text-muted-foreground">
              {inVoice.length} in voice
            </p>
          </div>
          <VoiceStatusPill voice={voice} />
        </div>

        {!voice.online && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-warning/10 p-2 text-xs text-warning">
            <WifiOff className="size-3.5" /> Connection lost — reconnecting
            automatically.
          </p>
        )}

        {voice.realtime === 'unavailable' && (
          <p className="mt-3 flex gap-2 rounded-lg bg-warning/10 p-2 text-xs text-warning">
            <AlertTriangle className="size-3.5 shrink-0" /> Voice isn't
            configured on this site yet.
          </p>
        )}

        {voice.error && (
          <p
            role="alert"
            className="mt-3 flex gap-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive"
          >
            <AlertTriangle className="size-3.5 shrink-0" /> {voice.error}
          </p>
        )}

        <div className="mt-3 flex gap-2">
          {voice.status === 'disconnected' ? (
            <Button
              className="flex-1 bg-success text-black hover:bg-success/90"
              onClick={() => void voice.join()}
              disabled={voice.realtime !== 'connected'}
            >
              <Headphones /> Join voice
            </Button>
          ) : (
            <>
              <Button
                variant={voice.muted ? 'destructive' : 'secondary'}
                size="icon"
                aria-pressed={voice.muted}
                aria-label={
                  voice.muted ? 'Unmute microphone' : 'Mute microphone'
                }
                onClick={voice.toggleMute}
                disabled={!connected}
              >
                {voice.muted ? <MicOff /> : <Mic />}
              </Button>
              <Button
                variant={voice.deafened ? 'destructive' : 'secondary'}
                size="icon"
                aria-pressed={voice.deafened}
                aria-label={voice.deafened ? 'Undeafen' : 'Deafen'}
                onClick={voice.toggleDeafen}
                disabled={!connected}
              >
                {voice.deafened ? <HeadphoneOff /> : <Headphones />}
              </Button>
              {voice.canShare && (
                <Button
                  variant={voice.sharing ? 'default' : 'secondary'}
                  size="icon"
                  aria-pressed={voice.sharing}
                  aria-label={
                    voice.sharing
                      ? 'Stop sharing your screen'
                      : 'Share your screen'
                  }
                  onClick={() => void voice.toggleShare()}
                  disabled={!connected}
                >
                  <MonitorUp />
                </Button>
              )}
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => void voice.leave()}
              >
                <PhoneOff /> Leave
              </Button>
            </>
          )}
        </div>

        {voice.sharing && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-primary/10 p-2 text-xs text-foreground">
            <MonitorUp className="size-3.5 shrink-0 text-electric" /> You're
            sharing your screen with the room.
          </p>
        )}

        {connected && (
          <div className="mt-3" aria-label="Your microphone level">
            <div className="h-1.5 overflow-hidden rounded-full bg-background">
              <div
                className="h-full rounded-full bg-gradient-to-r from-success to-electric transition-[width] duration-75"
                style={{ width: `${Math.round(voice.level * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <ul className="space-y-1" aria-label="Voice participants">
        {inVoice.length === 0 && (
          <li className="px-2 text-xs text-muted-foreground">
            Nobody is in voice yet.
          </li>
        )}
        {inVoice.map((m) => (
          <li
            key={m.id}
            className="flex items-center gap-3 rounded-lg px-2 py-1.5"
          >
            <Avatar member={m} size="sm" showStatus={false} />
            <span
              className={cn(
                'flex-1 truncate text-sm',
                m.speaking
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {m.name}
              {m.id === room.me?.id && ' (you)'}
            </span>
            {m.speaking && !m.muted && (
              <span
                className="nw-eq flex h-3 items-end gap-0.5"
                aria-label="Speaking"
              >
                <span className="w-0.5 bg-success" style={{ height: '100%' }} />
                <span className="w-0.5 bg-success" style={{ height: '100%' }} />
                <span className="w-0.5 bg-success" style={{ height: '100%' }} />
              </span>
            )}
            {m.deafened && (
              <HeadphoneOff
                className="size-3.5 text-destructive"
                aria-label="Deafened"
              />
            )}
            {m.muted && !m.deafened && (
              <MicOff
                className="size-3.5 text-destructive"
                aria-label="Muted"
              />
            )}
          </li>
        ))}
      </ul>

      <div className="space-y-3 border-t pt-4">
        <h3 className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
          Devices
        </h3>
        <DeviceSelect
          id="mic"
          label="Microphone"
          devices={voice.inputs}
          value={voice.inputId}
          onChange={(id) => void voice.chooseInput(id)}
        />
        <DeviceSelect
          id="speaker"
          label="Audio output"
          devices={voice.outputs}
          value={voice.outputId}
          onChange={voice.setOutputId}
          emptyHint="Your browser picks the output device"
        />
        <p className="text-xs text-muted-foreground">
          You can watch without joining voice. Player volume is always local to
          you.
        </p>
      </div>
    </div>
  )
}

function DeviceSelect({
  id,
  label,
  devices,
  value,
  onChange,
  emptyHint = 'Join voice to see your devices',
}: {
  id: string
  label: string
  devices: MediaDeviceInfo[]
  value: string
  onChange: (id: string) => void
  emptyHint?: string
}) {
  const usable = devices.filter((d) => d.deviceId)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select
        value={value || 'default'}
        onValueChange={onChange}
        disabled={usable.length === 0}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={emptyHint} />
        </SelectTrigger>
        <SelectContent>
          {usable.length === 0 ? (
            <SelectItem value="default">{emptyHint}</SelectItem>
          ) : (
            usable.map((d, i) => (
              <SelectItem key={d.deviceId} value={d.deviceId}>
                {d.label || `${label} ${i + 1}`}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
