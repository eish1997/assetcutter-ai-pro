# AI Gateway 优化清单（D 轮 · 验收即线上）

**日期**：2026-07-25  
**状态**：**D1–D9 完成**；D10 Staging **可选跳过**（独立立项）。  
**定位**：C 轮已铺好「环境契约」工具与主路收口；本轮专治 **绿了但不算数**——验收绿灯必须等价于「该环境可运营」。  
**前序**：B = 用户主路进 Gateway Job；C = 本地↔线上环境契约（C1–C14+C16；C15 Staging 仍可选）。

---

## 1. 我们要解决的问题

### 一句话

**本机/CI/Admin 面板上的「绿」经常不等于生产用户可用。**

### 拆开说（四个失真）

| 失真 | 白话 | 典型症状 |
| --- | --- | --- |
| **拓扑假绿** | 测的是 A 世界，上的是 B 世界 | 本机 auth + 云 proxy；Cookie / 积分桶 / 公平队列不在同一用户 |
| **旁路假绿** | 用户路径没走平台门，靠本机钥匙 | 独立「生成 3D」用腾讯代理/用户 Key；能力预设 / 分镜仍 `partial_gateway`；detect/describe 不进 Job |
| **门禁假绿** | 检查脚本「通过」但其实没验到关键路径 | CI 冒烟 `OPTIONAL=1` 全 SKIP 仍 exit 0；Route/Key Check 绿 ≠ Generation；无 R2 仍 Job succeeded |
| **文档假绿** | 说明书还在教已废路径 | 公平排队正文仍写 async-batch；索引/未收口清单仍写「混元要腾讯凭据」 |

根因不是「Gateway 写得不够多」，而是：

> **验收定义没钉死「算绿」的条件**——缺钥、旁路、SKIP、WARN、短链成功都被当成通过。

---

## 2. 目标是什么

### 产品目标

平台 AI（图 / 文 / 视频 / 3D / 理解）对**普通登录用户**在目标环境（生产或真 Staging）上：

1. **只靠平台 Key 池 + Gateway Job** 可完成（不依赖浏览器供应商 Key、不依赖本机 9001）。
2. **成功可复现**：媒体可二次打开（优先 R2）；失败可在 Admin 同一套排查卡定位。
3. **计费与限流真生效**：credits=`reserve`、fairness/间隔与生产一致。

### 工程目标（本轮可验收）

宣布「预发/生产验收通过」时，必须同时满足：

| # | 硬条件 |
| --- | --- |
| G1 | `env:profile:prod-like` 对目标 env 通过（非仅 `dev`） |
| G2 | 三服务 `buildSha` 一致（或显式 `ALLOW_BUILD_SHA_MISMATCH` 有书面原因） |
| G3 | 冒烟矩阵：**有钥车道 hard-fail；全 SKIP 不得宣布通过**（预发强制 `AI_GATEWAY_SMOKE_OPTIONAL=0` live） |
| G4 | 用户可达入口在 `workflowAiPickIndex` 中为 `gateway`（或显式 `admin_only` / `local`）；禁止静默 `partial_gateway` |
| G5 | 成功 Job 在有 R2 时媒体可二次 GET；无 R2 时不得当生产验收通过 |

### 非目标（本轮不做）

- 重做供应商适配器 / 商业化定价大改（见运营手册与多模态清单）。
- 强制立刻上真 Staging（C15）——**推荐但不阻塞**；无 Staging 时验收必须打生产且遵守 G1–G5。
- 把所有 `geminiService` raw API 物理删除（保留给显式 BYOK / 内部工具即可，但用户主路禁止 import）。

---

## 3. 与 B / C 的关系

| 轮次 | 解决了什么 | 仍没解决什么 |
| --- | --- | --- |
| **B** | 工作流图/视频/即梦等主路进 Job；单门执行 | 本地拓扑、旁路页、验收纪律 |
| **C** | profile 自检、假绿 Vite 门、credits/fairness 对齐、主路文/图/工作流 3D、冒烟矩阵、buildSha、R2 归档、排查卡 | **「绿」的定义仍可被 SKIP/旁路/文档钻空**；独立 Generate3D、能力预设、分镜、检测类、STRICT/CI 纪律未钉死 |
| **D（本轮）** | 把「算绿」钉死，并清掉仍在骗验收的旁路与假绿门禁 | — |

