# AI 执行路由闭环架构审计

**日期**：2026-07-15  
**状态**：架构审计与改造方案  
**背景**：后台发布模型后，前端已经能看到模型，但实际执行仍可能报 Google / Vertex RPM、供应商 Key 不可用、Gateway 待接或请求失败。用户明确要求不要按单点补丁处理，而要从架构视角收口。

## 1. 结论

这次问题不是某一个模型、某一个 import、某一个供应商的孤立问题，而是“前端模型选择”和“实际执行路由”还没有完全合并成同一张订单。

当前系统已经有三块能力：

1. 管理端能维护供应商、Key、发布模型。
2. 前端模型选择器已经开始读取 published + gateway ready 的有效模型。
3. 后端 `/api/ai/jobs` 已有发布校验、route 校验、Key 校验和部分 adapter。

但还缺中间最关键的一层：**所有用户可触发的生成入口，都必须把当前选择的 canonical model / provider / capability 作为统一执行请求提交给 Gateway**。

现在仍存在两类旧路径：

- UI 选择了模型，但执行时只把模型当成 `geminiService` 的 model 参数，最终仍可能走 Gemini / Vertex。
- UI 选择了模型，但某些快捷生成、Agent、预设、组覆盖、分镜、专家调用等入口没有统一传递 canonical model 和 asset context。

所以“前端显示模型”只能证明菜单上架了，不能证明仓库会按这个供应商出货。

目标状态应是：

```text
管理员配置 Key
  -> 发布模型
  -> 前端按生成类型展示可用模型
  -> 用户选择模型并发起生成
  -> 前端提交统一 Generation Request
  -> Gateway 按 canonicalModelId + providerId + capability 路由
  -> adapter 调真实供应商
  -> 统一资产落库
  -> UI / Agent / 时间轴展示结果
```

## 2. 当前风险判断

### 2.1 `unifiedAiGateway` 目前不是完整 Gateway

`services/unifiedAiGateway.ts` 名义上是统一出口，但目前有两种角色混在一起：

- 统一计费、限流、错误提示、调试日志。
- 对 `geminiService` 的薄委托和再导出。

这意味着业务代码改成 import `unifiedAiGateway` 后，只是减少了散点 import，不等于真正走 `/api/ai/jobs`。

例如文本对话路径：

```text
Workflow / Agent / preset
  -> getDialogTextResponse / workflowChat
  -> unifiedAiGateway
  -> geminiService.getDialogTextResponse
  -> Gemini / Vertex / 旧代理路径
```

这条链路如果没有进入 `/api/ai/jobs`，就不会使用 AI Gateway 的 provider route、Ark adapter、OpenAI adapter 或 Key 池分配。

### 2.2 前端模型选择已经前进，执行入口没有全部跟上

目前可见入口包括：

- 全局输入框 / 快捷生成。
- Project Agent 规划出的 `run_plain_text`、`run_plain_i2t`、`run_plain_t2i`、`run_plain_i2i`、`run_plain_3d`。
- 能力预设执行。
- 组覆盖。
- 分镜表重绘、拼图、角色替换。
- 视频生成。
- 3D 生成。
- 站点助手、专家调用、测试运行。

这些入口对模型字段的处理不一致，有的传 `textModelRegistryId`，有的传 `imageModelRegistryId`，有的传 `videoModelRegistryId`，有的传 `generate3D.modelRegistryId`，有的只把 model 当成 Gemini 参数。

如果不统一契约，后续每接一个供应商都会重复出现：

- 后台能发布，前端能看到，但执行走错供应商。
- 文本模型选了方舟，实际触发 Vertex 限流。
- 图片模型选了方舟 Seedream，实际进入 Gemini 生图链路。
- Agent @当前画面时没有把当前资产/画面上下文随请求传给视觉模型。
- 预设和组覆盖里看似选择了模型，但最终被默认模型覆盖。

### 2.3 `/api/ai/jobs` 已经具备成为权威执行入口的基础

`services/aiJobsClient.ts` 已经有 `createAiJob()`，并会把 `canonicalModelId / registryId` 归一化后提交到 `/api/ai/jobs`。

后端 `server/ai-gateway/auth-api-handler.js` 已经做了：

