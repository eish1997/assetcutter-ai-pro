# 本地伴侣 · SAM 分割 — 产品开发规格

本文面向实现与评审：**规格级、可落地**，与「一期二期」排期无关；交付物按本文即可闭环为可发布的产品能力。

### 文档控制


| 属性       | 说明                                                                                       |
| -------- | ---------------------------------------------------------------------------------------- |
| **规格版本** | `1.1`（`1.0` = 初版技术契约；`1.1` = 增补产品化 / 规范化 / 模块化约束）                                        |
| **配套协议** | 伴侣计算 `protocolVersion: 1`；SAM HTTP 见 §3（建议路径 `**/v1/segment/predict`**，与伴侣 `/v1/`* 语义对齐） |
| **权威冲突** | 实现与本文不一致时：**先修订本文并评审**，再改代码；例外须书面记「偏离项」于修订记录                                             |
| **工件要求** | SAM 服务须在仓库内提供 `**openapi.yaml`（或 JSON Schema）** 作为 HTTP 契约的机器可读源（见 §10 交付物）              |


#### 修订记录


| 版本  | 日期         | 摘要                                 |
| --- | ---------- | ---------------------------------- |
| 1.0 | 2026-05-07 | 初版：架构、Job 契约、Adapter、浏览器接入         |
| 1.1 | 2026-05-07 | 文档控制、模块化边界、错误码登记、UX/NFR、OpenAPI 要求 |


---

## 1. 目标与边界

### 1.1 产品目标

- 用户在 **网站** 内对图像做点选 / 框选等提示，由 **本机算力** 生成 **高质量分割 mask**（及可选抠图结果）。
- **用户不接触** Python、pip、模型下载命令；运维形态与现有 **本地伴侣（local-companion）** 一致：网站通过 **本机 HTTP** 与伴侣通信，伴侣负责 **Volume 资产读写** 与 **计算任务编排**。
- 行为与现有 `**seam_repair`** 任务一致：**输入资产须已 PUT 到当前 `projectId` 下**，输出写回 **指定 asset key** 或返回可消费的二进制说明（见 §6）。

### 1.2 非目标（本文不规定）

- 云端托管 SAM、多租户推理集群。
- 视频时序分割（若未来采用 SAM 2，另文扩展 `**type` 与 inputs**）。
- 替换现有 `**cut_image`** 内置栅格切割语义；分割能力与切割能力可并存，由产品命名与入口区分。

### 1.3 关键依赖假设

- **Segment Anything**（或 API 兼容的替代实现）以 **独立本机 HTTP 服务** 形式存在，由伴侣 **转发请求**；伴侣进程本身仍为 **Node（tsx）**，不强制内置 PyTorch。
- 浏览器侧遵守项目既有约定：**不写死 `localhost` 以外的固定 IP**；伴侣默认 `**http://127.0.0.1:18765`**（可配置），见 `services/companionLocalPrefs.ts`。

### 1.4 术语、稳定标识符与展示名（规范化）


| 类别         | 稳定标识（代码 / Job / 日志）                   | 对用户展示（可本地化）    |
| ---------- | ------------------------------------- | -------------- |
| 计算任务类型     | `**sam_segment`**（勿改，持久化与统计依赖）        | 「本机智能分割」/ 产品自定 |
| 伴侣 Adapter | `**sam_segment@v1`**（随不兼容契约递增）        | 不直接暴露          |
| Prompt 结构  | `**SamSegmentPromptV1`**（文档与 TS 类型同名） | —              |
| 设置项 env    | `COMPANION_SAM_SEGMENT_URL` 等         | 设置页短说明 + 帮助链   |


- **禁止**在 UI 文案中硬编码内部 `type` 字符串；错误提示须通过 **错误码 → 文案** 映射（附录 A）。
- **国际化**：前端文案键建议统一前缀 `**companion.sam_segment.`***（与现有设置/伴侣模块键风格一致即可）。

---

## 2. 系统架构

### 2.1 逻辑拓扑

