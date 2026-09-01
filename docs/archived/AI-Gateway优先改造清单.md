# AI Gateway 优先改造清单

**定位**：这是现有 AI Gateway 的下一轮收口清单，重点解决“有网关雏形，但路由、失败解释、后台诊断还不够中心化”的问题。  
**适用对象**：后端、前端、运营后台、测试。  
**执行注意（2026-07-24）**：P0–P2 已落地雏形但仍有双轨遗留。后续**执行顺序与「改到位」门禁**以 `docs/AI-Gateway一点改到位改造清单.md` 为准；本文保留作背景与历史验收参考。  
**关联文档**：
- `docs/AI-Gateway一点改到位改造清单.md`（当前执行主清单）
- `docs/多模型可运营改造计划.md`
- `docs/AI生成任务链路核对表.md`
- `docs/供应商模型发布闭环审计.md`
- `docs/AI-Gateway多模态商业化改造清单.md`
- `docs/AI-Gateway供应商聚合平台改造清单.md`

## 一句话目标

把 AI Gateway 从“能把任务转给供应商”升级成“能统一决策、统一解释、统一诊断、统一运营”的中心。

短期不追求重写全部 AI 链路；优先把最影响排障和运营的三件事收口：

1. 统一路由决策。
2. 统一失败原因解释。
3. 后台一屏诊断。

## 当前主要问题

| 问题 | 现状表现 | 影响 |
| --- | --- | --- |
| 路由决策分散 | 前端 `unifiedAiGateway`、服务端 route guard、provider router、模型目录、ops config 都参与判断 | 同一个模型“前台可见、后台不可执行、有 key 但不能生成”的情况难解释 |
| 失败原因分散 | 失败可能来自发布、路由、Key、额度、worker、adapter、上游、artifact 回写 | 用户和运营看到的失败文案不稳定，研发排障需要跨多层找证据 |
| 后台诊断不闭环 | Key Check、Route Check、真实 Generation Test 是三件事，但后台体验容易混在一起 | 运营容易误判“检查通过”等于“生成可用” |
| 多模态成熟度不均 | 文本/图片、视频、3D、聚合商 async adapter 的错误、轮询、产物解析语义不完全一致 | 新供应商接入成本高，老链路回归风险大 |
| 动态运营能力不足 | 有 pause、fallback、优先级覆盖，但实时健康、成本、成功率、延迟尚未进入统一决策 | Gateway 更像规则路由器，还不是运营调度器 |

## P0：统一路由决策中心

### 目标

新增一个“路由决策结果”契约，让所有入口拿到同一种判断结果，而不是各层自己解释模型、供应商、Key、状态。

### 建议产物

- 新增或收口服务端函数：`resolveAiGatewayRouteDecision(input, context)`。
- 返回统一结构：

```ts
type AiGatewayRouteDecision = {
  ok: boolean;
  canonicalModelId: string;
  modality: string;
  selectedRoute?: {
    routeId: string;
    providerId: string;
    adapterId: string;
    workerId: string;
    upstreamModelId?: string;
    priority: number;
    fallbackPolicy: string;
  };
  candidates: Array<{
    routeId: string;
    providerId: string;
    status: "ready" | "paused" | "adapter_pending" | "key_unavailable" | "mapping_incomplete" | "not_published";
    reasonCode: string;
    priority: number;
  }>;
  blockingReason?: {
    code: string;
    message: string;
    owner: "user" | "admin" | "developer" | "upstream" | "system";
    nextAction: string;
  };
};
```

### 代码落点

| 模块 | 调整 |
| --- | --- |
| `server/ai-gateway/model-route-guard.js` | 从“抛错式校验”升级为可复用的 decision 生成器；保留现有错误映射 |
| `server/ai-gateway/provider-router.js` | 优先消费 decision 的 selectedRoute；减少重复排序和 provider 判断 |
| `shared/aiGatewayModelRoutes.js` | 继续保留静态规则，但只作为候选来源之一 |
| `server/ai-gateway/model-ops-config-store.js` | ops 覆盖只影响 decision，不再由多个模块分别解释 |
| `services/modelRegistry/modelRouteCatalog.ts` | 前端目录展示尽量复用同一套状态语义 |

### 验收标准

- 给定 `canonicalModelId + modality + optional providerId`，能返回完整候选列表和唯一 selectedRoute。
- provider 被 pause、模型未发布、adapter pending、Key 不可用、endpoint mapping 缺字段时，decision 都有稳定 `reasonCode`。
- `/api/ai/jobs` 创建任务前后使用同一份 decision，不出现“检查通过但创建时换了另一套路由判断”。
- 保留现有错误码兼容：`AI_GATEWAY_MODEL_ROUTE_NOT_FOUND`、`AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE` 等不能突然消失。

### 建议测试

- 新增 `tests/aiGatewayRouteDecision.test.ts`。
- 覆盖：正常路由、显式 provider、provider pause、Key 不可用、adapter pending、endpoint mapping incomplete、多候选优先级。

