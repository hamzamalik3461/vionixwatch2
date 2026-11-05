# AGENTS.md

This document describes the project for developers and AI agents working on this codebase.

## Project Overview

VIONIX WATCH (formerly NIGHTWATCH) is a watch-together platform: rooms with host-controlled
synchronized video, voice, chat, reactions and a playlist. Rooms, members,
chat, playback and the queue are real and shared, stored in Netlify Database.
Voice runs on LiveKit. Uploads go straight from the browser to Mux
(direct uploads + status polling). **Continue from [PLAN.md](PLAN.md)**.

### VIONIX WATCH architecture

- `db/schema.ts` holds the Drizzle schema (`profiles`, `sessions`, `rooms`,
  `room_members`, `room_messages`, `room_videos`, `room_playback`, plus the
  social tables `friendships`, `dm_threads`, `dm_messages`, `dm_reads`,
  `calls`). Migrations are generated into `netlify/database/migrations` with
  `npx drizzle-kit generate --name …`.
- `src/server/*` is server-only: sessions (`session.ts` — the opaque httpOnly
  `nw_sid` token is sha256-hashed into the `sessions` table, one row per
  device; `requireAccount` gates registered-only features), accounts
  (`auth.ts` — guests upgrade in place, keeping their room history), friends
  (`friends.ts`), DMs + 1:1 calls (`dms.ts` — ringing calls expire lazily
  after 45s into "missed"), room logic (`rooms.ts`), LiveKit tokens and
  broadcasts (`livekit.ts` — calls use rooms named `vionix-call-<id>` with
  mic + camera grants), and password hashing (scrypt).
- API routes: `api.session.ts` (GET includes `username`), `api.auth.ts`
  (register/login/logout), `api.rooms.ts`, `api.rooms.$code.ts`,
  `api.rooms.$code.$action.ts`, `api.friends.ts` (list + request/accept/
  decline/cancel/remove), `api.dms.ts` (threads + open), `api.dms.$id.ts`
  (messages `?after=`, send, read markers), `api.calls.ts` (GET is the social
  "pulse": unread count, pending requests, ringing call; POST
  start/accept/decline/end returns LiveKit tickets).
- `src/components/social/SocialProvider.tsx` is mounted in `__root.tsx` around
  the Outlet: it owns the account, polls the pulse (5s idle / 2.5s in-call)
  and runs the call's LiveKit connection so calls survive navigation. It
  renders `CallOverlay` + the incoming-call banner. `useSocial()` is the hook.
  `src/components/shell/SiteHeader.tsx` is the shared nav (badges, account
  menu) used by every page outside the watch room.
- Pages: `/` (landing + lobby), `/login`, `/friends`, `/messages`,
  `/messages/$threadId` (file `messages_.$threadId.tsx`, un-nested), and
  `/profile`, plus `/room/$code`. Friends/DMs/calls need an account; rooms
  still work for guests.
- `src/components/room/useRoom.ts` is the client seam. It calls the API, polls
  every 3s (the poll doubles as the presence heartbeat), and applies
  server-pushed events.
- `src/components/room/useVoice.ts` keeps one LiveKit connection per room
  view. The server pushes `RealtimeEvent`s over the data channel
  (`canPublishData` is false for clients, so only server packets are trusted).
  Joining voice publishes the mic and subscribes to remote audio. Voice state
  (in voice, muted, deafened, speaking) comes from LiveKit participants.
- Playback sync: `room_playback` stores `{videoId, playing, position, rate,
updatedAt}`, stamped by the server. `VideoPlayer` follows the server clock
  (offset estimated in `useRoom`): it nudges the speed for drift under 1.5s and
  seeks beyond that. The host follows the same clock.
- Presence: members are marked gone after a 90s heartbeat gap, or 8s after a
  `leave` beacon, so a page refresh doesn't post leave/join noise.
- `src/lib/catalog.ts` holds the client types and static data (avatars,
  speeds, emojis). `src/lib/room-types.ts` holds the API wire types. New rooms
  start with an empty queue; the first added video is auto-selected
  (`selectIfIdle`), and the player shows an add-link/upload screen when
  nothing is queued.
- Uploads: `src/server/mux.ts` + the `upload-url` / `upload-status` actions.
  The browser PUTs the file to a Mux direct-upload URL, then polls
  `upload-status`; when the asset is ready the server adds it to the queue
  (passthrough carries the room id). Needs `MUX_TOKEN_ID`/`MUX_TOKEN_SECRET`.
