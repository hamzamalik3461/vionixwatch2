# VIONIX WATCH — Product roadmap

VIONIX WATCH is a watch-together platform: host-controlled synchronized video,
low-latency voice, live chat, uploads, room management — and, with an account,
friends, direct messages and 1:1 voice/video calls. It is delivered in small,
self-contained milestones so each one ships something usable.

## Milestone 1 — Product surface ✅ (done)

- Landing page with username + avatar, one-click Create Room (unique code and
  invite link), Join by code or pasted link, recently joined rooms, public
  rooms, feature overview, online count, how it works.
- Room screen with the large custom player (MP4 + HLS/Mux via hls.js; play,
  pause, ±10s, seek, speed, quality menu, volume, fullscreen, theater mode,
  loading and error states, keyboard shortcuts).
- Host-only controls are hidden or disabled for guests, and a "Preview as
  guest" switch lets the host check the guest view.
- Queue: add by URL, upload (drag and drop, progress, cancel, processing,
  thumbnail, duration, title), reorder, remove, next/previous, auto-advance.
- Sidebar tabs: chat (timestamps, avatars, system messages, auto-scroll,
  emoji reactions), members (online status, crown, mic state, host actions
  make host/remove), voice (real mic permission, live level meter, mute,
  deafen, device pickers, connection and reconnection status), and settings
  (invite link and code copy, lock, name, description, private, password,
  capacity, end room).
- Join gate for invite links, password gate, room-ended screen, invalid-room
  screen, loading skeletons, toasts.
- (Simulated members were replaced by real data in milestones 2–4.)

## Milestone 2 — Room data model and server-enforced permissions ✅ (done)

- Netlify Database (managed Postgres, Drizzle) tables: `profiles`, `rooms`,
  `room_members`, `room_messages`, `room_playback`, `room_videos`, with
  primary and foreign keys, indexes and timestamps.
- Anonymous guest identity: a signed, httpOnly session cookie issued by the
  server. The browser never decides who it is or what role it has.
- Server routes: create room, join (password and capacity checks, plus the
  lock check), leave, update settings, remove member, transfer ownership, end
  room. Owner checks run against the database on every request.
- Store room passwords as hashes (scrypt). Room codes come from a CSPRNG.
  Rate limits cover chat, reactions and room creation per session. Per-IP
  limits are still to do.
- Swap `useRoom` actions from local state to these routes.

## Milestone 3 — Realtime: playback sync, chat and presence ✅ (done; server pushes over LiveKit data, 3s polling fallback)

- Realtime messages go over LiveKit data channels, a second use of the same
  LiveKit connection that voice needs.
- Playback state `{videoId, playing, position, rate, updatedAt}` is written to
  `room_playback` by the owner-only route, then broadcast. The server rejects
  non-owners.
- Clients compute the expected position from `updatedAt` and correct drift.
  They nudge the playback rate for drift under 2s and seek for anything
  larger. This also covers mid-video joins and recovery after a reconnect.
- Chat is persisted to `room_messages`, with history loaded on join, join and
  leave notices, and per-user rate limiting.
- The online count comes from live presence.

## Milestone 4 — LiveKit voice ✅ (done; server-side kick on removal)

- A Netlify Function mints LiveKit access tokens. It validates the session and
  membership, and grants publish and subscribe only for that room.
- Publish the mic track from the existing `useVoice` hook, and subscribe to
  remote audio. Speaking indicators use LiveKit's active-speaker events, and
  output selection uses `setSinkId`.
- Removed members get their LiveKit participant kicked server-side.

## Milestone 5 — Mux uploads ✅ (done; direct upload + status polling, no webhook)

- An owner-only function creates a Mux Direct Upload URL. The browser uploads
  the file straight to Mux with progress and cancel (an UpChunk-style PUT).
- A Mux webhook (signature verified) or polling marks the asset ready, then
  stores the playback ID, duration and thumbnail in `room_videos`.
- The queue uses `https://stream.mux.com/{playbackId}.m3u8`, which the player
  already supports.

## Milestone 6 — Hardening and lifecycle

- A scheduled function cleans up empty and ended rooms.
- Public room lobby backed by real data.
- Custom error pages for ended, full and locked rooms, and for removed
  members.
- Two-browser end-to-end tests: voice, owner-only controls, synced play,
  pause and seek, and uploads. Mobile QA.

## Milestone 7 — Accounts, friends, DMs and 1:1 calls ✅ (done)

- Username + password accounts (scrypt) layered on the guest profile: a guest
  registers in place and keeps their room history. Per-device rows in a
  `sessions` table, so logging in on a new device doesn't log out the old one.
- Friends: request by username (crossing requests auto-accept), accept,
  decline, cancel, remove; online presence from session activity.
- Direct messages outside rooms: per-pair threads, unread counts, read
  markers, incremental polling, rate limiting.
- 1:1 voice and video calls over LiveKit (`vionix-call-<id>` rooms, mic +
  camera grants). Ring → accept/decline/missed lifecycle persisted in
  `calls`, call log lines in the thread, a global incoming-call banner and a
  full-screen call overlay that survives page navigation.
- New pages: `/login`, `/friends`, `/messages`, `/messages/$threadId`,
  `/profile`, all behind a shared animated site header with unread and
  request badges.

## Setup needed for later milestones

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `MUX_TOKEN_ID` and
  `MUX_TOKEN_SECRET` are set as Netlify environment variables (see
  `.env.example`). Never put them in source code.
