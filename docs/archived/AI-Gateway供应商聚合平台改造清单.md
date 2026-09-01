# AI Gateway 供应商聚合平台改造清单

## 背景

当前 AI Gateway 已经不是简单转发层。它已经具备任务生命周期、供应商凭证池、worker/adapter、模型发布守卫、诊断、结算、趋势报表和运营暂停等能力。

真正的问题是：它更像一套在业务推进中逐步搭出来的执行系统，供应商和模型规则仍然有较多硬编码。继续接入 302.AI、AIHubMix、OpenRouter、SiliconFlow 这类聚合平台时，如果仍按“每家供应商单独写 adapter + 单独补路由规则”的方式推进，开发和维护成本会继续上升。

本文目标是把当前网关从“能跑的业务网关”改造成“可配置、可插拔、可诊断、可运营的供应商聚合平台”。

## 给非技术同学的解释

可以把 AI Gateway 理解成“AI 供应商调度台”。

现在的调度台已经能工作：用户提交任务，系统知道该找哪家供应商、用哪个 key、怎么查任务状态、怎么失败退款、怎么让管理员看问题。

但它现在的问题是：很多线路是写死在机器里的。每加一家新供应商，都像要打开控制柜重新接线，而不是在后台新增一条线路配置。

改造目标是：以后接 302.AI、AIHubMix 这类平台时，尽量变成后台配置供应商、模型、价格、优先级、失败切换策略，而不是每次都大改代码。

## 当前主要问题

### 1. 供应商路线硬编码偏多

典型位置：

- `shared/aiGatewayModelRoutes.js`
- `server/ai-gateway/provider-router.js`
- `services/modelRegistry/providerBindings.ts`
- `services/modelRegistry/modelRouteCatalog.ts`

这些文件里直接写了不少 provider、model pattern、worker、adapter、priority、capability。新增一家聚合商时，需要在多处同步修改。

风险：

- 容易漏改。
- 容易出现“后台显示可用，但运行时不可执行”。
- 新供应商接入成本偏高。
- 路由行为不够透明，运营很难自己调整。

### 2. 模型、供应商、运行路由的关系分散

现在同一个事实可能在多个地方表达：

- 模型目录里写模型。
- provider binding 里写模型能走哪个 channel。
- gateway route 里写模型是否可执行。
- runtime provider route 里写实际 worker/adapter。
- model ops config 里再控制发布和暂停。

风险：

- 改模型发布状态时，需要理解多套概念。
- 聚合商里同一个模型可能有多个上游名字，映射容易乱。
- 文本、图片、视频、3D 的路由规则不够统一。

### 3. OpenAI-compatible 平台没有抽成通用模板

302.AI、AIHubMix、ToAPIs、TinySnow、OpenRouter、SiliconFlow、部分火山方舟接口，本质上都接近同一类平台：

- 有 `baseURL`
- 有 API Key
- 大量接口兼容 OpenAI SDK
- 模型通过 `model` 字段选择
- 部分图片、视频、3D 需要扩展接口路径

当前系统虽然已有 `openai-official-adapter.js`，也复用了部分 OpenAI-compatible 逻辑，但还没有形成“通用聚合商 adapter + 配置驱动”的稳定抽象。

风险：

- 接 302.AI 可能变成再复制一个专用 adapter。
- 接 AIHubMix 又再复制一次。
- 长期会出现一堆相似但细节不同的 adapter。

### 4. 多模态参数标准不够集中

内部任务已经有 text/image/video/model3d 等 modality，但供应商参数转换仍然分散在各 adapter 内。

例如：

- 图片尺寸、比例、参考图数量。
- 视频时长、比例、分辨率、参考图。
- 3D 格式、质量、贴图、预览图。
- 异步任务状态、产物 URL 提取。

风险：

- 新供应商需要重新理解所有业务字段。
- 同一个能力在不同供应商表现不一致。
- 前端和工作流层容易被供应商参数反向污染。

### 5. Fallback 策略还不够产品化

现在已有：

- provider 暂停。
- key RPM。
- key cooldown。
- key health。
- 自动熔断。
- provider/model 级运营控制。

但还没有形成完整的策略引擎。

理想状态：