- `src/server/live.e2e.ts` (run via `vitest.live.config.ts` under
  `netlify dev:exec`) repeats the flow with real LiveKit credentials. The
  sandbox database connection is read-only, so writes stay on PGlite locally.
- `src/server/api.test.ts` runs the real routes against PGlite with the real
  migrations.

### Non-obvious decisions

- Theme: always dark (`<html class="dark">`), warm charcoal neutrals.
  Brand colors: `--primary` is Milano Red `#a90e02`, `--electric` is Lemon
  Chiffon `#fffbd4` (the accent; the variable name is historical). Also
  available: `--success` and `--warning`. Entrance/float animation helpers:
  `nw-fade-up`, `nw-d-1..4`, `nw-float`, `nw-breathe` (all disabled under
  reduced motion).
- Fonts: Sora (headings, `font-display`), Manrope (body), JetBrains Mono
  (codes).
- Persistence uses Netlify Database. Realtime pushes go over LiveKit data
  channels, with polling as the fallback, so the room still works without
  LiveKit.
- Never trust the client's role. Secrets (LiveKit, Mux) are only read in
  server code, and `.env.example` lists the variable names.

### Tech Stack

| Layer         | Technology                                          |
| ------------- | --------------------------------------------------- |
| Framework     | TanStack Start                                      |
| Frontend      | React 19, TanStack Router                           |
| Build         | Vite 8                                              |
| Styling       | Tailwind CSS 4, theme variables in `src/styles.css` |
| UI Components | shadcn/ui (Radix UI + Tailwind)                     |
| Toasts        | sonner                                              |
| Icons         | lucide-react                                        |
| Language      | TypeScript 6.0 (strict mode)                        |
| Deployment    | Netlify, via `@netlify/vite-plugin-tanstack-start`  |

## Directory Structure

```
├── public
│   └── favicon.ico
├── src
│   ├── components
│   │   ├── error-pages.tsx # Themed 404 and route error pages with home/retry actions.
│   │   └── ui          # shadcn/ui controls, overlays, feedback, forms, and tables.
│   ├── examples
│   │   └── validated-form.tsx # Unmounted form pattern with validation, pending, error, and success states.
│   ├── lib
│   │   └── utils.ts    # cn() helper for merging Tailwind classes.
│   ├── routes
│   │   ├── __root.tsx  # HTML shell, <head> metadata (siteName, siteDescription), the tooltip provider, and the toast container.
│   │   ├── index.tsx   # Landing page (/).
│   │   └── room.$code.tsx # Watch room (/room/ABCD-123).
│   ├── router.tsx      # Creates the router from the generated route tree.
│   └── styles.css      # Tailwind import, theme variables for light and dark mode, base styles.
├── components.json     # shadcn/ui config, used by `npx shadcn add`.
├── netlify.toml        # Build command, publish directory, dev server ports.
├── package.json
├── tsconfig.json
└── vite.config.ts      # Vite path aliases and Tailwind, Netlify, TanStack Start, React plugins.
```

`src/routeTree.gen.ts` is generated by the router plugin when the dev server or build runs. Don't edit it.

Shared framework skill source lives in `frameworks/tanstack-start-react/.claude/skills` in this repository, separate from the standalone starter. Consult the matching framework/Netlify skills when available in a generated app; don't assume the starter contains a `.claude` directory.

## Key Concepts

### File-Based Routing

Route files in `src/routes/` define pages and endpoints:

- `__root.tsx` wraps every page.
- `index.tsx` is `/`.
- `about.tsx` would be `/about`.
- `api.*.ts` files are server API endpoints. See the `tanstack-start-api-routes` skill.

### Theme Variables

Colors and corner radius are CSS variables in `src/styles.css` (`--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--radius`, and more), with a second set under `.dark`. Tailwind exposes them as classes such as `bg-primary`, `text-muted-foreground`, and `border-border`.

Set these variables for the product before you build any page. In components, use the variable classes instead of raw colors like `bg-white` or `text-gray-600`, so the whole site changes when a variable changes.

### UI Components

Ready-made components are in `src/components/ui/`. Use them before writing your own, and restyle them through the theme variables or their variants. Add more with `npx shadcn add <name>`. Show a toast by calling `toast()` from `sonner`; the container is already mounted in `__root.tsx`. `TooltipProvider` is mounted there too, so `Tooltip` works anywhere without its own provider.

