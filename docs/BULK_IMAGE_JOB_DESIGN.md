# 批量出图任务设计（已确认参数）

## 1. 背景与约束

- **使用场景**：公司内约 30 人同时使用，共享同一 Google AI Studio API Key。
- **配额**：Google AI Studio **Tier 1**，公司整体 **RPD = 1,000**（每日请求数）；每分钟有高峰/闲时，RPM 不写死，通过并发控制避免高峰打满。
- **目标**：一次任务可配置总张数，由系统自动分片请求、排队执行；有进度、可取消、状态可信；不超 RPD、高峰不爆 RPM。

---

## 2. 已确认的限流与容量参数

| 项目 | 建议值 | 说明 |
|------|--------|------|
| 全公司每日生图请求上限 | **900** | 留约 100 给对话/理解等；达限后拒绝新任务并提示。 |
| 全公司同时进行中的生图请求数 | **2** | 用队列控制高峰 RPM，不依赖具体 RPM 数值。 |
| 单任务最大张数 | **24～30** | 约 6～8 次请求（按每请求 4 张），避免单人单任务占太多 RPD。 |
| 单次请求张数 | **4** | 平衡吞吐与单次失败成本；可后续按需改为 6/8。 |
| 每用户每日请求上限（可选） | **40** | 若做公平分配时使用；全公司仍以 900 先到为准。 |
| 每用户同时批量任务数（可选） | **1** | 避免一人连续占满 2 个槽位。 |

---

## 3. 核心设计要点

### 3.1 任务抽象（ImageJob）

- **id**：唯一标识。
- **instruction**：生图提示词（与现有 `dialogGenerateImage` 语义一致）。
- **totalImages**：用户要的总张数（≤ 单任务最大张数）。
- **status**：`pending | running | completed | failed | cancelled | partial`
- **results**：已生成图片列表（如 `string[]` base64 或 URL）。
- **progress**：已生成张数 / totalImages。
- **errorSummary**：可选，失败时的简短说明。
- **createdAt / updatedAt**：便于统计与排查。

### 3.2 执行与队列

- **分片**：按 `imagesPerRequest`（默认 4）将 totalImages 拆成多次 API 调用；每次调用返回多张时，解析为 `string[]` 而非只取第一张。
- **并发控制**：全公司 **同时最多 2 个「正在执行的生图请求」**（即 2 个请求在飞）；多出的任务进入队列，完成一个再取下一个。
- **取消**：用户取消时，仅停止后续子请求；已发出的请求可能仍会返回，需保证状态机不乱（例如 Job 已 `cancelled` 则不再把新结果写入）。

### 3.3 RPD 与可选每用户限制

- **RPD**：由**后端**统一维护「今日已消耗的生图请求数」，达到 900 时拒绝新建任务，并返回明确提示（如「今日额度已用尽，明日再来」）。未配置后端时由前端 localStorage 近似。
- **并发**：由**后端**统一限制同时最多 2 个生图请求；未配置后端时由前端内存队列近似。
- **可选**：按用户/会话做「每用户每日 40 次」或「每用户同时最多 1 个批量任务」，由实现时配置开关。

### 3.4 错误与部分成功

- **429/503 等**：在 Job 层做有限重试（已实现：`runStepWithRetry` 最多 2 次、指数退避）；高成本请求在 `geminiService` 层保持不自动重试。
- **部分成功**：部分子请求失败时，Job 状态为 `partial`，保留已成功图片；UI 展示「已生成 X/Y 张」及失败提示；已实现「继续生成剩余 N 张」按钮（`createImageJobContinue` 新建 Job）。

---

## 4. 服务层扩展（与现有代码的衔接）

- **现有**：`geminiService.dialogGenerateImage` 等单次只返回一张图（只取 `response` 中第一个 `inlineData`）。
- **已实现**：`dialogGenerateImages(imageBase64, instruction, numImages, ...)` 单次请求，解析响应中所有 `inlineData` 返回 `string[]`；Job 执行器按批（每批最多 4 张）调用、更新状态、扣减 RPD、并发 2、每日 900 上限。

---

## 5. 第一性原理检查

- **数据正确性**：Job 状态与真实完成张数一致；取消后不再写入新结果；RPD 计数与真实写入的请求一致。
- **状态透明**：用户可见「排队中 / 执行中（X/Y）/ 已完成 / 部分完成 / 已取消 / 失败」及简短错误说明。
- **行为可预测**：所有人走同一套「提交任务 → 排队/执行 → 进度/取消」；限流规则固定（同时 2 请求、每日 900），不因打开顺序变化。

### 5.1 落地措施（代码级保障）

以下措施在 `services/imageJobExecutor.ts` 中已实现，用于满足上述三条并提升健壮性。

