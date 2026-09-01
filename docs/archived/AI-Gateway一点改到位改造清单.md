# AI Gateway「一点改到位」改造清单

**日期**：2026-07-24  
**定位**：替换「先加一层、旧路径继续活着」的推进方式。每个切片必须做到：**只剩一条真相、旧路径删除、前后端与后台同语义、测试锁死**。  
**与旧清单关系**：
- `docs/AI-Gateway优先改造清单.md` — P0–P2 已落地雏形，但存在双轨遗留；本文负责**收口与删除旧路径**。
- `docs/AI-Gateway供应商聚合平台改造清单.md` — 长期平台愿景；本文切片 5 才开始碰配置化接入。
- `docs/AI-Gateway多模态商业化改造清单.md` — 历史进度与背景；执行以本文为准。
- `docs/AI-Gateway下一轮问题改造清单.md` — **切片 1–6 完成后的下一轮执行主清单**（路由单源 / 后台接聚合商 / 多模态异步 / Fallback / 放量 / 旁路清退）。

## 一句话目标

一次只改一个点；这个点改完后，仓库里**不能再有第二套判断/第二套错误形状/第二套产物字段**。

## 硬规则（写进每个 PR）

| 规则 | 要求 |
| --- | --- |
| 单点 | 一个切片只解决一个问题域，不顺手开下一个切片 |
| 改到位 | 服务端 + 前端消费 + 后台展示 + 单测 + 文档，同一 PR 合入或同批次连续合入，不拆「后端先上、前端以后再说」 |
| 删旧路 | 旧函数/旧字段/旧启发式必须删除或降为薄包装并标明废弃期限 ≤ 7 天；禁止永久双轨 |
| 单真相 | 同一事实只允许一个权威函数或一个权威契约 |
| 可验收 | 每个切片有「反例清单」：若还能复现反例，切片未完成 |
| 禁止 | 新增「兼容层」却不给删除日期；新增平行 API；用注释代替删除 |

### 切片完成门禁（缺一不可）

1. 权威入口只有一个（函数名写在切片里）。
2. `rg` / 测试证明旧入口调用点为 0，或仅剩标注废弃的 re-export。
3. 相关单测全绿；至少覆盖「成功路径 + 3 个失败反例」。
4. 交接文档追加一行：本切片完成日 + 权威入口路径。
5. 下一切片未开始前，不合并下一切片代码。

---

## 切片总览（严格顺序）

| 序 | 切片 | 一句话 | 状态 |
| --- | --- | --- | --- |
| 1 | 路由决策单真相 | 可执行路由只来自 `resolveAiGatewayRouteDecision` | 完成 |
| 2 | 失败原因单真相 | 一切失败只输出 `failureReason`，前端不再猜字符串 | 完成 |
| 3 | 诊断三态分离 | Key / Route / Generation 三 API 三语义，不可混用 | 完成 |
| 4 | Adapter 结果契约 | 所有 adapter 只返回统一 `AiGatewayAdapterResult` | 完成 |
| 5 | OpenAI-compatible 配置接入 | 新聚合商只加配置，不复制 adapter | 完成 |
| 6 | 动态调度 | 健康分/成本选路（仅在 1–5 完成后） | 完成 |

---

## 切片 1：路由决策单真相

### 问题

P0 已有 `resolveAiGatewayRouteDecision`，但计划/执行仍可能再走 `resolveAiProviderRoute`、`createAiGatewayJobPlan` 内二次推断、前端目录另算状态。同一模型多套结论。

### 权威入口

- `resolveAiGatewayRouteDecision`（`server/ai-gateway/model-route-guard.js` / `route-decision.js`）
- 对外公开形状：`publicAiGatewayRouteDecision`

### 本切片必须改完的落点

| 层 | 动作 |
| --- | --- |
| `createAiGatewayJobPlan` / `index.js` | 选路只消费 decision 的 `selectedRoute`；删除 plan 内独立 provider 推断或改为调用 decision |
| `provider-router.js` | 降为「把 selectedRoute 填进 workerRequest」；不再自己排序/猜 provider（或仅内部被 decision 调用） |
| `http-handler.js` / `auth-api-handler.js` | 创建/重试只写一份 `metadata.routeDecision`，执行不得再换一套判断 |
| `shared/aiGatewayModelRoutes.js` | 仅作候选源，不得单独被业务当成「可执行结论」 |
| 前端目录 `modelRouteCatalog` 等 | 展示状态码与 decision.candidates[].status 对齐；禁止本地再发明 gateway_ready 语义 |
| 后台 Route Check / 一屏诊断 | 只展示同一 decision |