- 积分门禁。
- 发布模型校验。
- Gateway route 可执行校验。
- 平台 Key 可用校验。
- provider 自动补齐。
- 任务创建、执行、状态回写。

视频路径 `services/aiGatewayVideoExecution.ts` 已经比较接近目标模式：创建 AI Gateway job，再轮询结果。

因此不建议再补很多单点 adapter 调用。更合理的是把文、图、Agent、预设等入口迁移到同一套 Gateway Job 契约。

## 3. 统一执行契约

建议新增一个前端统一执行层，可以命名为：

```text
services/generation/runUnifiedGeneration.ts
```

它不是又一个供应商 adapter，而是“前端点单单据”的唯一出口。

### 3.1 请求结构

```ts
type UnifiedGenerationRequest = {
  modality: 'text' | 'image' | 'video' | 'model3d' | 'music';
  capability:
    | 'text.generate'
    | 'vision.describe'
    | 'image.generate'
    | 'image.edit'
    | 'video.generate'
    | 'model3d.generate'
    | 'music.generate'
    | string;
  canonicalModelId: string;
  registryId?: string;
  providerId?: string;
  input: Record<string, unknown>;
  assetContext?: {
    projectId?: string;
    sourceAssetId?: string;
    sourceAssetIds?: string[];
    currentPreviewAssetId?: string;
    currentPreviewSnapshot?: {
      mimeType: string;
      dataUrl?: string;
      url?: string;
    };
    referenceAssetIds?: string[];
  };
  uiSource:
    | 'quick_compose'
    | 'project_agent'
    | 'preset'
    | 'group_override'
    | 'storyboard'
    | 'asset_preview'
    | 'admin_test'
    | string;
  estimatedCredits?: number;
  metadata?: Record<string, unknown>;
};
```

### 3.2 执行规则

默认规则：

```text
所有普通工作台生成请求 -> runUnifiedGeneration -> /api/ai/jobs
```

例外必须显式登记：

- 本机伴侣纯本地能力，例如本机 SAM 分割。
- 免费工具型处理，例如本地裁剪、格式转换。
- 尚未 Gateway 化的历史路径，但必须标注 `legacyPath`、`owner`、`migrationTarget`、`expireBy`。

### 3.3 模型字段规则

前端不应再只传 `model` 这种模糊字段。至少要传：

- `canonicalModelId`：平台逻辑模型 ID，是发布、计费、路由的主键。
- `registryId`：前端旧注册表兼容字段，可与 canonical 相同。
- `providerId`：当同一个 canonical model 有多个供应商 route 时，用于强制选择；为空时由后端按优先级、健康状态、成本选择。
- `capability`：同一个模型可支持多种能力，必须标清本次要做什么。

## 4. 依赖边界

### 4.1 业务 UI 禁止直连供应商层

以下层级应该保持单向：

```text
组件 / Agent / 预设 / 分镜
  -> runUnifiedGeneration 或明确的本地工具入口
  -> aiJobsClient
  -> /api/ai/jobs
  -> provider-router
  -> adapter
  -> 供应商 API
```

业务 UI 不应直接 import：

- `services/geminiService`
- `services/tripoService`
- `services/tencentService`
- `services/jimeng/client`
- 任意供应商 SDK / URL

如果暂时不能迁移，要在文档和索引里登记为 legacy exception。

### 4.2 `unifiedAiGateway` 需要拆职责

建议把 `unifiedAiGateway` 从“所有旧函数再导出”逐步拆成两层：

```text
runUnifiedGeneration
  负责新架构统一执行，请求 Gateway Job。

legacyUnifiedAiGateway
  暂存旧 Gemini / Vertex / 兼容路径，只给未迁移入口使用。
```

最终 `unifiedAiGateway` 可以保留为 facade，但内部必须优先走 Gateway Job，而不是默认薄委托 Gemini。

## 5. 入口审计清单

### 5.1 P0 必须先收口

