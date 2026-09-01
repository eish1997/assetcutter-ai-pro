# AI Gateway 优化清单（B 轮）

**日期**：2026-07-25  
**定位**：A1–A6 已收口之后的**具体可执行缺口**，不是愿景长文。  
**前提**：路由决策 / failureReason / 诊断三态 / Adapter 契约 / OpenAI-compatible / Fallback / 灰度回滚 / explicitByok 已有基线。

## 一句话目标

消灭「前台能点、后台跑偏 / 旧路旁路 / 运营填不全」三类事故；把网关从 **v1 能运营** 推到 **默认主路唯一 + 运营点点完成**。

| 序 | 切片 | 一句话 | 状态 |
| --- | --- | --- | --- |
| B1 | Catalog 执行态与 ops 对齐 | ops `gatewayExecutionStatus` 覆盖静态 PENDING | **完成** |
| B2 | 消灭第二张硬编码选路表 | provider-router 降为 materialize | **完成** |
| B3 | 文生图默认只走 Gateway Job | 旧 proxy 仅 debug | **完成** |
| B4 | 即梦工作流改走 Gateway | 直连 `/api/jimeng` 退出主路 | **完成** |
| B5 | 聚合商 Admin 映射+轮询超时 | 填表即写入 ops | **完成** |
| B6 | 价目真实单价 + 趋势估算/已定价 | 待补价预填种子价；趋势拆分成本 | **完成** |
| B7 | Jobs 失败 stage/owner 服务端筛选 | 列表 API + 分页一致 | **完成** |
| B8 | auto-circuit 只认结构化 failureReason | 无结构不 pause | **完成** |
| B9 | 趋势快照定时落库 | 每日自动 snapshot | **完成** |
| B10 | 真实用量字段回传（非 Gemini） | OpenAI-compatible + Tripo | **完成** |
| B11 | route-config-source 专用单测 | seed/overlay/append/disabled | **完成** |
| B12 | 上游硬取消契约收口 | hard/soft + cancelReason | **完成** |
| B13 | BYOK / 工具级旁路审计表 | 默认 platform；仅显式 BYOK | **完成** |
| B14 | music-worker `planned` 二选一 | 下线或最小实现 | **完成** |
| B15 | 预发 302 真实冒烟门禁 | Key/Route/Generation | **完成** |

> 执行序：B1 → … → B15 全部完成。
---

## P0：默认主路与真相源（必须先做）

### B1. Catalog 执行态与 ops 配置源对齐

| 项 | 内容 |
| --- | --- |
| **现象** | 前台 `listModelRoutes` 只叠 `enabled/priority/providerModelId`，`gatewayExecutionStatus` 仍可能被静态 `PENDING_RULES` 盖回 `adapter_pending` |
| **改哪里** | `services/modelRegistry/modelRouteCatalog.ts`（`applyGatewayRouteConfigOverlay`）；必要时 `shared/aiGatewayModelRoutes.js` 的 `resolveCatalogGatewayExecutionStatus` 改为读配置源 |
| **完成标准** | ops 标 `ready` 后前台不再显示 `adapter_pending`；Route Check / catalog / decision 三方一致 |
| **反例** | 只改静态表、前台变了、decision 没变（或相反） |
| **工作量** | M |

### B2. 消灭第二张硬编码选路表

| 项 | 内容 |
| --- | --- |
| **现象** | `DEFAULT_AI_PROVIDER_ROUTES` + `resolveAiProviderRoute` / `pickDefaultSelectedRouteForJob`（`provider-router.js`）仍可独立绑 adapter/worker，与 `listGatewayRouteConfigs` 平行 |
| **改哪里** | `server/ai-gateway/provider-router.js`、`index.js` plan 路径 |
| **完成标准** | 无 decision 时也从同一配置源 materialize；或明确降级为「只补 adapter/worker 缺省、禁止独立排序」；`rg resolveAiProviderRoute` 仅剩 materialize/测试 |
| **反例** | plan 与 `resolveAiGatewayRouteDecision` 选出不同 provider |
| **工作量** | M |