```
浏览器 (Vite 站点)
  │  companionFetchJson + Bearer（可选）
  ▼
local-companion :18765
  │  POST /v1/compute/jobs  { type, projectId, inputs, params }
  │  读/写  PUT|GET /v1/projects/:id/assets/:key
  ▼
SAM 本机后端（新建，建议 FastAPI）
  │  接收 multipart 或 JSON+raw body
  ▼
GPU/CPU 推理 → PNG mask 或 JSON（轮廓/RLE）
```

### 2.2 与现有能力对齐


| 现有能力                     | 对齐方式                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `**seam_repair**`        | 同一模式：`jobsStore` 注册 `type` → `xxxAdapter` 从 Volume 读字节 → `fetch` 本机后端 → `putAsset` 写回。参考 `local-companion/src/compute/seamRepairAdapter.ts`。 |
| **网站 `companionClient`** | 新增 `submitCompanionSamSegmentJob`（命名可定为产品名），与 `submitCompanionSeamRepairJob` 并列，见 `services/companionClient/compute.ts`。                     |
| **安全**                   | 复用 `accessGate`：`Authorization: Bearer` 与 `COMPANION_SHARED_TOKEN`；Origin 白名单行为不变。                                                           |


### 2.3 模块化分层与依赖方向（须遵守）

以下为**逻辑模块**划分，不要求物理目录一字不差，但 **依赖只能自上而下**，禁止反向耦合。