| Need               | Components                                                         |
| ------------------ | ------------------------------------------------------------------ |
| Actions and status | Button, Badge, Progress, Skeleton, Alert, Sonner                   |
| Forms              | Input, Textarea, Label, Checkbox, RadioGroup, Switch, Select, Form |
| Overlays and menus | Dialog, Sheet, Popover, DropdownMenu, Tooltip                      |
| Content and layout | Card, Tabs, Accordion, Separator, Table                            |

Use `Form` with React Hook Form and the Zod resolver. Start from `src/examples/validated-form.tsx`; it isn't mounted or connected to a backend. Its required `onSubmit` callback must reject on failure. See [the form pattern](docs/forms.md) for HTTP submission and error handling.

Use Sheet for a mobile menu and DropdownMenu for short action lists. Give Dialog and Sheet an accessible title and description. Pair Checkbox, RadioGroup, Switch, and inputs with visible labels. Reserve tables for tabular data and wrap them in their provided scroll container.

### Design Choices

Set the product's palette, heading/body fonts, and layout before building its screens. Use an explicit user design when supplied; otherwise choose defaults that fit the product. Keep Basic's placeholder until you replace it with the requested product.

- Set `--font-body` and `--font-heading` in `src/styles.css`. Use `font-display` for headings when the product needs a separate heading font.
- Use `max-w-content` for a page container and `max-w-reading` for long text. Keep consistent horizontal padding, such as `px-4 sm:px-6`, and a small repeated spacing scale, such as `gap-4`, `gap-6`, and `py-12`.
- Keep one main heading per page and a clear heading order. Use muted text for supporting copy, not essential low-contrast labels.
- Preserve focus rings. Give icon-only buttons an accessible name. Ensure actions work with a keyboard and on narrow screens.
- Use short color/opacity transitions. Add `motion-reduce:transition-none` or `motion-reduce:animate-none` when adding motion; don't make essential content depend on animation.
- Provide loading, empty, error, and success states for each data-driven screen. Skeletons should follow the shape of the content they replace.

### Routing and Server Data

Router types are registered in `src/router.tsx`, so use typed `Link` destinations and route parameters. The root route supplies the themed 404 page; the router's default error component supplies the safe retry/home page, including child-route SSR failures. Use `throw notFound()` for absent records; keep unexpected failures on the error path. See [routing conventions](src/routes/README.md).

Start with route loaders and server functions for server data. Validate server-function input with `.validator(...)`, keep secrets on the server, and handle HTTP failures before returning data. See [the data-fetching pattern](docs/data-fetching.md). Add TanStack Query only when client-side caching, mutations, or background refresh are needed.

### Browser Storage

Pages are rendered on the server first, where `window` and `localStorage` don't exist. Read `localStorage` inside `useEffect`, not during render or in a `useState` initializer, or the first render will differ from the server HTML and React will log a hydration error.

## Configuration Files

| File             | Purpose                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `vite.config.ts` | Vite path aliases and Tailwind, Netlify, TanStack Start, React plugins                           |
| `tsconfig.json`  | Strict TypeScript, with the `@/*` alias for `src/*`                                              |
| `netlify.toml`   | Builds with `vite build`, publishes `dist/client`, dev server on port 8888 proxying Vite on 3000 |

## Development Commands

Use Node 22.13+ on the Node 22 line, Node 24, or Node 26+. The installed lint and test tools set this minimum alongside the framework.

```bash
npm run dev        # Start the Vite dev server on port 3000
npm run build      # Production build
npm run typecheck  # Type-check with tsc; the build doesn't
npm run lint       # Check TypeScript and React Hooks rules
npm run format:check # Check formatting
npm run format     # Format project files
npm test           # Run local form, control, and error page tests
npm run preview    # Preview the production build
```

## Conventions

- Components: PascalCase. Utilities and hooks: camelCase. Route files: kebab-case.
- Import from `src` with the `@/` alias.
- TypeScript fails on unused locals and parameters, so remove what you don't use.
- Use React hooks for state.
- Run the dev server or build once to generate route types before type-checking a fresh copy.
- Run build, typecheck, lint, format:check, and tests before reporting completion. Verify changed user flows locally; a passing build doesn't prove an interaction works.

## Application Name

Set the product's name and description in `src/routes/__root.tsx`:

- `siteName` is the page title and the title shown when the link is shared.
- `siteDescription` is the meta description and the description shown when the link is shared.

Then replace the placeholder heading and text in `src/routes/index.tsx`.
