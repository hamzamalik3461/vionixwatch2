import { HttpError } from './http'
import { runtimeEnv } from './runtime-env'

/**
 * Minimal Mux Video API client for direct uploads. The browser PUTs the file
 * straight to Mux; these calls only create the upload and read its status,
 * so the Mux token never leaves the server.
 */

const API = 'https://api.mux.com/video/v1'

function auth() {
  const id = runtimeEnv('MUX_TOKEN_ID')
  const secret = runtimeEnv('MUX_TOKEN_SECRET')
  if (!id || !secret) return null
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`
}

export const muxConfigured = () => auth() !== null

async function muxFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const a = auth()
  if (!a)
    throw new HttpError(503, 'Uploads are not configured on this site yet')
  const res = await fetch(`${API}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
    headers: {
      authorization: a,
      'content-type': 'application/json',
      ...init?.headers,
    },
  }).catch(() => {
    throw new HttpError(
      502,
      'The video service could not be reached. Try again.',
    )
  })
  if (!res.ok) {
    console.error('[vionix] mux error', res.status, path)
    throw new HttpError(
      502,
      'The video service rejected the request. Try again.',
    )
  }
  return (await res.json()) as T
}

export type UploadPassthrough = { r: string; t: string; by: string }

export async function createDirectUpload(
  passthrough: UploadPassthrough,
  corsOrigin: string,
) {
  const { data } = await muxFetch<{ data: { id: string; url: string } }>(
    '/uploads',
    {
      method: 'POST',
      body: JSON.stringify({
        cors_origin: corsOrigin,
        new_asset_settings: {
          playback_policy: ['public'],
          video_quality: 'basic',
          passthrough: JSON.stringify(passthrough),
        },
      }),
    },
  )
  return { uploadId: data.id, url: data.url }
}

export async function getUpload(uploadId: string) {
  const { data } = await muxFetch<{
    data: { status: string; asset_id?: string }
  }>(`/uploads/${encodeURIComponent(uploadId)}`)
  return data
}

export async function getAsset(assetId: string) {
  const { data } = await muxFetch<{
    data: {
      status: string
      duration?: number
      passthrough?: string
      playback_ids?: { id: string; policy: string }[]
    }
  }>(`/assets/${encodeURIComponent(assetId)}`)
  return data
}