```
┌─────────────────────────────────────────────────────────┐
│ 表现层（React）                                          │
│ 大图 / 工作流 / 设置：仅调用「分割门面」与 companionClient   │
└───────────────────────────┬─────────────────────────────┘
                            │ 禁止 import Adapter 实现细节
┌───────────────────────────▼─────────────────────────────┐
│ 应用门面（建议 `services/samSegmentCompanion.ts` 或等价）   │
│ 组装：原图尺寸 → SamSegmentPromptV1 → PUT 资产 → submitJob │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│ 伴侣 HTTP 客户端（已有 `companionClient/*`）              │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│ local-companion：`jobsStore` 仅负责调度与事件              │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│ `samSegmentAdapter`（基础设施）：Volume I/O + HTTP 调用 SAM │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│ SAM HTTP 服务（可替换实现，见 §2.4）                       │
└─────────────────────────────────────────────────────────┘
```

**硬约束**

- `**jobsStore.ts`**：除新增分支调用外，**不**写入 SAM 专用业务逻辑；解析与 HTTP 细节均在 **Adapter**。
- **React 组件**：**不**拼接 `multipart`、**不**直连 SAM 端口；一律经伴侣 `**sam_segment`**。
- **共享类型**：`SamSegmentPromptV1` 与 Job `inputs`/`params` 形状建议 `**types.ts` 或 `services/companionClient/types-sam.ts`** 单点定义，伴侣侧可 **复制最小子集** 或将来抽 workspace 包（二选一须在 PR 说明）。

### 2.4 可替换推理后端（模块化扩展点）

- **固定契约**：伴侣只依赖 **§3 HTTP + §6 Job**；只要新后端语义等价，可替换为 ONNX Runtime、其他发行版 SAM、或后续 SAM 2 服务。
- **切换方式**：通过 `COMPANION_SAM_SEGMENT_URL` 指向不同实现；**禁止**在网站侧为「换后端」增加分支逻辑。
- **版本协商**：SAM 服务响应头或 `/health` 中返回 `**sam_backend_version`**（semver），伴侣可在 `reply.completed` 的 payload 中 **可选**透传，便于排障。

---

## 3. SAM 本机后端规格（须单独实现与分发）

### 3.1 进程与配置

- **监听地址**：默认 `127.0.0.1`，端口 **环境变量** `SAM_HTTP_PORT`（建议默认 `**18081`**，与 `8008` 修缝、`18765` 伴侣错开）。
- **超时**：大图为 **60～180s** 可配置；伴侣侧 `fetch` **AbortController** 超时须 **≥** 后端最坏情况。
- **模型**：默认 **SAM ViT-B** 检查点（体积与速度平衡）；路径 `SAM_CHECKPOINT_PATH` 或应用数据目录下固定相对路径。启动时若缺失：**HTTP 503** + 明确 JSON `error`（供伴侣映射为 `COMPUTE_SAM_MODEL_MISSING`）。

### 3.2 HTTP API（建议）

`**POST /v1/segment/predict`**（推荐；若历史原因使用无版本前缀路径，须在 **OpenAPI `servers` + 修订记录** 中说明，且 Adapter **常量唯一**）

- **Content-Type**: `multipart/form-data`
- **字段**：
  - `image`：原图文件（PNG/JPEG/WebP，与现网兼容即可）。
  - `prompt`：`application/json` 字符串或独立 part，结构如下。

`**prompt` JSON 结构（v1）**

```json
{
  "coordSpace": "pixel",
  "width": 1920,
  "height": 1080,
  "points": [{ "x": 120, "y": 340, "label": 1 }],
  "box": { "x1": 10, "y1": 20, "x2": 500, "y2": 400 },
  "multimaskOutput": false
}
```

- `points[].label`：**SAM 语义**，前景点为 `1`，背景点为 `0`（与官方 demo 一致）。
- `box`：可选，像素坐标；与 `points` 可同时存在（由模型侧决定优先级，**须在服务端文档写死**）。
- `multimaskOutput`：为 `true` 时返回多 mask（见响应）；默认单 mask 降低 UI 复杂度。

**成功响应**

- **统一（SamLocal ≥ 0.2.1）**：`200`，`Content-Type: application/json`，body 为 `{ "masks": [ { "score": number, "pngBase64": string }, ... ] }`；每项 `pngBase64` 为 **整张图尺寸** 的 RGBA PNG（**alpha 为 mask**），伴侣 Adapter 解码后写入 `outputKey` / `_mN`。**不再**返回单 body `image/png`，避免与多 mask 路由分叉。

**错误响应**

- `400`：参数非法（缺图、坐标越界、JSON 无法解析）。
- `413`：超过最大边长/像素数（后端须配置 `SAM_MAX_LONG_SIDE` 等）。
- `500`：推理内部错误。
- `503`：模型未加载或 GPU 不可用（若强制 GPU）。

### 3.3 资源与并发

- **单实例串行队列**：产品化第一阶段 **同一进程内排队**（避免 OOM）；返回 `429` 或阻塞直至就绪 — 二选一，**须在 Adapter 侧统一处理用户可见文案**。
- **内存**：ViT-H 显著高于 ViT-B；默认交付配置以 **ViT-B** 为官方推荐。

### 3.4 分发形态

- 与 **WebSeamRepair** 类似：可单独目录 `SamLocal/`（Python + `requirements.txt` + `README.md`），由安装包或文档约定 **一条启动命令**。
- 长期由 **桌面壳 / 安装器** 在启动伴侣前拉起 SAM 子进程（与 `relaySupervisor` 模式类似），本文只要求 **环境变量契约** 稳定。

---

## 4. local-companion 变更规格

### 4.1 计算任务

- `**REGISTERED_COMPUTE_TYPES`** 新增条目（示例键名，实现时可微调但须全仓一致）：
  - `**sam_segment`**：`adapterId` 如 `**sam_segment@v1`**，描述：从 Volume 读图与提示，调用本机 SAM HTTP，写回 mask 资产。

### 4.2 `submitJob` 分支

- 在 `local-companion/src/compute/jobsStore.ts` 中增加与 `seam_repair` 平级的 `else if (type === 'sam_segment')`：
  - 解析 `inputs` / `params`（见 §6）。
  - 调用 `runSamSegmentJob(...)`。
  - 成功：`reply.completed` 带 `outputKey`、`bytesOut`（与 seam 一致字段习惯）。
  - 失败：`task.failed` 带 `code`、`message`。

### 4.3 Adapter 模块（新建）

- 路径建议：`local-companion/src/compute/samSegmentAdapter.ts`。
- **环境变量**：
  - `COMPANION_SAM_SEGMENT_URL`：默认 `**http://127.0.0.1:18081/v1/segment/predict`**（须与 §3.2、OpenAPI 一致；禁止代码里再拼路径碎片）。
  - `COMPANION_SAM_SEGMENT_TIMEOUT_MS`：默认 `120000`，范围校验同 `seamRepairAdapter`。
- **逻辑**：
  1. `readAssetObjectBytes(projectId, imageKey)`。
  2. 组装 `multipart/form-data`：`image` + `prompt` JSON（来自 `params.prompt` 或结构化 `inputs`）。
  3. `fetch` SAM 后端。
  4. 若配置了 `outputKey`，`putAsset(projectId, outputKey, buf, 'image/png')`。
  5. 若无 `outputKey`（仅调试），返回字节数但不写盘 — **产品环境禁止依赖此路径**，网站侧必须传 `outputKey`。

### 4.4 插件清单

- `pluginRegistry.ts`：`plugin.compute.local` 的 `detail` 文案中 **adapters 列表**应包含新 `adapterId`（随 `listAdapterIds()` 自动体现即可）。
- 可选：在 `buildCapabilitiesPayload` / 静态管理页增加 **「SAM 后端地址探测」**（仅 GET 健康检查，不跑推理）— 非阻塞，但提升可运维性。

### 4.5 健康检查（建议）

- SAM 后端提供 `**GET /health`** → `{ "ok": true, "model": "vit_b" }`。
- 伴侣管理页或调试 API 可增加 **代理探测**（注意 SSRF：仅允许 `127.0.0.1` 与配置端口，禁止任意 URL）。

---

## 5. 浏览器端变更规格

### 5.1 `services/companionClient/compute.ts`

- 定义 `**CompanionSamSegmentInputsV1`**（与伴侣解析一致），至少包含：
  - `imageKey: string`
  - `outputKey: string`
  - 可选 `prompt` 内联对象；若过大可只传 `params.prompt`。
- 导出 `**submitCompanionSamSegmentJob(baseUrl, projectId, inputs, params?)`**，内部 `submitCompanionJob({ protocolVersion: 1, type: 'sam_segment', ... })`。

### 5.2 设置 / 本地伴侣 UI

- 在现有 **本地伴侣** 设置区块中补充：
  - **SAM 后端**说明：默认 URL、超时、未启动时的错误链（伴侣 → SAM）。
  - **任务进度**：复用现有 Job / SSE UI；新 `type` 显示友好名称「本机分割」。

### 5.3 业务 UI 接入点（须与交互稿一致，以下为技术落点）

- **大图预览 / 标注层**：在 `ImagePreviewOverlay` / `ImageFlatAnnotationOverlay` 工具流中增加 **「智能选区」**：将当前点击坐标（换算为 **原图像素**，复用 `services/imagePreviewPointerGeometry.ts`）打包为 `prompt.points`。
- **工作流**：新步骤或能力与 `**companionProjectId`** 联动：执行前确保 `**PUT` 图像到伴侣 Volume**（与修缝、manifest 流程一致）；执行后 `**GET` mask** 或依赖 manifest 合并 — **禁止**在业务层写死 `localhost`，使用 `getCompanionLocalBaseUrl()`。

### 5.4 错误提示（产品文案约束）

- 用户可见句须经 **错误码映射**（附录 A），**禁止**把原始 `stderr` / 堆栈直接弹出（可进「复制诊断信息」）。
- 伴侣不可达、SAM 不可达、模型缺失、超时等：**空态 / Toast / 内联** 三类呈现由交互稿定；本文要求 **同一错误码全站文案一致**。

### 5.5 用户体验状态（产品化）


| 状态      | 用户感知            | 前端 / 伴侣行为要求                                                                                   |
| ------- | --------------- | --------------------------------------------------------------------------------------------- |
| **未就绪** | 本地伴侣未连接或未配对     | 入口 **置灰或引导**至设置；不发起 `sam_segment`                                                             |
| **就绪**  | 伴侣在线，SAM 未探测    | 可点「分割」；首次请求失败时 **降级提示**启动 SAM（附录 A `COMPUTE_SAM_BACKEND`）                                     |
| **上传中** | 大图写入 Volume     | 进度条或骨架；**可取消**须 Abort PUT（若现有 API 支持）                                                         |
| **推理中** | 等待 mask         | `emitCapabilityRunProgress` + Job SSE；**禁止**重复提交同一 `(projectId, imageKey, prompt)` 除非显式「再次运行」 |
| **成功**  | 显示 mask / 叠加层   | 结果 asset **与 `outputKey` 一致**；失败时需可「重试」                                                       |
| **失败**  | 可读原因 + 可选「复制诊断」 | `code` + 本地化文案；日志见 §8                                                                         |


### 5.6 隐私与数据驻留（产品声明）

- **默认**：原图与 mask **仅在本机 Volume 与 SAM 进程内存**中处理，不经由产品云端 API（除非用户另行使用其他云能力）。
- **帮助文档**中须有一句 **数据驻留说明**，与用户预期对齐。

---

## 6. Job 契约（权威）

### 6.1 `POST /v1/compute/jobs` body

```json
{
  "protocolVersion": 1,
  "type": "sam_segment",
  "projectId": "<必填，与 Volume 一致>",
  "inputs": {
    "imageKey": "wf-orig-xxx/...",
    "outputKey": "wf-res-xxx/...mask.png"
  },
  "params": {
    "prompt": {
      "coordSpace": "pixel",
      "width": 1920,
      "height": 1080,
      "points": [{ "x": 100, "y": 200, "label": 1 }],
      "box": null,
      "multimaskOutput": false
    }
  }
}
```

- `**width` / `height**`：须与原图自然尺寸一致；伴侣 **可**在 Adapter 内用图像头校验，不一致则 `COMPUTE_SAM_PROMPT_MISMATCH`。
- **输出 MIME**：`image/png`，写入 `outputKey`。

### 6.2 事件流

- 与现有一致：`task.accepted` → `task.running` → `reply.delta`（可选进度）→ `reply.completed` | `task.failed`。
- SSE：`GET /v1/compute/jobs/:id/stream`（见 `createCompanionJobEventStream`）。

### 6.3 错误码登记（Job 层，与附录 A 一致）

- Job 失败时 `task.failed` / `job.error.code` **必须**为附录 A 中的 `**COMPUTE_*` 常量**之一；**禁止**随意新增字符串而不更新本文。

---

## 7. 安全

- **Token**：所有非豁免路径须带 Bearer；与 `COMPANION_SHARED_TOKEN` 对齐。
- **Origin**：`accessGate` 白名单；生产环境禁止 `*` 随意放开。
- **Volume 路径**：仅允许 project 作用域内 key；禁止 `inputs` 传入绝对路径（现有 `assetBlob` 已约束 key 语义则沿用）。
- **SAM URL**：仅 `127.0.0.1` / `::1` / 显式配置，**禁止**由用户 JSON 任意指定外网 URL（防 SSRF）。

---

## 8. 可观测性与日志

- **伴侣**：Adapter 内对每次任务打 **结构化单行日志**：`jobId`、`projectId`、`imageKey`、`outputKey`、耗时、`httpStatus`（勿打 base64）。
- **SAM 后端**：请求 id、推理耗时、设备（CPU/CUDA）、输入尺寸。
- **网站**：`onLog` / 能力执行进度与现有 `emitCapabilityRunProgress` 一致。

### 8.1 非功能性需求（NFR，验收必测）


| 项             | 目标                | 说明                                                                                        |
| ------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| **默认模型**      | ViT-B             | 官方推荐配置；文档与安装器默认一致                                                                         |
| **单请求延迟（参考）** | 1080p、单点提示，GPU 可用 | P95 **< 15s**（具体以硬件为准，须在帮助中声明变量）                                                          |
| **最大输入**      | 长边上限              | SAM 后端 `**SAM_MAX_LONG_SIDE`** 与伴侣侧前置校验 **一致**；超限 **413** / `COMPUTE_SAM_INPUT_TOO_LARGE` |
| **并发**        | 单 SAM 进程          | **串行队列**（§3.3）；伴侣不得默认并行轰炸 SAM                                                             |
| **可用性**       | 错误可诊断             | 每次失败有 **code**；可选「复制诊断」含 jobId、adapterId、sam_backend_version                              |


---

## 9. 测试与验收

### 9.1 自动化

- **伴侣单元测试**：`resolveSamSegmentKeys` 类纯函数（inputs 校验）；Adapter 用 **mock `fetch`** 或 nock 等价物返回固定 PNG，断言 `putAsset` 被调用。
- **契约测试**：一份 **黄金 JSON**（inputs+params）与 **最小 1×1 PNG** 响应，保证 `jobsStore` 分支不回归。

### 9.2 人工验收清单

1. 伴侣 + SAM 后端均启动，浏览器已配对 / 配置 Base URL。
2. 任意项目：`PUT` 测试图 → 提交 `sam_segment` job → `GET` `outputKey` 得到 PNG。
3. 关 SAM 后端：明确失败码与文案。
4. 错误 `width/height`：失败可预期。
5. 大图（如 4K）：在约定超时内完成或给出超时错误（无静默挂死）。

---

## 10. 文档与交付物清单


| 交付物                                                      | 说明                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `SamLocal/openapi.yaml`（或 `spec/sam-local.openapi.yaml`） | SAM HTTP **OpenAPI 3.x**；路径、schema、响应码与本文 §3 一致，CI 可 `spectral lint` |
| `SamLocal/` 或等价目录                                        | SAM HTTP 服务源码、`requirements.txt`、启动说明、模型获取合规声明                       |
| `local-companion/src/compute/samSegmentAdapter.ts`       | 伴侣 Adapter                                                           |
| `local-companion/src/compute/jobsStore.ts`               | 注册 `sam_segment` 与分支                                                 |
| `services/companionClient/compute.ts`                    | 浏览器提交封装                                                              |
| UI 变更                                                    | 设置页 + 大图/工作流入口（按产品设计）                                                |
| `docs/` 用户帮助                                             | 「本机分割」故障排除：端口、模型路径、防火墙                                               |
| 单测                                                       | §9.1                                                                 |


---

## 11. 版本与兼容

- **协议**：`protocolVersion: 1`；未来扩展 `prompt` 字段须 **向后兼容**（仅增字段）。
- `**type` 字符串**：`sam_segment` 写入持久化任务记录时勿改名；若改名须迁移层。

---

## 12. 参考代码路径（仓库现状）

- 伴侣入口：`local-companion/src/main.ts`（端口、控制台提示；可选 `**samLocalSupervisor`** 拉起 SamLocal）
- SamLocal 推理：`SamLocal/app/main.py`、`SamLocal/app/sam_inference.py`
- SamLocal 宿主包骨架：`SamLocal/host-plugin-bundle/`、`npm run pack:sam-local-bundle`
- 任务注册与派发：`local-companion/src/compute/jobsStore.ts`
- 修缝 Adapter 范本：`local-companion/src/compute/seamRepairAdapter.ts`
- 网站请求封装：`services/companionClient/compute.ts`、`services/companionClient/fetch.ts`
- Base URL / Token：`services/companionLocalPrefs.ts`
- 能力走伴侣宿主包示例：`services/capabilityExecutor.ts` → `executeCompanionHostBundleCapability`（**新能力应优先走专用 `sam_segment` type**，而非泛型 `host_bundle`，除非刻意走打包分发模型）

---

## 13. 仓库实现进度（快照，随迭代更新）


| 能力                                                                             | 状态                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 规格 v1.1、OpenAPI `SamLocal/openapi.yaml`                                        | 已有                                                                                                                                                                                 |
| `SamLocal` FastAPI（`SAM_MODE=stub` / `sam` + ViT-B）                            | stub 与 `**SAM_MODE=sam`** 推理已有（`requirements-sam.txt` 钉死 `**segment_anything`** commit + 权重；`SamLocal/app/sam_inference.py`）                                                       |
| `local-companion` `sam_segment` + `samSegmentAdapter`                          | 已有                                                                                                                                                                                 |
| `GET /v1/debug/sam-segment-health`（伴侣代探测 SamLocal `/health`，仅回环 URL）           | 已有                                                                                                                                                                                 |
| 网站 `submitCompanionSamSegmentJob`、`lightboxSamSegment.ts`、大图点选 UI              | 已有                                                                                                                                                                                 |
| 设置页：SamLocal 说明 +「探测 SamLocal（经伴侣）」+ **「复制环境变量示例」** + 能力清单 `samSegment` 片段     | 已有                                                                                                                                                                                 |
| 运行日志：`services/companionSamSegmentMessages.ts` 附录 A 文案映射                       | 已有                                                                                                                                                                                 |
| 用户排障：`docs/本机分割故障排除.md`                                                        | 已有                                                                                                                                                                                 |
| 安装器 / 伴侣随启拉起 SamLocal                                                          | `**COMPANION_SPAWN_SAM_LOCAL_CMD`**（见 `local-companion/src/samLocalSupervisor.ts`）；开发一键栈 `**npm run dev:companion-sam-stack`**（`scripts/dev-companion-sam-stack.mjs`）；桌面安装器可写死等价命令 |
| `**host_plugin_bundle` 骨架（SamLocal ZIP + `probe`）**                            | 已有（`**SamLocal/host-plugin-bundle/`**、`**npm run pack:sam-local-bundle`**）；打包后 **tar -tf 结构校验**；**exec 不用于常驻 HTTP**                                                                |
| 桌面壳 SamLocal 准备入口                                                              | 已有（托盘 **本机分割（SamLocal）准备…**、`shell/index.html` 设置页复制命令与环境变量）                                                                                                                       |
| 桌面壳 **扩展目录**（catalog + 一键 `install-from-url`）                                  | 已有（首页 **扩展（宿主插件包）**；catalog 项含 `**publicInstallUrl`** 时需 `**COMPANION_DIST_PUBLIC_HTTP_BASE`**；`**universal`/`all`** 平台一条多端可见）                                                     |
| 网站「安装最新宿主插件包」                                                                  | 已有；`**publicInstallUrl**` 存在时**直链**安装，否则预签名（`**hostPluginBundleClient`**）                                                                                                          |
| 工作流预设 `**companion_sam_segment`（本机智能分割）**：队列执行、`executeCapability` 中心点提示       | 已有                                                                                                                                                                                 |
| CI：`spectral lint` OpenAPI（`SamLocal/openapi.yaml`）                            | 已有（`info` / `tags` / `operationId` / 响应 schema 与实现 0.2.0 对齐）                                                                                                                       |
| 本机首次准备脚本 `**npm run setup:sam-local`**（pip + `**npm run download:sam-vit-b`**） | 已有（`scripts/setup-sam-local.mjs`、`scripts/download-sam-vit-b-checkpoint.mjs`）；说明见 `**docs/本机分割一键安装指南.md**`                                                                         |


---

## 附录 A · 错误码全表（规范化）


| `code`（Job / UI 映射）           | 触发条件                                   | HTTP / 上游 | 默认用户文案（zh-CN）                 | 可重试 |
| ----------------------------- | -------------------------------------- | --------- | ----------------------------- | --- |
| `COMPUTE_BAD_JOB`             | `projectId` / `inputs` 缺失或非法           | —         | 「任务参数不完整，请重试或联系支持」            | 视修复 |
| `COMPUTE_SAM_PROMPT_MISMATCH` | prompt 宽高与原图不一致                        | —         | 「选区与当前图片尺寸不匹配，请关闭大图后重试」       | 是   |
| `COMPUTE_SAM_INPUT_TOO_LARGE` | 超过最大边长/像素                              | 413       | 「图片过大，请缩小后再试」                 | 是   |
| `COMPUTE_SAM_BACKEND`         | `fetch` 失败、非 2xx、非 PNG                 | 视上游       | 「本机分割服务未启动或异常，请检查是否已启动分割助手」   | 是   |
| `COMPUTE_SAM_MODEL_MISSING`   | 503 / 模型未加载                            | 503       | 「本机分割模型未就绪，请按说明完成首次准备」        | 是   |
| `COMPUTE_SAM_TIMEOUT`         | 超时 Abort                               | —         | 「分割耗时过长已中断，请减小图片或稍后重试」        | 是   |
| `COMPUTE_SAM_OUTPUT`          | 空 body、无法解码 PNG                        | —         | 「分割结果无效，请重试」                  | 是   |
| `SAM_PROBE_NOT_LOOPBACK`      | 调试接口：`COMPANION_SAM_SEGMENT_URL` 非回环主机 | —         | （设置页 / 日志）「SamLocal 地址须为本机回环」 | 视配置 |
| `COMPANION_FETCH`（前端）         | 拉取 mask 资产失败                           | —         | 「无法从伴侣读取分割结果」                 | 是   |


- 新增错误码须 **先补本表** 再写代码；**i18n** 键建议 `companion.sam_segment.error.<snake_code>`。

---

## 附录 B · 产品验收口径（与 §9 互补）

- **产品化**：具备 §5.5 全状态可演示；错误均走附录 A；帮助页含数据驻留说明（§5.6）。
- **规范化**：OpenAPI 与实现一致；`sam_segment` / `SamSegmentPromptV1` 命名全仓一致。
- **模块化**：依赖方向符合 §2.3；换 SAM 实现仅改 URL 与 OpenAPI 对应实现，不改 React 业务分支。

### B.1 人工抽检清单（非视频 / 非 SAM2）


| #   | 场景                              | 期望                                                                                                |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | **stub 模式**（默认 `SAM_MODE=stub`） | 伴侣 + SamLocal 起服后，大图点选本机分割可返回 mask；设置页「探测 SamLocal」成功                                             |
| 2   | **sam 模式首次准备**                  | 仓库根 `npm run setup:sam-local` 可完成 pip + 权重；`SAM_MODE=sam` 后 `/health` 无 `sam_missing_checkpoint`  |
| 3   | **大图 / 上限**                     | 超 `SAM_MAX_LONG_SIDE` 或像素策略时返回 **413** / 附录 A `COMPUTE_SAM_INPUT_TOO_LARGE`，前端文案可读                |
| 4   | **SamLocal 未启动**                | 前端映射 `**COMPUTE_SAM_BACKEND`**；运行日志可定位                                                            |
| 5   | **503 / 模型未就绪**                 | 映射 `**COMPUTE_SAM_MODEL_MISSING`**；与缺权重、缺依赖区分靠 `/health` 与文档                                      |
| 6   | **超时**                          | 触发 `**COMPUTE_SAM_TIMEOUT`**（Abort）；可重试                                                           |
| 7   | **关服 / 进程退出**                   | 不产生未捕获异常；用户可重试；伴侣 `**runtime-status.samLocal`** 与托盘提醒与现状一致                                        |
| 8   | **回环探测**                        | `COMPANION_SAM_SEGMENT_URL` 非 127.0.0.1 / localhost 时 `**SAM_PROBE_NOT_LOOPBACK`**                |
| 9   | **host_plugin_bundle ZIP**      | `npm run pack:sam-local-bundle` 成功且脚本校验 ZIP 内含 `extracted/run.json`、`app/main.py` 等；**probe** 可通过 |
| 10  | **桌面壳引导**                       | 托盘「本机分割（SamLocal）准备…」打开窗口并滚动至设置内 SamLocal 区块；复制按钮可用                                               |


---

**文档维护**：实现与本文冲突时，**以本文更新为准**或同步修订本文后再改代码。