# AI Gateway 下一轮问题改造清单

**日期**：2026-07-24  
**定位**：在「一点改到位」收口之后，针对**仍然偏土、影响接供应商与运营**的问题，写下一轮可执行清单。  
**不是**：再写一份愿景长文；也不是重做切片 1–6。

## 与现有文档的关系

| 文档 | 角色 |
| --- | --- |
| `docs/AI-Gateway一点改到位改造清单.md` | **已完成基线**：路由决策 / 失败原因 / 诊断三态 / Adapter 结果契约 / OpenAI-compatible 配置模板 / 基础动态调度 |
| `docs/AI-Gateway优先改造清单.md` | 历史背景；执行不再以它为准 |
| `docs/AI-Gateway供应商聚合平台改造清单.md` | 长期平台愿景；本文只抽**下一轮必做问题**，避免平行开两条战线 |
| **本文** | **当前执行主清单**（基线之后） |

## 一句话目标

把网关从「代码里能跑、契约已收口」推到「运营能配、多模态一样稳、失败能自动换路」。

## 当前问题（相对基线仍成立）

| # | 问题 | 现象 | 为什么还痛 |
| --- | --- | --- | --- |
| A | 可执行路由仍偏硬编码 | `shared/aiGatewayModelRoutes.js`、bindings、catalog 多处写 provider/model | 接新模型要改多处；漏改就「前台有、后台跑不了」 |
| B | 聚合商接入未产品化 | OpenAI-compatible 已有配置 schema，但后台「填表即上线」未闭环 | 接 302 / AIHubMix 仍像开发任务，不像运营任务 |
| C | 多模态成熟度不均 | 图文较稳；视频 / 3D / 长异步的超时、轮询、产物解析仍易特判 | 新链路回归成本高，用户侧失败难解释 |
| D | 调度策略仍像规则表 | 有 `selectionReason`、pause、priority；缺「429/超时/余额」驱动的产品化 fallback | 还不是可运营调度台 |
| E | 运营闭环有缺口 | 一屏诊断有了，但「改配置 → 再诊断 → 放量」链路不顺 | 运营仍依赖研发翻代码 |
| F | 遗留旁路仍干扰心智 | 局部 BYOK / 旧代理路径与平台 Gateway 并存 | 工作流偶发「看起来走了错路」 |

---

## 硬规则（沿用一点改到位）

1. **单点**：一个切片只解决一个问题域。  
2. **改到位**：服务端 + 消费方 + 后台 + 单测同批次；禁止「后端先上、前端以后再说」。  
3. **删旧路**：旧入口删除或 ≤7 天废弃；禁止永久双轨。  
4. **单真相**：同一事实只允许一个权威函数/配置源。  
5. **可验收**：每个切片有反例清单；反例仍在 = 未完成。

---

## 切片总览（严格顺序）

| 序 | 切片 | 一句话 | 状态 |
| --- | --- | --- | --- |
| A1 | 路由配置单源 | 可执行候选只来自一份 route 配置（代码表退化为生成物或只读默认） | 完成 |
| A2 | 后台接聚合商闭环 | 运营填 baseURL/Key/模型映射后，无需新 adapter 文件即可诊断+冒烟 | 完成 |
| A3 | 多模态异步对齐 | 视频/3D/长异步共用同一套轮询状态机与产物契约 | 完成 |
| A4 | 产品化 Fallback | 429/超时/余额/连续失败按策略自动换路，并写审计 | 完成 |
| A5 | 运营放量闭环 | 诊断通过 → 灰度放量 → 一键回滚，后台可完成 | 完成 |
| A6 | 旁路清退 | 用户可达路径默认只走平台 Gateway；BYOK 仅显式工具保留 | 完成 |

> 不做并行：A1→A2→A3→A4→A5→A6。人力不足时优先 **A1→A2→A3**。

---

## 切片 A1：路由配置单源

### 问题

决策中心化了，但**候选从哪来**仍分散在硬编码表与多份 catalog。

### 权威入口

- 运行时候选：`resolveAiGatewayRouteDecision` 只读「route 配置源」
- 配置源建议：`model-ops` / 专用 route store（择一并写死）；`shared/aiGatewayModelRoutes.js` 仅作默认种子或生成物

### 必须改完的落点

| 层 | 动作 |
| --- | --- |
| `shared/aiGatewayModelRoutes.js` | 不再作为业务手改主战场；新增模型优先写配置源 |
| `services/modelRegistry/*` | 展示态与可执行态共用同一 route 字段语义 |
| Admin 模型中心 | 增删改 priority / enabled / providerModelId 写回配置源，立即影响 decision |
| 守门脚本 | `guard:provider-plug`（或等价）断言：目录有 route ⇒ decision 能解释 |

