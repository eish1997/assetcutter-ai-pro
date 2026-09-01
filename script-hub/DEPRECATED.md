# 已废弃（Deprecated）

**自 2026-06-30 起，本目录及主仓 `server/script-hub-*` 不再作为 Script Hub 真源。**

## 真源仓库

**Creative Production Runtime / ScriptHub**

- 路径：`F:/AI/ScriptHub`
- 文档入口：`F:/AI/ScriptHub/doc/00-Documentation-Index.md`
- 迁移与启动：`F:/AI/ScriptHub/doc/23-Project-Migration-Handoff.md`

## 本目录状态

主仓内 `script-hub/` + `script-hub-api`（:9101 / :5174）为 **2026-05 Sprint 0～1 半成品**，产品方向已收敛到独立仓（Hermes 工具中心 + Tool Bridge + Maya Connector）。

保留代码仅供历史参考；**新功能、联调、Agent 集成一律在独立仓推进**。

## 主仓仍待迁移的衔接点

| 模块 | 说明 |
|------|------|
| `companion-desktop` 第五导航 `scripts` | `scriptHubUrl` 待改指向独立仓 dev/prod |
| `agent-script-hub-client.cjs` | `ac.script_hub.*` → 独立仓 Tool Bridge（见 ScriptHub `doc/24-Companion-Integration.md`） |
| `scripts/agent-p1-smoke.mjs` | Script Hub 段已标记 skip |
| `docs/archived/Script-Hub-开发规格.md` | 已废弃，见独立仓 `doc/` |