| 入口 | 当前风险 | 目标 |
|---|---|---|
| 全局输入框文生文 | 可能选模型后仍走 Gemini / Vertex | `text.generate` 走 `/api/ai/jobs` |
| Agent `run_plain_text` | Agent 产出映射到快捷生成，但执行链路不一定带 canonical route | Agent 请求必须携带选中 text model 和上下文 |
| Agent `run_plain_i2t` / @当前画面 | 当前画面上下文可能只停留在 UI，没有进入视觉请求 | 请求携带 current preview snapshot / asset id |
| 全局文生图 | 可能仍走旧 `workflowGenerateImage` / Gemini 生图 | `image.generate` 走 Gateway |
| 全局图生图 / 多图参考 | 参考图、模型和 capability 需要统一 | `image.edit` 或 `image.generate` 明确区分 |
| 能力预设文本/图片 | 预设模型、组覆盖、默认模型优先级容易冲突 | 统一 resolve 后生成一份最终请求 |

### 5.2 P1 收口

| 入口 | 当前风险 | 目标 |
|---|---|---|
| 分镜表重绘 / 拼图 / 角色替换 | 多处服务各自调 `workflowChat` / 生图 | 统一 route，并保留 storyboard asset metadata |
| 专家调用 | 可能只继承用户输入，不继承资产上下文 | 专家 invocation 也生成统一请求 |
| 站点助手 | 文本流式可能仍适合 legacy，但要登记 | 明确是否 Gateway 化或保留例外 |
| 管理端 Route Test / Smoke Test | 测试通过层级和真实生成层级可能不同 | UI 标明 Key / Model / Route / Artifact 测试级别 |

### 5.3 P2 收口

| 入口 | 当前风险 | 目标 |
|---|---|---|
| 音乐生成 | 未来新增时容易复制旧问题 | 先定 Gateway Job 契约再做 UI |
| 更多 3D 供应商 | Tripo、混元、方舟 3D 不能各走各路 | `model3d.generate` 统一任务结构 |
| 高级批处理 | 批量任务需要 per item route 和失败隔离 | 每个子任务都有 job id 和 route metadata |

## 6. 供应商与多 route 策略

用户提到“多个供应商可能同时供应一个模型”，这个点需要在路由层设计清楚。

建议区分两种 ID：

```text
canonicalModelId: 平台卖给用户的模型/能力名
providerModelId: 供应商真实 API 里的模型名
```

同一个 `canonicalModelId` 可以有多条 route：

```text
canonicalModelId = gpt-image-2
  -> provider=openai-official, providerModelId=gpt-image-2
  -> provider=toapis, providerModelId=gpt-image-2
```

路由选择优先级：

1. 用户或管理员强制指定 `providerId`。
2. 模型发布设置里的默认 provider。
3. 健康状态可用、Key 可用、成本最低、延迟最低的 route。
4. 如果主 route 失败，按降级策略选择备用 route。

需要注意：这不是前端下拉里简单显示两个同名模型就能解决的问题。产品上可以显示为：

- 普通用户：只看到 `GPT Image 2`。
- 管理员：看到 `GPT Image 2 / OpenAI 官方`、`GPT Image 2 / ToAPIs`，并能配置默认和备用。

## 7. 参数与资产契约

### 7.1 参数不应散落在 UI

每个 route 应维护自己的参数 schema：

- 尺寸。
- 比例。
- 清晰度。
- 参考图数量上限。
- 是否支持局部编辑。
- 是否支持透明背景。
- 是否支持 seed。
- 视频时长、帧率、首尾帧。
- 3D 输出格式、贴图开关。

前端参数面板只渲染 schema，不应硬编码每个供应商的参数。

### 7.2 输出必须统一资产化

所有 adapter 返回后必须转成统一 artifact：

```text
text -> text asset / timeline result
image -> image asset
video -> video asset
model3d -> model asset + preview thumbnail
music -> audio asset
file -> file asset
```

Agent 侧栏时间轴、资产卡片、预览窗口应读统一资产，不应读供应商原始响应。

### 7.3 当前画面问答需要显式资产上下文

用户在资产预览里问“这是什么东西”，即使 @当前画面，也必须将当前预览内容落到请求里：

- 当前 asset id。
- 当前版本 id。
- 当前预览类型。
- 如果是图片/视频帧/3D 截图，需要传 snapshot。
- 如果是文本资产，需要传文本内容摘要或原文。
- 如果是资产集/分镜表，需要传当前节点和选中资产。

否则模型只能根据文字猜，不可能根据画面回答。

## 8. 分轮建议

不建议一次性全做完。原因是这次改造会同时碰到前端入口、Agent、预设、Gateway、adapter、资产落库和测试。一次做完风险很高，也很难判断哪个问题来自哪一层。