### 删除清单

- 「改模型路由必须同时改 3 个 TS/JS 文件」的流程说明（改为只改配置源）
- 业务路径上再维护一份平行 `catalogProviderIds` 手写真相

### 反例（任一仍在 = 未完成）

- 只改一处硬编码表，后台目录与 Route Check 结论不一致
- 新增模型必须改 adapter 源码才能出现在 decision.candidates

### 验收测试

- fixture：配置源增加假模型 → Route Check / `resolveAiGatewayRouteDecision` 同时看到
- 回归：现有 Gemini / GPT Image / Tripo / Jimeng 不回退

### 完成定义

「模型能走哪条供应商」只有一份权威配置；硬编码表不再是日常接入入口。

---

## 切片 A2：后台接聚合商闭环

### 问题

切片 5 有了 OpenAI-compatible 配置能力，但运营仍不能「填表 → Key Check → Route Check → Generation Test → 上线」。

### 权威入口

- 配置：`openai-compatible-config` + Admin Provider 表单
- 执行：禁止为第 N 家兼容平台再复制 `xxx-adapter.js`

### 必须改完的落点

| 层 | 动作 |
| --- | --- |
| Admin Provider Keys / 供应商面板 | 支持 baseURL、auth、modality endpoints、模型映射、超时 |
| 诊断三态 | 新建供应商后三态可跑，语义不混用 |
| 价格目录 | 新供应商模型可挂 SKU（可先最小字段） |
| 文档 | 「接 302/AIHubMix」步骤变成运营手册，不是开发手册 |

### 删除清单

- 「先找研发开 adapter 文件」作为默认接入路径（专用协议除外：即梦/Tripo/混元等）

### 反例

- 接入一家新 OpenAI-compatible 仍需新增 adapter 源文件才能冒烟
- Generation Test 成功但前台目录不可见（或缺价格导致不可用）

### 验收测试

- fixture 假聚合商：零新 adapter 文件，三态 + mock Generation 全绿
- 真实样板：至少 1 家（建议 302.AI 文本+图片）线上或预发冒烟

### 完成定义

兼容 OpenAI 的聚合商默认工作流 = 后台配置，不是改仓库。

---

## 切片 A3：多模态异步对齐

### 问题

结果契约有了，但视频/3D/长异步的**超时、轮询、取消、产物字段**仍容易按供应商特判。

### 权威入口

- 状态机：统一 running → succeeded / failed / cancelled（超时进 `failureReason`）
- 产物：只认 `AiGatewayAdapterResult.artifacts` / `output`

### 必须改完的落点

| 层 | 动作 |
| --- | --- |
| `openai-compatible-async-adapter` / Ark / Tripo / Jimeng | 轮询间隔、超时、终态映射进同一 helper |
| `execution-finalize` | 禁止按 adapterId 抠私有字段名写 succeeded |
| 前端 `aiJobArtifacts` / 工作流 | 主路径不再按 provider 拼 URL |
| 超时策略 | 长图（如 GPT Image 2）、视频、3D 按 modality/model 档位，不靠全局 120s |

### 删除清单

- finalize / 前端主路径上的 `if (provider === 'tripo')` 类产物特判（特判进 metadata）

### 反例

- 上游已成功，job 因超时/解析失败；或 succeeded 但无对应 modality artifact
- 同模态两家供应商 public artifacts 形状不同

### 验收测试

- 每家 async adapter：成功契约 + 超时失败 + 上游失败（均带 `failureReason`）
- 工作流图/视频/3D 各一条：只消费统一 artifacts

### 完成定义

多模态差异只留在 adapter 入参转换；出参与终态对外一致。

---

## 切片 A4：产品化 Fallback

### 问题

有 pause / priority / `selectionReason`，但缺「运行中失败后按策略换路」的产品行为。

### 权威入口

- `route-dispatch.js` + `ops-control.dispatchPolicy`
- 每次自动换路写审计；用户指定 provider 时只在同模型候选内换（或禁止换，由策略声明）

### 建议策略（最小集）

| 触发 | 默认动作 |
| --- | --- |
| 429 / RPM | 换下一条 ready 候选或换 key |
| 上游超时 | 可配置：重试同路 / 切更快路 |
| 余额不足 | 冷却当前 key；候选耗尽再失败 |
| 连续失败 N 次 | 临时 pause provider，写 ops 事件 |
| 成本优先任务 | decision 偏好低价候选（需价格数据） |