## P1：统一失败原因解释

### 目标

建立一套 Gateway 失败原因分类，把技术错误稳定映射成“谁负责、下一步做什么、是否可重试”。

### 建议产物

- 新增 `server/ai-gateway/failure-reason.js`。
- 输出统一结构：

```ts
type AiGatewayFailureReason = {
  code: string;
  stage:
    | "admission"
    | "billing"
    | "publication"
    | "routing"
    | "provider_key"
    | "worker"
    | "adapter"
    | "upstream"
    | "artifact"
    | "writeback";
  owner: "user" | "admin" | "developer" | "upstream" | "system";
  retryable: boolean;
  userMessage: string;
  adminMessage: string;
  nextAction: string;
  rawCode?: string;
};
```

### 代码落点

| 模块 | 调整 |
| --- | --- |
| `server/ai-gateway/http-handler.js` | `mapGatewayError()` 改为消费统一 failure reason |
| `server/ai-gateway/executor.js` | worker/adapter/upstream 失败写入统一 `metadata.gatewayFailure` |
| `server/ai-gateway/settlement.js` | 结算释放原因使用统一 code |
| `services/unifiedAiGateway.ts` | 软提示优先使用服务端返回的 `failureReason`，减少前端正则猜测 |
| `docs/AI生成任务链路核对表.md` | 补充 failure reason 表，避免运营继续按散点错误排查 |

### 验收标准

- 所有 400/422/500 Gateway 错误响应包含 `{ error, message, failureReason }`。
- job failed 时，job detail 中能看到 `metadata.gatewayFailure`。
- 前端软提示不再主要依赖“字符串包含 429/503/API key”等正则推断。
- 运营后台能按 `stage` 和 `owner` 过滤失败。

### 建议测试

- 新增 `tests/aiGatewayFailureReason.test.ts`。
- 覆盖：额度不足、模型未发布、route not found、provider paused、key unavailable、adapter pending、上游 429、上游 5xx、artifact empty。

### 已落地（2026-07-24）

| 项 | 路径 / 行为 |
| --- | --- |
| Mapper | `server/ai-gateway/failure-reason.js` |
| HTTP/Auth | `mapGatewayError` / `mapAuthAiGatewayError` 响应含 `failureReason` |
| Job failed | `metadata.gatewayFailure`（executor + execution-finalize） |
| Settlement | `creditsGate.settlementReleaseReason` |
| 前端软提示 | `services/unifiedAiGateway.ts` 优先读 `failureReason.stage` |
| 单测 | `tests/aiGatewayFailureReason.test.ts` |

## P2：后台一屏诊断

### 目标

把“Key Check、Route Check、Generation Test、最近失败、下一步动作”放到同一个模型/供应商诊断面板里。

### 建议产品形态

后台供应商模型中心新增“诊断”区域：

| 区块 | 内容 |
| --- | --- |
| 模型状态 | published、catalog visible、gateway status、execution status |
| 路由状态 | route candidates、selected route、priority、fallback policy |
| Key 状态 | key ready、cooling down、disabled、last error |
| 真实测试 | 最小成本 Generation Test，明确提示会真实创建任务和计费 |
| 最近失败 | 最近 N 次失败的 failure reason 分布 |
| 下一步 | 根据 owner 显示操作：补 Key、启用 route、补 adapter、解除 pause、联系上游 |

### 代码落点

| 模块 | 调整 |
| --- | --- |
| `server/ai-gateway/model-diagnostics-run.js` | 扩展为聚合诊断入口 |
| `server/ai-gateway/model-route-test.js` | Route Check 改为返回 route decision |
| `server/ai-gateway/model-generation-test.js` | 明确标注真实任务、返回 job id、产物、结算状态 |
| `components/admin/AdminProviderKeysPanel` 相关文件 | 增加一屏诊断 UI |
| `server/ai-gateway/trend-report.js` | 给诊断面板提供最近失败趋势 |

### 验收标准

- 运营能在一个模型页面回答：为什么不可用、是谁的问题、下一步做什么。
- Route Check 和 Generation Test 在 UI 上明确区分。
- Generation Test 必须返回真实 `aiGatewayJobId`，并验证最终产物不为空。
- 最近失败至少按 `stage / owner / provider / model` 聚合。

### 建议测试

- 后端：诊断 API 单测，覆盖 ready、key missing、route missing、adapter pending。
- 前端：后台诊断面板渲染测试，覆盖成功、不可用、需要真实测试确认三种状态。

### 已落地（2026-07-24）

| 项 | 路径 / 行为 |
| --- | --- |
| 一屏诊断聚合 | `server/ai-gateway/model-screen-diagnosis.js` + `POST /api/admin/model-screen-diagnosis` |
| 最近失败聚合 | `aggregateRecentGatewayFailures`（按 stage / owner / provider / model） |
| 后台 UI | `AdminProviderKeysPanel`：一屏诊断 / 路由检查（不创建任务） / 真实生成（会计费）三按钮分离 |
| Generation Test | 返回 `aiGatewayJobId`、`billingNote`、`failureReason` |
| 单测 | `tests/aiGatewayModelScreenDiagnosis.test.ts` |

