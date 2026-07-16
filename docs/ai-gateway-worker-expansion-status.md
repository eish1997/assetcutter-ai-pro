# AI Gateway Worker Expansion Status

Updated: 2026-07-13

## Naming

- `ai-gateway` is the product gateway for all commercial AI jobs.
- `ai-worker-proxy` is now a legacy Gemini adapter, not the place for new video, music, or 3D providers.
- `provider keys` are server-side credentials managed by admins. They are never sent to normal users.
- Large generated assets stay local-first through the companion flow. Cloud job records keep only lightweight URLs, manifests, status, and billing metadata.

## Current Worker Matrix

| Worker | Status | Adapter |
| --- | --- | --- |
| `text-worker` | active | `ai-worker-proxy` |
| `image-worker` | active | `ai-worker-proxy` |
| `model3d-worker` | active | `tripo-openapi` |
| `video-worker` | planned | none |
| `music-worker` | planned | none |

## Tripo Production Path

The preferred production path is:

```text
frontend workflow / asset set
  -> POST /api/ai/jobs
  -> auth-api credits and auth
  -> ai-gateway model3d-worker
  -> tripo-openapi adapter
  -> Tripo OpenAPI task
  -> AI job status and lightweight artifacts
  -> local companion persistence
```

BYOK Tripo remains as a compatibility fallback. If a user has a local Tripo key, the old BYOK proxy can still be used. If no local key exists, workflow and asset-set 3D generation use the admin-managed provider key pool.

## Provider Key Pool

Supported now:

- Admin UI: `/admin/ai-provider-keys`
- Postgres store: `ai_gateway_provider_keys`
- JSON fallback for local/dev
- Env fallback: `TRIPO_API_KEY` / `TRIPO_API_KEYS`
- Redacted listing
- Same-priority rotation
- Per-key RPM admission in the current server process
- Runtime status: last used, last error, cooldown

Still future work:

- Cross-instance RPM state if the service scales beyond one Render instance.
- Vendor-specific hard cancel where supported.

## Operations

Supported now:

- Admin AI jobs overview and provider/model health summary.
- Provider/model pause rules and model overrides.
- One-click ops actions from suggestions.
- Automatic provider pause on clear 429/5xx handoff failures.
- `healthz.aiGateway` reports workers, adapters, key store, ops-control store, and auto-circuit state.

## Safety Boundaries

- API keys are server-side only.
- Image base64 inputs for 3D jobs are transient. The persistent job store redacts them.
- Tripo model file fetching in platform mode goes through `/api/ai/provider-artifacts/tripo/fetch-file`, which uses the provider key pool server-side.
- Do not add new modalities to `ai-worker-proxy`; add a worker and provider adapter under `server/ai-gateway/`.