- 429 限流：自动切下一条路线。
- 超时：切更快路线。
- 余额不足：冷却当前 key 或禁用当前供应商。
- 连续失败：自动暂停一段时间。
- 成本敏感任务：优先便宜路线。
- 高质量任务：优先高质量路线。
- 用户明确指定模型：只在同等模型路由内 fallback。

### 6. 供应商后台配置还不够完整

现在已经有供应商 key 池和部分诊断能力，但还没有做到“新增供应商主要靠后台配置”。

理想后台应能管理：

- 供应商名称。
- provider id。
- base URL。
- API Key / AK/SK / SecretId/SecretKey。
- 支持的模型。
- 支持的能力：文本、图片、视频、3D、音频、OCR、Rerank。
- 模型映射。
- 请求路径。
- 结果提取规则。
- 价格和计费 SKU。
- 优先级。
- fallback 策略。
- smoke test。
- 最近成功率、失败率、429、平均耗时。

## 改造原则

1. 先不推翻现有网关。
2. 优先抽象 OpenAI-compatible 聚合商。
3. 302.AI 作为第一家样板供应商接入。
4. AIHubMix 作为第二家验证供应商。
5. Tripo、火山方舟、即梦等现有专用链路先保留兜底。
6. 用户侧模型菜单保持稳定，不让用户感知供应商复杂度。
7. 每阶段都要能回滚，不能一次性替换核心生成链路。

## 目标架构

```text
用户/工作流
  -> 统一 AiJob
  -> 模型发布与权限检查
  -> 路由策略
       - 模型
       - 能力
       - 供应商健康
       - 成本
       - 优先级
       - fallback
  -> worker
       - text-worker
       - image-worker
       - video-worker
       - model3d-worker
  -> adapter
       - openai-compatible-adapter
       - native-volcengine-adapter
       - native-tripo-adapter
       - native-tencent-adapter
  -> 供应商
       - 302.AI
       - AIHubMix
       - 火山方舟
       - Tripo
       - OpenAI
       - Gemini
```

## 改造阶段

### Phase 1：建立通用 OpenAI-compatible 聚合商模板

目标：新增 302.AI、AIHubMix、OpenRouter、SiliconFlow 这类供应商时，不再复制专用 adapter。

建议新增或改造：

- `server/ai-gateway/adapters/openai-compatible-adapter.js`
- `services/modelRegistry/providerCatalog.ts`
- `services/modelRegistry/providerModelCatalog.ts`
- `services/modelRegistry/modelRouteCatalog.ts`
- `shared/aiGatewayModelRoutes.js`
- `tests/aiGatewayOpenAiCompatibleAdapter.test.ts`

任务：

- 把 `baseURL`、API Key、默认路径、模型映射做成配置。
- 支持 text chat/completions。
- 支持 image generations。
- 支持 image edits，若供应商不支持则明确报错。
- 支持可配置 timeout。
- 支持统一错误解析。
- 支持 key 成功/失败回写。
- 支持 GET `/models` smoke test。

验收：

- 302.AI 文本任务能通过通用 adapter 调通。
- 302.AI 图片任务能通过通用 adapter 调通。
- 新增 AIHubMix 时，不需要新增第二套 adapter 主体。
- `npm run guard:provider-plug` 通过。

### Phase 2：统一模型路由配置

目标：把“模型能走哪个供应商”集中表达，减少多处硬编码。

建议新增或改造：

- `services/modelRegistry/providerModelCatalog.ts`
- `services/modelRegistry/modelRouteCatalog.ts`
- `shared/aiGatewayModelRoutes.js`
- `server/ai-gateway/provider-router.js`
- `scripts/check-provider-plug-contract.mjs`

任务：

- 将 provider route 与 model route 的重复字段收敛。
- 让 `gateway_ready` 的 route 必须能找到 runtime provider route。
- 每条 route 明确：
  - canonicalModelId
  - providerId
  - providerModelId
  - modality
  - adapterKind
  - priority
  - fallbackPolicy
  - enabled
  - keyRequired
- 对聚合商支持 `providerModelId` 覆盖。

验收：

- 后台模型中心显示的 route 与实际可执行 route 一致。
- 新增一个 302.AI 模型只需要补 catalog/route 配置。
- 如果 route 缺 worker/adapter，守门命令会失败。