| 原则 | 风险 | 措施 |
|------|------|------|
| **数据正确性** | 多 step 并发完成时，后写入覆盖先写入导致丢图 | `updateJob(id, (prev) => patch)` 支持基于当前 `prev` 的合并，结果合并为 `[...(prev.results ?? []), ...images].slice(0, prev.totalImages)`，等价于原子读-改-写 |
| **数据正确性** | 已取消的 job 仍把 step 成功结果计入 RPD | `updateJob` 返回是否实际写入；仅在返回 `true` 时 `incrementTodayRPD()`，取消后不再计 RPD |
| **数据正确性** | `results`/`totalImages` 缺省或异常导致状态错乱 | `deriveStatus` 使用 `(job.results ?? []).length`、`Number(job.totalImages)\|\|0` 及 `total<=0` 分支；合并时使用 `...(prev.results ?? [])` |
| **输入与边界** | instruction 空串或非字符串导致无效请求 | `createImageJob` 校验 `instruction.trim()` 非空，否则抛「生图指令不能为空」 |
| **输入与边界** | localStorage 被篡改导致 RPD 为负 | `getTodayRPD()` 返回 `Math.max(0, n)`，保证 ≥0 |
| **输入与边界** | 继续生成时原任务引用过期或字段缺失 | `createImageJobContinue` 校验 `originalJob?.id`，用 `jobs.get(id)` 取最新；对 `results`/`totalImages`/`instruction` 做防御性读取与校验 |
| **可控性** | 重试退避期间用户取消仍要等满 delay | 退避使用 `sleepWithAbort(delay, signal)`，取消时立即 reject，不再等待整段 delay |

---

## 6. 实现状态

| 项 | 状态 |
|----|------|
| 参数与限流策略 | 已确认（本文档） |
| 服务层「单请求多图」返回 `string[]` | 已实现（`geminiService.dialogGenerateImages`：单次请求，解析响应中所有 inlineData 返回数组） |
| Job 执行器（分片 + 队列 + RPD） | 已实现（`services/imageJobExecutor.ts`：按批调用、每批最多 4 张、并发 2、RPD 900 存 localStorage） |
| 429/503 有限重试 | 已实现（执行器内 `runStepWithRetry`：最多 2 次、指数退避 2s/4s） |
| 部分成功「继续生成剩余 N 张」 | 已实现（`createImageJobContinue(originalJob)` + 对话页部分完成任务上的按钮） |
| 每用户同时最多 1 个批量任务（可选） | 已实现（`ONE_BULK_JOB_AT_A_TIME`：前端仅允许 1 个 pending/running，新建时校验） |
| 后端 Job 存储与 API（若采用后端方案） | 已实现（`server/bulk-image-api.js`：POST/GET /jobs、POST /jobs/:id/cancel、GET /rpd；可选 BULK_IMAGE_DATA_DIR 持久化 jobs.json + rpd.json） |
| 前端：批量入口、进度、取消、部分成功展示 | 已实现（对话页「批量出图」区块：张数输入、批量生成、任务列表与进度条、取消、继续生成剩余） |
| 第一性原理落地（竞态、RPD、输入边界、可中断退避） | 已实现（见 §5.1） |
| 门面切换后端/本地 | 已实现（`services/bulkImageJobFacade.ts`：VITE_BULK_IMAGE_API 存在时走后端，否则 re-export 本地执行器） |

---

## 7. 后端部署与 Key 策略

- **部署**：运行 `node server/bulk-image-api.js`（或 `npm run dev:bulk-api`）。环境变量：`GEMINI_API_KEY`（公司统一 Key，前端未传时使用）、`BULK_IMAGE_PORT`（默认 9002）、`BULK_IMAGE_RPD_DAILY_LIMIT`（900）、`BULK_IMAGE_MAX_CONCURRENT`（2）、`BULK_IMAGE_DATA_DIR`（可选，持久化目录，写入 jobs.json 与 rpd.json）。
- **前端**：设置 `VITE_BULK_IMAGE_API=http://localhost:9002`（或生产后端地址）后，批量出图请求发往后端，进度通过轮询 GET /jobs 更新。
- **Key 策略**：公司 Key 存后端 env；前端可在设置页填写 Gemini Key，门面在 POST /jobs 时若存在则传 `apiKey`，**后端优先使用请求体中的 apiKey**，为空时使用 `GEMINI_API_KEY`。

---

## 8. 参考

- 配额与规划讨论：Google AI Studio Tier 1，公司整体 RPD 1,000，每分钟随机峰谷，以「同时 2 请求 + 每日 900」为护栏。
- 协作流程：参见 `.cursor/rules/user-ai-workflow.mdc`（需求整理 → 选项 → 确认 → 再改代码）。
- 后端与持久化方案：见 §7。