C 轮清单保留为历史与工具索引：`docs/AI-Gateway优化清单-C轮-环境契约.md`。  
**本轮以本文为准排期；C 条「完成」≠ 产品目标达成。**

---

## 4. 执行清单

> **推荐序**：纪律波 D1→D2→D3 → 旁路波 D4→D5→D6 → 产物/观测 D7→D8 → 文档债 D9 → 可选 D10。  
> 工作量：S &lt; 1d，M 1–2d，L 3d+。

### D1. 验收纪律：全 SKIP / dry-run /「一绿全绿」不算绿

| 项 | 内容 |
| --- | --- |
| **对应问题** | 门禁假绿 |
| **现象** | 矩阵默认 OPTIONAL；CI `--dry-run` 无 secrets 全 SKIP exit 0；`aggregateLaneResults` 在「单车道 0 + 其余 SKIP」时仍 `status: 'ok'`（vitest 还钉死该行为）；人容易说「冒烟过了」 |
| **改哪里** | `scripts/ai-gateway-smoke-lib.mjs`（`aggregateLaneResults`）、`ai-gateway-smoke-matrix.mjs`、`tests/aiGatewaySmokeMatrix.test.ts`、CI workflow、短文档「预发通过定义」 |
| **完成标准** | ① 预发强制 `AI_GATEWAY_SMOKE_OPTIONAL=0` + live（非 dry-run）；② **零 Generation 车道成功 → 聚合不得为 ok**（至少要求一条真实 Generation，或显式 `SMOKE_ALLOW_ROUTE_ONLY=1`）；③ CI 全 SKIP / 仅 dry-run → neutral 或 summary「未测」，禁止当矩阵绿；④ 输出 `OK/SKIP/FAIL` + 是否含 Generation |
| **反例** | CI 绿条 + 零 live Generation；或 302 dry-run 绿就宣布全矩阵绿 |
| **工作量** | S–M |
| **状态** | **完成** — `aggregateLaneResults`：全 SKIP→`skipped`；dry-run→`dry_run`；无 Generation 车道→`incomplete`；仅 `SMOKE_ALLOW_ROUTE_ONLY=1` 可 route-only ok。矩阵 summary 含 counts/hasGeneration；CI 步注明非预发绿 + GITHUB_STEP_SUMMARY。预发：`AI_GATEWAY_SMOKE_OPTIONAL=0` 且勿 `--dry-run`。 |

### D2. Credits STRICT 钉进生产蓝图 + prod-like 自检

| 项 | 内容 |
| --- | --- |
| **对应问题** | 拓扑/门禁假绿（计费弱闸） |
| **现象** | `plan`/`off` 直接 `ok: true` 不 reserve；生产误 `plan` 仅 WARN；`render.yaml` / `env-profile-check` 均不强制 STRICT |
| **改哪里** | `render.yaml`、`credits-gate.js`、`scripts/env-profile-check.mjs`、`.env.example` |
| **完成标准** | 生产 blueprint 钉 `reserve` **且** STRICT（或 production 误 plan 拒启动）；`env:profile:prod-like` 校验 STRICT/等价硬闸 |
| **反例** | Dashboard 手改 plan 仍能起服务；profile 绿但未查 STRICT |
| **工作量** | S |
| **状态** | **完成** — `render.yaml` 钉 `AI_GATEWAY_CREDITS_GATE_STRICT=true`；production 未设置 STRICT 时默认拒 plan/off；`env:profile:prod-like` 硬要求 STRICT；仅显式 `STRICT=false` 保留 WARN。 |

### D3. prod-like / 拓扑：验收入口强制可见（不可永久消音）