### B3. 文生图默认只走 Gateway Job

| 项 | 内容 |
| --- | --- |
| **现象** | `geminiService` / `workflowGenerateImage` 仍可回退 `/proxy/gemini/async`；`isAiGatewayImageExecutionEnabled` 灰度未收口 |
| **改哪里** | `services/geminiService.ts`、`services/aiGatewayTrace.ts`、工作流文生图入口 |
| **完成标准** | 用户可达文生图只 `createAiJob`（Gateway always-on；env 旁路已移除；batch proxy 保留） |
| **反例** | 平台模型已通，用户仍因旧 proxy/本地环境失败 |
| **工作量** | L |

### B4. 即梦工作流改走 Gateway Adapter

| 项 | 内容 |
| --- | --- |
| **现象** | `unifiedAiGateway.workflowGenerateImageJimeng` / `workflowGenerateVideoJimeng` 直连 `/api/jimeng/*`，绕过 Job |
| **改哪里** | `services/unifiedAiGateway.ts`（或等价入口）→ Gateway `jimeng-visual` adapter |
| **完成标准** | 即梦图/视频主路径经 Gateway job（always-on）；数字人能力下线；失败带 `failureReason` |
| **反例** | 工作流即梦成功但 Admin Jobs 看不到任务 |
| **工作量** | M |

---

## P1：运营点点完成 + 可观测（紧接着做）

### B5. 聚合商 Admin 表单补齐映射与轮询超时

| 项 | 内容 |
| --- | --- |
| **现象** | `AdminProviderKeysPanel` 只有 providerId/label/baseURL/requestMs/asyncCapable；schema 已有 `modelMapping`、`pollIntervalMs`/`pollTimeoutMs` 未暴露 |
| **改哪里** | `components/admin/AdminProviderKeysPanel.tsx`、`openai-compatible-config.js`、运营手册 |
| **完成标准** | 运营可填 canonical→upstream + poll 超时，保存进 `openAiCompatibleProviders`；手册步骤可点点完成 |
| **工作量** | M |

### B6. 价目「待补价」从 1 积分占位升级为真实单价

| 项 | 内容 |
| --- | --- |
| **现象** | `AdminPriceCatalogPanel` A2 最小 SKU 占位 `1` 积分；趋势成本偏估算 |
| **改哪里** | `AdminPriceCatalogPanel`、价目 catalog、可选成本字段 |
| **完成标准** | 待补价可填真实单价/成本；趋势能区分「估算 vs 已定价」 |
| **工作量** | M |

### B7. Jobs 失败 stage/owner 进服务端筛选

| 项 | 内容 |
| --- | --- |
| **现象** | `cleanAdminAiJobFilters` 丢掉 `failureStage`/`failureOwner`；前端只滤当前页 |
| **改哪里** | Admin Jobs API + `AdminAiJobsPanel` |
| **完成标准** | 列表 API 支持 `gatewayFailure.stage/owner`（含 `__missing__`）；分页与筛选一致 |
| **工作量** | S |

### B8. auto-circuit 只认结构化 failureReason

| 项 | 内容 |
| --- | --- |
| **现象** | `ops-control.js` → `autoCircuitErrorReason()` 用 `/429|timeout|.../` 猜字符串 |
| **改哪里** | `server/ai-gateway/ops-control.js` |
| **完成标准** | 只认 `failureReason.code/stage`；无结构化原因不自动 pause |
| **工作量** | S |

### B9. 趋势快照定时落库

| 项 | 内容 |
| --- | --- |
| **现象** | `trend-report.js` 有写入能力，仅手动 `POST .../trend-snapshots/refresh` |
| **改哪里** | auth-api / cron 或现有定时任务入口 |
| **完成标准** | 每日自动 snapshot；Admin 可读历史日 |
| **工作量** | S |

### B10. 真实用量字段回传（非 Gemini）

