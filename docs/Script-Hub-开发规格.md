# Script Hub 开发规格（可执行版）

**产品代号**：Script Hub  
**公网入口（第一版已锁定）**：`https://scripts.adrazzo.com`（独立子域 SPA；**不做**主站同域子路径，后续若要做另开版本评估）  
**目标 DCC（MVP）**：Autodesk Maya、Unreal Engine（Editor Python）  
**身份**：与 `app.adrazzo.com` 共用 **auth-api** 与用户库  
**本机执行**：仅经 **本地伴侣**（`127.0.0.1:18765`），不经公网直连 DCC  
**源码仓库**：与主项目 **同一 Git 仓库**；**独立子目录 + 独立构建/部署**（同 `local-companion/` 并列，见 §2.2）

**文档版本**：v0.3.5（2026-05-15）  
**读者**：前端、Node 后端、伴侣、QA、运维  

### 动工状态（Sprint 0～1 已落地 / 进行中）

| 项 | 路径 / 说明 |
|----|-------------|
| 前端脚手架 | `script-hub/`（Vite :5174，`README.md`） |
| 前端路由壳 | `BrowserRouter` + `AuthProvider`；`/login`；`RequireAuth` 下 `/library`、`/scripts/new`、`/scripts/:id`（MVP 先做私有库站，见 **§0.5**） |
| 业务 API | `server/script-hub-api.js`（默认 9101；`DATABASE_URL` 可用时 CRUD + revision；无库时业务 503） |
| 跨子域 Cookie | `server/auth-api.js`：`AUTH_COOKIE_DOMAIN`（可选，如 `.adrazzo.com`） |
| 根脚本 | `package.json`：`dev:script-hub-api`、`script-hub:dev`、`script-hub:build`、`script-hub:typecheck` |
| 环境变量说明 | `.env.example`（`AUTH_COOKIE_DOMAIN`、`SCRIPT_HUB_*`） |
| revision 正文 | **R2 + PG**：已配置 R2 且 **`SCRIPT_HUB_USE_R2`≠false** 时新 revision 写入 **`script-hub/{userId}/{scriptId}/rev-{version}.py`**，`content_body` 置空；读取时优先 R2。未配 R2 或显式关闭时仍仅用 **`content_body`**。列 **`content_storage_key`** 见 `003_script_hub_r2.sql` / store DDL。 |
| 伴侣 Script 探测 | **`GET /v1/script-connectors`**（`local-companion/src/scriptRun/scriptConnectorsSnapshot.ts`）；支持 **`mayaHost` / `mayaPort`** query；`script-hub` 详情页「本机连接器」 |
| **Run 记录** | **`POST /api/runs`**（`queued`）→ **`PATCH /api/runs/:id`**（`running` / `completed` / `failed`）；表 **`script_hub_runs`**（`004_script_hub_runs.sql`）；详情页 Maya 执行已串联 |
| **Run 历史页** | 路由 **`/scripts/:id/runs`**；**`GET /api/runs?scriptId=`** 过滤当前脚本（须为作者） |

本地联调顺序：`dev:auth-backend` → `dev:script-hub-api` → `script-hub:dev`；`AUTH_ALLOWED_ORIGINS` 需含 `http://localhost:5174`。

---

## 0.5 产品与运维：MVP 架构冻结清单（先做网站）

本节把**尚未在代码里自动保证、但依赖运维/产品一次性拍板**的事项写成检查表，避免网站做完再改域名、Cookie 或反代。**与 §0 技术决策互补**：§0 偏「做什么」；本节偏「怎么上线、第一版切多深」。

### 0.5.1 运维冻结项（每环境一份配置，变更需回归）