### Phase 3：统一多模态任务输入

目标：内部只认统一任务格式，供应商差异留在 adapter 层。

建议定义标准输入：

```ts
type GatewayTextInput = {
  prompt?: string;
  contents?: Array<{ role: string; parts: Array<{ text?: string; inlineData?: unknown }> }>;
  systemInstruction?: string;
  responseMimeType?: string;
};

type GatewayImageInput = {
  prompt: string;
  referenceImages?: string[];
  aspectRatio?: string;
  size?: string;
  seed?: number;
};

type GatewayVideoInput = {
  prompt: string;
  referenceImages?: string[];
  durationSeconds?: number;
  aspectRatio?: string;
  resolution?: string;
  seed?: number;
};

type GatewayModel3dInput = {
  prompt?: string;
  referenceImages?: string[];
  format?: "glb" | "fbx" | "obj" | "stl" | "usdz";
  quality?: string;
  texture?: boolean;
};
```

任务：

- 明确每种 modality 的必填字段。
- 明确每种 modality 的可选字段。
- adapter 只负责把标准字段转成供应商字段。
- 对不支持的字段返回 warning 或忽略记录。
- 产物统一成 `artifacts`。

验收：

- 图片、视频、3D 的输入不再直接依赖某一家供应商字段。
- 302.AI 与火山方舟可以接收同一份 video/model3d 标准输入，再由 adapter 转换。
- 前端工作流不需要知道具体供应商参数。

### Phase 4：实现可配置 fallback 策略

目标：失败时不只报错，而是按策略选择下一条可用线路。

建议新增或改造：

- `server/ai-gateway/route-policy.js`
- `server/ai-gateway/provider-router.js`
- `server/ai-gateway/ops-control.js`
- `server/ai-gateway/observability.js`
- `tests/aiGatewayRoutePolicy.test.ts`

策略类型：

- `none`
- `on_error`
- `on_rate_limit`
- `on_timeout`
- `on_provider_degraded`
- `cost_optimized`
- `quality_first`

任务：

- 定义哪些错误允许 fallback。
- 定义哪些错误不能 fallback，例如用户输入错误、模型未发布、权限不足。
- 记录 fallback trace。
- fallback 后在 job metadata 中保留原始失败 route。
- 支持最大 fallback 次数，避免循环。

验收：

- 302.AI 429 时可切 AIHubMix 或火山方舟。
- OpenAI-compatible 聚合商超时时可切备用 route。
- 用户能在任务详情里看到最终走了哪条路线。
- 管理员能看到 fallback 原因和失败供应商。

### Phase 5：补全供应商管理后台

目标：让运营能管理供应商，而不是每次找开发改代码。

建议涉及：

- 管理后台供应商中心。
- provider key pool。
- model route catalog。
- diagnostics。
- price catalog。

后台应支持：

- 新增/编辑供应商。
- 配置 API Key。
- 配置 base URL。
- 配置 provider capabilities。
- 配置模型映射。
- 配置 route priority。
- 配置 fallback policy。
- 配置价格和 SKU。
- 单条 route smoke test。
- 批量 diagnostics。
- 查看最近成功率、失败率、429、平均耗时。

验收：

- 管理员能新增一条 302.AI key 并 smoke test。
- 管理员能暂停 302.AI 图片路线，不影响 302.AI 文本路线。
- 管理员能调整 302.AI 与火山方舟的优先级。
- 管理员能看到某个模型最近 7 天供应商表现。

### Phase 6：用 302.AI 做样板接入

目标：验证“聚合商模板”是否真的降低接入成本。

建议 provider id：

- `302ai`

首批验证能力：

- text
- image
- video
- model3d

建议 smoke test：

- 文本：便宜 chat 模型。
- 图片：GPT Image 或 Seedream 类模型。
- 视频：Jimeng、Kling、Wan 或同类模型。
- 3D：Tripo3D、Hunyuan3D、doubao-seed3d 中至少一种。

验收：

- text/image 走通用 OpenAI-compatible adapter。
- video/model3d 如需专用路径，也必须复用统一任务格式和统一产物格式。
- 任务成功率、耗时、错误码、扣费结果能在后台看到。
- 不替换现有 Tripo/火山链路，先灰度。

