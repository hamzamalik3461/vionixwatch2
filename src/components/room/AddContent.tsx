import { useState } from 'react'
import { Link2, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseVideoLink } from '@/lib/video-links'
import { UploadDialog } from './UploadDialog'
import type { RoomState } from './useRoom'

/** Host tools to put something on screen: paste a video link or upload a file. */
export function AddContent({
  room,
  autoFocus,
}: {
  room: RoomState
  autoFocus?: boolean
}) {
  const [url, setUrl] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)

  function addUrl(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseVideoLink(url)
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }
    room.actions.addVideo(parsed.video)
    setUrl('')
  }

  return (
    <>
      <form onSubmit={addUrl} className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Link2 className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={url}
            autoFocus={autoFocus}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a video link — watch page, MP4 or stream URL"
            aria-label="Video URL"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          Add
        </Button>
        <Button type="button" onClick={() => setUploadOpen(true)}>
          <Upload /> Upload
        </Button>
      </form>
      <UploadDialog
        room={room}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
      />
    </>
  )
}