| 项 | 建议冻结结论 | 说明 / 变更代价 |
|----|----------------|-----------------|
| **公网入口形态** | **第一版锁定**独立子域 `https://scripts.adrazzo.com` 托管 SPA；业务 API 走 **同源** `https://scripts.adrazzo.com/api/*` 反代至 `script-hub-api` | 与 **D-1** 一致；**当前迭代不讨论**主站同域子路径（若未来要做：Cookie Path、`vite` `base`、SEO、反代另立项）。 |
| **认证请求走向** | **每个环境只选一种**并写进部署文档：（A）前端 `VITE_AUTH_API_BASE_URL` 指向 **auth-api 绝对 URL**（跨子域 + CORS）；（B）经 `scripts` 反代 **`/api/auth/*` → auth-api**（浏览器视角更少跨域） | 混用会导致预检、重定向与 Cookie 行为难排查。本地开发当前为 **Vite 代理**：`/api/auth`→9100，其余 `/api`→9101。 |
| **会话 Cookie** | 生产：`ac_session`、`Domain=.adrazzo.com`（`AUTH_COOKIE_DOMAIN`）、`Secure` + `SameSite=None`（与现网 auth-api **保持一致**） | 改 Domain 或策略 = **全站登录回归**。`localhost:5173` 与 `:5174` **无法**共享 Cookie（§4.1）；Staging 若用预览域，须在 **`AUTH_ALLOWED_ORIGINS`** 显式列出并理解预览域 Cookie 限制。 |
| **CORS / Origin 白名单** | auth-api、script-hub-api 的写接口白名单均含：`https://scripts.adrazzo.com`、`https://app.adrazzo.com`、`http://localhost:5174`；**按需**追加 Vercel 预览域 | script-hub-api 独立进程时须自带与 auth 同思路的 **Origin 校验**（§7.4）。 |
| **伴侣暴露面** | 伴侣 HTTP **仅绑定 `127.0.0.1`**，不经公网 | 与 §10 一致；运维侧禁止把 18765 暴露到防火墙外。 |
| **数据库与密钥** | `script-hub-api` 使用 **`DATABASE_URL`**（与 auth 可共用 PG 实例）；R2/签名密钥按接 §5.2 时再开 | 无 `DATABASE_URL` 时 API 对健康检查仍可用，**业务路由 503**（便于探活与排障）。 |

### 0.5.2 产品冻结项：「先做网站」的 MVP 范围（Website-first）

目标：**尽快交付可演示的 Script Hub 网站**（私有脚本库 + Maya 本机执行闭环），社区与第二 DCC 不挡站。

| 阶段代号 | 包含 | **刻意不做**（避免返工） |
|----------|------|---------------------------|
| **MVP-Site** | 登录；我的脚本列表；创建/编辑脚本与 **ParamSchema v1**；保存 revision；**Maya** 经伴侣 `script.maya` 执行并展示结果/错误；健康检查与基本空态 | **不设**公网社区为默认首页；**不上** UE `script.unreal`；**不做** publish → pending → admin 审核链、fork、Run 云端持久化全量（按 Sprint 1 实际裁剪，逐步对齐 §7.2） |
| **下一刀**（与 §13 Sprint 2～3 对齐） | UE；R2 正文 +（如需）伴侣 **cloud + JWT** 拉取；社区列表与审核；伴侣桌面入口 | 仍不在 MVP-Site |

**路由落地（与 §9.2 的关系）**：全量产品图中 `/` 为社区首页；**在 MVP-Site 阶段允许** `/` **重定向到** `/library`（或仅已登录用户如此），社区首页延至 **M3** 再替换默认落地页，避免未上线审核链时出现「空社区首页」。

### 0.5.3 与主站（Workbench）关系

- **默认**：主站 **仅放外链** 指向 `scripts.adrazzo.com`；Workbench **禁止** import `script-hub/` 源码（与 §3.3 一致）。  
- **可选后续**：iframe 或同域嵌入仅当 **§0.5.1 入口形态** 明确改为同域方案时再评估。

### 0.5.4 文档与代码漂移时的权威顺序

1. **安全不变量**（§10）：伴侣本机、参数注入缓解、pending 不可执行（已上线社区能力后生效）。  
2. **§0 已锁定决策**（D-1～D-4）。  
3. **本节冻结清单**（运维/产品边界）。  
4. **动工状态表**与迁移脚本反映 **当前仓库真值**；§5.1 SQL 为 **目标模型**，若与 `002_script_hub.sql` 不一致，以 **迁移文件 + script-hub-store 实现** 为准，并在本节「过渡」行同步更新。

---

## 0. 已锁定决策（原开放问题，不再讨论）

| ID | 决策 | 说明 |
|----|------|------|
| **D-1** | **script-hub-api 独立进程** | 不并入 `auth-api.js`；生产经 `scripts.adrazzo.com/api` 反代；与 auth 共用 Postgres |
| **D-2** | **社区发布默认 `pending`** | 用户点发布后 `moderation_status=pending`；**仅 `approved` _revision 在社区列表可见**；作者与 admin 可见 pending |
| **D-3** | **UE 执行以 Remote Execution 为主** | v1 必须实现 multicast 发现 + 远程执行；无编辑器时 probe 失败并给修复文档；**v1 不做** Cmd 无头批处理 |
| **D-4** | **本地 dev 端口 `5174`** | 工作台保持 `5173`；`script-hub` 独占 `5174` |

