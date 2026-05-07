# 本地伴侣 · SAM 分割 — 产品开发规格

本文面向实现与评审：**规格级、可落地**，与「一期二期」排期无关；交付物按本文即可闭环为可发布的产品能力。

---

## 1. 目标与边界

### 1.1 产品目标

- 用户在 **网站** 内对图像做点选 / 框选等提示，由 **本机算力** 生成 **高质量分割 mask**（及可选抠图结果）。
- **用户不接触** Python、pip、模型下载命令；运维形态与现有 **本地伴侣（local-companion）** 一致：网站通过 **本机 HTTP** 与伴侣通信，伴侣负责 **Volume 资产读写** 与 **计算任务编排**。
- 行为与现有 **`seam_repair`** 任务一致：**输入资产须已 PUT 到当前 `projectId` 下**，输出写回 **指定 asset key** 或返回可消费的二进制说明（见 §6）。

### 1.2 非目标（本文不规定）

- 云端托管 SAM、多租户推理集群。
- 视频时序分割（若未来采用 SAM 2，另文扩展 **`type` 与 inputs**）。
- 替换现有 **`cut_image`** 内置栅格切割语义；分割能力与切割能力可并存，由产品命名与入口区分。

### 1.3 关键依赖假设

- **Segment Anything**（或 API 兼容的替代实现）以 **独立本机 HTTP 服务** 形式存在，由伴侣 **转发请求**；伴侣进程本身仍为 **Node（tsx）**，不强制内置 PyTorch。
- 浏览器侧遵守项目既有约定：**不写死 `localhost` 以外的固定 IP**；伴侣默认 **`http://127.0.0.1:18765`**（可配置），见 `services/companionLocalPrefs.ts`。

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

| 现有能力 | 对齐方式 |
|---------|---------|
| **`seam_repair`** | 同一模式：`jobsStore` 注册 `type` → `xxxAdapter` 从 Volume 读字节 → `fetch` 本机后端 → `putAsset` 写回。参考 `local-companion/src/compute/seamRepairAdapter.ts`。 |
| **网站 `companionClient`** | 新增 `submitCompanionSamSegmentJob`（命名可定为产品名），与 `submitCompanionSeamRepairJob` 并列，见 `services/companionClient/compute.ts`。 |
| **安全** | 复用 `accessGate`：`Authorization: Bearer` 与 `COMPANION_SHARED_TOKEN`；Origin 白名单行为不变。 |

---

## 3. SAM 本机后端规格（须单独实现与分发）

### 3.1 进程与配置

- **监听地址**：默认 `127.0.0.1`，端口 **环境变量** `SAM_HTTP_PORT`（建议默认 **`18081`**，与 `8008` 修缝、`18765` 伴侣错开）。
- **超时**：大图为 **60～180s** 可配置；伴侣侧 `fetch` **AbortController** 超时须 **≥** 后端最坏情况。
- **模型**：默认 **SAM ViT-B** 检查点（体积与速度平衡）；路径 `SAM_CHECKPOINT_PATH` 或应用数据目录下固定相对路径。启动时若缺失：**HTTP 503** + 明确 JSON `error`（供伴侣映射为 `COMPUTE_SAM_MODEL_MISSING`）。

### 3.2 HTTP API（建议）

**`POST /segment/predict`**（名称可调整，但须在伴侣 Adapter 内 **单一常量** 配置）

- **Content-Type**: `multipart/form-data`
- **字段**：
  - `image`：原图文件（PNG/JPEG/WebP，与现网兼容即可）。
  - `prompt`：`application/json` 字符串或独立 part，结构如下。

**`prompt` JSON 结构（v1）**

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

- **默认**：`200`，`Content-Type: image/png`，body 为 **单通道或 RGBA mask**（产品约定：**RGBA 时 alpha 为 mask**，便于浏览器叠加；须在本文与后端 README 固定一种，禁止混用无文档格式）。
- **可选**：`200`，`Content-Type: application/json`，字段 `masks: [{ "format": "png_base64", "data": "..." }]` — 若采用 JSON，伴侣 Adapter 负责解码为 `Buffer` 再 `putAsset`。

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

- **`REGISTERED_COMPUTE_TYPES`** 新增条目（示例键名，实现时可微调但须全仓一致）：
  - **`sam_segment`**：`adapterId` 如 **`sam_segment@v1`**，描述：从 Volume 读图与提示，调用本机 SAM HTTP，写回 mask 资产。

### 4.2 `submitJob` 分支

- 在 `local-companion/src/compute/jobsStore.ts` 中增加与 `seam_repair` 平级的 `else if (type === 'sam_segment')`：
  - 解析 `inputs` / `params`（见 §6）。
  - 调用 `runSamSegmentJob(...)`。
  - 成功：`reply.completed` 带 `outputKey`、`bytesOut`（与 seam 一致字段习惯）。
  - 失败：`task.failed` 带 `code`、`message`。

### 4.3 Adapter 模块（新建）