### Phase 7：接入 AIHubMix 验证可复用性

目标：证明第二家聚合商接入不再重走大量开发。

验收：

- AIHubMix 接入时不复制 302.AI adapter。
- 只补供应商配置、模型配置、少量路径/结果提取规则。
- smoke test 与 diagnostics 复用 302.AI 的同一套工具。

## 推荐实施顺序

1. 先抽通用 OpenAI-compatible adapter。
2. 用 302.AI 接 text/image。
3. 收敛模型 route 与 runtime route 的重复配置。
4. 建立标准 video/model3d input/output。
5. 用 302.AI 接 video/model3d 灰度。
6. 做 fallback policy。
7. 接 AIHubMix 验证复用性。
8. 再考虑把 OpenAI/Gemini/ToAPIs 的部分路线降级为备用。

## 当前已落地进度

- 已新增 OpenAI-compatible 供应商集中配置：`server/ai-gateway/openai-compatible-config.js`，统一管理 label、默认 Base URL、是否补 `/v1`、adapter id 识别。
- 已将 302.AI 接入 text/image 路线：provider id `302ai`，channel/adapter `302ai-openai`，默认 Base URL `https://api.302.ai/v1`。
- 302.AI 已新增 video/model3d 灰度候选：供应商中心可见 `302ai-video-manual`、`302ai-model3d-manual`，但 route 明确标记为 `requires_endpoint_mapping` / `adapter_pending`，不会被误发布为可执行生产路线。
- 302.AI video/model3d 灰度候选已补 `endpointMapping.required` 元数据，明确还缺 `requestPath`、`pollPath`、`statusPath`、`artifactPath`；供应商中心模型行会直接提示这些映射缺口。
- 运营侧模型配置已新增 `endpointMappings`，可保存灰度 route 的 `requestPath`、`pollPath`、`statusPath`、`artifactPath` 等端点映射；缺字段时仍显示“参数待映射”，填齐后会推进到“adapter 待接”，不会误判为可发布。
- 后端 `model-ops-config-store.js` 已修复保存 `bindingOverrides[].fallbackPolicy` 时被清洗丢失的问题，并统一保留 `endpointMappings`，避免后台保存策略后前后端状态不一致。
- 已新增通用异步聚合商 adapter 骨架：`server/ai-gateway/adapters/openai-compatible-async-adapter.js`，支持按 endpoint mapping 组装 video/model3d 提交请求、提取 task id、轮询任务状态、提取产物 URL，并归一为 AI Gateway artifacts。
- `video-worker` 与 `model3d-worker` 已登记 `openai-compatible-async` adapter 能力，但 302.AI video/model3d 仍不加入默认可执行 runtime route；灰度路线保持“填齐 mapping 后 adapter 待接”，避免误跑生产。
- `endpointMappings` 已扩展支持 `taskIdPath`、`errorPath` 等异步任务提取字段；OpenAI-compatible async adapter 在拼接 Base URL 与 requestPath 时会规避重复 `/v1`，降低运营配置出错概率。
- 管理后台“工作区模型发布”已对 `requiresEndpointMapping` 的灰度路线展示 endpoint mapping 编辑表单，可直接配置提交路径、轮询路径、状态字段、产物字段、任务字段、错误字段，并随模型发布配置一起保存到 `endpointMappings`；保存时会保留其他未显示 route 的映射配置。
- endpoint mapping 灰度执行已接入 route guard：只有 `endpointMappings[].enabled === true` 且 `requestPath`、`pollPath`、`statusPath`、`artifactPath` 齐全时，302.AI/AIHubMix 等 OpenAI-compatible 异步路线才会生成 `openai-compatible-async` runtime route；未显式启用时仍保持“参数待映射”，避免误跑生产。
- Auth/HTTP 创建任务链路已能把受控灰度 runtime route 传给 `createAiGatewayJobPlan`，`provider-router` 会保留 `routeId` 与 `endpointMapping`，worker request 因此可以拿到真实提交路径和轮询提取规则。
- OpenAI-compatible async adapter 已补 submit/poll/artifact mock 端到端测试：模拟 302.AI video 任务提交返回 task id、轮询 running、轮询 succeeded、按 `artifactPath` 提取视频 URL，最终写入 `job.artifacts`、`job.output.usage` 和 `job.metadata.usage`，覆盖结算前的核心产物流。
- OpenAI-compatible async adapter 已补 model3d mock 端到端测试：模拟 302.AI 3D 任务按数组产物返回多个模型 URL，最终归一为多个 `model3d` artifacts，并按 task 计量写入 usage；generation test 同步校验 `model3d` artifact 的通过/失败路径。
- 管理后台真实生成诊断已扩展到 video/model3d：启用且可发布的受控灰度路线可以触发最小真实任务，generation test 会按 modality 校验 text/image/video/model3d 对应输出，不再只支持文本和图片。
- endpoint mapping 缺口已结构化贯穿 route test、diagnostics runner、availability 与后台诊断卡片：缺字段时会展示 `缺 requestPath / pollPath / ...`，批量诊断异常也会保留 `missingEndpointFields`，管理员不必只靠错误文案猜下一步。
- endpoint mapping 受控灰度路线已支持供应商自动推断：当用户侧只传 canonical model + modality、没有显式 provider/routeId 时，如果 ops 中只有一条匹配且已启用的 OpenAI-compatible async mapping，route guard 会自动选中该 provider 并 pin 到任务 metadata，减少用户侧感知供应商复杂度。
- endpoint mapping 受控灰度路线已支持多供应商优先级选择：当 302.AI、AIHubMix 等多条异步 mapping 同时启用时，系统会选择 priority 数字最小的路线；如果多条路线 priority 相同，会返回 `AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS`，并带出冲突 routeIds/providers，提示运营设置唯一优先级或显式指定供应商。
- 运营侧 `endpointMappings[].priority` 已贯通服务端存储、前端远端 ops 配置类型、route test、auth facade 与 HTTP facade 创建任务链路，避免“后台配置了优先级但运行时不用/保存时丢失”的问题。
- 管理后台“工作区模型发布”的 endpoint 映射卡片已新增优先级输入框，运营可以直接给 302.AI、AIHubMix 等灰度异步路线配置 priority；只配置优先级也会被保存，不需要手工改 JSON。
- 运营侧模型配置已新增 `providerOverrides[].baseUrl` / `providerOverrides[].requestTimeoutMs`：可按 provider 统一覆盖 302.AI、AIHubMix、TinySnow、火山方舟等 OpenAI-compatible 聚合商 Base URL 和请求超时；worker 获取 provider key、管理员 key smoke test、text/image OpenAI-compatible 执行链路、video/model3d 异步提交链路都会使用供应商级覆盖，避免逐个 key 修改接口地址或靠环境变量调超时。
- 模型映射覆盖已进入运行时：普通 text/image route 可通过 `bindingOverrides[].upstreamOverride` 覆盖实际上游模型名，video/model3d endpoint mapping 可通过 `endpointMappings[].upstreamOverride` 覆盖异步聚合商的实际模型名；auth facade 与 HTTP facade 会把覆盖值写入 `input.upstreamModelId`，adapter 请求体因此使用运营配置的供应商模型 id，而不改变用户侧看到的 canonical model。
- 单条普通 route 暂停已进入运行时与可用性摘要：`bindingOverrides[].enabled=false` 会让对应 text/image route 在 route guard 中不可执行，后台可用性显示“路线暂停”，同时不影响同一 provider 的其他 modality 路线；例如可暂停 302.AI 图片路线而保留 302.AI 文本路线。
- 管理后台 route/generation 诊断已能展示 endpoint mapping 冲突详情：当多条灰度路线 priority 相同导致 `AI_GATEWAY_MODEL_ROUTE_AMBIGUOUS` 时，诊断短文案显示冲突供应商，悬停详情列出 routeIds/providers/priority，运营可直接知道该调哪几条路线。
- 批量模型 diagnostics runner 已保留 endpoint mapping 异常 details：批量 route/generation 检查遇到缺字段或多路线冲突时，会把 `missingEndpointFields`、`routeIds`、`providers`、`priority` 透传给后台，不再只剩批量检查失败的通用错误。
- 后台批量诊断目标选择已改为覆盖已选发布模型中的 text/image/video/model3d，不再只检查当前 `workspaceSelectable` 的模型；因此 endpoint mapping 缺字段、key 缺失、adapter 待接等不可选灰度模型也会进入批量诊断。
- 当后台草稿中同一 canonical model + modality 存在多条已启用 endpoint mapping 时，批量诊断会用“用户侧只传模型和 modality”的视角发起 route/generation 检查，专门验证自动选路优先级和多供应商冲突，而不是只检查某一条显式 route。
- 单个模型卡片上的“路由检查”和“真实生成”也已复用同一套诊断目标选择逻辑：多条已启用 endpoint mapping 时按用户侧视角检查自动选路，单条 mapping 时仍检查具体 route/provider，避免单条按钮漏掉多供应商冲突。
- 单条“路由检查”失败时，后台顶部错误提示已补齐 endpoint mapping 细节：缺字段会显示缺哪些字段，多供应商冲突会显示冲突供应商、冲突 routeIds 和相同 priority，运营不必只依赖诊断卡片悬停详情。
- 模型可用性摘要已纳入 ops `endpointMappings` 中的额外异步灰度路线：即使某条 AIHubMix/302.AI mapping 只存在于后台配置中，也会作为 route candidate 展示并参与 ready/key missing/parameter pending 判断。
- 模型可用性摘要已新增 `route_ambiguous` 状态：当同一 canonical model + modality 下多条已启用 endpoint mapping 的最佳 priority 打平时，后台会在模型卡片上提前显示“路线冲突”，并返回冲突 providers、routeIds、priority，不必等到点击诊断才发现。
- 后台顶部“工作区模型”汇总卡片已接入可用性问题摘要：优先提示“路线冲突”，其次提示待映射、缺密钥、待接入、缺路由，运营不需要逐个展开模型卡片才能发现发布范围里的关键问题。
- 工作区模型保存拦截和模型卡片不可用原因已复用可用性详情文案：`route_ambiguous` 会显示冲突供应商，悬停详情列出 providers、routeIds、priority，避免只显示笼统的“多条 endpoint 映射优先级冲突”。
- 批量诊断完成消息已追加关键问题摘要：如果结果里有路线冲突、待映射、缺密钥、待接入或缺路由，会在“批量诊断完成”后直接显示“需处理：x 个路线冲突，y 个待映射”，运营无需逐条扫描结果卡片。
- 批量诊断问题摘要的错误码覆盖已补齐：除直接的 route/generation 错误码外，也能识别批量包装错误中包含的 `No enabled provider key`、`endpoint mapping` 等文案，把问题归类到缺密钥、待映射、待接入或缺路由，而不是只显示泛化失败。
- 已将 AIHubMix 接入 text/image 路线：provider id `aihubmix`，channel/adapter `aihubmix-openai`，默认 Base URL `https://aihubmix.com/v1`。
- 已使用真实 AIHubMix key 做轻量上游探活：`GET /v1/models` 返回 200，模型列表可读；`POST /v1/chat/completions` 使用 OpenAI-compatible chat 形态返回 200，并得到预期文本响应，证明默认 Base URL 与 chat/completions 接口可用。
- 302.AI 与 AIHubMix 均复用现有 OpenAI-compatible 请求执行链路，没有新增第二套供应商专用 adapter 主体。
- 已补供应商目录、通道目录、模型目录、模型 route、runtime provider route、worker adapter allowlist、Key 池 smoke test、BYOK 计费分类、前端设置读写入口。
- OpenAI-compatible 的 runtime provider route、text/image worker adapter allowlist、健康检查 adapter 清单、后台诊断 binding channel 已开始从同一张配置表派生，减少新增第三家聚合商时的漏改点。
- 已新增最小 fallback 策略层：可识别 provider key 缺失、429、超时、5xx、网络错误等可重试失败；系统自动选路的任务失败时，会禁用已失败 provider 并重新规划下一条可用路线，fallback trace 写入 `job.metadata.aiGatewayFallback`。
- 用户显式指定 provider 时默认不自动切换供应商；auth/http facade 因 route guard 自动 pin 的 provider 会标记为 `autoSelectedProvider`，允许按策略 fallback。
- `bindingOverrides[].fallbackPolicy` 已支持 `none`、`on_error`、`on_rate_limit`、`on_timeout`、`on_provider_degraded`、`cost_optimized`、`quality_first`，route guard 会把运维配置写入 `job.metadata.aiGatewayFallback.policy`；执行器按策略判断是否 fallback，不命中时会写入 skipped trace。
- `cost_optimized` 与 `quality_first` 已打通后台下拉、ops 配置清洗、服务端存储、route guard、可用性摘要和执行层；当前语义是“可重试供应商错误允许 fallback”的策略档位，真正按成本/质量重新排序供应商仍属于后续策略引擎增强。
- `bindingOverrides[].fallbackMaxAttempts` 已进入运行时：route guard 会把每条路线的最大 fallback 尝试次数写入 `job.metadata.aiGatewayFallback.maxAttempts`，executor 会按 1-5 次上限执行，避免供应商连续异常时无限切换或过度消耗。
- 管理后台“工作区模型发布”表已支持按普通 text/image route 编辑最大 fallback 尝试次数，保存时写入 `bindingOverrides[].fallbackMaxAttempts`，并与优先级、route 暂停、上游模型覆盖、fallback policy 一起保留。
- 后台供应商中心的工作区模型发布表已支持按路由配置 fallback policy；保存路由优先级时会保留 `enabled`、`upstreamOverride`、`fallbackPolicy` 等已有配置，不会因为只改优先级而丢策略。
- 模型可用性摘要已返回普通 text/image route 的 `fallbackPolicy` 与 `fallbackMaxAttempts`；管理后台“工作区模型发布”卡片会在 route 行用中文运营文案展示当前 fallback 策略和最大尝试次数，让发布前的策略可见性与任务详情保持一致。
- 公开任务摘要与管理后台 AI 任务详情已展示 fallback 最大尝试次数：管理员能看到策略、已尝试次数、最大次数、下一家供应商和最后 fallback 原因，不必翻原始 metadata 才能判断是否达到策略上限。
- 已新增公开任务摘要：`server/ai-gateway/job-public-summary.js` 统一输出 route、error、fallback 摘要，auth/http 的任务列表与详情都能看到是否发生 fallback、尝试次数、最后原因、下一家 provider。
- 生成诊断结果已带 `fallback` 摘要；管理员做 real generation test 时，可以直接判断“失败前有没有切换供应商、切换到哪里、为什么切换”。
- 已新增多模态标准输入抽取层：`server/ai-gateway/gateway-input.js`，集中从 `prompt`、`text`、`contents[].parts[].text`、`referenceImages`、`imageUrl`、`imageBase64DataUrl`、`inlineData` 中抽取统一 prompt 和参考图。
- Volcengine Ark async、Tripo OpenAPI、Tencent Hunyuan 3D adapter 已开始复用标准输入抽取层；video 的 `duration/aspectRatio/resolution/seed` 与 model3d 的 `format/quality/texture/seed` 也已集中规范化。
- 已新增路由级默认计费 SKU 层：`server/ai-gateway/route-billing.js`，集中决定 AI Gateway 任务默认 `billingSku`、`meterKind`、`unit`；Gemini/OpenAI/Tripo/Tencent 继续落到现有价目表 SKU，302.AI/AIHubMix/ToAPIs 等聚合商使用稳定的 `text|image.provider.model` 命名，方便后台价目表补价。
- `execution-usage.js`、`usage-event.js`、OpenAI-compatible 执行链路已复用同一套 SKU 解析，减少 adapter 自己拼 SKU 的分叉。
- 后台价目表已新增 AI Gateway 待补价 SKU 提示：从当前模型 route 推导缺失的 `billingSku`、provider、modality、meterKind，运营可一键带入“新建 SKU”弹窗补价。
- AI Gateway 趋势报表已新增 `providerPerformance` 供应商表现表，按 provider 汇总任务数、成功/失败、429、失败率、fallback 次数、平均耗时、用量事件、积分和成本，便于后台直接展示“哪家供应商最近表现好/差”。
- `services/adminClient.ts` 已补齐趋势报表新增字段类型，方便后台页面接入供应商表现表。
- 管理后台 AI 任务页已接入最近 7 天 `providerPerformance`，运营可直接看到供应商任务量、失败率、429、fallback 次数、平均耗时、积分和成本。
- 已通过 `npm run guard:provider-plug`、`npm run guard:ai-routing`，以及 AI Gateway/计费/运营趋势/后台路由配置/价目表补价提示/302.AI 多模态灰度聚焦测试。最近一次补充验证覆盖 endpoint mapping 唯一供应商推断、优先级选路、同优先级冲突诊断、auth/http facade 无 provider 创建任务、后台 endpoint priority 编辑保存、可用性摘要 route_ambiguous、工作区模型问题汇总、保存拦截冲突明细、批量诊断完成问题摘要、冲突诊断展示、路由检查失败提示、批量 diagnostics details 透传、不可选灰度模型批量诊断目标选择、单模型诊断目标选择与 ops 配置保存/读取。

