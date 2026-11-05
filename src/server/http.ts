import type { z } from 'zod'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new HttpError(
      400,
      parsed.error.issues[0]?.message ?? 'Invalid request',
    )
  }
  return parsed.data
}

/** Wraps a handler so thrown HttpErrors become JSON responses and nothing else leaks. */
export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err: unknown) => {
    if (err instanceof HttpError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    console.error('[vionix] unexpected error', err)
    return Response.json({ error: 'Something went wrong' }, { status: 500 })
  })
}
