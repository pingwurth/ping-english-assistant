# AGENTS.md — ping-english-assistant

English listening/dictation/shadowing training app. Local-first SPA for PC Web + Mobile H5.

## Tech Stack

- **client/** — Next.js 16.3 + React 19 + TypeScript 5.7.3 + Tailwind CSS 4 + shadcn/ui (base-nova). `client/app/api/*` Route Handlers act as a **BFF** (LLM / ASR / TTS / translate / mnemonic / SOE forwarding), reading local config from `~/.ping-eng/settings.json`
- **server/** — Python FastAPI + faster-whisper (转写, port 8766) + WhisperX (对齐, port 8765); **plus** a Node.js Fastify 5 stateless SOE pronunciation-scoring proxy (contract ②, port 8788) with `mock | azure | tencent | iflytek` providers
- **page-prototype/** — standalone Next.js prototype sandbox (no tests, separate deps, for design iteration only)

State management: custom `createStore` + `useSyncExternalStore` (zero external deps). No zustand, no Pinia.

## Commands

All commands run from `client/`:

```bash
pnpm install          # install deps (pnpm is the package manager, not npm)
pnpm test             # vitest run (node env; core/services/platform/lib/stores/app-api unit tests)
pnpm dev              # next dev — localhost:3000
pnpm build            # next build
```

No typecheck script — use `npx tsc --noEmit` or rely on Next.js build-time checks.

Tests are **node-environment unit tests only** (vitest). No browser/React component tests exist.
Test files live inside `__tests__/` dirs co-located with source across `core/**`, `services/**`, `platform/**`, `lib/**`, `stores/**`, and `app/api/**`.

Backend commands (not part of the `client/` workflow):

```bash
cd server && pnpm install && cp .env.example .env && pnpm start   # Fastify SOE proxy → :8788
cd server && pnpm test                                            # provider / auth / mapper unit tests
cd server && ./start.sh                                           # Python transcribe (:8766) + align (:8765)
```

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
- `kokoro-tts.ts` / `kokoro-worker.ts` / `kokoro-protocol.ts` — Kokoro-82M TTS running in a Web Worker (`kokoro-js` + `@huggingface/transformers`)
- `storage/idb.ts` — **hand-written Promise-based IndexedDB wrapper (the `idb` package is NOT used)**; three stores `materials` / `blobs` / `records`, `DB_VERSION = 3` (`records.materialId` index); only an unavailable DB open falls back to memory — per-operation transaction failures do not silently switch the whole app
- `storage/schema.ts` — `MaterialRecord` shape + `RECORD_KEYS` key-prefix conventions
- `storage/prefs.ts` — localStorage preference adapter
- `storage/backup.ts` — export/import (pairs with `core/backup/` + `fflate` zip)

### Services layer (`services/`)

Interface contracts in `contracts.ts`, mock implementations in `mock/`, BFF client implementations in `api/`. Factory in `index.ts` currently **always returns mocks** (`NEXT_PUBLIC_SERVICE_MODE` is only reserved in comments).

Live contracts: SOE (pronunciation scoring, ②, via `/api/soe/evaluate` BFF → Fastify proxy), TTS (⑥⑦), Mnemonic (生词助记). Contracts ①③④ (ASR + shadowing/recitation reports) were **removed** — those flows now call the BFF directly from the page (`lib/llm/asr-service.ts`, `pages/training/recording-review.tsx`). SSE event types are still used.

### Stores (`stores/`)

Custom lightweight stores using `createStore` + `useStore` (React `useSyncExternalStore`). No external state library. `material-store.ts` handles material CRUD + seed data injection.

### Components (`components/`)

- `pages/` — page components (library, collection, favorites, import, player, training-center, puzzle, dictation, settings, tts, transcribe, vocabulary, mnemonic, placeholder)
- `pages/training/` — shadowing, recitation, read-aloud, recording-review
- `shared/` — reusable business components (shell layout, player sub-components, record button, score panel, translate/subtitle drawers, transcribe dialog, model-config dialogs)
- `ui/` — shadcn/ui primitives (badge, button, card, dialog, input, progress, separator, sheet, switch, tabs, textarea)

### BFF layer (`client/app/api/` + `client/lib/`)

Next.js Route Handlers keep cloud API keys out of the browser. They read `~/.ping-eng/settings.json` (`lib/server-settings.ts`, plain JSON file — no database) and forward upstream, passing per-request credentials through a multipart `creds` field for the SOE proxy.

- `app/api/` — `settings/{llm-configs,soe,kokoro,local-services}`, `soe/{evaluate,health}`, `transcribe`, `transcribe/local`, `tts`, `translate`, `mnemonic`, `models`, `hf/[...path]`
- `lib/llm/` — LangChain `ChatOpenAI` factory + ASR/TTS/translate/mnemonic services; providers `dashscope` (Qwen) / `mimo`, unknown providers fall back to OpenAI-compatible
- `lib/service-endpoints.ts` — **the only place allowed to hold endpoint paths / default models / default service URLs**; never hardcode a baseUrl elsewhere

### Data model (`types/`)

- `material.ts` — learning material with media ref + subtitle metadata (+ `MaterialCollection`)
- `subtitle.ts` — parsed sentence structures with timestamps
- `training.ts` — union type for 5 training modes (puzzle, dictation, read-aloud, shadowing/recitation report)
- `progress.ts` — learning progress + favorites
- `api.ts` — API contract types (SSE events, request/response shapes)
- `vocabulary.ts` / `mnemonic.ts` / `note.ts` — 生词本、LLM 助记卡片（snake_case, mirrors model output）、句子笔记

## Conventions

- **Path alias**: `@/*` maps to `client/` root (configured in tsconfig.json + vitest.config.mts)
- **Package manager**: pnpm (lockfile at `client/pnpm-lock.yaml`)
- **UI library**: shadcn/ui with base-nova style, Lucide icons, Tailwind CSS 4
- **Routing**: react-router-dom inside Next.js SPA shell — routes defined in `components/study-app.tsx`
- **Style**: Tailwind utility classes + `cn()` helper (`lib/utils.ts` using clsx + tailwind-merge)
- **Docs language**: Chinese (zh-CN) for code comments, commit messages, and docs
- **Architecture docs**: `docs/系统架构设计.md` is the source of truth for **API contracts (§3.3 编号②⑤⑥⑦⑧), data models (§4) and the ADR rationale (1–7)** — but its deployment topology (uni-app Vue 3 three-end build, Pinia, conditional-compilation adapters, one Fastify backend as the single cloud gateway) is the **planned production shape and does NOT match the current implementation** (`client/` is a Next.js SPA with a custom store and a Next.js BFF; there is no mini-program end). Read it for contracts/models/rationale, verify topology against code.
- **Service contracts**: `services/contracts.ts` is the interface truth — `types/api.ts` defines the data shapes
- **Local-first**: all user data persists in browser IndexedDB; backend is stateless when it ships
- **No lint/format scripts**: no ESLint or Prettier configured; follow existing code style

## Gotchas

- `next.config.mjs` has `ignoreBuildErrors: true` for TypeScript — build won't catch type errors
- `components/study-app.tsx` is the single place where client routes live; `next dev` may rewrite the `<!-- BEGIN:nextjs-agent-rules -->` block in `client/AGENTS.md` — keep that auto-managed block in diffs
- `page-prototype/` is a design sandbox with its own `package.json` and `node_modules` — changes there don't affect `client/`
- Seed data auto-injects on first load (`data/seed.ts`) — 4 sample materials, each sharing the same 5 `seedSentences`; clearing IndexedDB re-triggers injection
- Recorder outputs 16kHz mono WAV specifically for ASR/SOE compatibility (architecture ADR-5)
- Player seek has drift compensation (SEEK_DRIFT_THRESHOLD_MS = 300ms) — don't remove this
- When forwarding to the Fastify SOE proxy, **append text fields (`refText`/`evalMode`/`provider`/`creds`) before `audio`** — `@fastify/multipart`'s `req.file()` only guarantees fields preceding the file part
- `records` store is shared across business types by key prefix; deleting by prefix is dangerous (`progress:` must match exactly, otherwise `m-1` also hits `m-10`). See `removeMaterial()` in `stores/material-store.ts` for the correct pattern
- `~/.ping-eng/settings.json` stores plaintext API keys; both list and single-config GET responses mask keys, and update paths treat an unchanged mask as “keep the stored real key”
- `next.config.mjs` sets `allowedDevOrigins: ['192.168.110.*']` — required for phone-over-LAN H5 debugging; update it when the network segment changes
- `client/package.json` also ships Vercel AI SDK (`ai`, `@ai-sdk/openai`), but the LLM path actually uses **LangChain** (`@langchain/openai` in `lib/llm/factory.ts`) — don't mix the two stacks