建议分 5 轮。

### 第 1 轮：执行入口审计与架构护栏

目标：先把“哪里还会绕过 Gateway”查清并阻止新增绕路。

交付：

- 新增执行入口审计表。
- 给每个入口标记 `gateway` / `legacy` / `local`。
- 增加静态测试或脚本：业务组件不得直接 import 供应商 service。
- 把当前 `WorkflowSection` 里临时 import 替换问题纳入审计，不把它当最终方案。

验收：

- 能回答“选择方舟文本后，最终会不会进入 Ark adapter”。
- 能回答“选择 Flash 后，为什么允许进入 Vertex”。

### 第 2 轮：文生文 / Agent 文本闭环

目标：先解决截图里最直接的问题：前端选了模型，文本执行必须走对应 route。

交付：

- `runUnifiedGeneration(text.generate)`。
- 全局文生文接入 Gateway Job。
- Agent `run_plain_text` 接入同一入口。
- 选 Ark 文本时不得调用 Gemini / Vertex。
- 选 Flash 时才允许调用 Gemini / Vertex。

验收：

- Ark Doubao 文本：创建 job，route 为 `volcengine-ark`。
- OpenAI 文本：创建 job，route 为 `openai-official`。
- Flash 文本：route 为 `vertex-gemini` 或 `gemini-aistudio`。

### 第 3 轮：图片生成 / 图片编辑闭环

目标：图片模型选择、参考图、局部编辑、预设生图全部走统一 route。

交付：

- `runUnifiedGeneration(image.generate / image.edit)`。
- 全局文生图、图生图、多图参考接入。
- 预设生图和组覆盖接入。
- Ark Seedream、OpenAI Image、Gemini Image 按 route 执行。

验收：

- 选择 Ark Seedream 后，不进入 Gemini 生图。
- 选择 GPT Image 后，不进入 Vertex。
- 参考图数量按目标 route schema 限制。

### 第 4 轮：当前画面上下文与 Agent 视觉闭环

目标：解决“@当前画面但 AI 没看图”的问题。

交付：

- asset preview -> Agent 的 context assembler。
- 当前画面 snapshot / asset id / version id 入统一请求。
- `run_plain_i2t` 走 `vision.describe` 或等价 capability。
- 3D / 视频 / 文本资产各有可送模摘要策略。

验收：

- 在图片预览问“这是什么”，回答基于图片。
- 在 3D 预览问“这是什么”，至少基于当前视口截图和资产 metadata 回答。
- 在文本资产预览问答，使用文本内容而不是空上下文。

### 第 5 轮：分镜、专家、批量与例外清理

目标：把剩余高频入口收口，留下少量有说明的 legacy 例外。

交付：

- 分镜重绘、拼图、角色替换接入统一请求。
- 专家调用接入统一请求。
- 站点助手明确 Gateway 化或登记 legacy。
- 批量任务每个子任务都有 route metadata。
- 删除或隔离旧的 Gemini 直通入口。

验收：

- 新增供应商模型时，不需要改多个 UI 执行入口。
- 管理端发布模型后，普通工作台可选即可执行。
- 报错能显示：未发布、缺 Key、Gateway 待接、参数不支持、上游限流。

## 9. 测试矩阵

### 9.1 路由测试

- 选择 Ark 文本，不调用 Gemini / Vertex。
- 选择 Ark 图片，不调用 Gemini / Vertex。
- 选择 OpenAI 文本，不调用 Vertex。
- 选择 OpenAI 图片，不调用 Vertex。
- 选择 Flash，允许调用 Gemini / Vertex。
- 同一个 canonical model 有多 provider 时，指定 provider 优先。

### 9.2 上下文测试

- Agent `run_plain_text` 带选中的 text model。
- Agent `run_plain_i2t` 带当前画面 snapshot。
- 预设覆盖优先级稳定：组覆盖 > 预设模型 > 全局默认。
- 资产预览中发问能带当前 asset id / version id。

### 9.3 失败提示测试

- 未发布：`AI_GATEWAY_MODEL_NOT_PUBLISHED`。
- 缺 Key：`AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE`。
- Gateway 待接：`AI_GATEWAY_MODEL_ADAPTER_PENDING`。
- 无 route：`AI_GATEWAY_MODEL_ROUTE_NOT_FOUND`。
- 参数不支持：返回可读的 schema mismatch。
- 上游限流：显示供应商限流，不误报本站队列。

