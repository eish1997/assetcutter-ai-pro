# AI Gateway 多模态商业化改造清单

> 目标：保留当前可用产品，逐步把「Gemini 图片代理」演进成统一 AI 任务平台。原则是前端入口统一、计费与审计统一、执行按模态拆分、每个阶段都可独立上线和回退。

## 0. 目标架构

```text
前端
  -> auth-api / 登录 / 积分 / 套餐 / 权限
  -> ai-gateway / 任务创建 / 路由 / 限流 / 状态
  -> workers / adapters
       image-worker -> vertex / openai / jimeng / toapis
       video-worker -> veo / kling / runway / other
       music-worker -> suno / udio / other
       3d-worker    -> tripo / tencent / local companion
       text-worker  -> vertex / openai / toapis
  -> artifact storage / R2 / project asset store
```

当前 `server/gemini-proxy-api.js` 不再继续扩大为万能代理；它先作为 `vertex/gemini image/text adapter` 被新网关包住，后续再按风险迁移。

## 1. 统一任务模型

先定义所有模态共用的 `AiJob`，不要让前端直接理解每个供应商的状态机。

```ts
type AiJobModality = "text" | "image" | "video" | "music" | "3d";
type AiJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type AiJob = {
  id: string;
  userId: string;
  modality: AiJobModality;
  capability: string;
  provider?: string;
  model?: string;
  status: AiJobStatus;
  costEstimate: number;
  reserveKey?: string;
  input: unknown;
  output?: unknown;
  artifacts?: Array<{ kind: string; url: string; mimeType?: string; bytes?: number }>;
  error?: { code?: string; message: string; raw?: unknown };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};
```

统一 API：

- `POST /api/ai/jobs`
- `GET /api/ai/jobs/:id`
- `POST /api/ai/jobs/:id/cancel`
- `POST /api/ai/jobs/:id/retry`

## 2. Phase 0：先稳线上

目标：不重构大链路，先让现有图片能力适合内测收费。

任务：

- Render `assetcutter-gemini-proxy` 开启 `GEMINI_FAIRNESS_ENABLED=true`。
- 确认 `/healthz`：`vertex.configured=true`、`adcLikelyConfigured=true`、`location=us-central1`。
- 线上 `gemini-proxy` 与 `auth-api` 共用 `DATABASE_URL`，使 fairness 管理页写入能被 proxy 热加载。
- 为白模、Pro 生图、批量能力设置更低默认并发。
- 默认优先直发，理解步只在必要能力开启。
- 429、登录、积分不足、Vertex 未配置、模型 404 分开映射。
- 失败任务释放积分预扣，避免用户付费失败。

验收：

- 单用户连续执行 5 次普通文生图，不出现 Render 共享代理类错误。
- 白模失败时能明确区分上游 429 与积分/登录问题。
- 管理后台能看到 fairness 状态和当前排队/并发配置。

## 3. Phase 1：落统一任务表与接口

目标：建立 `AiJob` 地基，但不强制所有能力立刻迁移。

建议文件：

- `server/ai-job-store.js`
- `server/ai-job-handlers.js`
- `server/migrations/0xx_ai_jobs.sql`
- `services/aiJobsClient.ts`
- `types/aiJob.ts`
- `tests/aiJobs.test.ts`

任务：

- Postgres 表存储任务状态、输入摘要、输出 artifact、错误、积分 reserve。
- `auth-api` 暴露统一 job API。
- job API 先只支持 `image` 的最小子集。
- 每个 job 记录 `correlationId`、`userId`、`capability`、`provider`、`model`。
- 支持取消状态，但初期可只做软取消。

验收：

- 未登录创建 job 返回 `LOGIN_REQUIRED`。
- 积分不足创建 job 返回 `CREDITS_EXCEEDED`。
- 成功/失败都能在 DB 里查到完整状态。
- 用户只能读取自己的 job，管理员可查全部。

## 4. Phase 2：AI Gateway 包住现有 Gemini Proxy

目标：先不重写 `gemini-proxy`，由 `ai-gateway` 创建 job 并调用旧链路。

建议文件：

- `server/ai-gateway.js`
- `server/ai-provider-router.js`
- `server/adapters/gemini-proxy-adapter.js`
- `tests/aiGateway.geminiProxy.test.ts`

