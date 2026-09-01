# AssetCutter AI Pro Agent Rules

This file is the Codex-compatible companion to `.cursor/rules/**`.
Keep the original Cursor rules in place. When this file and `.cursor/rules`
cover the same topic, treat this file as the quick operational version and
read the linked Cursor rule for detail.

## Rule Sources

- Cursor originals: `.cursor/rules/*.mdc`
- Main Cursor index: `.cursor/rules/index.mdc`
- Architecture notes may be referenced from `docs/`
- `docs/` root is only 错题本 / 交接 / the shell charter / ADRs / closure list.
  Historical plans are in `docs/archived/` and are not default reading.
- If a task touches an area below, read the corresponding source before editing.

## General Engineering

- Make surgical changes. Touch only files needed for the user request.
- Prefer existing patterns, helpers, stores, and components over new abstractions.
- Do not refactor adjacent code unless it is necessary to complete the task.
- State important assumptions when behavior is ambiguous.
- Verify changes with the smallest relevant build/test command.
- Use English commit messages.

## Frontend UI

- Do not add native `<select>` in `tsx/jsx`.
- Use `components/ui/CustomDropdown.tsx` or an existing custom dropdown pattern.
- For UI work, preserve the current product style and density.
- Avoid visible instructional copy unless the feature specifically needs it.
- Visual tokens: `design-system/MASTER.md` (page overrides in `design-system/pages/`). Do not replace with a generic landing-page palette. Aesthetic pass uses skill `frontend-design`; post-change audit uses `web-design-guidelines`.

Source: `.cursor/rules/dropdown-ui-style.mdc`

## Client Persistence

- Do not call `localStorage` or `sessionStorage` directly in new code.
- Use `services/clientPersist.ts` helpers such as `readLocalJson`,
  `writeLocalJson`, scoped keys, or the relevant project store.
- Core workspace/project data must be recoverable from cloud-backed stores;
  local storage is only cache or device-level preference.

Sources:
- `.cursor/rules/client-persist.mdc`
- `.cursor/rules/workspace-data.mdc`

## Cross-Device URLs

- Do not persist hard-coded `localhost`, `127.0.0.1`, LAN IPs, or machine-specific
  URLs for user assets or project data.
- Prefer relative paths or public/cloud URLs for persisted resource references.
- When rendering site-local API resources, resolve relative `/api/...` paths
  against `window.location.origin` at render/request time.
- For capability previews, prefer existing helpers such as
  `resolveCapabilityPreviewSrc()` or `CapabilityPreviewImg`.

Source: `.cursor/rules/cross-device-availability.mdc`

## Workflow AI Routing

When changing user-reachable AI dispatch, workflow task branching, provider
selection, or new AI capability classes:

- Update `services/workflowRunTaskBranch.ts` if `WorkflowSection.runTask`
  branch order or dispatch categories change.
- Update `services/workflowAiPickIndex.ts` if nodes, edges, or cargo rows change.
- Run relevant tests:
  - `npx vitest run tests/workflowRunTaskBranch.test.ts`
  - `npx vitest run tests/workflowAiPickIndex.test.ts`
- Check `docs/多模型可运营改造计划.md` §1.4
  when adding suppliers, modalities, or provider bypasses.

Source: `.cursor/rules/workflow-ai-pick-index.mdc`

## Workflow Timeline, Audit, and Overlay Rings

When changing workflow step timelines, audit-derived events, overlay snapshots,
or the corresponding mappings:

- Review `docs/工作流步骤时间线审计与Overlay快照.md`.
- Keep related modules aligned:
  - `workflowStepTimeline.ts`
  - `workflowAuditEvents.ts`
  - `workflowOverlaySnapshots.ts`
  - `workflowOverlayDraftCompare.ts`
  - `workflowMirrorPreferenceScope.ts`
  - `WorkflowSection`
  - `ArchivedDetailModal`
- Run `npm run test:workflow-rings` when the change touches these rings.

Source: `.cursor/rules/index.mdc`

## Local Services and Companion

- If backend service code changes, restart the affected local service in the
  same session when practical.
- If runtime code under `companion-desktop/` or `local-companion/` changes,
  run from the repo root:

```powershell
npm run restart:local-companion
```

- Pure documentation changes in those directories do not require restart.
- Product shape of the local shell (building / tenants / concierge):
  `docs/架构宪章-本地壳大楼租户.md`. Do not reopen that metaphor in implementation tasks.
  dsh plugin vs shell: charter §3.11 — only Cordis keys; do not Cordis-ize the lobby,
  fork harness, or treat floor/store hard-fit as plugins. Pack the shell (asar files +
  extraResources) before expanding keys.

Sources:
- `.cursor/rules/auto-restart-services.mdc`
- `.cursor/rules/companion-desktop-restart.mdc`

## Companion release pack

When the user asks to **打包** / pack the local companion or shell tool ZIPs for
admin upload, read `.cursor/skills/companion-release-pack/SKILL.md` and run:

```powershell
npm run companion-desktop:release:pack
```

Outputs: `companion-desktop/dist-out-<verNoDots>/installer/` and
`dist-out-shell-tools/`. Do not commit those directories.

## Git and Deploy

- Commit messages must be English.
- This repository may require Git proxy settings for GitHub pushes:

```powershell
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
```

- Preserve user changes. Never reset, checkout, or revert unrelated work unless
  the user explicitly asks.
- After a successful `git push`, **immediately** run `npm run dev-log:post-push`
  (summarize since last tip and upload to R2). Do not claim the push task is done
  until post-push has been attempted. Do not commit dev-log JSON into the repo.
  Skip only if the user says so or `SKIP_DEV_LOG=1`. A Cursor hook
  (`.cursor/hooks/dev-log-after-push.mjs`) also auto-runs after successful push;
  still verify or re-run if unsure. Receipt export prefers PNG (thermal style).
  Entry: sidebar below Admin.

Sources:
- `.cursor/rules/git-push.mdc` (`alwaysApply`)
- `.cursor/rules/dev-log-r2.mdc` (`alwaysApply`)
- `.cursor/hooks.json` → `afterShellExecution`

## Session Notes

- If a reusable bug/fix is discovered, update `docs/错题本.md`.
- If architecture, directory conventions, or handoff-relevant context changes,
  update `docs/交接文档.md`.
- Avoid duplicate notes; append only when there is new durable information.

Source: `.cursor/rules/session-handoff-log.mdc`

## Plain-Language Trigger

If the user starts with `虾米`, interpret the following text as a plain-language
implementation request: clarify only when necessary, then implement directly.

Source: `.cursor/rules/xiami-plain-language.mdc`

## Executable agent plans

When writing or revising a long implementation plan for another agent to loop on,
read `.cursor/skills/agent-executable-dev-plan/SKILL.md`. The plan must pass
goal-fit, agent-loop fit, and minimal-human-verification before execution.

## 3D and Rendering

For Three.js scenes, cameras, geometry, materials, shaders, loaders, textures,
interaction, animation, or postprocessing, prefer proven existing project
patterns and relevant Three.js references. Verify rendered output when changing
visible 3D behavior.

Source: `.cursor/rules/index.mdc`