---

## 1. 交付定义（Done 的标准）

| 里程碑 | 用户可感知结果 | 技术验收 |
|--------|----------------|----------|
| **M0** | 打开 `scripts.adrazzo.com` 已登录（与 app 同账号） | `Domain=.adrazzo.com` Cookie；`auth-api` `/api/auth/me` 200 |
| **M1** | 私有脚本 + Maya 填参执行成功 | Maya 端到端 Run 绿；日志可见 |
| **M2** | UE probe + execute 与 Maya 并列可用 | 两 Connector 单测 + 手测清单全绿 |
| **M3** | 社区浏览、发布、fork；仅审核通过公开 | pending 不上首页；fork 为私有副本 |
| **M4** | 伴侣菜单进入 Script Hub；DCC 状态可见 | WebView + `runtime-status.scriptConnectors` |

> **注意**：M1 只要求 **Maya**；UE 在 M2 完成，避免首版双线联调。

---

## 2. 范围与非目标

### 2.1 In Scope（按 §13 排期）

- 脚本 CRUD（私有库）
- **ParamSchema v1** 统一参数表单
- Maya / UE Connector（probe、execute、错误码）
- 伴侣侧 script 作业（**复用** `/v1/compute/jobs` 基础设施，见 §7）
- 社区：发布、列表、标签、`targetType` 筛选、管理员审核/下架
- 作者工具：`run(params)` 注解 → schema **草稿**（非运行时真相源）

### 2.2 Out of Scope（v1 明确不做）

- 浏览器直连 Maya Command Port / UE Remote Execution
- 无 schema 的运行时「纯推断 UI」
- 云端执行用户 Python
- 付费市场、评论楼、自动 `pip install`
- 与工作流节点联动（Phase 4 backlog）
- 独立 Git 仓库拆分（除非团队/开源策略变化）

---

## 3. 系统架构

### 3.1 逻辑拓扑

```
scripts.adrazzo.com (script-hub SPA, :5174 dev)
    │ credentials:include
    ├─► auth-api（现有 Render）     — /api/auth/* 登录 / me
    ├─► scripts.adrazzo.com/api/*   — script-hub-api（反代，与面对用户同源）
    └─► 127.0.0.1:18765             — 伴侣 compute jobs（script.maya | script.unreal）

local-companion/
    └─► local-companion/src/scriptRun/   — Maya / UE 适配器
```

**认证路径说明**：登录请求始终打 **auth-api**（`VITE_AUTH_API_BASE_URL`）；业务 CRUD 打 **同源** `/api/*`（script-hub-api）。会话 Cookie 域为 `.adrazzo.com`，两后端均可校验同一 `ac_session`。

### 3.2 仓库布局（与 `local-companion` 并列）

**原则**：单独网站、单独 `package.json`、单独 `npm run build`；**不**把页面塞进根目录 `App.tsx`。

| 路径 | 说明 |
|------|------|
| `script-hub/` | Script Hub 前端（Vite + React），部署到 `scripts.adrazzo.com` |
| `script-hub/src/services/` | `authClient` 薄封装、`scriptHubApi`、`companionScriptRun` |
| `script-hub/src/components/param-form/` | ParamSchema 表单（v1 不放 `packages/`，避免过早抽象） |
| `server/script-hub-api.js` | 独立 HTTP 进程 |
| `server/auth-middleware.js` | **Sprint 0 抽取**：session 校验，auth-api 与 script-hub-api 共用 |
| `server/migrations/002_script_hub.sql` | Postgres 表（序号随仓库已有 migration 递增） |
| `local-companion/src/scriptRun/` | Maya / UE 适配器 |
| `docs/script-hub/` | 用户向连接文档、错误码 |

根 `package.json` 增加：

```json
"script-hub:dev": "npm run dev --prefix script-hub",
"script-hub:build": "npm run build --prefix script-hub",
"dev:script-hub-api": "node --env-file=.env.local server/script-hub-api.js"
```

本地一键（可选，Sprint 0 末）：`dev:script-hub-stack` = `script-hub:dev` + `dev:script-hub-api` + `dev:auth-backend`。

### 3.3 与现有模块的边界