## 10. 开发原则

1. 不再用“把某个 import 从 `geminiService` 改成 `unifiedAiGateway`”当作完成标准。
2. 完成标准必须是：选中的模型进入 `/api/ai/jobs`，后端 route metadata 可见，adapter 与供应商一致。
3. 前端显示的模型必须来自 published + gateway ready + key / route 可用口径。
4. 所有入口都必须传 `canonicalModelId`，不能只传展示 label 或旧 model 字符串。
5. 当前画面、参考资产、版本节点必须作为请求上下文进入执行层。
6. 允许保留 legacy，但必须登记，不能无声绕过。

## 11. 下一步建议

建议下一轮先做第 1 轮和第 2 轮。

原因：

- 第 1 轮先把所有入口盘清楚，避免继续修完一个坏一个。
- 第 2 轮直接解决当前“前端模型能显示但执行报错”的核心链路。
- 文本链路成本低、验证快，适合作为 Gateway Job 统一执行的第一条标准样板。

等文本闭环稳定后，再迁移图片。图片涉及参考图、编辑、多图、尺寸参数和资产落库，复杂度更高，不适合在路由契约未稳定前硬改。

## 12. 第 1 轮进展：入口审计与护栏

**时间**：2026-07-15

本轮先不改真实生成逻辑，只完成两件事：

1. 把主要生成入口登记成可测试的审计表。
2. 加一条供应商直连边界检查，防止后续继续新增绕路。

### 12.1 已新增入口审计表

新增 `WORKFLOW_AI_EXECUTION_ENTRY_ROWS`，位置：

```text
services/workflowAiPickIndex.ts
```

当前审计入口：

| 入口 | 当前状态 | 结论 |
|---|---|---|
| 全局输入框 / 快捷生成 · 文生文 | legacy | 第 2 轮迁移到 Gateway Job |
| Project Agent · `run_plain_text` | legacy | 第 2 轮随文本闭环一起迁移 |
| Project Agent · @当前画面 / `run_plain_i2t` | legacy + context missing | 第 4 轮补当前画面上下文 |
| 全局输入框 / 快捷生成 · 文生图 / 图生图 | legacy | 第 3 轮迁移到 Gateway Job |
| 能力预设执行 | partial gateway | 需要统一模型优先级与 capability 请求 |
| 分镜表 AI | legacy | 第 5 轮收口 |
| 工作流生视频 | gateway | 已接近目标模式，继续补参数 schema |
| 工作流生 3D | partial gateway | Tripo / 混元 / 方舟 3D 需要统一 `model3d.generate` |
| 本机伴侣智能分割 | local | 明确保留为本地工具例外 |
| 管理端 Route Test | admin only | 只代表测试层级，不代表普通生成入口 |

这张表的目的不是运行时分发，而是让每次改造都能回答：

```text
这个入口现在到底走 Gateway、旧 Gemini 链路、本地工具，还是只属于管理测试？
```

### 12.2 已新增边界检查

新增脚本：

```text
scripts/check-ai-routing-boundary.mjs
```

新增命令：

```bash
npm run guard:ai-routing
```

检查范围：

- `components`
- `hooks`
- `services`

默认禁止业务层新增直连：

- `services/geminiService`
- `services/tripoService`
- `services/tencentService`
- `services/jimeng/adapter`
- `services/jimeng/client`

当前保留的例外主要是：

- `services/unifiedAiGateway.ts`：现有 facade / 迁移中出口。
- `services/generate3d/**`：3D 仓库层。
- 3D 持久化、重拉、下载相关工具。
- 本轮尚未迁移的少量已登记 legacy 例外。

后续原则：每完成一块 Gateway 化，就从脚本 `ALLOWED_FILES` 里删除对应例外。

### 12.3 已补测试

更新：

```text
tests/workflowAiPickIndex.test.ts
```

新增校验：

- 执行入口审计表覆盖本轮要跟踪的主要入口。
- 文本、Agent 文本、图片主入口当前仍明确标为 `legacy`。
- 视频入口明确标为 `gateway`。
- 每个入口必须有 `nextAction`，避免只登记不收敛。

