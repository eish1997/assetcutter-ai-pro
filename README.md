# AssetCutter AI Pro

AI-assisted asset workflow workbench (workspace, capability presets, experimental tools).

## Features

- [x] Workspace asset list + capability presets (in-slot page switch)
- [x] Justified row layout for assets and presets
- [x] Quick compose bar / chat dock
- [x] Capability sets and workflow composer
- [x] Experimental: seam repair, PBR texture generation, prompt arena
- [x] Admin console (`/admin`) for staff ops
- [ ] Removed: standalone dialog page, texture pattern extract page, prompt-effect analysis page

## Sidebar / pages

- **Workspace**: main asset canvas + function sidebar; content slot switches assets ↔ presets
- **Settings**: API keys, sync, companion
- **Experimental**: seam repair, generate texture, prompt arena
- **Admin** (staff): users, usage, credits, invites (separate from removed prompt-effect page)

## Run

```bash
npm install
npm run dev
```

See `.env.example` for environment variables.