| 现有模块 | Script Hub 关系 |
|----------|-----------------|
| `server/auth-api.js` | 扩展 `AUTH_COOKIE_DOMAIN`、CORS 白名单；**不**塞 script 业务路由 |
| `local-companion` | 新增 `scriptRun` 适配器 + compute types；改后按 `companion-desktop-restart` 重启 |
| 根目录 workbench | 仅共享登录；可选顶栏链接；**禁止** import script-hub 页面 |
| `services/authClient.ts` | Sprint 0 复制最小子集到 `script-hub/src/services/authClient.ts`（避免根目录耦合） |

---

## 4. 身份与会话（M0）

### 4.1 Cookie

| 项 | 值 |
|----|-----|
| 名 | `ac_session` |
| Domain | `.adrazzo.com`（env：`AUTH_COOKIE_DOMAIN`） |
| SameSite / Secure | 与现网 auth-api 一致（`None` + `Secure`） |

**开发**：`localhost:5173` 与 `:5174` **无法**共享 Cookie；本地可各登一次，或使用 `*.adrazzo.test` + hosts 联调跨域登录。

### 4.2 CORS 白名单

auth-api 与 script-hub-api 均须包含：

- `https://scripts.adrazzo.com`
- `https://app.adrazzo.com`
- `http://localhost:5174`
- Vercel 预览域（按需）

### 4.3 角色与社区审核（D-2）

| 角色 | 权限 |
|------|------|
| `user` | 私有脚本 CRUD；本机执行；**发布 → pending** |
| `admin` | 审核（approve/reject/remove）；全站 Run 统计 |

**社区可见性规则**：

- `GET /api/community/scripts`：**仅** `moderation_status=approved` 且 `visibility=public`
- 作者：`GET /api/scripts/:id` 可见自己的 pending
- **pending 脚本不可被他人执行**（API 403）；作者可在本机自测私有 revision，与 listing 解耦

---

## 5. 领域模型与数据库

### 5.1 表结构（Postgres）

> **实施说明**：下列 DDL 为 **目标域模型**（含 R2 指针字段）。当前 Sprint 1 仓库若已采用 **`content_body` TEXT** 存正文，视为 **过渡实现**，接 R2 时增加 key/sha 回填与体积门槛迁移；**权威结构以 `server/migrations/002_script_hub.sql` 为准**，本块用于产品与查询语义对齐。

```sql
-- 002_script_hub.sql（示意，实施时对齐现有 migration 规范）

CREATE TABLE script_hub_scripts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL CHECK (target_type IN ('maya', 'unreal')),
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public', 'unlisted')),
  current_revision_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, slug)
);

CREATE TABLE script_hub_revisions (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES script_hub_scripts(id) ON DELETE CASCADE,
  version INT NOT NULL,
  entrypoint TEXT NOT NULL DEFAULT 'run',
  schema_json JSONB NOT NULL,
  content_storage_key TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  content_byte_size INT NOT NULL,
  changelog TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (script_id, version)
);

CREATE TABLE script_hub_public_listings (
  script_id TEXT PRIMARY KEY REFERENCES script_hub_scripts(id) ON DELETE CASCADE,
  published_revision_id TEXT NOT NULL REFERENCES script_hub_revisions(id),
  tags TEXT[] NOT NULL DEFAULT '{}',
  moderation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'removed')),
  download_count INT NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  moderated_by_user_id TEXT REFERENCES users(id),
  moderated_at TIMESTAMPTZ,
  reject_reason TEXT
);

CREATE TABLE script_hub_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  script_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  params_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  exit_code INT,
  error_code TEXT,
  error_message TEXT,
  log_excerpt TEXT,
  duration_ms INT,
  client TEXT NOT NULL DEFAULT 'script-hub-web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_script_hub_scripts_owner ON script_hub_scripts(owner_user_id);
CREATE INDEX idx_script_hub_public_approved ON script_hub_public_listings (moderation_status)
  WHERE moderation_status = 'approved';
CREATE INDEX idx_script_hub_runs_user_created ON script_hub_runs(user_id, created_at DESC);
```

### 5.2 R2

- Key：`script-hub/{userId}/{scriptId}/rev-{version}.py`
- **MVP 实现**：script-hub-api 在 **`createRevision`** 内对 R2 **服务端 `PutObject`**（不经浏览器预签名）；DB 存 **`content_storage_key`**，大正文不留在 PG。关闭：`SCRIPT_HUB_USE_R2=false`。
- 与现有 R2 中间层共用 **`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`**。

### 5.3 共享类型

类型定义放在 `script-hub/src/types/scriptHub.ts`；script-hub-api 可用 JSDoc 或复制常量保持同步（v1 不强制共享 npm 包）。