| 项 | 内容 |
| --- | --- |
| **现象** | `buildProviderTaskUsage` 多 credits/duration；Tripo/Jimeng/Ark/兼容层缺 `promptTokens`/`costUsd` |
| **改哪里** | 各 adapter 成功态 + `execution-usage.js` + 趋势汇总 |
| **完成标准** | 至少 OpenAI-compatible + 1 家专用 adapter 回传真实用量；趋势可按供应商汇总 |
| **工作量** | M |

### B11. `route-config-source` 专用单测

| 项 | 内容 |
| --- | --- |
| **现象** | 无 `tests/*routeConfig*`；权威源仅间接覆盖 |
| **改哪里** | 新增 `tests/aiGatewayRouteConfigSource.test.ts` |
| **完成标准** | seed-only、overlay 覆盖 priority/enabled/upstream、append、disabledProviders 全绿 |
| **工作量** | S |

### B12. 上游硬取消契约收口

| 项 | 内容 |
| --- | --- |
| **现象** | 多数 adapter `*_hard_cancel_unavailable`；worker 返回 `legacy_adapter_cancel_not_supported` |
| **改哪里** | 1–2 家有 cancel API 的 adapter + 统一 soft cancel 文案 |
| **完成标准** | 有 API 的走 hard cancel；其余统一 `mode:'soft'` + `cancelReason`；Admin/用户文案可区分 |
| **工作量** | L |

---

## P2：清债与样板（可并行、不挡主路）

### B13. BYOK / 工具级旁路审计表

| 项 | 内容 |
| --- | --- |
| **现象** | A6 门闩已有；腾讯 3D、`workflowCreditsBypass`、多处 `byokSupported` 仍易混淆 |
| **完成标准** | 用户可达路径清单：默认 platform；BYOK 仅显式工具；预检=创建 |
| **工作量** | M |
| **结果** | **完成** — 人文表 `docs/AI-Gateway-BYOK旁路审计表.md`；机器可读 `shared/aiGatewayByokPathAudit.ts`；`tests/aiGatewayByokPathAudit.test.ts`；手册交叉引用。 |

### B14. music-worker `planned` 二选一

| 项 | 内容 |
| --- | --- |
| **现象** | `workers/types.js` 抛 `AI_GATEWAY_WORKER_PLANNED` |
| **完成标准** | 下线入口，或最小 adapter+路由+冒烟 |
| **工作量** | L |
| **结果** | **完成** — 选择「下线入口」：registry 移除 music-worker；后续 cleanup 已删除 music-worker.js stub 与 `createPlannedWorker`。 |

### B15. 预发 302 真实冒烟门禁

| 项 | 内容 |
| --- | --- |
| **现象** | A2 留「运营环境冒烟」；fixture 有、线上 Key 无门禁 |
| **完成标准** | 预发对 302 文本+图片跑 Key/Route/Generation；结果进手册或可选 CI |
| **工作量** | S |
| **结果** | **完成** — 预发冒烟通过：Key + Route + Generation（gpt-4o-mini / gpt-image-1.5）；脚本默认图模改为 gpt-image-1.5。 |

---

## 明确不做（本轮）

- 不重写整套 Job API / 不新开第二套 Gateway
- 不把即梦 / Tripo / 混元强行塞进 OpenAI-compatible 模板（专用 adapter 保留）
- 不上黑盒「智能路由」；自动换路必须可审计（沿用 `selectionReason`）
- 不并行开「供应商聚合平台」长文里的全部 Phase

---

## 进度记录

