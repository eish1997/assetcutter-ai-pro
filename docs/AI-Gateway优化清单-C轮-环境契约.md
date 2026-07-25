# AI Gateway 优化清单（C 轮 · 环境契约）

**日期**：2026-07-25  
**定位**：B 轮已收「用户主路图/即梦/视频 → Gateway Job」。本轮专治 **本地 ≠ 线上**，把验收从「本机碰巧能跑」推到「同一套环境契约」。  
**前提**：不重复 B1–B15；入口单门已有基线，问题在拓扑/配置源/假绿旁路/门禁。

## 一句话目标

验收时 **auth + ops/Key + credits + fairness + proxy + 前端 knobs** 可声明为同一 profile；消灭「本地绿线上红 / 线上绿本地红」。

| 序 | 切片 | 一句话 | 状态 |
| --- | --- | --- | --- |
| C1 | 验收 profile + 自检脚本 | `prod-like` / `dev` 两档；打印错配 | **完成** |
| C2 | ops/Key 只读对齐 | 本地能跟线上同一发布白名单与 Key 池视图 | **完成** |
| C3 | `.env.example` + `render.yaml` 补洞 | 文档默认=代码默认；blueprint 声明关键闸 | **完成** |
| C4 | 生产构建拒假绿开关 | DIRECT / Key First / same-origin 进 CI 红灯 | **完成** |
| C5 | 拓扑错配运行时告警 | 本机 auth + 云 proxy 等组合黄条/阻断预发 | **完成** |
| C6 | Credits gate 钉死 | 预发/生产 `reserve`；`plan` 仅 dev | **完成** |
| C7 | 文案/理解收口 Jobs | understand/chat 用户主路走 Gateway | **完成** |
| C8 | PBR/助手生图收口 | 生图类一律 `runUnifiedImageGeneration` | **完成** |
| C9 | 3D 平台化 | Tripo/混元用户路径不靠本机 9001/用户 Key 假绿 | **完成** |
| C10 | 冒烟矩阵扩容 | 302 + Vertex/Jimeng/Tripo；有钥 hard-fail | **完成** |
| C11 | 多服务同版本 | health `buildSha`；冒烟前比对 | **完成** |
| C12 | 清噪音双轨+文档 | async-batch/死枝/music/过时文档 | **完成** |
| C13 | Fairness/Vertex 间隔对齐 | prod-like 强制生产旋钮 | **完成** |
| C14 | R2 产物契约 | 成功媒体可二次 GET；无 R2 标 WARN | **完成** |
| C15 | 真 Staging（可选） | `*-staging` 三服务+库；smoke 默认打 staging | **待做** |
| C16 | 观测对齐 | Job 详情固定 failure + proxyJobId + buildSha | **完成** |

> **推荐执行序**：契约波 C1→C3→C4→C6→C5→C2 → 假绿波 C13→C12→C7→C8→C9 → 发现波 C10→C11→C14→C16 → 可选 C15。  
> 工作量：S &lt; 1d，M 1–2d，L 3d+。

---

## P0：契约波（必须先做）

### C1. 验收 profile + 自检脚本

| 项 | 内容 |
| --- | --- |
| **现象** | 本地常用「本机 auth(disk) + 云端 proxy」或浏览器 Key，测通后当预发绿 |
| **改哪里** | 新增 `scripts/env-profile-check.mjs`；`package.json`：`env:profile:check` / `env:profile:prod-like`；短文档段（可写本文件附录或 `.env.example` 头注释） |
| **完成标准** | 两档 profile：`dev`（允许 disk/`plan`）与 `prod-like`（同 auth 世界、credits=`reserve`、fairness 开、禁 DIRECT/Key First/same-origin）；脚本打印通过/失败项，非 0 退出码 |
| **反例** | 只有文档没有脚本；或脚本不读实际 env |
| **工作量** | S |
| **结果** | **完成** — `scripts/env-profile-check.mjs` + `npm run env:profile:dev|prod-like|check`；`tests/envProfileCheck.test.ts`；`dev` 对拓扑/disk 仅 WARN，`prod-like` 硬失败。 |

### C2. ops / Key 只读对齐