---

## 6. ParamSchema v1

- 运行时 **只认** `schema_json`；保存 revision 前必须带 schema。
- 入口约定：`def run(params: dict) -> None`（§7.3 包装调用）。
- UI：`enum` 用 **CustomDropdown**（禁止原生 `<select>`）。
- 伴侣执行前 **再次校验** params ⊆ schema。

字段类型：`string` | `text` | `int` | `float` | `bool` | `enum` | `path`（校验规则见 v0.1，未变）。

---

## 7. script-hub-api

### 7.1 基址（D-1）

- **生产**：`https://scripts.adrazzo.com/api/*` → 反代至 `script-hub-api` 进程
- **本地**：`http://localhost:9xxx`（env `SCRIPT_HUB_API_PORT`，默认 `9101`）；`script-hub/vite.config.ts` 将 `/api` 代理到该端口（**仅 script 路由**；`/api/auth` 仍代理到 `9100` auth-api）

### 7.2 路由

| Method | Path | 说明 |
|--------|------|------|
| GET | `/healthz` | 健康检查 |
| GET | `/api/scripts` | 当前用户脚本列表 |
| POST | `/api/scripts` | 创建 |
| GET | `/api/scripts/:id` | 详情 |
| PATCH | `/api/scripts/:id` | 更新元数据 |
| DELETE | `/api/scripts/:id` | 删除（v1 硬删） |
| POST | `/api/scripts/:id/revisions` | 新 revision |
| GET | `/api/scripts/:id/revisions/:revId/content` | 正文（权限校验） |
| POST | `/api/scripts/:id/publish` | → listing **pending**（D-2） |
| POST | `/api/scripts/:id/fork` | 复制为当前用户私有脚本 |
| GET | `/api/community/scripts` | **仅 approved**；`?targetType=&tag=&q=` |
| POST | `/api/admin/scripts/:id/moderate` | `{ status: approved\|rejected\|removed, reason? }` |
| POST | `/api/runs` | 创建 Run（`status=queued`） |
| PATCH | `/api/runs/:id` | 伴侣执行完后更新摘要 |
| GET | `/api/runs` | 当前用户 Run 列表；**`?limit=`**、**`?scriptId=`**（仅本人脚本） |
| POST | `/api/schema/infer` | 草稿 schema（可选） |

### 7.3 错误信封

```json
{ "error": "human_message", "code": "SCRIPT_HUB_XXX", "details": {} }
```

### 7.4 CSRF

script-hub-api 独立进程但浏览器视角为 **scripts 同源 `/api`**，写接口仍走 session Cookie。跨域写 auth-api 的规则不变。script-hub-api 的 POST/PATCH/DELETE 校验 **Origin 白名单**（与 auth-api `assertWriteOrigin` 同思路）。

---

## 8. 本地伴侣：script 执行

### 8.1 与 compute jobs 的关系（消除双 API）

**v1 对外只暴露一套 Job API**，Script Hub 前端调用：

```
POST /v1/compute/jobs
{ "type": "script.maya" | "script.unreal", "inputs": { ... }, "params": { ... } }
```

在 `jobsStore.ts` 的 `REGISTERED_COMPUTE_TYPES` 注册新 type；**不**另起一套 `/v1/script-runs` 存储。

**辅助只读接口**（可单独加，不存 second job store）：

| Method | Path | 说明 |
|--------|------|------|
| GET | `/v1/script-connectors` | 聚合 probe 状态（**已实现**）。可选查询参数 **`mayaHost`**、**`mayaPort`**，与 Script Hub 执行表单对齐；未传时使用 `COMPANION_MAYA_HOST` / `COMPANION_MAYA_PORT`（默认 `127.0.0.1:7001`）。短缓存 TTL 与 Sam/rembg 相同（**`COMPANION_RUNTIME_PROBE_CACHE_MS`**）。 |
| GET/PATCH | `/v1/script-connectors/config` | 读写本机连接器配置（**未实现**，仍用环境变量） |

`GET /v1/runtime-status` 增加 `scriptConnectors` 切片（与 `/v1/script-connectors` 同源探测，带短缓存 TTL，对齐 Sam rembg 探测模式）。

### 8.2 Job `inputs` 合同（v1）

```json
{
  "protocolVersion": 1,
  "type": "script.maya",
  "inputs": {
    "scriptSource": "inline",
    "content": "def run(params): ...",
    "entrypoint": "run",
    "schema": { "schemaVersion": 1, "fields": [] }
  },
  "params": { "scale": 1.5 }
}
```