- 路径建议：`local-companion/src/compute/samSegmentAdapter.ts`。
- **环境变量**：
  - `COMPANION_SAM_SEGMENT_URL`：默认 `http://127.0.0.1:18081`（或 `/segment/predict` 全路径，二选一固定）。
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

- SAM 后端提供 **`GET /health`** → `{ "ok": true, "model": "vit_b" }`。
- 伴侣管理页或调试 API 可增加 **代理探测**（注意 SSRF：仅允许 `127.0.0.1` 与配置端口，禁止任意 URL）。

---

## 5. 浏览器端变更规格

### 5.1 `services/companionClient/compute.ts`

- 定义 **`CompanionSamSegmentInputsV1`**（与伴侣解析一致），至少包含：
  - `imageKey: string`
  - `outputKey: string`
  - 可选 `prompt` 内联对象；若过大可只传 `params.prompt`。
- 导出 **`submitCompanionSamSegmentJob(baseUrl, projectId, inputs, params?)`**，内部 `submitCompanionJob({ protocolVersion: 1, type: 'sam_segment', ... })`。

### 5.2 设置 / 本地伴侣 UI

- 在现有 **本地伴侣** 设置区块中补充：
  - **SAM 后端**说明：默认 URL、超时、未启动时的错误链（伴侣 → SAM）。
  - **任务进度**：复用现有 Job / SSE UI；新 `type` 显示友好名称「本机分割」。

### 5.3 业务 UI 接入点（须与交互稿一致，以下为技术落点）

- **大图预览 / 标注层**：在 `ImagePreviewOverlay` / `ImageFlatAnnotationOverlay` 工具流中增加 **「智能选区」**：将当前点击坐标（换算为 **原图像素**，复用 `services/imagePreviewPointerGeometry.ts`）打包为 `prompt.points`。
- **工作流**：新步骤或能力与 **`companionProjectId`** 联动：执行前确保 **`PUT` 图像到伴侣 Volume**（与修缝、manifest 流程一致）；执行后 **`GET` mask** 或依赖 manifest 合并 — **禁止**在业务层写死 `localhost`，使用 `getCompanionLocalBaseUrl()`。

### 5.4 错误提示（产品文案约束）

- 伴侣不可达：沿用现有「请启动本地伴侣」类提示。
- SAM 不可达：`COMPUTE_SAM_BACKEND` — 「本机分割服务未启动或端口错误」。
- 模型缺失：`COMPUTE_SAM_MODEL_MISSING` — 「首次使用请完成本机模型准备（见帮助）」。
- 超时：`COMPUTE_SAM_TIMEOUT`。

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

- **`width` / `height`**：须与原图自然尺寸一致；伴侣 **可**在 Adapter 内用图像头校验，不一致则 `COMPUTE_SAM_PROMPT_MISMATCH`。
- **输出 MIME**：`image/png`，写入 `outputKey`。

### 6.2 事件流

- 与现有一致：`task.accepted` → `task.running` → `reply.delta`（可选进度）→ `reply.completed` | `task.failed`。
- SSE：`GET /v1/compute/jobs/:id/stream`（见 `createCompanionJobEventStream`）。

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

| 交付物 | 说明 |
|--------|------|
| `SamLocal/` 或等价目录 | SAM HTTP 服务源码、`requirements.txt`、启动说明、模型获取合规声明 |
| `local-companion/src/compute/samSegmentAdapter.ts` | 伴侣 Adapter |
| `local-companion/src/compute/jobsStore.ts` | 注册 `sam_segment` 与分支 |
| `services/companionClient/compute.ts` | 浏览器提交封装 |
| UI 变更 | 设置页 + 大图/工作流入口（按产品设计） |
| `docs/` 用户帮助 | 「本机分割」故障排除：端口、模型路径、防火墙 |
| 单测 | §9.1 |

---

## 11. 版本与兼容

- **协议**：`protocolVersion: 1`；未来扩展 `prompt` 字段须 **向后兼容**（仅增字段）。
- **`type` 字符串**：`sam_segment` 写入持久化任务记录时勿改名；若改名须迁移层。

---

## 12. 参考代码路径（仓库现状）

- 伴侣入口：`local-companion/src/main.ts`（端口、控制台提示）
- 任务注册与派发：`local-companion/src/compute/jobsStore.ts`
- 修缝 Adapter 范本：`local-companion/src/compute/seamRepairAdapter.ts`
- 网站请求封装：`services/companionClient/compute.ts`、`services/companionClient/fetch.ts`
- Base URL / Token：`services/companionLocalPrefs.ts`
- 能力走伴侣宿主包示例：`services/capabilityExecutor.ts` → `executeCompanionHostBundleCapability`（**新能力应优先走专用 `sam_segment` type**，而非泛型 `host_bundle`，除非刻意走打包分发模型）

---

**文档维护**：实现与本文冲突时，**以本文更新为准**或同步修订本文后再改代码。
