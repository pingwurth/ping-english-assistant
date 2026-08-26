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
pnpm test             # vitest run (core/ and services/mock/ only, node env)
npx tsc --noEmit      # typecheck (no dedicated script)
```

Server (`server/`):
```bash
./start.sh              # WhisperX alignment server (CPU)
./start.sh --device cuda  # GPU mode
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

- **Service contracts**: Interfaces in `services/contracts.ts` (ASR, SOE, TTS, Reports). Mocks always returned now; future `NEXT_PUBLIC_SERVICE_MODE` env var switches to real API.
- **Stores**: `createStore` + `useStore` (wraps React `useSyncExternalStore`). `material-store.ts` handles CRUD + seed data auto-injection on first load.
- **Player**: `SentencePlayer` abstraction in `core/player/`. Seek has drift compensation (`SEEK_DRIFT_THRESHOLD_MS = 300ms`).
- **Audio**: 16kHz mono WAV recording target for ASR/SOE compatibility. WAV encoder in `core/audio/`.
- **Subtitle parser**: SRT/LRC bilingual parser in `core/subtitle/`, zero deps, line-number-aware error reporting.

### Test Layout

Vitest 4.x, node environment only. Test files co-located in `__tests__/` dirs:
- `core/subtitle/__tests__/`, `core/training/__tests__/`, `core/audio/__tests__/`
- `services/mock/__tests__/`

Path alias `@/*` maps to `client/` root (defined in `tsconfig.json`).

### Directories to Ignore

- `page-prototype/` — standalone design sandbox, separate deps, no tests
- `docs/` — Chinese-language design docs (tech selection, architecture, prototype)
- `.mimocode/`, `.qoder/` — other AI assistant configs
