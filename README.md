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
- [x] Dev log (staff): post-push work summary to R2, timeline, thermal receipt PNG (`dev-log:rewrite` to refresh tip)
- [x] Upstream Gemini/Vertex 429: limited long-backoff retries (proxy + client); understand mode lowers image batch concurrency
- [x] Task-envelope credits: sum-of-steps precharge + clear stale reserve after settle (avoids CREDITS_RESERVE_INVALID)
- [ ] Removed: standalone dialog page, texture pattern extract page, prompt-effect analysis page

## Sidebar / pages

- **Workspace**: main asset canvas + function sidebar; content slot switches assets ↔ presets
- **Settings**: API keys, sync, companion
- **Admin** (staff): opens `/admin`
- **Dev log** (staff, below Admin): R2 push summaries; day thermal receipt PNG; `npm run dev-log:post-push` / `dev-log:rewrite`
- **Experimental**: seam repair, generate texture, prompt arena

## Run

```bash
npm install
npm run dev
```

See `.env.example` for environment variables (including `GEMINI_PROXY_RATE_LIMIT_RETRIES`, `VITE_WORKFLOW_UNDERSTAND_IMAGE_CONCURRENCY`).