| 项 | 内容 |
| --- | --- |
| **现象** | 本地 `server/data/*.json` vs 线上 Postgres；Admin 线上配 302/白名单，本机 Route Check「无模型」 |
| **改哪里** | `scripts/` 只读拉取（admin token → 写本地 disk 或打印 diff）；或文档强制 `DATABASE_URL` 只读副本；相关：`model-ops-config-store.js`、`provider-key-store.js` |
| **完成标准** | `npm run admin:pull-online-config`（名可微调）能让本地 Route Check / 发布白名单与目标环境一致；密钥明文不进 git |
| **反例** | 只能手抄 Admin 截图；或把生产写密钥 commit 进仓 |
| **工作量** | M |
| **结果** | **完成** — `scripts/admin-pull-online-config.mjs` + `npm run admin:pull-online-config`：写 model-ops / ops-control；Key 仅 redacted mirror + missingLocally WARN；gitignore mirror/`*.bak-*`。 |

### C3. `.env.example` + `render.yaml` 补洞

| 项 | 内容 |
| --- | --- |
| **现象** | example 仍暗示 `AI_GATEWAY_EXECUTION_ENABLED=false`；`AI_GATEWAY_CREDITS_GATE` / `JIMENG_*` 未进 blueprint |
| **改哪里** | `.env.example`、`render.yaml`（auth + 必要时 proxy）、交叉改 `README` 一行即可 |
| **完成标准** | 文档默认与代码一致（execution 默认开）；blueprint 声明 `AI_GATEWAY_CREDITS_GATE`（建议生产值 `reserve`）及 `JIMENG_*`/`VOLCENGINE_*` 的 `sync: false` 占位 |
| **反例** | 只改注释不改 blueprint；或生产仍靠 Dashboard 暗配且无文档 |
| **工作量** | S |
| **结果** | **完成** — example 改为默认开执行 + credits 说明；auth blueprint 钉 `AI_GATEWAY_CREDITS_GATE=reserve` + Jimeng/Volcengine `sync:false`；README 增加 `env:profile:*`。 |

### C4. 生产构建拒绝假绿开关

| 项 | 内容 |
| --- | --- |
| **现象** | `VITE_USE_BROWSER_GEMINI_KEY_FIRST`、`VITE_*_DIRECT`、`VITE_AI_WORKER_PROXY_API=same-origin` 可打进生产包 |
| **改哪里** | `scripts/` guard（挂 `npm run build` 前或 CI）；可选 Vite 插件 |
| **完成标准** | `NODE_ENV=production` / CI build 若检测到上述开关 → 失败；本地 `dev` 仍可用 |
| **反例** | 仅文档警告；生产包仍带 DIRECT |
| **工作量** | S |
| **结果** | **完成** — `scripts/check-false-green-vite-env.mjs`；`npm run guard:false-green` 挂在 `build` 前；CI 独立一步；vitest 覆盖。 |

### C5. 拓扑错配运行时告警

| 项 | 内容 |
| --- | --- |
| **现象** | `.env.development` 常见：前端云 proxy + 本机 auth → Cookie/积分/公平桶不在同一用户世界 |
| **改哪里** | `services/` 启动或首次 AI 调用自检（对比 `VITE_AUTH_API_BASE_URL` 与 proxy/`AUTH_API_BASE` 世界）；Dev/Compose 黄条；`prod-like` 可硬失败 |
| **完成标准** | 错配组合可见（文案点明「勿当预发」）；`env:profile:prod-like` 下退出非 0 |
| **反例** | 静默错配半小时才发现 credits/fairness 怪 |
| **工作量** | M |
| **结果** | **完成** — `services/aiEnvTopology.ts` + `AiEnvTopologyBanner`（DEV 黄条）；`env:profile:prod-like` 已硬失败（C1）；vitest 覆盖。 |

### C6. Credits gate 钉死

