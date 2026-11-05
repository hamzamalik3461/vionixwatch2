import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Live end-to-end config: runs the API routes against the real Netlify
 * Database branch and real LiveKit credentials. Not part of `npm test`;
 * run with: netlify dev:exec npx vitest run --config vitest.live.config.ts
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/server/live.e2e.ts'],
    testTimeout: 60_000,
  },
})