| 项 | 内容 |
| --- | --- |
| **对应问题** | 拓扑假绿 |
| **现象** | 黄条仅 DEV + 工作流；`ac_ai_env_topology_banner_dismissed` 可永久关闭；`.env.example` 仍教本机 auth + 云 proxy |
| **改哪里** | `AiEnvTopologyBanner.tsx`、挂载点、`aiEnvTopology.ts`、`.env.example` 注释 |
| **完成标准** | ① AI 密集页可见拓扑告警；② dismiss 仅会话级或每次启动重现严重错配；③ 文档写明未跑通 `env:profile:prod-like` 禁止宣布预发通过 |
| **反例** | 关掉黄条后半个月仍当预发 |
| **工作量** | S |
| **状态** | **完成** — dismiss 改 sessionStorage（本标签页）；主站 `App` + `AdminLayout` 挂载；工作流去重；`.env.example` 标明勿当预发 + `env:profile:prod-like`。 |

### D4. 3D 旁路收口（独立页 + MODEL3D 开关 + 拉取 + false-green）

| 项 | 内容 |
| --- | --- |
| **对应问题** | 旁路假绿（C9 反例仍活） |
| **现象** | ① `useGenerate3DManager` / `tencentQueueRunner` 完整 BYOK 队列仍在仓；② `VITE_AI_GATEWAY_MODEL3D_EXECUTION=false` 可重开 Tripo 用户 Key，且 `guard:false-green` / env-profile **不查**；③ lightbox「混元拉取」仍 `getTencentCredsFromEnv`；④ `VITE_TENCENT_PROXY` 可进生产包，example 默认写 9001 |
| **改哪里** | `tripoWorkflow.ts`、`aiGatewayModel3dExecution.ts`、`useGenerate3DManager.ts`、`WorkflowSection` 拉取、`check-false-green-vite-env.mjs`、`.env.example`、预设文案 |
| **完成标准** | 用户可达生成/拉取走 Gateway 或平台产物；生产构建禁 `MODEL3D_EXECUTION=false` 与裸 `VITE_TENCENT_PROXY`（或仅 `admin_only` 诊断）；死枝队列不可被用户入口接回 |
| **反例** | 关 MODEL3D 本机出模掩盖平台 Key 空；生产包带 9001 |
| **工作量** | M |
| **状态** | **完成（门禁+文案）** — `guard:false-green` / `prod-like` 禁 `MODEL3D=false` 与裸 `VITE_TENCENT_PROXY`；example 默认不再写出 9001；lightbox 无代理时拒绝并指向 Gateway 产物；预设文案已 scrub。独立 `useGenerate3DManager` 队列仍在仓内（未挂主入口），后续若接回须走 Gateway。 |

### D5. 能力预设 + 分镜 → Gateway（去 partial）

| 项 | 内容 |
| --- | --- |
| **对应问题** | 旁路假绿 |
| **现象** | `capability_preset_execute`、`storyboard_ai` 仍 `partial_gateway` |
| **改哪里** | `capabilityExecutor.ts`、分镜 services、`workflowAiPickIndex.ts`、`docs/架构未收口清单.md` A1/A3 |
| **完成标准** | 用户主路执行 → `createAiJob` / unified generation；索引 `routeStatus: gateway`；浏览器 Key 仅 BYOK |
| **反例** | 本地有 Gemini Key 预设绿、线上无 Key 红 |
| **工作量** | L |
| **状态** | **完成（主路）** — `capability_preset_execute` / `workflow_3d` → `gateway`；检测/描述改走 Gateway Job（见 D6）。 |

### D6. 检测 / 描述 / 分镜结构 → Job（或明确降级标签）

| 项 | 内容 |
| --- | --- |
| **对应问题** | 旁路假绿 + 观测盲区 |
| **现象** | `detectObjectsInImage` / `describeImageSubject` / 结构解析经 gate 包装但仍 raw gemini，无 Job |
| **改哪里** | `unifiedAiGateway.ts`、`geminiService.ts`、调用方 |
| **完成标准** | **二选一且写进索引**：① 进 text/vision Job；或 ② 标 `admin_only`/`tooling` 且产品不把它当「平台 AI 主路」验收项 |
| **反例** | 索引写 gateway，实际 Admin Jobs 永远没有对应记录 |
| **工作量** | M–L |
| **状态** | **完成** — detect/describe/结构解析均 `runUnifiedVisionTextGeneration`；`storyboard_ai` → `gateway`；legacy raw 仍留在 `geminiService` 供对照，用户入口不走。 |

