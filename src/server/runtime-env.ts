/** Read invocation-scoped Netlify configuration, with a local/test fallback. */
export function runtimeEnv(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    Netlify?: { env?: { get: (key: string) => string | undefined } }
  }
  return (
    (runtime.Netlify?.env?.get(name) ?? process.env[name])?.trim() || undefined
  )
}