### 删除清单（完成时必须为 0）

- 创建任务路径上「先 decision、再忽略 decision 另调 router」的双次选路。
- 前端用静态表推断「可执行」，与服务端 decision 不一致的分支。
- 文档/注释里仍写「以 provider-router 为准」的表述。

### 反例（任一仍存在 = 未完成）

- 同一 `canonicalModelId + modality`，Route Check 与 `POST /api/ai/jobs` 选出不同 provider。
- 前台显示可生成，创建返回 route/key/publication 类错误且 decision 未写入 job。
- `rg "resolveAiProviderRoute"` 仍出现在「业务选路」调用点（允许只存在于 decision 内部或测试夹具）。

### 验收测试

- 扩展 `tests/aiGatewayRouteDecision.test.ts`：创建路径与 Route Check 共用 decision 快照断言。
- 增加回归：pause / key 不可用 / adapter pending / 未发布 —— 前后台同一 `reasonCode`。

### 完成定义

仓库内「能不能跑、走哪条路」只回答一次，答案在 `metadata.routeDecision`。

---

## 切片 2：失败原因单真相

### 问题

P1 已有 `failure-reason.js`，但 adapter/上游/结算仍可能只抛裸 `message`；前端 `unifiedAiGateway` 仍保留字符串启发式兜底。运营看到的 stage/owner 不完整。

### 权威入口

- `resolveAiGatewayFailureReason` / `attachFailureReasonToErrorBody`（`server/ai-gateway/failure-reason.js`）
- Job：`metadata.gatewayFailure`
- HTTP：`{ error, message, failureReason }`

### 本切片必须改完的落点

| 层 | 动作 |
| --- | --- |
| `http-handler` / `auth-api-handler` / credits gate | 所有 4xx/5xx Gateway 错误必带 `failureReason` |
| `executor.js` / `execution-finalize.js` / `settlement.js` | 失败必写 `gatewayFailure`；结算释放原因走同一 code 表 |
| 全部 `adapters/*` | catch/上游失败映射进 failureReason，禁止只 `throw new Error(msg)` 出网关边界 |
| `unifiedAiGateway.ts` | 软提示**只**读 `failureReason`；删除或搬进测试的正则猜 429/key 逻辑 |
| 后台任务/诊断 | 按 `stage` / `owner` 过滤；无 failureReason 的 failed job 视为缺陷 |

### 删除清单

- 前端生产路径上的失败字符串启发式（`/429|API key|.../` 之类）。
- 「有的错误有 failureReason、有的没有」的分支说明；改为类型/测试强制。

### 反例

- 任意 adapter 故意失败（超时、上游 429、空产物）后，job 无 `metadata.gatewayFailure`。
- 前端在缺少 `failureReason` 时仍能「猜出」rate_limit（应改为 unknown + 上报，而不是猜）。
- 管理端 failed job 列表出现无 stage 的失败行。

### 验收测试

- 扩展 `tests/aiGatewayFailureReason.test.ts`：每个 adapter 至少 1 条失败映射（可用 mock upstream）。
- 前端：无 `failureReason` 时不得映射为具体 soft hint（断言 unknown/generic）。

### 完成定义

失败只有一种形状；猜字符串的代码不在生产路径。

---

## 切片 3：诊断三态分离

### 问题

P2 已有一屏诊断与三按钮，但产品语义仍易混：「检查通过」被当成「能生成」。需要 API/文案/权限/计费提示一次钉死。

### 权威入口

| 能力 | API / 模块 | 是否创建任务 | 是否计费 |
| --- | --- | --- | --- |
| Key Check | 现有 Key 探测 | 否 | 否 |
| Route Check | `model-route-test` | 否 | 否 |
| 一屏诊断 | `model-screen-diagnosis` | 否 | 否 |
| Generation Test | `model-generation-test` | **是** | **是**（必须明示） |

### 本切片必须改完的落点