| 项 | 内容 |
| --- | --- |
| **现象** | 本地默认 `plan`，线上常 `reserve`；计费/预扣失败只在线上复现 |
| **改哪里** | `server/ai-gateway/credits-gate.js` 文档+默认策略；`render.yaml`；C1 profile 校验 |
| **完成标准** | 预发/生产强制或文档钉死 `reserve`；`plan` 仅 `dev` profile，且自检标明「不可当预发」 |
| **反例** | 本地 plan 绿、线上 `CREDITS_*` 红仍当「Gateway 坏了」 |
| **工作量** | S |
| **结果** | **完成** — 未设置时 production 默认 `reserve`；health 暴露 `creditsGatePolicy`；生产误用 plan 打 WARN，`AI_GATEWAY_CREDITS_GATE_STRICT=true` 拒启动；render.yaml 已钉 reserve（C3）。 |

---

## P1：假绿波（契约后立刻做）

### C13. Fairness / Vertex 间隔对齐

| 项 | 内容 |
| --- | --- |
| **现象** | 非 prod fairness 默认关；Vertex 图间隔本地 0、线上 ~65s → 本地连打成功、线上像卡住 |
| **改哪里** | C1 `prod-like` 强制项；`server/ai-worker-proxy-throttle.js` / fairness 默认说明；`.env.example` |
| **完成标准** | `prod-like` 要求 fairness 开 + 间隔与生产一致（或验收必须打 Render proxy）；自检覆盖 |
| **反例** | 本地关 fairness 连打当预发通过 |
| **工作量** | S |
| **结果** | **完成** — `env:profile:prod-like`：云 proxy 认 Render 默认；本机 proxy 硬要求 fairness+≥60s；`render.yaml` 钉 `GEMINI_VERTEX_IMAGE_MIN_INTERVAL_MS=65000`。 |

### C12. 清噪音双轨 + 文档 scrub

| 项 | 内容 |
| --- | --- |
| **现象** | 服务端仍挂 `async-batch`；`geminiService` 不可达 legacy 枝；health 可能列 music；旧文档写 IMAGE_EXECUTION 回滚 / video bridge；`aiGatewayByokPathAudit` 称 chat「默认 Gateway」与实现不符 |
| **改哪里** | `server/ai-worker-proxy-api.js`、`geminiService.ts`、health/modalities、`shared/aiGatewayByokPathAudit.ts`、`workflowAiPickIndex.ts`、`types.ts`、过时 `docs/*` 段 |
| **完成标准** | 用户/运维文档不再教已删开关；审计表与代码一致；async-batch 下线或标 internal-only；health 无 music |
| **反例** | 新人按旧文档设 `legacy` 以为还能回退 |
| **工作量** | S |
| **结果** | **完成** — async-batch 默认 410；删 geminiService 不可达 legacy POST；health 去 music；BYOK 审计/types/pickIndex/公平排队文档已 scrub。 |

### C7. 文案 / 理解收口 Jobs

| 项 | 内容 |
| --- | --- |
| **现象** | `understand*` / `workflowChat` / detect/describe / 站点助手仍走 `/proxy/gemini/generate-content` 或浏览器 Key；失败可 `shouldFallbackUnderstandToBrowserGemini` |
| **改哪里** | `services/geminiService.ts`、`unifiedAiGateway.ts`、`capabilityExecutor.ts`、`workflowAiPickIndex.ts` |
| **完成标准** | 用户可达理解/对话主路 → `runUnifiedTextGeneration`（或等价 text Job）；浏览器 fallback 仅显式 BYOK 工具；索引不再 `partial_gateway`（对已收口项） |
| **反例** | 本地有 Gemini Key 理解绿、线上无浏览器 Key 挂 |
| **工作量** | L |
| **结果** | **完成（主路）** — `runUnifiedContentsTextGeneration`；`getDialogTextResponse` / `understandImageEditIntent` / `workflowChat` → Gateway Job；浏览器 fallback 关闭。站点助手 / detect/describe 仍 raw（可跟 C8 一并收）。 |

### C8. PBR / 助手生图收口

