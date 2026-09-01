# AI 生成任务链路核对表

**用途**：排查“前端生成任务总是出错”“后台供应商看起来正常但生成失败”“这个模型好了另一个模型坏了”这类问题。  
**核心判断**：后台 Key Test、Route Check、真实 Generation Test 是三件不同的事，前两者通过不代表整条生成链路通过。

## 一句话链路

```text
前端入口
  -> WorkflowSection / capabilityExecutor
  -> runUnifiedGeneration 或 3D 专用执行分支
  -> POST /api/ai/jobs
  -> 后端积分 / 发布 / 路由 / Key 守门
  -> AI Gateway worker / adapter
  -> 供应商上游
  -> 轮询结果
  -> output / artifacts
  -> 工作流资产回写
```

## 三种测试不要混用

| 测试层 | 证明什么 | 不证明什么 | 入口 |
|---|---|---|---|
| Key Check / Upstream Probe | 供应商凭证字段齐全，部分供应商可做低成本探活 | 不证明某个模型能生成，不证明产物能回写 | 供应商中心的 Key 测试 |
| Route Check | 某个 canonical model 是否有 Gateway route，是否有可用平台 Key | 不创建生成任务，不调用真实生成接口 | 供应商中心的 Route Check |
| Generation Test | 真实创建任务、调用供应商、轮询、产物解析、计费、回写 | 这是端到端验证，成本和风险最高 | 目前待补，排障时用最小真实任务手动验证 |

## 排障作业单

每次遇到生成失败，先填这张表。填不出来的格子，就是链路里缺观测或缺约束的地方。

| 核对项 | 应填写内容 | 去哪里看 |
|---|---|---|
| 前端入口 | 工作流快捷生成、能力预设、能力集合、资产集、分镜表、AI 任务重试等 | 用户操作路径、`WorkflowSection` 日志 |
| 任务类型 | text / image / video / model3d / music | AI 任务详情 `modality` |
| 能力名 | `text.generate`、`workflow_text_to_image`、`workflow_generate_video`、`model3d.generate` 等 | AI 任务详情 `capability` |
| canonicalModelId | 平台逻辑模型 id | AI 任务详情、供应商中心模型发布区 |
| registryId | 前端/模型注册 id | 前端预设、AI 任务 metadata |
| providerId | 实际供应商，如 `vertex-site`、`openai-official`、`volcengine-jimeng`、`tripo` | AI 任务 route、Route Check |
| Key 状态 | ready / key_missing / cooling_down / disabled | 供应商中心 Key 池、健康报表 |
| Route 状态 | gateway_ready / adapter_pending / route_not_found | 供应商中心 Route Check、`shared/aiGatewayModelRoutes.js` |
| Job 状态 | queued / running / succeeded / failed / cancelled | 用户侧 AI 任务、后台 AI 任务 |
| 上游状态 | HTTP 状态、上游 task id、错误码 | AI 任务详情 metadata、provider key events |
| 产物状态 | artifacts 是否有 url，output 是否包含 text/image/video/model3d | AI 任务详情 |
| 回写状态 | 工作流资产是否创建，是否有 `aiGatewayJobId` | 工作区资产卡、任务回填入口 |

## 按层定位

### 1. 前端入口层

如果用户点了按钮但没有 AI job：

- 查 `WorkflowSection.runTask` 是否把任务分到正确分支。
- 普通文/图/视频应优先看 `capabilityExecutor` 和 `runUnifiedGeneration`。
- 3D 要特别看是否走了 `branch_generate_3d`，以及是否按 provider 分流。

关键代码：

- `components/WorkflowSection.tsx`
- `services/workflowRunTaskBranch.ts`
- `services/capabilityExecutor.ts`
- `services/generation/runUnifiedGeneration.ts`
- `services/generate3d/`

### 2. 模型选择层

如果前端能选模型，但后端拒绝：

- 查模型是否在 workspace 发布名单里。
- 查 canonical model 和 registryId 是否一致。
- 查该模型是否标记为 gateway ready，而不是 adapter pending。
- 查前端是否硬传了错误 provider。新路线更推荐只传模型 id，让后端推断 provider。

关键代码：