| 层 | 动作 |
| --- | --- |
| 四个后端入口 | 响应顶层带 `checkKind: "key" \| "route" \| "diagnosis" \| "generation"` |
| `AdminProviderKeysPanel` | 四者文案、确认框、结果区不可复用同一「通过」绿标语义；Generation 必须二次确认 + billingNote |
| 文档 | 运营手册式三行：`能连 Key ≠ 能路由 ≠ 能生成` |
| 一屏诊断 | 作为「只读总览」唯一入口；Key/Route/Generation 是子动作，不互相替代 |

### 删除清单

- UI 上把 Route Check 结果画成「生成可用」。
- Generation Test 成功但不返回 `aiGatewayJobId` 的路径。
- 诊断与 Generation 共用同一成功文案。

### 反例

- 运营只跑 Route Check，UI 出现「可生成」类文案。
- Generation Test 无 job id 或未提示计费。
- 一屏诊断与 Route Check 的 `reasonCode` 不一致。

### 验收测试

- `tests/aiGatewayModelScreenDiagnosis.test.ts` 断言 `checkKind`。
- 前端渲染测试：三种结果态文案快照或断言互斥。

### 完成定义

后台不可能把三种检查看成一件事。

---

## 切片 4：Adapter 结果契约（多模态对齐）

### 问题

各 adapter 成功/失败字段不齐：artifacts、output、usage、轮询状态各写各的。接新供应商贵，回归靠碰运气。这是当前最大工程债。

### 权威契约

```ts
type AiGatewayAdapterResult = {
  status: "running" | "succeeded" | "failed" | "cancelled";
  upstreamTaskId?: string;
  output?: Record<string, unknown>;
  artifacts?: Array<{
    kind: "text" | "image" | "video" | "model3d" | "music";
    url?: string;
    mimeType?: string;
    metadata?: Record<string, unknown>;
  }>;
  usage?: Record<string, unknown>;
  failureReason?: AiGatewayFailureReason; // status=failed 时必填
};
```

权威消费：`execution-finalize.js` **只**认上述字段落库；前端 `aiJobArtifacts` **只**从 artifacts/output 恢复。

### 本切片必须改完的落点

| 层 | 动作 |
| --- | --- |
| `workers/types.js` | 定义并导出契约；TS 侧可有镜像类型 |
| 每一个 `adapters/*.js` | 返回值归一；私有字段只放 `output.raw` 或 `artifacts[].metadata` |
| `execution-finalize.js` | 拒绝/打标非契约结果（开发态断言或 metrics） |
| `services/aiJobArtifacts.ts` | 去掉「按供应商特判」的恢复分支（特判进 metadata） |
| 轮询（视频/3D/async） | running → succeeded/failed 状态机统一；超时映射 failureReason |

### 删除清单

- finalize 里按 adapterId 分支抠不同字段名（`images` vs `artifacts` vs `modelUrl`…）。
- 前端按 provider 特判拼 URL 的主路径。

### 反例

- 任一 adapter 成功但无 text output 且无对应 modality artifact。
- 任一 adapter 失败无 `failureReason`。
- 同一模态两个 adapter 的 job.public artifacts 形状不同。

### 验收测试

- 每 adapter 一张「成功契约」+「失败契约」单测（mock HTTP）。
- finalize 单测：非法 shape 不可写成 succeeded。

### 完成定义

新供应商 = 实现同一 result；不再为产物解析开特例主路径。

---

## 切片 5：OpenAI-compatible 配置化接入

### 问题

聚合商（302 / AIHubMix / OpenRouter 等）若继续「一家一个 adapter 文件」，平台化失败。

### 权威入口

- 配置：`openai-compatible-config` + ops/后台供应商配置
- 执行：单一 `openai-compatible-async-adapter`（或 sync+async 两个模板，禁止第三套复制）

### 本切片必须改完的落点

| 层 | 动作 |
| --- | --- |
| 配置 schema | baseURL、auth、modality endpoints、model 映射、超时/轮询 |
| adapter 模板 | 只读配置；无供应商 if-else 丛林 |
| 路由候选 | 新聚合商进候选只需配置 + 发布，不改 `shared/aiGatewayModelRoutes` 硬编码表（或表退化为生成物） |
| 后台 | 新增供应商表单能跑通「诊断三态」 |

### 删除清单