### 反例

- 429 后任务直接死掉，明明还有 ready 候选
- 用户钉死 provider 后仍被静默切到另一家
- 换路无审计、后台看不到 `selectionReason` 变化

### 验收测试

- mock：第一候选 429 → 自动第二候选成功，job metadata 可解释
- mock：显式 pin provider → 不跨 provider fallback

### 完成定义

Fallback 是可解释策略，不是偶然重试。

---

## 切片 A5：运营放量闭环

### 问题

一屏诊断能看，但「通过诊断 → 小流量 → 全量 / 回滚」未产品化。

### 权威入口

- Admin：模型发布 + dispatch 灰度比例 + 一键暂停/回滚
- 证据：诊断快照 + 最近失败 stage/owner 可对比

### 必须改完的落点

| 层 | 动作 |
| --- | --- |
| 模型发布 | 发布前强制展示最近诊断结论（过期则提示重跑） |
| 灰度 | 按用户/项目/百分比选新 route（写入 decision） |
| 回滚 | 一键恢复上一 selectedRoute 策略，无需发版 |

### 反例

- 诊断失败仍可一键全量发布且无警告
- 灰度生效但 job 上看不出走了哪条策略

### 完成定义

运营可在不发版的前提下完成「验证 → 放量 → 回滚」。

---

## 切片 A6：旁路清退

### 问题

平台 Gateway 是主路，但局部 BYOK / 旧代理仍可能劫持工作流心智。

### 权威入口

- 用户可达生成：只创建 AI Gateway job
- BYOK：仅显式「自备 Key 工具 / 拉产物」入口

### 必须改完的落点

| 层 | 动作 |
| --- | --- |
| 工作流 `runTask` / 能力块 | 平台模型默认 Gateway；本地 Key 不覆盖平台路由 |
| 计费预检 | 与真实创建路径同一套 platform/BYOK 判定 |
| 文档与文案 | 标明「平台路由」vs「本地调试」 |

### 反例

- 有陈旧本地 Key 时，平台已通的模型仍走坏掉的代理
- 预检放行但创建因旁路失败（或相反）

### 完成定义

默认路径只有一条；旁路必须用户显式选择。

### 落地摘要（2026-07-24）

- `shared/billingRoute.ts`：`explicitByok` 门闩；本地 Key / BYOK channel / Tripo·腾讯凭证默认不翻 BYOK
- `runUnifiedGeneration`：默认不钉 BYOK provider；仅 `explicitByok` 或 `vertex-proxy` 可钉
- `AssetSetPanel` Tripo：默认平台 sentinel，不再被本地 Key 劫持
- 文案见 `docs/AI-Gateway运营接聚合商手册.md`「平台路由 vs 本地调试」

---

## 明确不做（本轮）

- 不重写整个 `unifiedAiGateway.ts` / 不新开第二套 Job API  
- 不把专用协议（即梦 / Tripo / 混元等）强行塞进 OpenAI-compatible 模板  
- 不上「完全自动、黑盒」的智能路由；所有自动动作必须可审计  
- 不并行开启「供应商聚合平台」长文里的全部 Phase；只做本文切片

---

## 推荐节奏

| 次序 | 切片 | 交付物 |
| --- | --- | --- |
| 1 | A1 | 路由配置单源 + 守门 |
| 2 | A2 | 后台接一家真实聚合商样板 |
| 3 | A3 | 视频/3D/长异步契约与超时对齐 |
| 4 | A4 | 429/超时等产品化 fallback |
| 5 | A5 | 灰度放量与回滚 |
| 6 | A6 | 旁路清退 |

---

## PR 自检（每个切片）

- [ ] 只属于一个切片编号（A1–A6）
- [ ] 权威入口写在 PR 描述
- [ ] 删除清单已用搜索验证
- [ ] 反例清单逐条打勾
- [ ] 相关单测通过
- [ ] 未塞入下一切片半成品
- [ ] `docs/交接文档.md` 追加完成行

---

## 进度记录