| `scriptSource` | 含义 |
|----------------|------|
| `inline` | 正文在 `content`（私有编辑页、已拉取的 revision） |
| `cloud` | `{ "revisionId", "contentUrl" }`；伴侣用 **短期 JWT**（script-hub-api 签发，5min）拉取，**不用**用户 Cookie 注入伴侣 |

### 8.3 参数注入（安全）

**禁止**三引号字符串拼接。v1 采用 **base64 通道**：

```python
import json, base64
__PARAMS__ = json.loads(base64.b64decode("...").decode("utf-8"))
# user script
run(__PARAMS__)
```

### 8.4 Maya `maya.command_port@v1`

| 项 | 规格 |
|----|------|
| 默认 | `127.0.0.1:7001` |
| probe | TCP 连通 + 可选 `SCRIPT_HUB_PING` |
| execute | Command Port 发送包装 Python |
| 错误码 | `MAYA_PORT_CLOSED`, `MAYA_EXEC_TIMEOUT`, `MAYA_RUNTIME_ERROR` |

### 8.5 UE `unreal.python@v1`（D-3）

| 项 | 规格 |
|----|------|
| 主路径 | **Remote Execution**（`239.0.0.1:6766`） |
| 前置 | Editor 已开 + Python Editor Script Plugin |
| probe | multicast 发现至少 1 个节点 |
| 错误码 | `UE_NO_EDITOR`, `UE_PYTHON_DISABLED`, `UE_REMOTE_FAILED` |

### 8.6 本机配置

路径：**伴侣数据卷** `{repositoryRoot}/config/script-connectors.json`（**非** Git 仓库目录；与 `ensureRepositoryRoot()` 一致）。

---

## 9. 前端（`script-hub/`）

### 9.1 技术栈与 UI（对齐工作台）

- **栈**：React 19 + TS + Vite + React Router；数据层以 **轻量 `fetch` 封装** 为主（TanStack Query 可选，不挡首版网站）。
- **视觉与主站工作台一致**（权威参考：仓库根目录 **`index.html`** 内联样式中的 **CSS 变量** 与字体）：
  - 字体：**Plus Jakarta Sans**（正文）、**JetBrains Mono**（代码块 / JSON / Python）。
  - 色板：`--background` `#050505`、`--surface-raised` `#16161a`、`--surface-input` `#1c1c22`、描边 `#2e2e32`、强调 **`--accent-blue`** `#2563eb`（可与紫渐变点缀仅用于营销位，管理页保持克制）。
  - 组件气质：**深色密实底** + **细描边卡片**（`glass` / panel）、**圆角输入框**、**主按钮实心蓝**；滚动条样式与主站深色滚动条一致。
- **实现位置**：`script-hub/src/index.css` 复用同名变量与 utility class（`sh-*`），**不**引入与工作台重复的 Tailwind CDN，避免双栈；若日后与工作台合并设计 token，优先抽 **公共 CSS 片段** 而非复制第三套色值。

### 9.2 页面

| 路由 | 页面 |
|------|------|
| `/` | **全量目标**：社区首页（仅 approved）。**MVP-Site（§0.5.2）**：可重定向至 `/library`，待 M3 再接社区首页。 |
| `/library` | 我的脚本 |
| `/scripts/new` | 创建（选 Maya / UE） |
| `/scripts/:id` | 编辑 + 参数 + 执行 |
| `/scripts/:id/runs` | **Run 历史**（`GET /api/runs?scriptId=`） |
| `/settings/connectors` | 本机连接器 |
| `/admin/moderation` | 审核队列 |

### 9.3 执行流程

1. `GET /v1/script-connectors` → 状态条  
2. 填参 → schema 校验  
3. **`POST /api/runs`**（`status=queued`）→ **`POST /v1/compute/jobs`** → **`PATCH /api/runs/:id`**（`running` + `companionJobId`）  
4. 轮询 job（MVP 未接 SSE；后续可订阅 job events）→ **`PATCH /api/runs/:id`**（`completed` / `failed` + `logExcerpt` / `durationMs` 等）  
5. 社区脚本 **首次执行** → 确认对话框（作者、revision、target）

### 9.4 环境变量

| 变量 | 默认 |
|------|------|
| `VITE_AUTH_API_BASE_URL` | 同 workbench（auth Render URL） |
| `VITE_SCRIPT_HUB_API_BASE_URL` | 空 = 同源 `/api` |
| `VITE_COMPANION_BASE_URL` | `http://127.0.0.1:18765` |

