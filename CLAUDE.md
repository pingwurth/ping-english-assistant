# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

English listening/dictation/shadowing training app ("ping-english-assistant"). Local-first SPA for PC Web + Mobile H5. See `README.md` for overview, `AGENTS.md` for conventions.

## Commands

All commands run from `client/`:

```bash
pnpm install          # install deps (pnpm, not npm)
pnpm dev              # next dev — localhost:3000
pnpm build            # next build
pnpm test             # vitest run (node env; core/services/platform/lib/stores/app-api unit tests)
pnpm typecheck        # tsc --noEmit (script in package.json; same as AGENTS.md)
```

Server (`server/`):
```bash
./start.sh              # WhisperX alignment server (CPU)
./start.sh --device cuda  # GPU mode
```

SOE proxy (`server/`, Node.js 20+, Fastify 5):
```bash
pnpm install            # in server/
pnpm start              # soe proxy on :8788 (SOE_PROVIDER=mock|azure|tencent|iflytek, see server/.env.example)
pnpm check              # tsc --noEmit
```

No ESLint/Prettier configured. No lint or format scripts exist.

## Architecture

### SPA Inside Next.js

Next.js App Router is used as a **shell only** — all pages are `'use client'`, no SSR of business logic.

- `app/page.tsx` → renders `<StudyApp />`
- `app/[...slug]/page.tsx` → catch-all, also renders `<StudyApp />`
- `components/study-app.tsx` → `BrowserRouter` + `react-router-dom` `<Routes>`

Client-side routing via react-router-dom 7.x. Local-first: all user data in browser IndexedDB; backend is stateless.

### Six-Layer Design

| Layer | Path | Purpose |
|-------|------|---------|
| **Core** | `core/` | Platform-independent pure TS (subtitle parser, training logic, WAV encoder). Runs in Node for tests. |
| **Platform** | `platform/` | Browser implementations (HTMLAudioElement controller, getUserMedia recorder, IndexedDB storage) |
| **Services** | `services/` | AI service contracts in `contracts.ts`, mock impls in `mock/`. Factory in `index.ts`. |
| **Stores** | `stores/` | Custom `createStore` + `useSyncExternalStore`. No zustand/Pinia. |
| **Components** | `components/` | `pages/` (P0–P11), `pages/training/`, `shared/`, `ui/` (shadcn primitives) |
| **Types** | `types/` | Material, subtitle, training, progress, API types |

### Key Patterns

- **Service contracts**: `services/contracts.ts` defines `SoeService` + `MnemonicService` only. `getSoeService()` (services/index.ts) resolves mock pseudo-scoring vs. BFF-proxied real scoring from settings.json; the "mock" mnemonic actually forwards to `/api/mnemonic`. ASR/TTS/reports do NOT go through contracts: ASR is `lib/llm/asr-service.ts` + BFF routes, TTS is `pages/tts.tsx` → `POST /api/tts`. (TtsService contract & ServiceMode scaffolding removed 2026-11 as dead paths.)
- **Stores**: `createStore` + `useStore` (wraps React `useSyncExternalStore`). `material-store.ts` handles CRUD + seed data auto-injection on first load.
- **Records store** (IDB v3): per-material reads go through the `materialId` value index (`recordsStore.getEntriesByMaterial`) or primary-key prefix ranges (`getAllEntriesByPrefix`) — never full-store materialization. `train:` records are written only via `appendTrainingRecord` (stores/training-record-store.ts): keeps the latest 100 per material×mode (prune-on-write + startup sweep).
- **Player**: `SentencePlayer` abstraction in `core/player/`. Seek has drift compensation (`SEEK_DRIFT_THRESHOLD_MS = 300ms`).
- **Audio**: 16kHz mono WAV recording target for ASR/SOE compatibility. WAV encoder in `core/audio/`.
- **Subtitle parser**: SRT/LRC bilingual parser in `core/subtitle/`, zero deps, line-number-aware error reporting.

### Test Layout

Vitest 4.x, node environment only (no browser/React component tests). Test files co-located in `__tests__/` dirs:
- `core/**` — subtitle/training/audio/backup/player (`sentence-player` injects a fake PlayerController)
- `services/**` — mock & api service tests
- `platform/**` — html-player seek-calibration state machine, recorder (stubbed getUserMedia/MediaRecorder/AudioContext), hf-path, storage helpers
- `lib/**` — server-settings (HOME redirected to a temp dir per test), upload-limit
- `stores/**` — material-store cascade removal & seeding (idb falls back to in-memory in node)
- `app/api/**` — BFF route handlers imported as functions (e.g. soe settings masking round-trip)

Path alias `@/*` maps to `client/` root (defined in `tsconfig.json`).

### Directories to Ignore

- `page-prototype/` — standalone design sandbox, separate deps, no tests
- `docs/` — Chinese-language design docs (tech selection, architecture, prototype)
- `.qoder/` — other AI assistant config (`.mimocode/` never existed in this repo's history; stale claim removed 2026-11)