## 不建议做的事

- 不建议马上把 302.AI 设成唯一供应商。
- 不建议删除 Tripo、火山方舟、即梦等现有链路。
- 不建议每接一家聚合商就复制一套 adapter。
- 不建议让前端直接感知供应商参数。
- 不建议把价格、模型发布、fallback 继续散在多个地方。

## 最小可交付版本

如果只做一个小版本，建议范围如下：

- 新增 `302ai` provider。
- 抽出通用 OpenAI-compatible adapter。
- 支持 text/image。
- 供应商 key 池支持 `302ai`。
- 模型 route 支持 `302ai`。
- 管理后台能 smoke test。
- 保留现有供应商为 fallback。

这个版本完成后，就能判断 302.AI 是否适合作为主供应商入口。

## 后续完整版本

完整版本应包含：

- text/image/video/model3d 全部走统一 AiJob。
- 聚合商供应商可配置。
- 模型路由集中配置。
- fallback 策略可配置。
- 价格和 SKU 可配置。
- diagnostics 覆盖所有已发布模型。
- 后台能看到每个供应商的成功率、失败率、429、耗时、成本。

## 验收总表

| 项目 | 验收标准 |
| --- | --- |
| 通用聚合商 adapter | 302.AI 与 AIHubMix 至少两家复用同一套 adapter 主体 |
| 模型路由 | 后台显示 route 与运行时 route 一致 |
| 多模态输入 | text/image/video/model3d 使用统一内部输入格式 |
| 产物格式 | 图片、视频、3D 都输出统一 artifacts |
| fallback | 429、超时、供应商降级可按策略切换 |
| 供应商后台 | 运营可配置 key、base URL、优先级、暂停、诊断 |
| 诊断 | 已发布模型能批量 route check / generation test |
| 结算 | fallback 后仍能正确结算与释放预留积分 |

