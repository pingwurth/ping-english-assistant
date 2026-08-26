# AGENTS.md — ping-english-assistant

English listening/dictation/shadowing training app. Local-first SPA for PC Web + Mobile H5.

## Tech Stack

- **client/** — Next.js 16.3 + React 19 + TypeScript 5.7.3 + Tailwind CSS 4 + shadcn/ui (base-nova)
- **server/** — Python FastAPI + faster-whisper (转写, port 8766) + WhisperX (对齐, port 8765)
- **page-prototype/** — standalone Next.js prototype sandbox (no tests, separate deps, for design iteration only)

State management: custom `createStore` + `useSyncExternalStore` (zero external deps). No zustand, no Pinia.

## Commands

All commands run from `client/`:

```bash
pnpm install          # install deps (pnpm is the package manager, not npm)
pnpm test             # vitest run — tests core/ and services/mock/ only (node env)
pnpm dev              # next dev — localhost:3000
pnpm build            # next build
```

No typecheck script — use `npx tsc --noEmit` or rely on Next.js build-time checks.

Tests are **core-layer unit tests only** (vitest, node environment). No browser/React tests exist.
Test files live inside `__tests__/` dirs co-located with source: `core/subtitle/__tests__/`, `core/training/__tests__/`, `core/audio/__tests__/`, `services/mock/__tests__/`.

## Architecture

### SPA inside Next.js

This is a **single-page app** using Next.js App Router as a shell. Routing is client-side:

- `app/page.tsx` → renders `<StudyApp />`
- `app/[...slug]/page.tsx` → catch-all that also renders `<StudyApp />`
- `components/study-app.tsx` → `BrowserRouter` + `react-router-dom` `<Routes>`

All pages are `'use client'` components. There is no server-side rendering of business logic.

### Core layer (`core/`)

Platform-independent pure TS. Runs in Node (vitest) without DOM. Contains:
- `subtitle/` — SRT/LRC bilingual parser (zero deps, line-number-aware error reporting)
- `training/` — dictation-diff, puzzle logic, scoring, session management
- `player/` — `SentencePlayer` abstraction + types
- `audio/` — WAV encoder (16kHz mono target for ASR/SOE)

### Platform layer (`platform/`)

Browser-specific implementations:
- `html-player.ts` — `HtmlPlayerController` (HTMLAudioElement/HTMLVideoElement, seek calibration, rAF progress)
- `recorder.ts` — `WebRecorder` (getUserMedia → MediaRecorder → 16kHz WAV via OfflineAudioContext)
- `storage/` — IndexedDB (idb) + localStorage adapters

### Services layer (`services/`)

Interface contracts in `contracts.ts`, mock implementations in `mock/`. Factory in `index.ts` returns mocks always (future: `NEXT_PUBLIC_SERVICE_MODE` env var to switch to real API).

Services: ASR (speech-to-text), SOE (pronunciation scoring), TTS (text-to-speech), Reports (SSE streaming LLM analysis).

### Stores (`stores/`)

Custom lightweight stores using `createStore` + `useStore` (React `useSyncExternalStore`). No external state library. `material-store.ts` handles material CRUD + seed data injection.

### Components (`components/`)

- `pages/` — P0–P11 page components (library, import, player, training modes, settings, tts, etc.)
- `pages/training/` — shadowing, recitation, read-aloud
- `shared/` — reusable business components (shell layout, player sub-components, record button, score panel)
- `ui/` — shadcn/ui primitives (badge, button, card, input, progress, separator, textarea)

### Data model (`types/`)

- `material.ts` — learning material with media ref + subtitle metadata
- `subtitle.ts` — parsed sentence structures with timestamps
- `training.ts` — union type for 5 training modes (puzzle, dictation, read-aloud, shadowing/recitation report)
- `progress.ts` — learning progress + favorites
- `api.ts` — API contract types (SSE events, request/response shapes)

## Conventions

- **Path alias**: `@/*` maps to `client/` root (configured in tsconfig.json + vitest.config.mts)
- **Package manager**: pnpm (lockfile at `client/pnpm-lock.yaml`)
- **UI library**: shadcn/ui with base-nova style, Lucide icons, Tailwind CSS 4
- **Routing**: react-router-dom inside Next.js SPA shell — routes defined in `components/study-app.tsx`
- **Style**: Tailwind utility classes + `cn()` helper (`lib/utils.ts` using clsx + tailwind-merge)
- **Docs language**: Chinese (zh-CN) for code comments, commit messages, and docs
- **Architecture docs**: `docs/系统架构设计.md` is the authoritative architecture reference (ADRs 1–7)
- **Service contracts**: `services/contracts.ts` is the interface truth — `types/api.ts` defines the data shapes
- **Local-first**: all user data persists in browser IndexedDB; backend is stateless when it ships
- **No lint/format scripts**: no ESLint or Prettier configured; follow existing code style

## Gotchas

- `next.config.mjs` has `ignoreBuildErrors: true` for TypeScript — build won't catch type errors
- `components/study-app.tsx` is minified into a single line — expand before editing
- `page-prototype/` is a design sandbox with its own `package.json` and `node_modules` — changes there don't affect `client/`
- Seed data auto-injects on first load (`data/seed.ts`) — 4 sample materials with 5 sentences each
- Recorder outputs 16kHz mono WAV specifically for ASR/SOE compatibility (architecture ADR-5)
- Player seek has drift compensation (SEEK_DRIFT_THRESHOLD_MS = 300ms) — don't remove this