### D7. 「成功没图」用户侧可见 + 列表观测 + 视频归档

| 项 | 内容 |
| --- | --- |
| **对应问题** | 门禁假绿（产物）+ 观测盲区 |
| **现象** | `mediaArchive.skipped` 仅详情排查卡；列表无 archive/failure/buildSha；video 默认不拉回；无 R2 时 smoke R2 车道 SKIP |
| **改哪里** | 前端 Job 回传 toast；`AdminAiJobsPanel` 列表列；`job-media-archive.js`；`smoke:ai-gateway-r2` |
| **完成标准** | ① 用户侧无持久 URL 有明确提示；② Admin **列表**可扫到 skipped / 无 proxyJobId；③ 有 R2 预发必跑二次 GET；④ 视频归档或产品承认短链 |
| **反例** | Job succeeded、跨设备 404；列表全绿要点进详情才知无 R2 |
| **工作量** | M |
| **状态** | **完成** — Admin/用户 Jobs 列表可扫 `mediaArchive`；skipped 用户提示 + 生图成功 soft toast（`media_ephemeral`）；视频默认不归档（短链），`.env.example` 注明 `AI_GATEWAY_MEDIA_ARCHIVE_REMOTE_VIDEO`。有 R2 预发仍跑 `smoke:ai-gateway-r2`。 |

### D8. Route/Key 绿 ≠ Generation；buildSha 子集「对齐」收紧

| 项 | 内容 |
| --- | --- |
| **对应问题** | 门禁假绿 |
| **现象** | Route/Key 被当可运营；`compareBuildShas` 只比「可达且有 sha」子集（web 挂仍可能 auth≈proxy 报 aligned）；`ALLOW_BUILD_SHA_MISMATCH` 可放行 |
| **改哪里** | Admin 面板文案；`check-build-sha-alignment.mjs`；可选发布前聚合检查 |
| **完成标准** | ① UI 三档：Key / Route / **Generation**，仅前两档不得「可上线」；② buildSha：**三服务皆可达且同 sha** 才算对齐（缺一即失败，除非显式放行并记原因） |
| **反例** | Key Check 绿就开白名单；只比对两服务当全站已更新 |
| **工作量** | S–M |
| **状态** | **完成** — Admin 测试层级 + 发布成功文案强调三档；`compareBuildShas` 要求 web+auth+proxy 皆可达且同 sha（缺一 `incomplete`，非绿）。 |

### D9. 文档与索引 scrub + 死枝开关说明

| 项 | 内容 |
| --- | --- |
| **对应问题** | 文档假绿 |
| **现象** | 公平排队正文仍教 async-batch；`cargo_image`/`cargo_3d` 备注过时；C 附录 A4 与 C7–C9「完成」矛盾；`AI_WORKER_PROXY_ASYNC_BATCH_ENABLED` / `music-worker.js` 残留可误开 |
| **改哪里** | 公平排队长文、架构未收口清单、C 附录、`WORKFLOW_AI_CARGO_ROWS`、`DOCS.md`；async-batch/music 标 internal-only 或删文档路径 |
| **完成标准** | 新人不会去打 async-batch / 本机 9001 当主路；索引与代码一致；误开 internal 开关有醒目警告 |
| **反例** | 半页免责 + 半页旧步骤 |
| **工作量** | S |
| **状态** | **完成** — 公平排队文首标历史规格；C 附录 A4 改为「起草时/现行」对照；`workflowAiPickIndex` cargo_image/3d 备注 Gateway；`DOCS.md` §五不再教 localhost 代理主路；`.env.example` + async-batch 410 文案标明误开禁预发；music-worker 已删并注明勿恢复。 |