### 12.4 第一轮后能回答的问题

现在可以明确回答：

**前端显示方舟模型后，为什么执行还可能报 Google / Vertex？**

因为文本和图片主入口目前仍是 `legacy`，模型字段还没有强制变成 `/api/ai/jobs` 的 `canonicalModelId + capability`。显示层已经前进，执行层还没完全迁移。

**`WorkflowSection` 把 import 改到 `unifiedAiGateway` 是否等于完成？**

不等于。这只算入口收口。只要 `unifiedAiGateway` 内部仍薄委托 `geminiService`，就仍可能进入旧 Gemini / Vertex 链路。

**下一轮应该改什么？**

第 2 轮先做文本闭环：

```text
quick compose text
Project Agent run_plain_text
  -> runUnifiedGeneration(text.generate)
  -> createAiJob(/api/ai/jobs)
  -> route metadata 可见
```

验收重点：

- 选 Ark Doubao 文本时 route 是 `volcengine-ark`。
- 选 OpenAI 文本时 route 是 `openai-official`。
- 只有选 Gemini / Flash 时才允许进入 Gemini / Vertex。

## 13. 第 2 轮进展：文本执行闭环

**时间**：2026-07-15

本轮把无图片的文生文入口收进 Gateway Job，不再只把选中的文字模型作为 `geminiService` 参数下传。

### 13.1 已新增统一文本执行层

新增：

```text
services/generation/runUnifiedGeneration.ts
```

当前落地能力：

```text
runUnifiedTextGeneration
  -> runUnifiedGeneration(text.generate)
  -> createAiJob(/api/ai/jobs)
  -> poll getMyAiJob
  -> extract output.text
```

提交给 Gateway 的关键字段：

- `modality: text`
- `capability: text.generate`
- `canonicalModelId`
- `registryId`
- `uiSource`
- `assetContext`

这意味着选择 Ark Doubao 文本模型时，前端提交的是：

```text
canonicalModelId = doubao-seed-2-0-pro
capability = text.generate
```

后端会按 `shared/aiGatewayModelRoutes.js` 路由到：

```text
providerId = volcengine-ark
adapterId = volcengine-ark-openai
```

而不是进入 Gemini / Vertex。

### 13.2 已接入无图片文生文

更新：

```text
services/capabilityExecutor.ts
```

当能力是：

```text
preset.category === text_to_text
并且没有图片输入
```

会走：

```text
runUnifiedTextGeneration(...)
```

仍保留原来的上层行为：

- 快捷输入框仍创建文本资产。
- Agent `run_plain_text` 仍复用快捷输入框文本任务。
- 执行完成后仍写入 `textResults`，侧栏时间轴仍能显示结果。

### 13.3 审计表已更新

更新：

```text
services/workflowAiPickIndex.ts
```

状态变化：

| 入口 | 原状态 | 新状态 |
|---|---|---|
| 全局输入框 / 快捷生成 · 文生文 | `legacy` | `gateway` |
| Project Agent · `run_plain_text` | `legacy` | `gateway` |
| 全局输入框 / 快捷生成 · 文生图 / 图生图 | `legacy` | 保持 `legacy`，第 3 轮处理 |
| Project Agent · @当前画面 / `run_plain_i2t` | `legacy + context missing` | 保持不变，第 4 轮处理 |

### 13.4 已补测试

新增：

```text
tests/runUnifiedGeneration.test.ts
```

覆盖：

- Ark 文本模型会创建 `text.generate` Gateway Job，并带 canonical model metadata。
- 异步文本 job 会轮询到 `output.text`。

更新：

```text
tests/workflowAiPickIndex.test.ts
```

覆盖：

- 文本主入口已标记为 `gateway`。
- 图片主入口仍是 `legacy`，避免误宣称第 3 轮已完成。

### 13.5 本轮没有处理的内容

本轮刻意没有处理：

- `run_plain_i2t` / @当前画面问答。
- 图片生成、图片编辑、多图参考。
- 分镜重绘、拼图、角色替换。
- 专家调用中的独立文本生成。
- 站点助手流式文本。

这些入口仍需要后续轮次继续收口。

### 13.6 第二轮后应该达到的效果

管理员发布 Ark Doubao 文本模型并配置 Key 后：

