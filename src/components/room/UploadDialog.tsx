import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, FileVideo, Loader2, UploadCloud, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ApiError, roomAction } from '@/lib/api'
import type { RoomState } from './useRoom'

/** Containers Mux accepts for direct uploads. */
const ACCEPTED = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/x-msvideo',
  'video/mpeg',
  'video/3gpp',
]
const ACCEPT_EXT = /\.(mp4|mov|webm|mkv|avi|mpeg|mpg|m4v|3gp)$/i
const MAX_BYTES = 4 * 1024 * 1024 * 1024 // 4 GB
const POLL_MS = 3000
const POLL_LIMIT = 100 // ~5 minutes of processing

type Stage = 'pick' | 'confirm' | 'uploading' | 'processing' | 'ready' | 'error'

/**
 * Real Mux direct upload: the server mints an upload URL, the browser PUTs
 * the file straight to Mux, then we poll until the asset is ready and the
 * server adds it to the queue for everyone.
 */
export function UploadDialog({
  room,
  open,
  onOpenChange,
}: {
  room: RoomState
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [stage, setStage] = useState<Stage>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closedRef = useRef(false)
  const generation = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  function stopWork() {
    generation.current += 1
    xhrRef.current?.abort()
    xhrRef.current = null
    if (pollRef.current) clearTimeout(pollRef.current)
    pollRef.current = null
  }

  function reset() {
    stopWork()
    setStage('pick')
    setFile(null)
    setTitle('')
    setProgress(0)
    setError(null)
  }

  // Fresh state every time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStage('pick')
      setFile(null)
      setTitle('')
      setProgress(0)
      setError(null)
    }
  }

  useEffect(() => {
    closedRef.current = !open
    if (!open) stopWork()
    return () => {
      closedRef.current = true
      stopWork()
    }
  }, [open])

  function fail(message: string) {
    if (closedRef.current) return
    stopWork()
    setError(message)
    setStage('error')
  }

  function pick(f: File | undefined) {
    if (!f) return
    if (!(ACCEPTED.includes(f.type) || ACCEPT_EXT.test(f.name))) {
      fail('Unsupported format. Use MP4, MOV, WebM, MKV, AVI or MPEG.')
      return
    }
    if (f.size === 0) {
      fail('That file is empty. Choose a video with content.')
      return
    }
    if (f.size > MAX_BYTES) {
      fail('That file is larger than 4 GB.')
      return
    }
    setFile(f)
    setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 80))
    setStage('confirm')
  }

  async function start() {
    if (!file) return
    stopWork()
    const run = generation.current
    const active = () => !closedRef.current && generation.current === run
    const clean = title.trim().slice(0, 80) || 'Uploaded video'
    setStage('uploading')
    setProgress(0)
    let upload: { uploadId: string; url: string }
    try {
      upload = await roomAction<{ uploadId: string; url: string }>(
        room.code,
        'upload-url',
        {
          title: clean,
        },
      )
    } catch (e) {
      if (!active()) return
      fail(
        e instanceof ApiError && e.status === 503
          ? 'Uploads are not configured on this site yet. Paste a public video link instead.'
          : e instanceof Error
            ? e.message
            : 'Could not start the upload.',
      )
      return
    }

    if (!active()) return
    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    xhr.open('PUT', upload.url)
    xhr.upload.onprogress = (e) => {
      if (active() && e.lengthComputable)
        setProgress((e.loaded / e.total) * 100)
    }
    xhr.onerror = () => {
      if (active())
        fail('The upload failed. Check your connection and try again.')
    }
    xhr.onload = () => {
      if (!active()) return
      xhrRef.current = null
      if (xhr.status < 200 || xhr.status >= 300) {
        fail('The video service rejected the file.')
        return
      }
      setStage('processing')
      void poll(upload.uploadId, 0, run)
    }
    xhr.send(file)
  }

  async function poll(uploadId: string, attempt: number, run: number) {
    if (closedRef.current || generation.current !== run) return
    if (attempt > POLL_LIMIT) {
      fail(
        'Processing is taking unusually long. Keep this dialog open and retry the upload if it does not finish.',
      )
      return
    }
    try {
      const { status } = await roomAction<{ status: string }>(
        room.code,
        'upload-status',
        {
          uploadId,
        },
      )
      if (closedRef.current || generation.current !== run) return
      if (status === 'ready') {
        setStage('ready')
        toast.success('Upload complete', {
          description: 'Your video is in the queue for everyone.',
        })
        void room.actions.refresh()
        return
      }
      if (status === 'errored') {
        fail(
          'The video could not be processed. Try a different encoding (H.264 MP4 works best).',
        )
        return
      }
    } catch (e) {
      if (closedRef.current || generation.current !== run) return
      if (e instanceof ApiError && [401, 403, 404, 503].includes(e.status)) {
        fail(e.message)
        return
      }
      // Transient poll failure — keep trying.
    }
    if (closedRef.current || generation.current !== run) return
    pollRef.current = setTimeout(
      () => void poll(uploadId, attempt + 1, run),
      POLL_MS,
    )
  }

  function cancel() {
    stopWork()
    toast('Upload cancelled')
    reset()
  }

  const busy = stage === 'uploading' || stage === 'processing'

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && busy) cancel()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload a video</DialogTitle>
          <DialogDescription>
            The file goes straight to the streaming service and plays in sync
            for everyone in the room.
          </DialogDescription>
        </DialogHeader>

        {stage === 'pick' && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              pick(e.dataTransfer.files[0])
            }}
            className={
              'grid w-full place-items-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition-colors ' +
              (drag
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/60')
            }
          >
            <UploadCloud className="size-10 text-electric" />
            <span className="font-semibold">
              Drop a video here or click to browse
            </span>
            <span className="text-xs text-muted-foreground">
              MP4, MOV, WebM, MKV, AVI or MPEG — up to 4 GB
            </span>
          </button>
        )}

        {stage === 'confirm' && file && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border bg-secondary/40 p-3">
              <FileVideo className="size-8 shrink-0 text-electric" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="up-title">Title</Label>
              <Input
                id="up-title"
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>
        )}

        {busy && file && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {stage === 'processing' ? (
                <Loader2 className="size-5 animate-spin text-electric motion-reduce:animate-none" />
              ) : (
                <FileVideo className="size-5 text-electric" />
              )}
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                {title}
              </p>
              <span className="text-xs tabular-nums text-muted-foreground">
                {stage === 'uploading'
                  ? `${Math.floor(progress)}%`
                  : 'Processing…'}
              </span>
            </div>
            <Progress value={stage === 'uploading' ? progress : 100} />
            <p className="text-xs text-muted-foreground">
              {stage === 'uploading'
                ? 'Uploading directly to the streaming service…'
                : 'Upload done. The video is being prepared for streaming — this can take a minute.'}
            </p>
          </div>
        )}

        {stage === 'ready' && (
          <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 p-4">
            <CheckCircle2 className="size-6 text-success" />
            <p className="text-sm font-semibold">
              Done — it&apos;s in the queue for everyone.
            </p>
          </div>
        )}

        {stage === 'error' && (
          <div
            role="alert"
            className="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4"
          >
            <X className="size-5 shrink-0 text-destructive" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={[
            ...ACCEPTED,
            '.mp4,.mov,.webm,.mkv,.avi,.mpeg,.mpg,.m4v,.3gp',
          ].join(',')}
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])}
          tabIndex={-1}
        />

        <DialogFooter>
          {stage === 'confirm' && (
            <>
              <Button variant="outline" onClick={reset}>
                Choose another file
              </Button>
              <Button onClick={() => void start()}>
                <UploadCloud /> Upload
              </Button>
            </>
          )}
          {busy && (
            <Button variant="outline" onClick={cancel}>
              Cancel upload
            </Button>
          )}
          {(stage === 'ready' || stage === 'error') && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
