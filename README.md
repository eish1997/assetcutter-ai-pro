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
- [x] Project Agent (U1â†’U4): dock chat, @experts (real LLM), auto mode, child-run cards, export/cold-load; optimistic send while expert LLM runs
- [x] Vertex route: default `us-central1`; Gemini 3.x models hybrid to `global` (avoids regional Publisher 404)
- [x] AI Gateway single execution door: catalog/ops route, image/Jimeng/video via Jobs; B-round ops (failure filters, auto-circuit, trend snapshots, cancel); BYOK only when explicit; no Jimeng digital-human / music-worker / client async-batch
- [x] Env acceptance profiles: `npm run env:profile:dev|prod-like` (C-round localâ†”prod contract)
- [x] Acceptance-as-production (D-round): smoke matrix skips â‰?green; credits STRICT; vision/3D/storyboard via Gateway Jobs; doc scrub of async-batch / local 9001 paths
- [x] Multi-provider Gateway routing: default jobs omit client `provider` pin; Gemini/GPT can fall back to keyed aggregators (302/AIHubMix); `guard:ai-routing` includes client pin check; prompt arena/translate via Gateway Jobs
- [x] 302 Gemini image: Google-native `/google/v1/models/{model}`; empty-candidates retry; CSRF-safe `/api/media/fetch-url`; PBR textures promote to companion assets
- [x] 3D preview PBR slot generate: override params panel (aspect/size/understand/count 1x–x4); defaults keep preset aspect/size/understand; only explicit picks override
- [x] Workflow 3D lightbox: remember camera/view; GL/scene warm cache; close captures live frame as card poster only (never overwrite `original` / full companion images); multi-version `__v__` models + per-step PBR seeds; companion grid thumbs use stable keys (no `:fp` spam)
- [x] Admin Tripo Generation Test: video/model3d wait default 660s (avoids false timeout while upstream still succeeds)
- [x] AI Gateway image timeout: Gemini/image modality jobs use 600s AbortSignal (not 120s); auth-store JSON fallback uses atomic write + UNKNOWN/EPERM retries
- [x] OpenAI `/images/edits`: undici fetch must use undici `FormData` (Node global FormData becomes `text/plain` / `[object FormData]`)
- [x] WebGPU-first RenderHost (`services/renderCore/`) with classic WebGL path for PMREM; companion shell can disable WebGPU
- [x] Agent CLI (`npm run agent:cli` / `agent:init`): HTTP Soul API + workbench asset merge (`source=agent-cli`); see `docs/Cursorä¸ŽCodex-Agent-CLIæŽ¥å…¥.md`
- [x] Companion local object keys: `{assetId}/{mediaKind}-{full|thumb}-{slot}-{id8}.{ext}` (legacy `result-*` / `image-N` read-compat only)
- [ ] Removed: standalone dialog page, texture pattern extract page, prompt-effect analysis page

## Sidebar / pages

- **Workspace**: main asset canvas + function sidebar; content slot switches assets â†?presets; Project Agent dock (right)
- **Settings**: API keys, sync, companion
- **Admin** (staff): opens `/admin`
- **Dev log** (staff, below Admin): R2 push summaries in plain Chinese; day thermal receipt PNG; `npm run dev-log:post-push` / `dev-log:rewrite`
- **Experimental**: seam repair, generate texture, prompt arena

## Run

```bash
npm install
npm run dev
```

See `.env.example` for environment variables (including `AI_WORKER_PROXY_RATE_LIMIT_RETRIES`, `VITE_WORKFLOW_UNDERSTAND_IMAGE_CONCURRENCY`).