```text
前端选择 Doubao 文本模型
  -> 发起无图片文生文
  -> 创建 /api/ai/jobs
  -> Gateway route = volcengine-ark
  -> adapter = volcengine-ark-openai
  -> 返回 output.text
  -> 工作台文本结果展示
```

如果用户选择 Gemini / Flash，则仍允许进入 Gemini / Vertex route。这是正确行为，不再是“选了方舟却报 Vertex”。

## 14. 第 3 轮进展：图片执行闭环

**时间**：2026-07-15

本轮把快捷输入框和能力执行器里的主图片生成链路收进 Gateway Job。

### 14.1 已扩展统一执行层

更新：

```text
services/generation/runUnifiedGeneration.ts
```

新增：

```text
runUnifiedImageGeneration
  -> runUnifiedGeneration(image)
  -> createAiJob(/api/ai/jobs)
  -> poll getMyAiJob
  -> extract image artifact url
```

无参考图时：

```text
capability = workflow_text_to_image
```

有参考图时：

```text
capability = workflow_image_edit
```

提交给 Gateway 的关键字段：

- `modality: image`
- `capability: workflow_text_to_image | workflow_image_edit`
- `canonicalModelId`
- `registryId`
- `referenceImages`
- `config.imageConfig`
- `assetContext`

### 14.2 已接入能力执行器主生图链路

更新：

```text
services/capabilityExecutor.ts
```

已切换到 Gateway 的路径：

- 文生图：`text_to_image`
- 图生图：`image_to_image`
- 多图参考图生图
- 能力集合中的多图生图节点
- split_component 裁剪后再生图

仍保留旧逻辑的部分：

- 生图前的“理解提示词”仍走原文字/视觉理解链路。
- 大图预览局部重绘里的局部 inpaint 辅助调用还在组件侧，后续单独收。
- 分镜重绘、拼图、角色替换仍留到第 5 轮。

### 14.3 已修复供应商图片模型被回退的问题

更新：

```text
services/modelRegistry/imageModels.ts
```

过去 `coerceImageModelRegistryId()` 只认识本地旧图片注册表，遇到方舟 Seedream 这类供应商图片模型时，可能回退到默认 Gemini。

现在会保留：

```text
doubao-seedream-*
gpt-image-*
dall-e-*
```

这保证了前端选择 Ark Seedream 后，进入执行层的仍然是 Ark Seedream，而不是被强制改成 Gemini 默认模型。

### 14.4 审计表已更新

更新：

```text
services/workflowAiPickIndex.ts
```

状态变化：

| 入口 | 原状态 | 新状态 |
|---|---|---|
| 全局输入框 / 快捷生成 · 文生图 / 图生图 | `legacy` | `gateway` |
| Project Agent · `run_plain_t2i` / `run_plain_i2i` | 跟随快捷图片入口 | 已随主图片入口走 Gateway |
| Project Agent · @当前画面 / `run_plain_i2t` | `legacy + context missing` | 保持不变，第 4 轮处理 |
| 分镜表 AI | `legacy` | 保持不变，第 5 轮处理 |

### 14.5 已补测试

更新：

```text
tests/runUnifiedGeneration.test.ts
tests/workflowAiPickIndex.test.ts
tests/openaiAdapter.test.ts
```

覆盖：

- Ark Seedream 图片模型会创建 image Gateway Job。
- 有参考图时使用 `workflow_image_edit`。
- 能从 job artifacts / output artifacts 取回图片 URL。
- `doubao-seedream-*` 不会被 `coerceImageModelRegistryId()` 回退到 Gemini 默认。
- 审计表中图片主入口已标记为 `gateway`。

### 14.6 第三轮后应该达到的效果

管理员发布 Ark Seedream 图片模型并配置 Key 后：

```text
前端选择 Seedream 图片模型
  -> 发起文生图或图生图
  -> 创建 /api/ai/jobs
  -> Gateway route = volcengine-ark
  -> adapter = volcengine-ark-image
  -> 返回 image artifact
  -> 工作台资产版本显示图片结果
```

如果用户选择 GPT Image，则走 OpenAI / ToAPIs 对应 route；如果选择 Gemini 图片模型，则允许走 Gemini / Vertex route。

### 14.7 本轮没有处理的内容

本轮没有处理：