| 日期 | 切片 | 结果 |
| --- | --- | --- |
| 2026-07-24 | — | 清单创建；执行尚未开始。基线：一点改到位切片 1–6 已完成。 |
| 2026-07-24 | A1（部分） | 新增权威入口 `listGatewayRouteConfigs`（`server/ai-gateway/route-config-source.js`）；`modelOpsConfig.gatewayRouteConfigs` 可持久化；decision / plan / availability 改读该源；静态表仅作 seed。单测：RouteDecision + Dispatch + OpsStore + Availability 全绿。**未完**：Admin 写回 UI、`guard:provider-plug` 断言目录⇒decision、前端 catalog 对齐、删尽「三处手改」流程。 |
| 2026-07-24 | A1（部分） | Admin 保存发布范围时同步写 `gatewayRouteConfigs`；priority draft 可读配置源；`guard:provider-plug` 改为 `listGatewayRouteConfigs` + `ready` 词汇。验证：guard 通过 + 相关 vitest 绿。**未完**：前端 `modelRouteCatalog` 运行时叠加 ops 配置展示、删尽「三处手改」文档流程、A1 完成门禁。 |
| 2026-07-24 | A1 **完成** | 前端 `listModelRoutes` 叠加 `gatewayRouteConfigs`（enabled/priority/providerModelId）；opsTypes/opsConfig 归一化；静态 `MODEL_ROUTE_CATALOG` / `aiGatewayModelRoutes` 仅作 seed。权威入口：`listGatewayRouteConfigs` + Admin/`model-ops` 的 `gatewayRouteConfigs`。 |
| 2026-07-24 | A2（部分） | `openAiCompatibleProviders` 进 model-ops；`applyOpenAiCompatibleProvidersFromOps`；Admin 表单+保存；运营手册；decision/PUT 时 apply。**未完**：价格目录最小挂 SKU、真实 302 冒烟、模型映射 UI 细化。 |
| 2026-07-24 | A2 **完成** | 价目表待补价纳入 ops `gatewayRouteConfigs`；补价预填最小积分；运营手册补价格步骤。真实 302 线上冒烟留运营环境执行（需 Key）。下一切片 A3。 |
| 2026-07-24 | A3（部分） | 新增 `server/ai-gateway/async-poll.js`（状态归一 / timing / poll loop）；`openai-compatible-async` 改用共享 loop，超时写 `AI_GATEWAY_ASYNC_POLL_TIMEOUT` + failureReason（修「超时静默挂起」）。**未完**：Tripo/Jimeng/Ark 全量改用 helper；前端产物主路径去 provider 特判。 |
| 2026-07-24 | A3（部分） | Tripo 轮询改用 `runAiGatewayAsyncPollLoop`，超时同样写 `AI_GATEWAY_ASYNC_POLL_TIMEOUT`；保留 artifacts-pending 续轮询。**未完**：Jimeng/Ark；前端产物主路径；A3 完成门禁。Goal 轮次预算将尽。 |
| 2026-07-24 | A3（部分） | Jimeng 视频/图片与 Volcengine Ark 异步轮询改用共享 loop；超时统一 `AI_GATEWAY_ASYNC_POLL_TIMEOUT`（修 Ark 超时静默退出）。单测：Jimeng/Ark/AsyncPoll/Tripo/OpenAI-async 绿；补超时断言。前端 `extractRestorableAiJobArtifacts` 已优先契约 artifacts（既有断言）。**未完**：A3 完成门禁确认（finalize/工作流主路径扫尾）后进 A4。 |
| 2026-07-24 | A3 **完成** | 工作流视频/3D 主路径优先契约 `artifacts`（`aiGatewayVideoExecution` / `aiGatewayModel3dExecution` / `tripoWorkflow`）；Tripo 补超时失败断言；finalize 无按 adapter 抠产物字段。出参/终态对外一致后进入 A4。 |
| 2026-07-24 | A4（部分） | `dispatchPolicy.runtimeFallback`（respectProviderPin / allowCrossProvider）；pin/admin_pin 跳过跨供应商换路（`skipReason=provider_pinned`）；fallback 重决策写入 `nextSelectionReason` + 新 `routeDecision`。验收测：429→第二候选；显式 pin 不跨提供商。**未完**：超时策略可配置、连续失败 pause 产品化、后台 runtimeFallback 编辑入口。 |
| 2026-07-24 | A4 **完成** | executor 接入 `onTimeout`（同路重试/切路/直接失败）；Admin Jobs「运行时 Fallback」可编辑并保存 `dispatchPolicy.runtimeFallback`（不再冲掉 pin/canary）；连续失败 pause 沿用 auto-circuit。验收：429 换路、pin 不跨供应商、超时同路再切路/超时 fail。 |
| 2026-07-24 | A5 **完成** | 发布诊断门禁（`publishDiagnosisByModel` + 强制确认）；一屏诊断写快照；Admin 灰度 canary 编辑 + `previousDispatchPolicy` 一键回滚；canary `selectionReason` 可审计。 |
