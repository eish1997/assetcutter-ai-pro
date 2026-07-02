# Script Hub（`scripts.adrazzo.com`）

> **⚠️ 已废弃（2026-06-30）**  
> 本目录与主仓 `server/script-hub-api.js` 等为半成品，**不再维护**。  
> **真源**：`F:/AI/ScriptHub`（Creative Production Runtime）— 见 [`DEPRECATED.md`](./DEPRECATED.md) 与 `docs/Script-Hub-开发规格.md` 文首说明。

---

独立 Vite 应用，源码在 `**script-hub/**`，与根目录工作台 **分开构建**。

**第一版公网入口（已锁定）**：`https://scripts.adrazzo.com`（独立子域；业务 API 同源 `/api` 反代，见 `docs/Script-Hub-开发规格.md`）。

**UI**：与主站工作台对齐 — 见根目录 `index.html` 中 CSS 变量与字体；`script-hub/src/index.css` 使用同名 `--background` / `--surface-*` / `--accent-blue` 及 `sh-*` 工具类。

**用户偏好（P0）**：`GET/PATCH /api/me/script-hub-prefs` — 按账号云同步「上次运行参数」与 Maya Host/Port；列表页 **执行 / 参数…**；顶栏 **本机环境** 状态条。

**伴侣**：与主工作台 **同一套客户端**：`companionFetchJson` + `getCompanionLocalBaseUrl()`（键 `ac_companion_local_base_v1`，默认 `http://127.0.0.1:18765`）+ `getCompanionLocalToken()`（`ac_companion_local_token_v1`）。浏览器 **直连** 本机伴侣，**不经 Vite `/v1` 代理**；`GET /v1/script-connectors`（可选 `mayaHost`/`mayaPort`、**`bustCache=1`** 强制重探测；与 **`script.maya` 并行**，Maya 主线程忙时探针可能短时超时）、`POST /v1/compute/jobs`（`script.maya`）等均走此路径。Script Hub 与工作台若不同端口，须在两侧各自保存通信密码与（若改过）伴侣 HTTP 根。桌面壳配对、伴侣白名单见 `companion-desktop/README.md` 与 `local-companion` 文档。

**R2**：若根 `.env.local` 已配置 `**R2_*`** 四元组且未设 `**SCRIPT_HUB_USE_R2=false**`，新 revision 正文由 **script-hub-api** 写入 R2（`script-hub/{userId}/{...}}/rev-{n}.py`）；`GET http://127.0.0.1:9101/healthz` 响应含 `**scriptHubR2`: true/false**。

**Run**：`POST /api/runs`（`queued`）→ 伴侣 `POST /v1/compute/jobs` → `PATCH /api/runs/:id`（`running` + `companionJobId`，结束再 `completed`/`failed`）；`GET /api/runs?limit=50` 拉历史，`**?scriptId=`** 限定单脚本。前端路由 `**/scripts/:id/runs**`。

## 本地开发（Sprint 0）

终端 1 — auth-api（9100）：

```powershell
npm run dev:auth-backend
```

终端 2 — script-hub-api（9101）：

```powershell
npm run dev:script-hub-api
```

终端 3 — 前端（5174）：

```powershell
cd script-hub
npm install
npm run dev
```

或仓库根：

```powershell
npm run script-hub:dev
```

**首次**请在 `script-hub/` 执行 `npm install`（子项目独立 `node_modules`）。

`vite.config.ts` 将：

- `/api/auth` → `http://127.0.0.1:9100`
- 其余 `/api/*` → `http://127.0.0.1:9101`

**CORS**：若 auth-api 使用 `AUTH_ALLOWED_ORIGINS`，请包含 `http://localhost:5174`（Script Hub dev）。

**本地 Postgres（与 auth 共用）**：仓库根 `docker-compose.script-hub-dev.yml`（端口 **55432**，用户/库 `assetcutter` / 密码见 compose）。先 `npm run pg:dev:script-hub`，根 `.env.local` 配置 `**DATABASE_URL`** 后执行 `**npm run migrate:auth-to-postgres**`（可选，从 `server/data/auth-db.json` 导入用户）；再 `npm run dev:script-hub-stack`。

规格见 `**docs/Script-Hub-开发规格.md**`。