## P3：多模态适配器契约对齐

### 目标

让 text、image、video、model3d、music worker/adapter 的输入、轮询、产物、错误、用量结算语义一致。

### 建议产物

- 定义 `AiGatewayAdapterResult`：

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
  failureReason?: AiGatewayFailureReason;
};
```

### 代码落点

| 模块 | 调整 |
| --- | --- |
| `server/ai-gateway/workers/types.js` | 补齐 worker/adapter 统一契约 |
| `server/ai-gateway/adapters/*` | 按统一 result 输出，减少各 adapter 自定义字段 |
| `server/ai-gateway/execution-finalize.js` | 统一落库 output/artifacts/failureReason |
| `services/aiJobArtifacts.ts` | 前端按 artifact kind 恢复产物 |

### 验收标准

- 每个 adapter 成功时至少输出一个符合模态的 artifact 或明确 text output。
- 每个 adapter 失败时都能输出 failure reason。
- 3D、视频轮询超时和上游失败不再只是一条裸 message。

## P4：动态调度和运营策略

### 目标

在 P0-P3 稳定后，再引入更智能的 route selection：成功率、成本、延迟、quota、用户等级、供应商健康度。

### 建议能力

| 能力 | 说明 |
| --- | --- |
| provider health score | 基于近期失败率、429、5xx、timeout 自动降权 |
| cost-aware routing | 同质量档位下优先低成本供应商 |
| quality-first routing | 高质量档位优先指定 provider/model |
| tenant policy | 不同 workspace / user plan 可见不同供应商和模型 |
| rollout policy | 新 adapter 可按百分比或 allowlist 灰度 |
| circuit breaker | 当前 auto pause 升级为可解释、可恢复、可后台配置 |

### 验收标准

- selectedRoute 的原因可解释：不是黑盒“系统选的”。
- 每次自动降权、熔断、fallback 都写入审计事件。
- 后台能手动覆盖自动策略，并能回滚。

## 推荐实施顺序

| 顺序 | 改造项 | 原因 |
| --- | --- | --- |
| 1 | P0 路由决策中心 | 先统一“该走哪条路”，否则后面诊断和失败解释会继续分裂 |
| 2 | P1 失败原因解释 | 让所有错误先变得可读、可归因 |
| 3 | P2 后台一屏诊断 | 把 P0/P1 的结果产品化，降低运营和排障成本 |
| 4 | P3 适配器契约对齐 | 逐步消除多模态差异，适合边接新供应商边整理 |
| 5 | P4 动态调度 | 等基础事实统一后再做智能策略，避免在混乱数据上做自动化 |

## 第一轮 Sprint 建议

### Sprint 1：Route Decision

- 新增 route decision 函数和类型。
- `/api/ai/jobs` 创建任务时写入 `metadata.routeDecision`。
- Route Check API 返回完整 decision。
- 补单测。

交付标准：研发看到一个 job id，就能还原当时有哪些候选路由、为什么选中或拒绝。

### Sprint 2：Failure Reason

- 新增 failure reason mapper。
- HTTP 错误、job failed、前端软提示统一消费。
- 文档补充错误分类表。
- 补单测。

交付标准：失败不再只是一句 message，而是稳定的 `stage + owner + nextAction`。

### Sprint 3：Admin Diagnosis

- 后台模型详情新增诊断区域。
- Route Check 和 Generation Test 明确分离。
- 最近失败按 failure reason 聚合。
- 补 UI 测试。

交付标准：运营不需要读代码，也能判断“补 Key、开 route、等 adapter、找上游、还是让用户重试”。

## 不建议第一轮做的事

- 不建议重写 `unifiedAiGateway.ts`，先让它消费更好的服务端结果。
- 不建议一开始就做复杂智能调度，先把事实、原因、诊断统一。
- 不建议把所有供应商配置迁到一个巨大的 JSON，先统一 decision 输出，再逐步收口来源。
- 不建议把 BYOK、平台 Key、代理桥一次性抽象成同一种执行形态；可以先统一状态语义。

## PR 自检清单

- 是否更新或复用了 route decision，而不是新增一套 provider/model 判断。
- 是否给新增错误补了 failure reason。
- 是否能从 job detail 看到 route、provider、adapter、worker、failure reason。
- 是否区分 Key Check、Route Check、Generation Test。
- 是否补了最小相关测试。
- 如果触碰工作流 AI 分发，是否同步检查 `services/workflowRunTaskBranch.ts` 和 `services/workflowAiPickIndex.ts`。
- 如果新增供应商、模态或 provider bypass，是否对照 `docs/架构宪章-店仓菜单.md` 和 `docs/多模型可运营改造计划.md`。