## 关键文件索引

- `shared/aiGatewayModelRoutes.js`
- `server/ai-gateway/openai-compatible-config.js`
- `server/ai-gateway/provider-router.js`
- `server/ai-gateway/provider-key-store.js`
- `server/ai-gateway/route-policy.js`
- `server/ai-gateway/job-public-summary.js`
- `server/ai-gateway/gateway-input.js`
- `server/ai-gateway/route-billing.js`
- `server/ai-gateway/adapters/openai-official-adapter.js`
- `server/ai-gateway/workers/registry.js`
- `server/ai-gateway/model-publication-guard.js`
- `server/ai-gateway/model-availability-summary.js`
- `server/ai-gateway/model-route-test.js`
- `server/ai-gateway/model-generation-test.js`
- `server/ai-gateway/trend-report.js`
- `services/modelRegistry/providerCatalog.ts`
- `services/modelRegistry/providerModelCatalog.ts`
- `services/modelRegistry/providerBindings.ts`
- `services/modelRegistry/modelRouteCatalog.ts`
- `scripts/check-provider-plug-contract.mjs`

## 结论

当前网关不是简陋，而是还停留在“业务可用、工程偏硬编码”的阶段。

下一步最重要的不是继续多接几家供应商，而是先把“聚合商接入方式”抽出来。302.AI 应作为第一家样板供应商，验证通用 OpenAI-compatible adapter、统一路由配置、多模态输入输出和 fallback 策略。这样后续 AIHubMix、OpenRouter、SiliconFlow 等平台才能低成本接入。
