# NIGHTWATCH

Watch together, in sync. NIGHTWATCH lets you spin up a room in one click,
invite friends with a code or link, and watch videos together. The host
controls shared playback, and everyone else stays in sync, chats, reacts and
hangs out in a voice channel.

## What's live now

- **Landing page**: pick a username and avatar, create a room (public or
  private, with an optional password) or join by code or invite link. It also
  shows recently joined rooms, public rooms, the feature overview and how it
  works.
- **Watch room** (`/room/ABCD-123`):
  - The custom video player supports MP4, HLS (.m3u8) and Mux streams. It has
    play, pause, ±10s, seek, speed, fullscreen, theater mode, local volume,
    loading and error states, and keyboard shortcuts (Space/K, ←/→, F, M).
  - Host-only controls are disabled for guests, with a "Preview as guest"
    toggle for hosts.
  - The playlist supports add by URL, upload, reorder, remove,
    next/previous and auto-advance.
  - Sidebar: chat with emoji reactions, a member list with host actions, a
    voice panel with real microphone permission, level meter, mute, deafen
    and device selection, and room settings / owner dashboard.

Other people in the room and the backend are simulated for now. See
[PLAN.md](PLAN.md) for the roadmap: database, realtime sync, LiveKit voice and
Mux uploads.

## Tech stack

React 19 + TypeScript on TanStack Start (Vite 8), Tailwind CSS 4,
shadcn/ui (Radix), lucide icons, sonner toasts, and hls.js. It's deployed on
Netlify. Later milestones add Netlify Functions, Netlify Database, LiveKit and
Mux.

## Run locally

```bash
pnpm install
pnpm dev        # http://localhost:3000
# or, with Netlify platform emulation:
netlify dev
```

## Environment variables

Copy `.env.example` for local development. In production, set the values under
Netlify → Project configuration → Environment variables. Secrets are only ever
read on the server.

## Roadmap

1. ✅ Product surface (this release)
2. Room data model and server-enforced permissions
3. Realtime playback sync, chat and presence
4. LiveKit voice
5. Mux direct uploads
6. Hardening, cleanup and end-to-end testing

Details are in [PLAN.md](PLAN.md).
