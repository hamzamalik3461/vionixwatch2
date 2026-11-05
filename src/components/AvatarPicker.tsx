import { useId, useRef, useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { avatarChoices, isImageAvatar } from '@/lib/catalog'
import { cn } from '@/lib/utils'

/**
 * Downscales a picked image to a 256px square data URL, ready to upload.
 * Re-encoding in the browser keeps uploads tiny and strips anything weird.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/'))
    throw new Error('Pick an image file (PNG, JPEG, WebP…).')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not read that image.'))
      el.src = url
    })
    const SIZE = 256
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not process that image.')
    // Cover-crop the center square.
    const s = Math.min(img.naturalWidth, img.naturalHeight)
    if (!s) throw new Error('Could not read that image.')
    ctx.drawImage(
      img,
      (img.naturalWidth - s) / 2,
      (img.naturalHeight - s) / 2,
      s,
      s,
      0,
      0,
      SIZE,
      SIZE,
    )
    const webp = canvas.toDataURL('image/webp', 0.85)
    const out = webp.startsWith('data:image/webp')
      ? webp
      : canvas.toDataURL('image/jpeg', 0.85)
    if (out.length > 2_900_000) throw new Error('That image is too large.')
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Emoji avatar grid plus an "upload your own" tile. When the current value is
 * an uploaded image (URL or pending data-URL preview), it shows as a selected
 * photo tile. `onImage` receives the downscaled data URL; the caller decides
 * whether to upload it right away or hold it until a form is submitted.
 */
export function AvatarPicker({
  value,
  onPick,
  onImage,
  busy = false,
  size = 'md',
}: {
  value: string
  onPick: (emoji: string) => void
  onImage: (dataUrl: string) => void | Promise<void>
  busy?: boolean
  size?: 'sm' | 'md'
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const [reading, setReading] = useState(false)
  const tile =
    size === 'md' ? 'size-10 rounded-xl text-xl' : 'size-9 rounded-xl text-lg'
  const custom = isImageAvatar(value)

  async function pickFile(file: File | undefined) {
    if (!file) return
    setReading(true)
    try {
      await onImage(await fileToAvatarDataUrl(file))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not use that image.')
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy || reading}
        aria-label={
          custom ? 'Change your uploaded avatar' : 'Upload your own avatar'
        }
        aria-pressed={custom}
        className={cn(
          'grid place-items-center overflow-hidden border bg-secondary transition-all hover:-translate-y-0.5 hover:border-primary/60 motion-reduce:transition-none',
          tile,
          custom && 'border-primary ring-2 ring-primary/40',
        )}
      >
        {reading || busy ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
        ) : custom ? (
          <img
            src={value}
            alt="Your uploaded avatar"
            className="h-full w-full object-cover"
          />
        ) : (
          <ImagePlus className="size-4 text-muted-foreground" />
        )}
      </button>
      <input
        ref={fileRef}
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="sr-only"
        aria-label="Upload avatar image"
        onChange={(e) => void pickFile(e.target.files?.[0])}
      />
      {avatarChoices.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onPick(a)}
          aria-label={`Avatar ${a}`}
          aria-pressed={!custom && value === a}
          className={cn(
            'grid place-items-center border bg-secondary transition-all hover:-translate-y-0.5 hover:border-primary/60 motion-reduce:transition-none',
            tile,
            !custom &&
              value === a &&
              'border-primary bg-primary/20 ring-2 ring-primary/40',
          )}
        >
          {a}
        </button>
      ))}
    </div>
  )
}
