# Cursor / Codex：Agent CLI 一发入魂

外部 Agent **只走 CLI**（云端 API）。MCP 产品面已移除。

## 两步

```powershell
# 1) 确保 auth-api 在 9100（或设置 ASSETCUTTER_API_BASE）
npm run dev:auth-backend

# 2) 安装 + 浏览器登录一次
npm run agent:init
```

## 验收话术（粘贴给 Cursor）

> 用 AssetCutter Agent CLI：先 whoami，再创建一个测试项目，run 一句文生图 prompt，然后 assets list 与 audit 确认资产和审计都在。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run agent:cli -- login` | 设备码登录，保存 PAT |
| `npm run agent:cli -- whoami` | 当前用户 |
| `npm run agent:cli -- project create "名"` | 建项目 |
| `npm run agent:cli -- run --prompt "..."` | 生成并写入平台资产列表 |
| `npm run agent:cli -- assets list` | 列资产 |
| `npm run agent:cli -- audit` | 查审计 |

Token 路径：`~/.assetcutter/agent-cli/credentials.json`（勿提交 Git）。

## 工作台可见性

CLI 创建的项目（`agp_*`）与资产会进入**网页工作台**：

1. 用**同一账号**登录网站（会话 Cookie）
2. 侧栏项目列表会合并 Agent CLI 项目（置顶）
3. 打开该项目后，网格加载对应 `agent-cli` 资产

CLI 库仍是权威源；工作台是给人看与承接产出的界面。

## 硬隔离

- CLI / Soul API **禁止**依赖 `agent-body-mcp`、`codex-mcp-config`、`:19120`
- 桌面伴侣可继续做本机分割等非 Agent 协议能力