---

## 10. 安全

| 威胁 | 缓解 |
|------|------|
| 执行未审核社区脚本 | listing pending 不可执行；approved 仍要确认框 |
| 参数注入 | schema 校验 + base64 注入 |
| 伴侣被公网访问 | 只绑 `127.0.0.1` |
| 云脚本越权 | content API + 短期 JWT；revision 不可变 |
| CSRF | Origin 白名单 + session |

---

## 11. 部署

| 组件 | 域名/说明 |
|------|-----------|
| `script-hub` 静态构建物 | `scripts.adrazzo.com` |
| `script-hub-api` | 同域 `/api` 反代 |
| `auth-api` | 不变 |
| Postgres / R2 | 现有实例 + `002_script_hub.sql` |

**上线前核对（摘自 §0.5，运维可复制为 checklist）**：

- [ ] 本环境 **auth 请求走向**（绝对 URL vs 反代 `/api/auth`）已选定并写入 Runbook。  
- [ ] `AUTH_COOKIE_DOMAIN` / `Secure` / `SameSite` 与现网 auth **一致**；跨子域登录已手测。  
- [ ] `AUTH_ALLOWED_ORIGINS`（及 script-hub-api Origin 白名单）含 **生产 `scripts` + `app` + 本地 5174 + 所需预览域**。  
- [ ] `script-hub-api` 已配置 **`DATABASE_URL`**；迁移已执行。  
- [ ] 伴侣仍 **仅 127.0.0.1**；用户侧文档说明「执行需本机伴侣」。

**CI**（增量，不阻断 workbench）：

- `npm run script-hub:build`
- `node --test server/script-hub-api.test.js`（新增）
- `npm run local-companion:typecheck`
- script-run 单元测试

---

## 12. 测试策略

手测清单与 v0.1 相同；**补充**：

- [ ] pending 脚本不在 `/api/community/scripts` 出现
- [ ] 非作者对 pending 脚本 `content` 403
- [ ] `script-hub` 构建物不包含 workbench 代码（bundle 体积抽检）

---

## 13. 迭代计划

### Sprint 0（1 周）— M0

| ID | 任务 | 验收 |
|----|------|------|
| S0-1 | `AUTH_COOKIE_DOMAIN` + `server/auth-middleware.js` 抽取 | 双子域 `me` 200 |
| S0-2 | `script-hub/` 脚手架（:5174）+ 登录 + vite 双代理 | 能 login |
| S0-3 | `script-hub-api` healthz + session 中间件 | CI 绿 |
| S0-4 | DNS 预览 `scripts.adrazzo.com` | 可访问 |

### Sprint 1（2 周）— M1 Maya

| ID | 任务 | 验收 |
|----|------|------|
| S1-1 | migration + Script CRUD | API 测试绿 |
| S1-2 | R2 上传（revision 正文，`PutObject` + `content_storage_key`） | 配 R2 时新 revision 走对象存储；`GET /healthz` 见 `scriptHubR2` |
| S1-3 | ParamSchema 表单 | 7 类型 |
| S1-4 | `script.maya` + **`GET /v1/script-connectors`**（Maya probe + 前端状态条） | Maya 手测绿；无 Maya 时 UI 显示 ERR |
| S1-5 | 执行流 + **Run 记录**（`POST/PATCH /api/runs`） | 端到端；DB 可查 `script_hub_runs` |

### Sprint 2（2 周）— M2 UE

| ID | 任务 | 验收 |
|----|------|------|
| S2-1 | `script.unreal` Remote Execution（D-3） | UE 手测绿 |
| S2-2 | connectors 设置页 | 改配置生效 |
| S2-3 | `runtime-status.scriptConnectors` | 状态条一致 |
| S2-4 | 短期 JWT 拉取 cloud 脚本 | 无 Cookie 进伴侣 |

### Sprint 3（2 周）— M3 + M4

| ID | 任务 | 验收 |
|----|------|------|
| S3-1 | publish pending + admin 审核 + community | D-2 手测 |
| S3-2 | fork | 私有副本 |
| S3-3 | schema infer 草稿 | 可用 |
| S3-4 | `companion-desktop` 菜单打开 Script Hub | M4 |

### Backlog

- 工作流触发 script job
- Run 全文日志 R2
- Houdini / Blender
- 团队 ACL

---