- @当前画面问答：需要第 4 轮补当前预览 snapshot / asset id / version id。
- 大图预览局部重绘的组件侧 inpaint 辅助调用。
- 分镜表重绘、拼图、角色替换。
- 专家调用、站点助手、流式文本。
- route 级参数 schema 的完整产品化渲染。
## 15. 第 4 轮进展：当前画面问答进入 Gateway 闭环

### 15.1 已完成

- `run_plain_i2t` / `@当前画面` 不再只把问题当普通文字交给旧链路，而是通过 `runUnifiedVisionTextGeneration()` 创建 `text.generate` Gateway Job。
- 当前预览画面会以截图 `inlineData` 进入 Gateway 请求，支持 3D / 全景 / 高度场视口截图，拿不到实时视口时回退到资产预览图。
- `WorkflowPendingTask.inputContext` 新增轻量上下文：`source=current_view`、`assetId`、`displayKey`、`mimeType`。
- 能力执行层会把 `currentPreviewAssetId` 写入 `assetContext`，并把 `inputContext` 写入 job metadata，方便后续追踪“这次回答基于哪一个当前画面”。
- 审计表中 `project_agent_current_view_qa` 已标记为 `gateway / canonical_model / partial`。

### 15.2 仍然是 partial 的原因

- 当前已经传递画面快照和资产 id，但还没有把左侧版本树的父子关系、分叉来源、版本 id 全量结构化传入。
- 对文本、视频、3D、音乐这类非静态图片资产，目前主要依赖当前可截图画面；还缺少“资产语义摘要 + 当前渲染状态 + 版本节点”的统一上下文包。
- Agent 侧还没有在回复 UI 中显式展示“本回答引用了哪个当前画面 / 哪个资产版本”，后续可补 job id、asset id、version id 的可追溯展示。

### 15.3 验证重点

- `tests/runUnifiedGeneration.test.ts` 覆盖视觉文本请求：图片必须以内联数据进入 `contents.parts`，metadata 必须包含 `visionText=true` 和 `imageCount`。
- `tests/workflowAiPickIndex.test.ts` 覆盖当前画面问答入口已从 `legacy` 更新为 `gateway`。

## 16. 第 5 轮进展：分镜文本理解进入 Gateway 薄层

### 16.1 已完成

- 新增 `services/storyboardGatewayText.ts`，作为分镜文本任务的统一 Gateway 薄层。
- 分镜结构解析、批量结构解析、结构优化、批量导入 AI 规范化已从旧 `workflowChat` 切到 `runUnifiedTextGeneration()`。
- 分镜文本任务会统一携带：
  - `uiSource=storyboard.<operation>`
  - `assetContext.projectId`
  - `assetContext.sourceAssetId=storyboardAssetId`
  - `metadata.storyboard=true`
  - `metadata.operation`
  - `metadata.storyboardAssetId`
  - `metadata.rowId`
  - `metadata.presetId / presetLabel`
  - 原请求配置摘要 `requestOptions`
- 分镜重绘、拼图改图、角色替换本身已经通过能力执行器进入上一轮统一生图 Gateway 链路，本轮补齐的是文本理解和结构化解析链路。
- 审计表中 `storyboard_ai` 已从 `legacy` 更新为 `partial_gateway / canonical_model / partial`。

### 16.2 仍然是 partial 的原因

- 分镜解析页仍有大量本地规则预解析、字段确认、切格、回填逻辑，这些不应全部进入 Gateway，但需要继续区分“本地处理”和“AI 调用”。
- 视觉检测、拆格、部分辅助理解路径仍需要单独审计是否应该统一为 Gateway job 或保留本地工具。
- 分镜生成结果目前能通过审计事件追踪，但 UI 侧还没有完整展示 Gateway job id、route、provider、模型和费用明细。

### 16.3 验证重点

- `tests/storyboardGatewayText.test.ts` 覆盖分镜文本薄层必须携带 asset/project/operation/preset metadata。
- `tests/storyboardTableParse.test.ts`、`tests/storyboardTableBulkAiDetect.test.ts`、`tests/storyboardParsePageCore.test.ts` 覆盖原分镜解析行为仍保持。
- `tests/workflowAiPickIndex.test.ts` 覆盖 `storyboard_ai` 状态已变为 `partial_gateway`。