| 项 | 内容 |
| --- | --- |
| **现象** | `generatePBRTexture` 等仍 `getAIForImageModel`，不进 Admin Jobs |
| **改哪里** | `geminiService.ts`、`unifiedAiGateway.ts`、相关实验页入口 |
| **完成标准** | 用户可达生图类一律 `runUnifiedImageGeneration` / `createAiJob` |
| **反例** | 贴图成功但 Jobs 列表空白 |
| **工作量** | M |
| **结果** | **完成** — `generatePBRTexture` → `runUnifiedImageGeneration`；站点助手文 → `runUnifiedContentsTextGeneration`。擂台文案仍 raw（非生图）。 |

### C9. 3D 平台化

| 项 | 内容 |
| --- | --- |
| **现象** | Tripo 非平台 Key 走 `/api/tripo`；腾讯依赖 `VITE_TENCENT_PROXY`/不安全浏览器凭据；生产无 ai3d-proxy |
| **改哪里** | `tripoWorkflow.ts`、`tencentService.ts`、`aiGatewayModel3dExecution.ts`、`App.tsx` / Workflow 入口；锁 `VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS` |
| **完成标准** | 用户主路 Tripo=平台 Key+Gateway；混元=Gateway adapter；生产构建禁不安全浏览器凭据；本机 9001 仅诊断 |
| **反例** | 本机用户 Tripo Key 出模掩盖平台 Key 池空 |
| **工作量** | L |
| **结果** | **完成** — 工作流/资产集混元 → `createAndPollAiGatewayModel3dJob`；Tripo workflow 在 model3d execution 开启时强制平台 Key；下载/拉取用平台 Key；`VITE_TENCENT_PROXY` 仅诊断（env-profile prod-like 失败）；不安全浏览器凭据仍由 C4 `guard:false-green` 锁。`tencentWorkflowRunImageTo3D` 留作 legacy/诊断。 |

---

## P2：发现波（不挡契约，但决定「算不算数」）

### C10. 冒烟矩阵扩容

| 项 | 内容 |
| --- | --- |
| **现象** | 仅 `smoke:ai-gateway-302`；默认打生产 auth；无 Vertex/Jimeng/Tripo live；未进强制 CI |
| **改哪里** | `scripts/ai-gateway-*-smoke.mjs`、`package.json`、可选 `.github/workflows`（`OPTIONAL=1`） |
| **完成标准** | 矩阵：302 文本+图、Gemini/Vertex handoff（断言 `proxyJobId`）、Jimeng Job、Tripo 平台 Key；缺凭据 SKIP；有凭据 hard-fail |
| **反例** | 只测 302 宣布「预发全绿」 |
| **工作量** | M |
| **结果** | **完成** — `npm run smoke:ai-gateway-matrix`（`smoke:ai-gateway-302|vertex|jimeng|tripo`）；`AI_GATEWAY_SMOKE_OPTIONAL=1` 缺钥 SKIP；矩阵子进程 `REPORT_BLOCKED=1` 区分 SKIP/OK；Vertex 断言 `proxyJobId`；CI dry-run 步；Generation Test 回传 `proxyJobId`。 |

### C11. 多服务同版本门禁

| 项 | 内容 |
| --- | --- |
| **现象** | web / auth-api / ai-worker-proxy 可各发各的；前端新、proxy 旧 → 假故障 |
| **改哪里** | 三服务 `/healthz` 暴露 `buildSha`（或 `gitSha`）；冒烟脚本比对；部署清单一节 |
| **完成标准** | 冒烟前三服务 SHA 一致（或显式允许矩阵）；文档要求同 SHA 验收 |
| **反例** | 只 redeploy web 当全站已更新 |
| **工作量** | M |
| **结果** | **完成** — `shared/buildSha.js`；auth/proxy `/healthz` + web `public/healthz`（build 写入）与 Vite 开发中间件；`npm run smoke:build-sha`；矩阵首车道；`ALLOW_BUILD_SHA_MISMATCH=1` 显式放行。验收：三服务同 `RENDER_GIT_COMMIT`/`BUILD_SHA` 后再宣布预发通过。 |

### C14. R2 产物契约

