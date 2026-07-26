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
- [x] Project Agent (U1→U4): dock chat, @experts (real LLM), auto mode, child-run cards, export/cold-load; optimistic send while expert LLM runs
- [x] Vertex route: default `us-central1`; Gemini 3.x models hybrid to `global` (avoids regional Publisher 404)
- [x] AI Gateway single execution door: catalog/ops route, image/Jimeng/video via Jobs; B-round ops (failure filters, auto-circuit, trend snapshots, cancel); BYOK only when explicit; no Jimeng digital-human / music-worker / client async-batch
- [x] Env acceptance profiles: `npm run env:profile:dev|prod-like` (C-round local↔prod contract)
- [x] Acceptance-as-production (D-round): smoke matrix skips ≠ green; credits STRICT; vision/3D/storyboard via Gateway Jobs; doc scrub of async-batch / local 9001 paths
- [x] Multi-provider Gateway routing: default jobs omit client `provider` pin; Gemini/GPT can fall back to keyed aggregators (302/AIHubMix); `guard:ai-routing` includes client pin check; prompt arena/translate via Gateway Jobs
- [x] WebGPU-first RenderHost (`services/renderCore/`) with classic WebGL path for PMREM; companion shell can disable WebGPU
- [x] Agent CLI (`npm run agent:cli` / `agent:init`): HTTP Soul API + workbench asset merge (`source=agent-cli`); see `docs/Cursor与Codex-Agent-CLI接入.md`
- [ ] Removed: standalone dialog page, texture pattern extract page, prompt-effect analysis page

## Sidebar / pages

- **Workspace**: main asset canvas + function sidebar; content slot switches assets ↔ presets; Project Agent dock (right)
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