| 日期 | 切片 | 结果 |
| --- | --- | --- |
| 2026-07-25 | — | B 轮清单创建；执行尚未开始。基线：A1–A6 完成。 |
| 2026-07-25 | B1 **完成** | catalog overlay 应用 `gatewayExecutionStatus`（与 `materializeGatewayRouteConfigRow` 同权威链）；opsTypes/opsConfig/Admin 透传该字段；反例测：ops `ready` 覆盖静态 `adapter_pending`；非 seed 缺省 status → ready。验证：`modelRouteCatalog` + `aiGatewayRouteDecision` + `modelOpsConfigStore` 30 passed。下一切片 B3。 |
| 2026-07-25 | B3 **完成** | `isAiGatewayImageExecutionEnabled` 默认全开；`dialogGenerateImage` / multiRefs → `runUnifiedImageGeneration`；`geminiService` 禁止 Gateway 失败后静默回退 `/proxy/gemini/async`。cleanup 后 env 旁路已移除，Gateway always-on（batch proxy 保留）。下一切片 B4。 |
| 2026-07-25 | B4 **完成** | 新增 `aiGatewayJimengExecution`；`workflowGenerateImageJimeng` / `VideoJimeng` 走 `createAiJob`+poll（jimeng-visual）。cleanup 后 Jimeng Gateway always-on；数字人能力已下线。下一切片 B5。 |
| 2026-07-25 | B5 **完成** | Admin OpenAI 兼容表单补 `modelMapping` + `pollIntervalMs`/`pollTimeoutMs`；normalize 不再丢掉轮询字段；手册步骤可点点完成。下一切片 B2。 |
| 2026-07-25 | B2 **完成** | `lookupRuntimeAdapterDefaults` 仅按已选 provider 补 adapter/worker；plan 无 model/provider 时抛错（禁止 DEFAULT 表跨供应商排序）；`resolveAiProviderRoute` 降为 deprecated 薄包装。下一切片 B6。 |
| 2026-07-25 | B6 **完成** | 待补价草稿用 `DEFAULT_PRICE_CATALOG` 预填真实单价/成本（无种子则留空，禁止 1 积分占位）；趋势桶拆分 `totalCostUsdPriced`/`totalCostUsdEstimated`；catalog 回填成本标 `estimated`；Admin 用量趋势展示已定价 vs 估算。下一切片 B7。 |
| 2026-07-25 | B7 **完成** | `failureStage`/`failureOwner`（含 `__missing__`）进 store.list + Admin Jobs/summary API；`cleanAdminAiJobFilters` 透传；前端不再二次滤当前页；shared `aiGatewayJobFailureFilters`。下一切片 B8。 |
| 2026-07-25 | B8 **完成** | `autoCircuitErrorReason` 只认 `failureReason`/`gatewayFailure` 的 code/stage（限流/超时/不可用/upstream）；纯消息字符串不再触发 pause。下一切片 B9。 |
| 2026-07-25 | B9 **完成** | `trend-snapshot-loop`：auth-api 启动后定时刷新今日快照并封存昨日；`AI_GATEWAY_TREND_SNAPSHOT_ENABLED`/`INTERVAL_MS`；Admin trends 可读历史日。下一切片 B10。 |
| 2026-07-25 | B10 **完成** | `execution-usage` 提取 OpenAI token/cost + Tripo consumed credits；兼容层/官方/Tripo 成功态回传 `promptTokens`/`costUsd`；usage-event 优先用供应商成本。下一切片 B11。 |
| 2026-07-25 | B11 **完成** | 新增 `tests/aiGatewayRouteConfigSource.test.ts`：seed-only、overlay priority/enabled/upstream、append、disabledProviders。下一切片 B12。 |
| 2026-07-25 | B12 **完成** | `cancel-result` 统一 soft/hard + cancelReason/文案；OpenAI-compatible 支持 `cancelPath` 硬取消；其余 adapter/worker soft；job summary 暴露 `workerCancel`。下一切片 B13。 |
| 2026-07-25 | B13 **完成** | BYOK 审计表（人文+机器可读）+ vitest；默认 platform；仅 `explicitByok`；预检=结算。下一切片 B14。 |
| 2026-07-25 | B14 **完成** | music-worker 从 registry 下线；cleanup 删除 stub/`createPlannedWorker`；resolve 抛 NOT_REGISTERED。下一切片 B15。 |
| 2026-07-25 | B15 **完成** | 预发 Key 池挂 302 + smoke:ai-gateway-302 通过（text gpt-4o-mini / image gpt-image-1.5）；B 轮收口。 |