- `services/modelRegistry/canonicalModelCatalog.ts`
- `services/modelRegistry/publishedModelCatalog.ts`
- `services/modelRegistry/providerBindings.ts`
- `shared/aiGatewayModelRoutes.js`

### 3. 后端守门层

如果 `/api/ai/jobs` 返回 400/422：

- `AI_GATEWAY_MODEL_NOT_PUBLISHED`：模型没发布到工作台。
- `AI_GATEWAY_MODEL_ADAPTER_PENDING`：目录里有模型，但后端 adapter 还没真正接通。
- `AI_GATEWAY_MODEL_ROUTE_NOT_FOUND`：没有可执行 route。
- `AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE`：route 有了，但没有可用平台 Key，或 Key 被冷却/禁用。
- `AI_GATEWAY_PROVIDER_PAUSED`：供应商被运营暂停。

关键代码：

- `server/ai-gateway/auth-api-handler.js`
- `server/ai-gateway/model-publication-guard.js`
- `server/ai-gateway/model-route-guard.js`
- `server/ai-gateway/provider-key-store.js`
- `server/ai-gateway/ops-control.js`

### 4. 执行适配层

如果 job 创建成功但很快 failed：

- 看 route 里的 `workerId` 和 `adapterId` 是否对应。
- 看 adapter 是否真的支持该 modality / capability / 参数形状。
- 看 provider key events 是否出现 401、403、429、5xx、timeout。
- 看是否触发自动冷却或 provider 熔断。

关键代码：

- `server/ai-gateway/provider-router.js`
- `server/ai-gateway/workers/`
- `server/ai-gateway/adapters/`
- `server/ai-gateway/executor.js`

### 5. 产物与回写层

如果 job 成功但前端说“没有结果”：

- 查 `artifacts` 是否有可用 URL。
- 查 `output` 字段是否被脱敏后仍保留轻量产物信息。
- 图片要有 image url / dataUrl；视频要有 video url；3D 要有 model3d url；文本要有 text/content。
- 查工作流资产回写是否识别了对应 artifact kind。

关键代码：

- `services/generation/runUnifiedGeneration.ts`
- `services/aiJobArtifacts.ts`
- `services/aiJobArtifactRestore.ts`
- `server/ai-gateway/execution-finalize.js`
- `server/ai-gateway/adapters/*`

## 常见误判

| 看到的现象 | 容易误判 | 实际应判断 |
|---|---|---|
| 后台 Key 测试通过 | 供应商生成可用 | 只说明凭证层通过，仍需 Route Check 和真实生成 |
| Route Check 通过 | 一定能出图/出视频/出模型 | 只说明 route/key 守门通过，不证明上游参数和产物解析 |
| 前端模型可选 | 后端一定支持 | 还要看发布名单、Gateway route、adapter ready、key ready |
| Job succeeded | 工作流一定能显示 | 还要看 artifacts/output 是否符合前端回写契约 |
| 某供应商 healthy | 该供应商所有模型都可用 | 健康是 key/provider 维度，模型 route 仍可能缺失 |

## 最小真实 Generation Test 标准

后续补后台 Generation Test 时，必须满足：

1. 明确标记 `createsGenerationTask=true`。
2. 每次测试都生成可追踪的 AI job id。
3. 使用最低成本输入，例如最短文本、最小图、最短视频或最低质量 3D。
4. 返回 route、provider、canonicalModelId、registryId、upstream task id。
5. 验证 job 进入终态，而不是只提交成功。
6. 验证 artifacts/output 至少包含一个可用产物。
7. 不自动发布模型，不自动修改 key，不自动改 ops-control。
8. 写入审计日志和 provider key health event。

## 当前结论

当前架构方向是“菜单 / 编排 / Gateway / 供应商”分层，方向是对的；主要风险是迁移中存在多条半重叠链路：

- 普通文图生成已经更多走 `runUnifiedGeneration -> /api/ai/jobs`。
- 3D 仍有独立分支和 provider 特例。
- 后台供应商中心已有 Key Check / Route Check，但 Generation Test 仍未闭环。
- 模型目录、发布名单、route rules、provider binding 需要保持同步。

排障时优先收集 AI job id，再按上面的作业单逐层定位。