| 项 | 内容 |
| --- | --- |
| **现象** | 本地无 `R2_*` 时 job 仍可 succeeded（data URL / 供应商临时链）；跨设备「成功没文件」 |
| **改哪里** | `job-media-archive.js`、冒烟断言、C1 对 R2 的 WARN |
| **完成标准** | 预发无 R2 → 自检/冒烟 WARN；有 R2 时成功任务媒体可二次 GET（非过期临时链优先） |
| **反例** | 任务绿但刷新后图 404 |
| **工作量** | M |
| **结果** | **完成** — 无 R2：`mediaArchive.status=skipped` + env-profile WARN；有 R2：inline + 远程图片拉回写 R2；video 默认不归档；`smoke:ai-gateway-r2` 二次 GET；healthz/`aiGateway.mediaArchive` 暴露策略。 |

### C16. 观测对齐

| 项 | 内容 |
| --- | --- |
| **现象** | 本地看终端、线上看另一套日志；缺少统一「失败舞台 + proxyJobId + 构建版本」 |
| **改哪里** | `AdminAiJobsPanel` / job 公开摘要；`job-public-summary.js`；curl 示例进手册 |
| **完成标准** | Job 详情固定：`gatewayFailure` + `proxyJobId`（若有）+ auth/proxy `buildSha`；本地可用同一 JSON 结构排查 |
| **反例** | 只能猜是 Cookie、Key 还是 Vertex 间隔 |
| **工作量** | M |
| **结果** | **完成** — `job.observability` / detail.`observability`：`gatewayFailure`+`proxyJobId`+`mediaArchive`+`buildSha.{auth,proxy}`；Admin 详情「排查卡」；auth 缓存 proxy `/healthz` SHA。Curl：见下。 |

```bash
# 登录后取 Job 排查卡（本地/线上同一 JSON）
curl -sS -b cookies.txt "$AUTH/api/ai/jobs/$JOB_ID" | jq '.observability // .job.observability'
# 对照三服务版本
curl -sS "$AUTH/healthz" | jq '{service,buildSha}'
curl -sS "$PROXY/healthz" | jq '{service,buildSha}'
```

### C15. 真正 Staging（可选 · 终极）

| 项 | 内容 |
| --- | --- |
| **现象** | `render.yaml` 仅一套 prod 名；smoke「staging」实打生产 |
| **改哪里** | `render.yaml` 或独立 blueprint：`*-staging` web/auth/proxy + DB；smoke 默认 base URL 改 staging |
| **完成标准** | 有独立库与 Key；冒烟默认不打生产；生产发布前 staging 矩阵绿 |
| **反例** | 继续在生产上做「预发」实验 |
| **工作量** | L |

---

## 「测好了算数」（C 轮总验收）

同时满足才可声称「预发通过」：

1. 跑过 `env:profile:prod-like` 且通过（C1），无拓扑错配（C5）。  
2. ops / Key / 发布白名单与目标环境一致（C2）。  
3. `credits=reserve`，fairness + Vertex 间隔按生产（C6/C13）。  
4. 无浏览器 Key First / DIRECT / same-origin / 不安全腾讯凭据（C4）。  
5. 用户路径样例：文生图 + 理解文案 +（若启用）即梦/Tripo 平台冒烟通过（C7/C10）。  
6. 成功任务产物可再次拉取（C14）；三服务版本一致（C11）。  

**明确不算数**：本机 disk 空配 + 浏览器 Key；Admin Generation Test；只跑 vitest；只测 302。

---

## 非目标（本轮不扩）

- 重做商业定价模型  
- Companion / Sam / A-Driver 云端化  
- proxy 异步 job 迁出内存（可另开 D 轮）  
- 多区域多活  

---

## 附录 A · 背景速查（执行时按需翻）

### A1 最高频错配

本机 auth `:9100`（disk）+ 云端 `VITE_AI_WORKER_PROXY_API` → 登录与代理积分/公平桶不在同一世界。

### A2 假绿黑名单

`same-origin` · `VITE_USE_BROWSER_GEMINI_KEY_FIRST` · `VITE_OPENAI_DIRECT` · `VITE_VECTOR_ENGINE_DIRECT` · `VITE_ALLOW_UNSAFE_TENCENT_BROWSER_CREDS` · `AI_GATEWAY_EXECUTION_ENABLED=false` · 本地 `plan` 当预发 · Admin Generation Test 当用户路径

