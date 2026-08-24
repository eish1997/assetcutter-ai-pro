# AssetCutter AI Pro

AI-assisted asset workflow workbench (workspace, capability presets, experimental tools).

## Features

- [x] Workspace asset list + capability presets (in-slot page switch)
- [x] Justified row layout for assets and presets
- [x] Quick compose bar / chat dock
- [x] Capability sets and workflow composer
- [x] Experimental: seam repair, PBR texture generation, prompt arena
- [x] Admin console (`/admin`) for staff ops
- [x] Compose-style dropdowns / sidebar chips (aligned with quick compose bar)
- [x] Dev log (staff): plain-language day receipt + post-push R2 timeline (`dev-log:rewrite` to refresh tip)
- [x] Production lazy-chunk recovery: exclude `/assets` from SPA rewrite; retry/reload on stale preview chunks
- [x] Upstream Gemini/Vertex 429: limited long-backoff retries (proxy + client); understand mode lowers image batch concurrency
- [x] Task-envelope credits: sum-of-steps precharge + clear stale reserve after settle (avoids CREDITS_RESERVE_INVALID)
- [x] Credit reserve reuse: an existing envelope (e.g. 149) covers a later smaller step (e.g. 134) instead of idempotency conflict
- [x] Project Agent (U1?U4): dock chat, @experts (real LLM), auto mode, child-run cards, export/cold-load; optimistic send while expert LLM runs
- [x] Vertex route: default `us-central1`; Gemini 3.x models hybrid to `global` (avoids regional Publisher 404)
- [x] AI Gateway single execution door: catalog/ops route, image/Jimeng/video via Jobs; B-round ops (failure filters, auto-circuit, trend snapshots, cancel); BYOK when Settings enables a user API-key outlet (browser-direct, no site credits); Vertex site proxy still bills; no Jimeng digital-human / music-worker / client async-batch
- [x] Env acceptance profiles: `npm run env:profile:dev|prod-like` (C-round local?prod contract)
- [x] Acceptance-as-production (D-round): smoke matrix skips ??green; credits STRICT; vision/3D/storyboard via Gateway Jobs; doc scrub of async-batch / local 9001 paths
- [x] Multi-provider Gateway routing: default jobs omit client `provider` pin; Gemini/GPT can fall back to keyed aggregators (302/AIHubMix); `guard:ai-routing` includes client pin check; prompt arena/translate via Gateway Jobs
- [x] 302 Gemini image: Google-native `/google/v1/models/{model}`; empty-candidates retry; CSRF-safe `/api/media/fetch-url`; PBR textures promote to companion assets
- [x] Fix workspace asset grid staircase (drop-host `relative` no longer overrides justified `absolute`); PBR promote prefers companion import; media/archive fetch timeout default 120s
- [x] PBR texture assets stay out of the workspace grid after re-login: heal `hiddenInGrid`+capability+`pbrHostAssetId` on sanitize; also hide by host slot refs / label / paramsSnapshot
- [x] Workspace grid uses progressive thumbs for http(s)/blob (not full-res `<img>`), preventing UV-atlas decode black screens
- [x] PBR black-screen hardening: stale richer companion snapshots do not resurrect deleted assets; tighter grid thumb decode limits; strip nested PBR dataUrls only when resolvable; PBR textures still hydrate for 3D panel (stay hidden from grid)
- [x] 3D preview PBR slot generate: override params panel (aspect/size/understand/count 1x?4); defaults keep preset aspect/size/understand; only explicit picks override
- [x] Workflow 3D lightbox: remember camera/view; GL/scene warm cache; close captures live frame into the step poster pair (`image-full` + `image-thumb`, not `originalCompanionKey` / `model-full`); multi-version `__v__` models + per-step PBR seeds; side-tree/strip thumbs refresh on close
- [x] Admin Tripo Generation Test: video/model3d wait default 660s (avoids false timeout while upstream still succeeds)
- [x] AI Gateway image timeout: Gemini/image modality jobs use 600s AbortSignal (not 120s); auth-store JSON fallback uses atomic write + UNKNOWN/EPERM retries
- [x] OpenAI `/images/edits`: undici fetch must use undici `FormData` (Node global FormData becomes `text/plain` / `[object FormData]`)
- [x] WebGPU-first RenderHost (`services/renderCore/`) with classic WebGL path for PMREM; companion shell can disable WebGPU
- [x] Agent CLI (`npm run agent:cli` / `agent:init`): HTTP Soul API + workbench asset merge (`source=agent-cli`); see `docs/Cursor?Codex-Agent-CLI??.md`
- [x] Companion Copilot Body MCP (`ac.*`): `create_text_asset` / `create_image_asset` (prefer `localPath` for images; no large base64 in tool args); confirm cards dismiss after approve/reject
- [x] Shell tools: local authored drafts + hot reload, Copilot `ac.shell_tool.*`, ZIP export/import, submit-for-review + admin approval; industrial tool-window UI (titlebar-only title, unified window controls)
- [x] Companion local object keys: `{assetId}/{mediaKind}-{full|thumb}-{slot}-{id8}.{ext}` for generate and load; open project copies legacy `result-*` / `original-image-*` / `preview-*` / `thumb-mi|th-*` onto canonical keys and rewrites JSON; grid cards use `image-thumb` (not hashed disk cache)
- [x] Companion connection cards: software treated as unknown by default; `softwareBridgeRegistry` + verified strategies; local versions on the card
- [x] Companion Workflow objects (draft / version / pin / repair); Maya run uses the connected Command Port from the connection page (no repo-root smoke as the product path)
- [x] Companion Copilot product UI: runtime awareness bar, task cards, desktop observe
- [ ] Removed: standalone dialog page, texture pattern extract page, prompt-effect analysis page

## Sidebar / pages

- **Workspace**: main asset canvas + function sidebar; content slot switches assets ??presets; Project Agent dock (right)
- **Settings**: API keys, sync, companion
- **Admin** (staff): opens `/admin`
- **Dev log** (staff, below Admin): R2 push summaries in plain Chinese; day thermal receipt PNG; `npm run dev-log:post-push` / `dev-log:rewrite`
- **Experimental**: seam repair, generate texture, prompt arena

## Run

```bash
npm install
npm run dev
npm run restart:local-stack   # vite:3000 auth:9100 companion:18765 sam:18081 gemini:9002
```

See `.env.example` for environment variables (including `AI_WORKER_PROXY_RATE_LIMIT_RETRIES`, `VITE_WORKFLOW_UNDERSTAND_IMAGE_CONCURRENCY`).