## 14. 用户文档（Sprint 1 起并行）

| 文件 | 内容 |
|------|------|
| `docs/script-hub/maya-setup.md` | Command Port |
| `docs/script-hub/ue-setup.md` | Python + Remote Execution |
| `docs/script-hub/error-codes.md` | 错误码表 |

---

## 15. 引用

- 仓库并列约定：本轮会话 + `local-companion/README.md`
- 伴侣 UX：`docs/本地伴侣-本机能力用户体验与产品化路线图.md`
- Job 模型：`local-companion/src/compute/jobsStore.ts`
- 鉴权：`server/auth-api.js`

---

## 附录 A. 文档修订摘要（审查记录）

### v0.3.4 → v0.3.5（2026-05-15）

| 问题 | 处理 |
|------|------|
| Run 历史无独立页 | **`/scripts/:id/runs`** + **`ScriptRunsPage`**；**`GET /api/runs?scriptId=`** 与归属校验 |

### v0.3.3 → v0.3.4（2026-05-15）

| 问题 | 处理 |
|------|------|
| Run 未落库、执行流与 §9.3 脱节 | **`script_hub_runs`** + **`POST/GET /api/runs`** + **`PATCH /api/runs/:id`**；`script-hub` Maya 执行串联；**`companion_job_id`** 记录伴侣 job |

### v0.3.2 → v0.3.3（2026-05-15）

| 问题 | 处理 |
|------|------|
| revision 正文应落 R2 | **`server/script-hub-r2.js`** + **`content_storage_key`**；`createRevision` / `getRevisionContentForOwner` / `deleteScript` 联动；**`GET /healthz`** 增加 **`scriptHubR2`**；迁移 **`003_script_hub_r2.sql`** |

### v0.3.1 → v0.3.2（2026-05-15）

| 问题 | 处理 |
|------|------|
| Sprint 1 需本机连接器可观测 | **GET `/v1/script-connectors`** 落地（Maya probe + UE skipped）；`script-hub` 详情页展示状态 |

### v0.3 → v0.3.1（2026-05-15）

| 问题 | 处理 |
|------|------|
| 第一版公网入口需口头与文档一致 | 文首与 **§0.5.1** 明确 **锁定** `https://scripts.adrazzo.com`，同域子路径不纳入当前迭代 |
| Script Hub 网站 UI 需对齐工作台 | **§9.1** 补充字体/色板/实现约定（`script-hub/src/index.css` 与根 `index.html` 变量对齐） |

### v0.2 → v0.3（2026-05-15）

| 问题 | 处理 |
|------|------|
| 产品/运维依赖（域名、Cookie、反代、MVP 范围）散落在各节 | 新增 **§0.5 产品与运维：MVP 架构冻结清单**；§11 增加上线 checklist |
| 「先做网站」与 §9.2 默认 `/` 社区首页易冲突 | §0.5.2 / §9.2 明确 **MVP-Site** 可先 **`/` → `/library`** |
| §5.1 与 Sprint1 代码（PG `content_body`）易误读 | §5.1 增加 **目标模型 vs 过渡实现** 说明；动工状态表标明真值来源 |

### v0.1 → v0.2

| 问题 | 处理 |
|------|------|
| `apps/script-hub` 与「像 local-companion 并列」不一致 | 统一为 **`script-hub/`** |
| `/v1/script-runs` 与 compute jobs 双轨 | **合并**为 `POST /v1/compute/jobs` + type `script.*` |
| M1 写「Maya 或 UE」与排期矛盾 | M1 **仅 Maya**；M2 UE |
| §14 开放问题未关闭 | 升为 **§0 已锁定决策** |
| 社区 pending 与列表 API 模糊 | 明确 **仅 approved 可浏览/执行** |
| 伴侣用用户 Cookie 拉云脚本 | 改为 **短期 JWT** |
| 参数三引号注入风险 | 改为 **base64 通道** |
| `services/scriptHubClient` 放根目录 | 收拢到 **`script-hub/src/services/`** |
| auth 中间件不存在 | Sprint 0 **抽取** `auth-middleware.js` |
| 配置路径写 companionRepo | 改为 **伴侣数据卷** `repositoryRoot/config/` |
| script-hub-api 部署二选一 | **锁死** 同域反代 |
| 缺本地双代理说明 | §7.1 补充 vite：`/api/auth`→9100，其余 `/api`→9101 |

---

**维护**：破坏性变更时递增文档版本，并更新 `docs/交接文档.md`。