任务：

- `POST /api/ai/jobs` 接普通文生图。
- Gateway 根据 `modality/capability/model` 选择 `gemini-proxy-adapter`。
- Adapter 调用现有 `/proxy/gemini/async` 或 `/generate-content`。
- poll 结果写回 `ai_jobs`。
- 保留旧前端入口作为回退。

验收：

- 普通文生图可通过新 job API 完成。
- 旧工作流仍可使用。
- Gateway 失败不影响旧链路。

## 5. Phase 3：图片能力逐步迁移

迁移顺序：

1. 普通文生图。
2. 图生图/变体。
3. 线稿/转风格。
4. 白模/Pro 生图。
5. 批量能力。

每迁一个能力必须具备：

- 回退开关。
- 对应测试。
- 错误映射。
- 积分预扣/释放。
- 管理后台可见 job 状态。

验收：

- 每个能力迁移后，旧入口可通过开关恢复。
- 失败任务能重试。
- 任务刷新页面后仍可恢复状态。

## 6. Phase 4：多模态 Worker 与 Adapter

目标：新增音乐、视频、3D 时不塞进 `gemini-proxy`。

建议拆分：

- `image-worker`：图片生成、图像编辑、白模。
- `video-worker`：图生视频、文生视频、视频延展。
- `music-worker`：文生音乐、延展、分轨。
- `3d-worker`：Tripo、腾讯 3D、本地 companion 后处理。
- `text-worker`：理解、解析、标签、提示词改写。

规则：

- Worker 可以共享 job 表，但不要共享供应商 SDK 适配代码。
- Provider adapter 只负责供应商协议转换，不负责产品计费。
- Gateway 负责路由、限流、熔断、回退。

验收：

- 新增一个供应商不需要改前端任务协议。
- 新增一个模态不需要改 `gemini-proxy`。
- 单个 worker 故障不影响其它模态。

## 7. Phase 5：商业化运营层

目标：从「能生成」升级为「能卖、能管、能追责」。

任务：

- 套餐级并发：免费/基础/专业/企业。
- 模型权限：Pro 图像、长视频、3D 高面数仅高套餐可用。
- 供应商成本报表：按 user / capability / provider / model 汇总。
- 失败率与退款率统计。
- 管理员手动重试、取消、退款。
- 供应商健康面板：429、5xx、平均耗时、队列长度。
- 自动熔断：某供应商连续失败后切备用。

验收：

- 能回答「哪个用户、哪个功能、哪个模型打爆了配额」。
- 能按套餐限制峰值。
- 能在供应商异常时自动降级或排队。

## 8. 当前优先级

P0：

- 修 Render fairness 未开启。
- 确认线上 `GEMINI_FAIRNESS_CONFIG_SOURCE=db` 真生效。
- 降低白模/Pro 生图默认并发。
- 429 文案补充当前 provider/model/route。

P1：

- 建 `AiJob` 表和只读管理视图。
- 新增普通文生图 job API 样板。
- Gateway 包现有 `gemini-proxy`。

P2：

- 迁移白模、变体、线稿。
- 接入第二个图片供应商。
- 视频/音乐/3D 新能力统一走 job API。

## 9. 验证命令

```powershell
npx vitest run tests/geminiProxyRetry.test.ts tests/geminiProxyFairnessEnvelope.test.ts
npx vitest run tests/proxyCreditsGate.test.ts tests/creditReserves.test.ts
npx vitest run tests/workflowRunTaskBranch.test.ts tests/workflowAiPickIndex.test.ts
npm run typecheck
```

涉及 Render 后还要验证：

```powershell
Invoke-WebRequest -UseBasicParsing https://assetcutter-gemini-proxy.onrender.com/healthz
Invoke-WebRequest -UseBasicParsing https://assetcutter-auth-api.onrender.com/healthz
```

## 10. 不做事项

- 不把音乐、视频、3D 全塞进 `gemini-proxy`。
- 不让前端直接拼供应商专用 API。
- 不在没有 job 表的情况下做长视频/长音乐任务。
- 不用 `localStorage` 存核心任务状态。
- 不在生产使用 `VITE_BULK_IMAGE_API=same-origin`。
