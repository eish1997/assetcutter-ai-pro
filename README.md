# AssetCutter AI Pro

基于 **Google Gemini** 与 **腾讯混元生3D** 的智能资产生产 Web 应用：提取花纹、贴图修缝、生成贴图、对话生图（含批量出图）、生成3D、工作流与能力预设、资产仓库、提示词效果与擂台；另提供**管理后台**用于批量出图任务的可观测与运维。

**技术栈：** React 19 + Vite 6 + TypeScript + @google/genai，样式为 Tailwind + 内联 CSS。

**项目形态：** 主站为纯静态前端（SPA），部署后为静态站点；无服务端用户系统，设置与生成记录存于浏览器本地（localStorage）。批量出图、贴图修缝、腾讯 3D 等可选能力依赖对应后端或代理。详见 [DOCS.md](DOCS.md)。

---

## 目录

- [网站功能概览（侧栏结构）](#网站功能概览侧栏结构)
- [管理后台](#管理后台)
- [商店（能力包）](#商店能力包)
- [部署成网站](#部署成网站)
- [本地开发](#本地开发)
- [故障排查](#故障排查)
- [生成记录与提示词](#生成记录与提示词)
- [贴图修缝（WebSeamRepair）](#贴图修缝webseamrepair)

---

## 网站功能概览（侧栏结构）

| 入口 | 说明 |
|------|------|
| **主页** | 欢迎页与快捷入口，可跳转到各功能模块 |
| **对话生图** | 上传图片 + 描述需求 → AI 理解 → 生图模型出图（可选模型/尺寸、多会话、临时库）；支持**批量出图任务**（总张数、队列与 RPD 限制，可选后端） |
| **工作流** | 多图筛选 → 拖拽/点选到功能框 → 待处理 → 一键执行 → 版本切换与归档；文本类资产支持居中灯箱查看 |
| **能力** | 功能预设管理（生图、转风格、生成多视角、生成3D 等），工作流功能区调用此处配置；内嵌**商店**：从 Catalog 拉取远程能力包并安装/回滚 |
| **生成3D** | 腾讯混元生3D：文生/图生、智能拓扑、纹理生成、组件、UV、人物、格式转换（当前未上线） |
| **贴图**（组） | **提取花纹**：图案提取、无缝循环贴图；**贴图修缝**：OBJ + 贴图 + 可选 seam mask → 修缝；**生成贴图**：功能贴图 + 描述 → AI 生成 PBR Base Color / Roughness / Metallic |
| **提示词**（组） | **提示词效果**：生成记录与评分、结构化复现与导出；**提示词擂台**：A/B 对比测试 + 获胜片段库 |
| **资产仓库** | 按类型筛选、查看/下载、多选批量下载、删除 |
| **设置** | API 密钥（Gemini 等）、能力商店地址、入站密码等 |

详细功能与类型说明见 [DOCS.md](DOCS.md)。

---

## 管理后台

路径 **`/admin`** 为管理入口；现已切换为用户系统 RBAC 鉴权，仅 `admin` 角色账号可访问。

---

## 商店（能力包）

「商店」用于**远程分发与更新能力预设（`CustomAppModule[]`）**，入口在**「能力」页内**。从 **Catalog JSON** 拉取能力包，安装后合并到本地「能力」列表（同 `id` 覆盖），并为每次安装保留**历史快照**以便回滚。

- **Catalog 地址**：在「设置」页配置「能力商店（GitHub 地址）」；默认可为 `https://cdn.jsdelivr.net/gh/eish1997/assetcutter-ai-pro-store@main/store/catalog.json`
- **本地示例（可选）**：`public/store/catalog.json` 与 `public/store/capability_pack_basic.json` 可用于离线演示/调试

---

## 部署成网站

若要把项目发布成线上可访问的网站，按 **[DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)** 操作即可（GitHub → Vercel，全程点选 + 填几处配置）。

若使用 Render，仓库已提供 `render.yaml`（静态前端 + auth-api + Postgres 免费起步版）。首次部署时请在 Render Dashboard 补齐：

- `assetcutter-web`：`VITE_AUTH_API_BASE_URL=https://你的-auth-api.onrender.com`
- `assetcutter-auth-api`：`AUTH_ADMIN_EMAIL`、`AUTH_ADMIN_PASSWORD`（可选 `AUTH_ADMIN_USERNAME`）；**生产启动使用 `npm run start:auth-backend`**（仅 `node server/auth-api.js`，环境变量以 Dashboard 为准）。勿用 `dev:auth-backend`：其中含 Windows 的 `set` 与 `--env-file=.env.local`，在 Render（Linux）上会部署失败。
- **必配**：`AUTH_ALLOWED_ORIGINS`（含前端完整 Origin，如 `https://xxx.vercel.app`）、`DATABASE_URL`（Blueprint 会从 Postgres 注入）；生产还要求 `AUTH_COOKIE_SAMESITE=none` 与 `AUTH_COOKIE_SECURE=true`（`render.yaml` 已写）。
- **Gemini 代理**（`assetcutter-gemini-proxy`）：在 Dashboard 配置 `GEMINI_API_KEY`、`PROXY_ALLOWED_ORIGINS`（含 Vercel 前端 Origin）；前端构建变量 `VITE_BULK_IMAGE_API=https://该服务.onrender.com`（无尾斜杠）。
- **Vertex AI（可选）**：同一代理进程可配置 `VERTEX_PROJECT_ID`（或 `GOOGLE_CLOUD_PROJECT`）、`VERTEX_LOCATION`（默认 `global`）、ADC（如 `GOOGLE_APPLICATION_CREDENTIALS`）；设置页选择「Vertex」后，前端请求体会带 `aiBackend:vertex`。详见 [docs/VERTEX_AI_INTEGRATION.md](docs/VERTEX_AI_INTEGRATION.md)。

**前端（如 Vercel）+ 可选 Gemini 代理（如 Render）**  
若浏览器未配置官方 Key，或需避免长请求被平台超时：构建时设置 `VITE_BULK_IMAGE_API` 指向 `server/gemini-proxy-api.js` 的公网地址；Gemini key 仅配置在后端（`GEMINI_API_KEY` 或 `GEMINI_API_KEYS`）。对话/网站助手等经 **`POST /proxy/gemini/async` + 轮询 `GET /proxy/gemini/async/:jobId`**（Vertex 路径在同一接口增加 `aiBackend:vertex`）。异步并发/重试可通过 `GEMINI_ASYNC_PROXY_MAX_CONCURRENT`、`GEMINI_PROXY_RETRIES`、`GEMINI_ASYNC_JOB_TTL_MS`、`GEMINI_ASYNC_JOB_MAX_WAIT_MS` 调整；跨域允许源通过 `PROXY_ALLOWED_ORIGINS` 配置。

**可选：入站密码**  
在环境变量、`.env` 或本地开发时的 `.env.local` 中设置 `VITE_SITE_PASSWORD` 后，打开网站会先要求输入密码，正确后才进入应用；同一标签页内刷新无需重输，关闭标签页后需重新输入。不设置则无密码门控。

---

## 本地开发

**环境要求：** Node.js；使用贴图修缝时需安装 Python 3。

| 步骤 | 命令 | 说明 |
|------|------|------|
| 1. 安装依赖 | `npm install` | 首次或 `package.json` 变更后执行 |
| 2. 配置环境变量 | 在 [.env.local](.env.local) 中设置腾讯 3D / 修缝 / 可选 Gemini 代理等 | Gemini Key 在设置页填写 |
| 3. 启动主站（必选） | `npm run dev` | 打开 http://localhost:3000 使用整站 |
| 4. 贴图修缝后端（可选） | `npm run dev:seam-backend` | 仅在使用「贴图修缝」时需要，端口 8008 |
| 5. Gemini 代理（可选） | 本地：`npm run dev:gemini-proxy`；**Render/生产：`npm run start:gemini-proxy`** | 端口默认 9002；**勿**在生产使用 `dev:gemini-proxy`（含 `--env-file=.env.local`，Linux 无该文件会启动失败 → 502） |
| 6. 腾讯 3D 代理（可选） | `npm run proxy` | 仅在使用「生成3D」时需要，端口 9001，需配置腾讯云密钥 |
| 7. 用户系统认证后端（可选） | `npm run dev:auth-backend` | 邮箱密码登录与 RBAC，端口默认 9100；配置 `R2_*` 后同源提供 `/api/r2` |
| 8. R2 独立进程（可选） | `npm run dev:r2-api` | 仅高级场景，端口默认 9003；需改 Vite 代理 target 指向 9003 |
| 9. 初始化管理员（一次性） | `npm run seed:admin` | 需先设置 `AUTH_ADMIN_EMAIL` 与 `AUTH_ADMIN_PASSWORD` |
| 10. 迁移用户数据到 Postgres（可选） | `npm run migrate:auth-to-postgres` | 需先设置 `DATABASE_URL`，把 `server/data/auth-db.json` 导入数据库 |
| 一键启动主站 + 修缝 | `npm run dev:all` | 同时跑主站与贴图修缝后端（两个进程） |

**构建与预览：** `npm run build` 生成 `dist/`；`npm run preview` 本地预览构建结果。

**端口与代理：**

- 主站：`http://localhost:3000`（Vite）
- 贴图修缝 API：开发时由 Vite 代理 `/seam-repair-api` → `http://127.0.0.1:8008`；生产环境可设置 `VITE_SEAM_REPAIR_API` 为后端地址
- Gemini 代理：`BULK_IMAGE_PORT`（默认 9002）由 `server/gemini-proxy-api.js` 使用；前端设置 `VITE_BULK_IMAGE_API=http://localhost:9002` 以走后端代理
- R2：推荐由 `auth-api` 挂载 `/api/r2/*`（与登录 Cookie 同源）；开发时 Vite 将 `/api/r2` 代理到 **9100**。独立进程见 `server/r2-storage-api.js`（`R2_API_PORT` 或 `PORT`，默认 9003）
- 腾讯 3D：开发时需单独运行 `npm run proxy`，前端只设置 `VITE_TENCENT_PROXY=http://localhost:9001`；真正的 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` 仅供代理进程使用。生产部署见 [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)
- 用户系统 API：开发时由 Vite 代理 `/api/auth/*` 与 `/api/admin/*` → `http://127.0.0.1:9100`

**环境变量（.env.local）：**

- `Gemini API Key`：对话生图、提取花纹、生成贴图等 AI 能力必填；请在网站「设置」页填写，仅保存在当前浏览器本机
- `VITE_SEAM_REPAIR_API`：生产环境贴图修缝后端地址（可选，开发时用代理即可）
- `VITE_BULK_IMAGE_API`：Gemini 代理根地址（如 `http://localhost:9002`）；不设置时需在浏览器「设置」填写官方或第三方 Key
- `VITE_AUTH_API_BASE_URL`：可选，用户系统认证 API 根地址（前后端分域部署时必填）
- `VITE_R2_API_BASE_URL`：可选；未设时 R2 请求与 `VITE_AUTH_API_BASE_URL` 同源（推荐生产只配后者）
- `BULK_IMAGE_PORT`：代理监听端口（默认 9002），避免与 `PORT=9001` 的 ai3d 代理冲突
- （Gemini 代理）`GEMINI_API_KEY` / `GEMINI_API_KEYS`：服务端密钥（支持多个 key，按 key 池分摊并发压力）
- （Gemini 代理）`GEMINI_KEY_POOL_MAX_IN_FLIGHT_PER_KEY`：单个 key 允许的并发 in-flight 请求数
- （Gemini 代理）`GEMINI_ASYNC_PROXY_MAX_CONCURRENT`：异步代理全局并发上限（避免 429/503）
- （Gemini 代理）`GEMINI_ASYNC_JOB_TTL_MS` / `GEMINI_ASYNC_JOB_MAX_WAIT_MS` / `GEMINI_PROXY_RETRIES`：异步 job 生命周期、最大等待与失败重试策略
- （Gemini 代理）`GEMINI_PROXY_MAX_BODY_BYTES`：单次 POST JSON 最大体积（默认约 25MB）。大图 base64 易超过旧版 10MB 上限，过小会在边缘表现为 **502**；可按需调大
- （Auth / R2 JSON）`API_JSON_BODY_MAX_BYTES`：登录、预签名 upload-url、object-refs 等 **JSON** 体上限（默认 **4MB**）。文件本体仍走 **PUT 直传 R2**，不经此限制；旧版 1MB 易误伤工作区索引类请求
- （R2）`R2_CAPABILITY_PREVIEW_MAX_BYTES`：能力商店预览图上传校验（默认 8MB）
- （管理端）`CAPABILITY_PUBLISH_ADMIN_BODY_BYTES`：发布能力包到 R2 的 POST 体（默认 64MB）
- （Gemini 代理）`PROXY_ALLOWED_ORIGINS`：CORS 允许源列表；以及 `BULK_IMAGE_BIND_HOST`（云平台端口扫描需监听 `0.0.0.0`，默认已是 `0.0.0.0`）
- （R2 存储 API）`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`：R2 S3 兼容访问必填项
- （R2 存储 API）`R2_PUBLIC_BASE_URL`：可选。若 bucket 绑定了公网域名（如 `https://assets.example.com`），接口会返回可直接访问的 `publicUrl`
- （R2 存储 API）`R2_API_PORT` / `R2_API_BIND_HOST`：R2 API 监听端口与地址（默认 `9003` / `0.0.0.0`）
- （R2）挂在 auth 上时无需 `AUTH_ME_URL`；**独立** `r2-storage-api` 时需设置 `AUTH_ME_URL` 指向可访问的 `/api/auth/me`
- （工作区云同步）`VITE_WORKSPACE_CLOUD`：设为 `false` 时关闭工作区与 R2 的同步，仅用本地 `localStorage`
- `AUTH_PORT` / `AUTH_BIND_HOST`：认证后端监听地址（默认 `127.0.0.1:9100`）
- `AUTH_SESSION_TTL_MS`：登录会话有效期（毫秒，默认 7 天）
- `AUTH_ALLOWED_ORIGINS`：允许访问认证 API 的前端域名白名单（逗号分隔，建议生产必配）
- `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_LOGIN_RATE_LIMIT_MAX` / `AUTH_REGISTER_RATE_LIMIT_MAX`：认证接口限流窗口与阈值
- `AUTH_COOKIE_SAMESITE` / `AUTH_COOKIE_SECURE`：跨域会话 Cookie 策略（Vercel + Render 需 `none` + `true`）
- `AUTH_ADMIN_EMAIL` / `AUTH_ADMIN_PASSWORD`：管理员初始化账号（用于 `npm run seed:admin`）
- `AUTH_ADMIN_USERNAME`：可选，管理员用户名（不填则由邮箱前缀自动生成）
- `DATABASE_URL`：设置后 `auth-api` 自动改用 Postgres 存储用户与会话；可配合 `npm run migrate:auth-to-postgres` 从本地 JSON 迁移历史数据
- 生产环境启动强校验：若缺失 `DATABASE_URL` 或 `AUTH_ALLOWED_ORIGINS`，或 Cookie 策略不是 `AUTH_COOKIE_SAMESITE=none` + `AUTH_COOKIE_SECURE=true`，`auth-api` 会拒绝启动
- 腾讯混元生 3D：运行 `npm run proxy` 时需在 `.env.local` 或环境中设置 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`；前端仅需设置 `VITE_TENCENT_PROXY`（如 `http://localhost:9001`）。如确需浏览器直持密钥调试，必须显式设置 `VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS=true`，默认关闭。部署说明见 [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)
- `VITE_SITE_PASSWORD`：可选，整站入站密码；本地开发可写在 `.env.local`，与上述变量一起管理。

**首次使用贴图修缝时**，需在 `WebSeamRepair/backend` 安装 Python 依赖一次：

```bash
cd WebSeamRepair/backend
pip install -r requirements.txt
```

---

## 故障排查

- **主站打不开 / 白屏**：确认已执行 `npm install`，且端口 3000 未被占用。
- **贴图修缝点「开始修复」报错**：说明修缝后端未启动。执行 `npm run dev:seam-backend` 或 `npm run dev:all`；若提示找不到 `python`，请安装 Python 并先执行上文的 `pip install -r requirements.txt`。
- **无浏览器 Key 且需代理**：启动 `npm run dev:gemini-proxy` 并设置 `VITE_BULK_IMAGE_API=http://localhost:9002`；管理后台 `/admin` 由用户角色控制（需 `admin` 账号）。
- **线上对话生图 503/504 或短超时**：若前端已配 `VITE_BULK_IMAGE_API`，请确认后端已部署含异步 Gemini 代理的版本，并重新构建前端；仍失败时检查 Render 等服务日志与 `PROXY_ALLOWED_ORIGINS`（需包含 Vercel 站点 Origin）。
- **Render 上 Gemini 代理一直 502**：多为 **Start Command 用了 `npm run dev:gemini-proxy`**（依赖不存在的 `.env.local`，进程起不来）。改为 **`npm run start:gemini-proxy`**，并确认已设 `GEMINI_API_KEY`（或 `GEMINI_API_KEYS`）、`PROXY_ALLOWED_ORIGINS` 含 `https://你的站点.vercel.app`。仓库 `render.yaml` 已包含 `assetcutter-gemini-proxy` 正确启动方式。若 **`/healthz` 正常** 而 **`POST /proxy/gemini/async` 仍 502**，请看 Network 里 **Content-Length**：超过 **10MB** 的旧代理会拒 body，可 **升级含 `GEMINI_PROXY_MAX_BODY_BYTES` 的版本** 或在环境变量里调大。
- **生图报 503 / UNAVAILABLE（模型繁忙）**：前端会对生图请求做有限次退避重试；后端异步代理可对同一任务多次重试（可选 `GEMINI_PROXY_RETRIES`）。高峰仍失败时请隔段时间再试或换模型挡位。
- **生图报 504 / DEADLINE_EXCEEDED（处理超时）**：系统会按可重试错误自动退避重试；若仍失败，通常是模型侧高峰导致处理窗口不足，可稍后重试。
- **生成 3D 报错 / CORS**：本地开发需运行 `npm run proxy` 并设置 `VITE_TENCENT_PROXY=http://localhost:9001`，同时在代理环境中配置好 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`。
- **生产部署**：见 [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)。贴图修缝若需上线，需单独部署 8008 后端并设置 `VITE_SEAM_REPAIR_API`；可选部署 `gemini-proxy-api` 并设置 `VITE_BULK_IMAGE_API`；腾讯 3D 需单独部署代理并配置 `VITE_TENCENT_PROXY`。

---

## 生成记录与提示词

- **生成记录**：对话生图、提取花纹的生成记录存于前端 `localStorage`（`ac_generation_records`），由 `services/recordStore.ts` 读写，条数上限 500。详见 [docs/PROMPT_SCORING_DESIGN.md](docs/PROMPT_SCORING_DESIGN.md)。
- **提示词效果**：只读分析页，查看记录、评分、结构化复现与导出。
- **提示词擂台**：A/B 对比测试（选胜者替换编辑框）+ 获胜片段库。对比选择存 `ac_ab_choices`，片段库存 `ac_winning_snippets`。详见 [docs/PROMPT_OPTIMIZATION_AB_DESIGN.md](docs/PROMPT_OPTIMIZATION_AB_DESIGN.md)。

---

## 贴图修缝（WebSeamRepair）

侧栏 **贴图** 组内的 **贴图修缝** 使用本仓库内 `WebSeamRepair` 的算法（OBJ + 贴图 + 可选 seam mask → seam-aware 修复），**默认在浏览器内用 Pyodide 运行**，部署成静态站即可使用。

- **浏览器内计算**：首次点击「开始修复」会加载约 10MB 的 Pyodide（仅一次），之后修缝在本地完成。
- **可选 Python 后端**：可启动 `npm run dev:seam-backend` 并配置 `VITE_SEAM_REPAIR_API`，前端会优先尝试 Pyodide，失败时回退到后端。
- 算法与参数见 [WebSeamRepair/README.md](WebSeamRepair/README.md)。
- Cloudflare R2 存储接入说明见 [docs/R2_SETUP.md](docs/R2_SETUP.md)。**已登录**用户可在开启云同步时把工作区项目同步到 R2；开发环境 Vite 将 `/api/r2` 代理到 **9100**（auth-api，需在 `.env.local` 配置 `R2_*`）。