- 为第 N 家兼容 OpenAI 的平台再复制一份 `xxx-adapter.js`（政策禁止）。
- 多处手写同一 upstream model id 映射。

### 反例

- 接入一家新 OpenAI-compatible 平台仍需新增 adapter 源文件才能冒烟。
- 模型映射只存在于前端或只存在于 routes 硬编码。

### 验收测试

- 用 fixture 配置模拟「假聚合商」，不写新 adapter 文件跑通 Route Check + mock Generation。
- 回归：现有已接入的 compatible 路径不回退。

### 完成定义

「加聚合商」的默认工作流是改配置，不是改代码。

---

## 切片 6：动态调度（最后做）

### 前置

切片 1–5 全部完成门禁通过。禁止提前开干。

### 目标

在**单一 decision** 上增加可解释策略：健康分、成本、灰度、熔断恢复；每次自动动作写审计。

### 完成定义

`selectedRoute` 带 `selectionReason`；后台可覆盖并回滚；无黑盒。

---

## 推荐节奏

| 周次 | 切片 | 交付物 |
| --- | --- | --- |
| 第 1 周 | 切片 1 | 选路单真相 + 删双次选路 |
| 第 1–2 周 | 切片 2 | 失败单真相 + 删前端启发式 |
| 第 2 周 | 切片 3 | 诊断三态钉死 |
| 第 3–4 周 | 切片 4 | 全 adapter 契约对齐（最大块） |
| 第 5 周 | 切片 5 | 配置化聚合商 |
| 之后 | 切片 6 | 动态调度 |

若人力不足：**只串行做 1→2→3→4**，不要并行开 5/6。

---

## PR 自检（每个切片 PR）

- [ ] 本 PR 只属于一个切片编号
- [ ] 权威入口已在描述写明
- [ ] 删除清单已用搜索验证为 0（或附废弃 issue + ≤7 天删除日）
- [ ] 反例清单逐条打勾
- [ ] 单测已加且本地通过
- [ ] 未顺手引入下一切片的半成品
- [ ] 交接文档已追加完成行

## 明确不做（在切片 1–4 期间）

- 不重写整个 `unifiedAiGateway.ts` 架构（切片 2 只删启发式、改消费）
- 不上复杂智能调度（切片 6）
- 不把 BYOK / 平台 Key / 代理桥强行合成一种执行形态
- 不新增第二套 job API「以后再迁」

---

## 进度记录

| 日期 | 切片 | 结果 |
| --- | --- | --- |
| 2026-07-24 | — | 清单创建；执行尚未开始 |
| 2026-07-24 | 切片 1（部分） | `createAiGatewayJobPlan` 优先消费 `routeDecision.selectedRoute`；decision 补齐 adapter/worker；`materializeAiProviderRouteFromSelectedRoute`；auth/http 显式传入 decision；fallback 清旧 decision；单测 40 passed。**未完**：前端目录语义对齐、删尽业务侧独立 `resolveAiProviderRoute` 选路、交接完成行 |
| 2026-07-24 | 切片 1（部分） | 目录/规则状态词汇对齐 decision candidates：`ready` / `adapter_pending` / `not_published`（替 `gateway_ready` / `not_gateway_routed`）；`normalizeCatalogRouteCandidateStatus`；后台文案更新；单测 54 passed。**未完**：删尽业务侧独立选路（`index.js` runtime_catalog_only 兜底仍可调 `resolveAiProviderRoute`）、切片完成门禁 |
| 2026-07-24 | 切片 1 **完成** | `createAiGatewayJobPlan` 只物化 selectedRoute；裸 modality 经 `pickDefaultSelectedRouteForJob`；`resolveAiProviderRoute` 仅留在 `provider-router` 内部；目录状态=decision 词汇；权威入口 `resolveAiGatewayRouteDecision` |
| 2026-07-24 | 切片 2（部分） | `unifiedAiGateway.resolveUnifiedAiSoftHint` 只读 `failureReason`，删除 message 正则启发式；`tests/unifiedAiSoftHint.test.ts`。**未完**：adapter 失败强制带 failureReason、后台按 stage/owner 过滤门禁 |
| 2026-07-24 | 切片 2 **完成** | 前端只认 failureReason；`decorateErrorWithFailureReason` + openai adapter/executor；Admin AI Jobs 按 stage/owner 过滤（含缺 failureReason）；单测通过 |