### A3 持久化两世界（无 / 有 `DATABASE_URL`）

| 领域 | 本地 disk | 线上 PG |
| --- | --- | --- |
| model-ops | `server/data/model-ops-config.json` | `model_ops_config` |
| provider keys | `ai-gateway-provider-keys.json` | `ai_gateway_provider_keys` |
| ops-control | `ai-gateway-ops-control.json` | `ai_gateway_ops_control` |
| jobs | JSON 镜像 | `ai_gateway_jobs` |
| fairness | `gemini-fairness-config.json` | `gemini_fairness_config` |

### A4 用户可达旁路（历史快照 · 已由 C7–C9 / D 轮收口）

> **D9**：下表为 C 轮起草时「仍活旁路」盘点，**勿当现行状态**。现行以 [`AI-Gateway优化清单-D轮-验收即线上.md`](./AI-Gateway优化清单-D轮-验收即线上.md) 与 `workflowAiPickIndex` 为准。

| 路径 | C 轮起草时 | 现行（2026-07-25） |
| --- | --- | --- |
| 文生图 / 即梦 / 工作流视频 | Gateway-only | Gateway-only |
| 理解 / chat / detect / describe / 助手 | sync/浏览器（→C7） | 主路 Gateway Job（D5/D6）；legacy raw 仅对照 |
| PBR 等生图 | 旧 client（→C8） | `runUnifiedImageGeneration` |
| Tripo / 混元 3D | 用户 Key / 9001（→C9） | 平台 Key + Gateway；9001 诊断且生产禁（D4） |
| OpenAI / VectorEngine DIRECT | 本地反代绿（→C4） | `guard:false-green` 生产禁 |

### A5 关键路径

`render.yaml` · `.env.example` · `.env.development` · `vercel.json` · `scripts/ai-gateway-302-staging-smoke.mjs` · `server/ai-gateway/*` · `server/ai-worker-proxy-*.js` · `services/geminiService.ts` · `unifiedAiGateway.ts` · `capabilityExecutor.ts` · `workflowAiPickIndex.ts` · `shared/aiGatewayByokPathAudit.ts` · `docs/线上生图部署清单.md` · `.github/workflows/ci.yml`

---

## 变更日志

| 日期 | 说明 |
| --- | --- |
| 2026-07-25 | 初版穷尽盘点 |
| 2026-07-25 | 重整为 B 轮同构可执行清单：总表 + P0/P1/P2 切片（现象/改哪里/完成标准/反例）+ 附录速查 |
| 2026-07-25 | C1 **完成** — `env-profile-check` + npm scripts + vitest |
| 2026-07-25 | C3 **完成** — `.env.example` + `render.yaml` credits/Jimeng 补洞 |
| 2026-07-25 | C4 **完成** — `guard:false-green` + build/CI 门禁 |
| 2026-07-25 | C6 **完成** — production 默认 reserve + STRICT 拒启动 + health policy |
| 2026-07-25 | C5 **完成** — aiEnvTopology + DEV 黄条 |
| 2026-07-25 | C2 **完成** — admin:pull-online-config 只读对齐 |
| 2026-07-25 | C13 **完成** — prod-like fairness/Vertex 间隔契约 + blueprint 65s |
| 2026-07-25 | C12 **完成** — async-batch 410 + 死枝/文档/music scrub |
| 2026-07-25 | C7 **完成（主路）** — chat/understand → runUnifiedContentsTextGeneration |
| 2026-07-25 | C8 **完成** — PBR + 站点助手走 Gateway Job |
| 2026-07-25 | C9 **完成** — Tripo 强制平台 Key；混元主路 Gateway；9001 仅诊断 |
| 2026-07-25 | C10 **完成** — smoke matrix 302/Vertex/Jimeng/Tripo + CI dry-run |
| 2026-07-25 | C11 **完成** — 三服务 healthz.buildSha + smoke:build-sha |
| 2026-07-25 | C14 **完成** — R2 媒体归档/WARN + smoke 二次 GET |
| 2026-07-25 | C16 **完成** — Job observability 卡 + Admin 排查卡 + curl；C15 可选未做 |