### D10. 真 Staging（可选 · 终极）

| 项 | 内容 |
| --- | --- |
| **对应问题** | 无隔离预发，实验碰生产 |
| **现象** | smoke 默认生产 URL；无 `*-staging` 三服务+库 |
| **改哪里** | Render blueprint / 环境变量 / smoke 默认 URL（承接 C15） |
| **完成标准** | 独立 Staging；矩阵默认打 staging；生产仅发布闸 |
| **反例** | 用生产当唯一「预发」且 OPTIONAL SKIP |
| **工作量** | L |
| **状态** | **跳过（可选）** — D 轮 Goal 以 D1–D9 为完成门槛；Staging 独立立项。 |

---

## 5. 「预发通过」检查表（给人用）

复制打勾；任一项否 → **不得**写「预发通过」。

- [ ] `npm run env:profile:prod-like` 针对目标 env 退出 0（未通过禁止宣布预发；DEV 拓扑黄条关闭仅本会话有效）  
- [ ] `npm run smoke:build-sha` 三服务一致  
- [ ] `AI_GATEWAY_SMOKE_OPTIONAL=0` **live**（勿 `--dry-run`）跑矩阵；summary `status=ok` 且 `hasGeneration=yes`（勿把 `skipped`/`dry_run`/`incomplete` 当通过）  
- [ ] `npm run smoke:ai-gateway-r2`（有 R2）或明确记录「无 R2，不验收产物持久化」  
- [ ] 用户路径抽检：工作流图 + 独立页 3D（D4 后）+ 无浏览器供应商 Key  
- [ ] Admin 抽一单失败/成功 Job，排查卡含 `gatewayFailure` / `proxyJobId` / `buildSha` / `mediaArchive`  
- [ ] 无未解释的 `partial_gateway` 用户入口（对照 pickIndex）

---

## 6. 风险 → 切片对照（含深挖增量）

来源：C 轮验收审计 + [深挖C轮风险](a98a8df6-ac2b-4130-9117-2cd22a4831f5)。

| 风险（摘要） | 切片 |
| --- | --- |
| 矩阵「一绿全绿」/ dry-run / 全 SKIP 假绿 | D1 |
| 冒烟默认打生产 | D1、D10 |
| detect/describe sync proxy、无 Job | D6、D5 |
| `MODEL3D_EXECUTION=false` 重开 Tripo 用户 Key | D4 |
| Credits plan 放行、STRICT 未钉 | D2 |
| mediaArchive skipped；video 不归档；列表无观测 | D7 |
| buildSha 子集对齐 / ALLOW 放行 | D8、§5 |
| 拓扑黄条可永久 dismiss | D3 |
| `VITE_TENCENT_PROXY` 漏网 false-green；lightbox 拉取 | D4 |
| pickIndex cargo / 附录半 scrub；async-batch 文档 | D9 |
| 能力预设 / 分镜 / workflow_3d partial | D5 |
| 腾讯队列死枝复燃 | D4 |
| 无 Staging | D10 |

---

## 7. 成功长什么样（验收叙事）

**以前**：开发者本机跑通 → 觉得 Gateway 好了 → 上线用户报「没 Key / 没图 / 卡住」。

**以后**：任何人宣布环境可用时，只能指着 §5 检查表；绿灯意味着：

> 同一 auth 世界、平台 Key、真计费、真限流、真出图、真可二次打开、真同版本——而不是「脚本没报错」。

---

## 附录：相关路径

| 用途 | 路径 |
| --- | --- |
| C 轮（工具与历史完成项） | `docs/AI-Gateway优化清单-C轮-环境契约.md` |
| 未收口架构条目 | `docs/架构未收口清单.md` |
| 拣货索引 | `services/workflowAiPickIndex.ts` |
| 环境自检 | `npm run env:profile:prod-like` |
| 冒烟矩阵 | `npm run smoke:ai-gateway-matrix` |
| 运营接聚合商 | `docs/AI-Gateway运营接聚合商手册.md` |
