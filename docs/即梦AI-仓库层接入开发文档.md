# 即梦 AI · 仓库层接入开发文档

**版本**：v0.2  
**状态**：规格冻结（评审修订版，可开工 W0）  
**读者**：产品、架构、后端、前端（二期）  
**关联**：[`docs/架构宪章-店仓菜单.md`](./架构宪章-店仓菜单.md)、[`docs/adr/模型中心与供应商绑定.md`](./adr/模型中心与供应商绑定.md)、[`docs/多模型可运营改造计划.md`](./多模型可运营改造计划.md)、[`docs/adr/统一积分制-手动发放-v1.md`](./adr/统一积分制-手动发放-v1.md)

**v0.2 相对 v0.1 变更摘要**：冻结 binding 选型（图 mirror imageModels；视频/数字人独立 registry）；SKU 表增加 `verified` 门禁；补积分 L1 门禁、feature-flag 双层、轮询策略、Tripo 对照、M1 完整 checklist；收窄 W0 验收至 **verified SKU + 基础设施**。

---

## 0. 执行摘要（给决策者）

| 项 | 结论 |
|----|------|
| **W0 目标** | 登记 **§3 全表 SKU**（含 unverified 占位）；完成 **服务端代理 + 类型 + 注册表 + 计费占位 + 积分 L1 门禁**；**仅对 `verified: true` 的 SKU 承诺冒烟**；不上菜单、不改工作流 UI。 |
| **W0 非目标** | 设置页选模型、工作流预设、能力商店、运营 JSON 默认上架；§3.4 小云雀/Seedance **实现**；OmniHuman 端到端（可 skip 冒烟）。 |
| **产品边界** | 即梦官方三大类：**图片、视频、数字人**；**不含** Tripo/腾讯混元式 **mesh 3D**（`generate3d` 分区不动）。 |
| **「生模型」** | 即梦语境 = **数字人 / 角色视频**（OmniHuman），不是 glb/fbx。 |
| **技术红线** | AK/SK **仅服务端**；浏览器不经 HMAC 直连 `visual.volcengineapi.com`。 |
| **架构拍板（已冻结）** | 见 **§0.1**；M1 前不得另起 binding 方案。 |
| **二期触发** | W0 验收（§1.4）通过后，产品开「菜单」工单（§12）。 |

### 0.1 架构拍板（v0.2 冻结，2026-07-06）

| ID | 决策 | 结论 |
|----|------|------|
| D1 | 视频/数字人是否进 `modelRegistry` binding | **否**。图类 mirror `imageModels` + `role=image`；视频/数字人走 **独立 registry** + `pickJimengBinding(modality)`（对齐 Tripo / `generate3d` 独立分区）。**不**扩展 `ModelResolveRole` 为 `video \| digital_human`（避免 ADR 与 `pickBinding` 全链改造）。 |
| D2 | W0 凭证 | **仅站点 env**（`VOLCENGINE_*`）；`connectionCatalog` 增 hidden 行 `credentialKind: "site"`，**defaultEnabled=false**；M1 再议用户自备 Key。 |
| D3 | 数字人 capability（M1） | 新增 **`generate_digital_human`**（不复用 `generate_video` 语义）。 |
| D4 | 积分 | **L1 提交前最低余额预检**（`assertUnifiedProxyCreditsGate`）+ **L2 成功后实扣**（`emitMeteredUsage`）；长任务 **v1 不做 reserve**，后续可接 `credit_reserves`。 |
| D5 | W0 图类 SKU 可见性 | 全部 `warehouseOnly: true`，**不进**运营 allowlist / 工作流型号列表。 |
| D6 | 与现有生视频 | M1 默认 **jimeng 专用网关函数**；`VITE_WORKFLOW_VIDEO_API_URL` 桥 **保留**；M2 可选将桥 URL 指向 `/api/jimeng/*` 统一入口。 |
| D7 | W0 冒烟范围 | **每个 modality 至少 1 条 verified SKU**（图 + 视频）；数字人 **0/1**（未开通则 skip）；**不要求** 20 条全跑通。 |
| D8 | req_key 真源 | **研发 Owner** 在火山控制台/API Explorer 逐项核对后改 `verified: true`；PR 不得将 unverified 标为 true。 |

---

## 1. 产品定位与分期

### 1.1 为什么要「先仓库、后菜单」

参照店—仓—菜单宪章：

- **供货商**（火山即梦）契约异构：异步 Submit/GetResult、多步数字人、按 `req_key` 区分能力，与 Gemini/OpenAI 不兼容。
- **若先做 UI**，会在 `WorkflowSection`、设置页、能力预设里散落 `if (jimeng)`，后续换档或下架成本高。
- **先做仓库**：统一 `registryId`、适配器、价目 SKU、服务端代理；前端二期只消费稳定契约。

### 1.2 分期定义

```text
Phase W0（本文范围）仓库层
  ├─ SKU 全量登记（catalog，含 verified 标记）
  ├─ 图类 mirror → imageModels 扩展表（warehouseOnly）
  ├─ jimengVideoRegistry / jimengDigitalHumanRegistry（独立，不经 pickBinding）
  ├─ 输出口 volcengine-jimeng（hidden，credentialKind: site）
  ├─ server 签名代理 + /api/jimeng/* + auth-api 挂载
  ├─ jimengAdapter + pickJimengBinding(modality)
  ├─ unifiedAiGateway（traceUnifiedAiCall + 新 JobKind）
  ├─ credits L1 门禁 + billingSku 占位 + L2 实扣
  ├─ ESLint 禁业务直连
  └─ 单测 + verified SKU 冒烟

Phase M1 菜单与编排
  ├─ 运营 allowlist 上架 registryId
  ├─ 工作流 / 资产集 / 能力预设 / generate_digital_human
  └─ 设置页展示「火山即梦」输出口（仍建议站点 AK）

Phase M2 体验与运营
  ├─ 进度 / 队列 / 失败文案 / 火山业务码映射
  ├─ 管理后台按 jimeng SKU 拆分
  ├─ 模型 ops JSON 远程上下架
  └─ 可选：VITE 视频桥 → /api/jimeng 统一
```

### 1.3 W0 非目标（显式）

- 设置页模型下拉、工作流侧栏新型号
- §3.4 小云雀 / Seedance **接口实现**（仅 catalog schema 预留）
- OmniHuman **生产级** R2 转存链（W0 可 skip 或 server 最小 staging）
- 用户自备火山 Key（M1 再议）
- `ModelResolveRole` 扩展为 video / digital_human

### 1.4 成功标准（Phase W0 验收）

| # | 验收项 | 怎么验 |
|---|--------|--------|
| W0.1 | `services/jimeng/catalog.ts` 含 §3 全表，且每条有 `modality`、`upstreamReqKey`、`docRef`、`verified` | 单测 `jimeng.catalog.test.ts` |
| W0.2 | **verified SKU** 经 `/api/jimeng/tasks` 完成 Submit → Poll → done（图 ≥1，视频 ≥1） | `npm run test:jimeng-smoke` 或手测 |
| W0.3 | `JIMENG_API_ENABLED=false` 时 POST `/api/jimeng/tasks` → **503**；网关 `isJimengAvailable()` → false | 单测 |
| W0.4 | 平台代付路径：未登录 / 积分不足 → **403** `CREDITS_EXCEEDED` / `LOGIN_REQUIRED`（对齐 gemini-proxy） | `tests/jimeng.credits-gate.test.ts` |
| W0.5 | 经网关的 jimeng 调用包裹 **`traceUnifiedAiCall`**，产生 usage 且带 `registryId` + `billingSku` | 单测或 mock |
| W0.6 | **零**新增用户可见菜单项 | UI review |
| W0.7 | ESLint **`no-restricted-imports`** 禁止业务目录 import `services/jimeng/adapter` | `eslint.config.js` + CI |
| W0.8 | `npm run typecheck` + 新增单测通过 | CI |

---

## 2. 供货商契约（官方）

### 2.1 接入与鉴权

| 项 | 值 |
|----|-----|
| 控制台 | [火山引擎 · 即梦AI](https://www.volcengine.com/product/jimeng) |
| 文档根 | https://www.volcengine.com/docs/85621?lang=zh |
| API Host | `visual.volcengineapi.com` |
| Region | `cn-north-1` |
| Service | `cv` |
| Version | `2022-08-31` |
| 鉴权 | HMAC-SHA256（`Authorization` + `X-Date` + `X-Content-Sha256`） |

**分项开通**：各 `req_key` 需在控制台单独开通；未开通时透传火山 `code` / `message`。

### 2.2 调用形态

```http
POST https://visual.volcengineapi.com/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31
POST https://visual.volcengineapi.com/?Action=CVSync2AsyncGetResult&Version=2022-08-31
```

- 成功：`code === 10000`，`data.task_id`
- 完成：`status === done` → `image_urls` / `binary_data_base64` / `video_url`
- 结果 URL **约 1 小时有效** → M1 拣货层须转存 R2/工作区；W0 可只返回 URL

> 图片 4.0+：**禁止**同步 `CVProcess`；catalog 统一 `asyncMode: "submit_poll"`。

**数字人 OmniHuman**：多步（主体识别 → 检测 → 视频生成）；`orchestration: "omnihuman_v1"`，**不**并入单步 submit_poll。

### 2.3 站内货物映射（v0.2 冻结）

| 官方大类 | 站内分区 | registry 来源 | binding / 选型 |
|----------|----------|---------------|----------------|
| 图片 / 编辑 | **图** | `JIMENG_IMAGE_REGISTRY` mirror 进 `imageModels` 扩展 | `pickBinding(registryId, "image")` → 仅 `volcengine-jimeng` |
| 视频 | **视频** | `jimengVideoRegistry`（**独立**） | `pickJimengBinding("video", registryId)` |
| 数字人 | **数字人** | `jimengDigitalHumanRegistry`（**独立**） | `pickJimengBinding("digital_human", registryId)` |
| mesh 3D | **3D** | `generate3d` 不变 | Tripo / 腾讯 |

```text
图类 jimeng SKU ──→ pickBinding(role=image) ──→ volcengine-jimeng channel
视频/数字人 SKU ──→ pickJimengBinding(modality) ──→ 不经 getClientForTask / geminiService
```

---

## 3. SKU 清单（仓库登记）

### 3.0 字段约定

| 字段 | 说明 |
|------|------|
| `registryId` | 输入口，`jimeng-{modality}-{slug}`，kebab-case |
| `upstreamReqKey` | 火山 body `req_key`（**须官方核对**） |
| `docRef` | 火山文档页 URL（**一 SKU 一 doc**） |
| `verified` | `true` = Owner 已在控制台/API Explorer 调通；**W0 冒烟仅覆盖 true** |
| `warehouseOnly` | W0 恒为 `true` |
| `asyncMode` | `submit_poll` \| `omnihuman_v1` |

### 3.1 图片（Image）

| registryId | upstreamReqKey | verified | docRef |
|------------|------------------|----------|--------|
| `jimeng-image-t2i-v40` | `jimeng_t2i_v40` | **true** | [图片生成4.0](https://www.volcengine.com/docs/85621/1817045?lang=zh) |
| `jimeng-image-t2i-v30` | `jimeng_t2i_v30` | false | [文生图3.0](https://www.volcengine.com/docs/85621/1616429?lang=zh) |
| `jimeng-image-t2i-v31` | `jimeng_t2i_v31` | false | [文生图3.1](https://www.volcengine.com/docs/85621/1616429?lang=zh) |
| `jimeng-image-i2i-v30` | `jimeng_i2i_v30` | false | [图生图3.0](https://www.volcengine.com/docs/85621/1747301?lang=zh) |
| `jimeng-image-t2i-v46` | `jimeng_t2i_v46` | false | [图片生成4.6](https://www.volcengine.com/docs/85621/2275082?lang=zh) |
| `jimeng-image-inpainting` | `jimeng_inpainting` | false | [inpainting](https://www.volcengine.com/docs/85621/2164806?lang=zh) |
| `jimeng-image-outpainting` | `jimeng_outpainting` | false | [outpainting](https://www.volcengine.com/docs/85621/1792702?lang=zh) |
| `jimeng-image-upscale` | `jimeng_upscale` | false | [智能超清](https://www.volcengine.com/docs/85621/2164806?lang=zh) |
| `jimeng-image-pod-extract` | `jimeng_pod_extract` | false | [POD按需定制](https://www.volcengine.com/docs/85621/1792702?lang=zh) |
| `jimeng-image-product-extract` | `jimeng_product_extract` | false | [商品提取](https://www.volcengine.com/docs/85621/1792702?lang=zh) |

> **维护流程（D8）**：Owner 调通后在 PR 中将对应行 `verified` 改为 `true`，并在 PR 描述附 API Explorer 截图或 requestId。`upstreamReqKey` 以官方文档原文为准，禁止仅引用第三方博客。

### 3.2 视频（Video）

| registryId | upstreamReqKey | verified | docRef |
|------------|------------------|----------|--------|
| `jimeng-video-ti2v-v30-pro` | `jimeng_ti2v_v30_pro` | **true** | [视频3.0 Pro](https://www.volcengine.com/docs/85621/1777001?lang=zh) |
| `jimeng-video-t2v-v30-720p` | `jimeng_t2v_v30` | false | [720P 文生](https://www.volcengine.com/docs/85621/1792702?lang=zh) |
| `jimeng-video-i2v-first-v30-720p` | `jimeng_i2v_first_v30` | false | [720P 图生首帧](https://www.volcengine.com/docs/85621/1792702?lang=zh) |
| `jimeng-video-i2v-first-tail-v30-720p` | `jimeng_i2v_first_tail_v30` | false | [720P 首尾帧](https://www.volcengine.com/docs/85621/1792702?lang=zh) |
| `jimeng-video-i2v-recamera-v30-720p` | `jimeng_i2v_recamera_v30` | false | [720P 运镜](https://www.volcengine.com/docs/85621/1792702?lang=zh) |
| `jimeng-video-t2v-v30-1080p` | `jimeng_t2v_v30_1080p` | false | [1080P 文生](https://www.volcengine.com/docs/85621/1792702?lang=zh) |
| `jimeng-video-i2v-first-v30-1080p` | `jimeng_i2v_first_v30_1080p` | false | [1080P 图生首帧](https://www.volcengine.com/docs/85621/1792702?lang=zh) |
| `jimeng-video-i2v-first-tail-v30-1080p` | `jimeng_i2v_first_tail_v30_1080p` | false | [1080P 首尾帧](https://www.volcengine.com/docs/85621/1792702?lang=zh) |
| `jimeng-video-motion-mimic-v20` | `jimeng_motion_mimic_v20` | false | [动作模仿2.0](https://www.volcengine.com/docs/85621/1792702?lang=zh) |
| `jimeng-video-translate-v20` | `jimeng_video_translate_v20` | false | [视频翻译2.0](https://www.volcengine.com/docs/85621/1792702?lang=zh) |

### 3.3 数字人（Digital Human）

| registryId | upstreamReqKey | verified | asyncMode | docRef |
|------------|------------------|----------|-----------|--------|
| `jimeng-dh-omnihuman-v10` | （多步，见 OmniHuman 文档） | false | `omnihuman_v1` | [OmniHuman 1.0](https://www.volcengine.com/docs/85621/1810469?lang=zh) |

### 3.4 小云雀 / Seedance（W0 不实现）

火山文档树含 **小云雀 · 短剧漫剧 Agent**（Seedance 2.0 等）。W0 **仅**在 `catalog.ts` schema 预留：

```ts
visibility?: "warehouseOnly" | "vendor_extended"; // vendor_extended 默认，不计 W0 验收
```

**不计入 W0 验收**；待产品单独立项后再补 SKU 表。

---

## 4. 架构设计（仓库层）

### 4.1 分层与依赖

```text
  Phase M1 菜单     WorkflowSection / 能力预设 / 设置页
                           │（二期）
  Phase M1 拣货     capabilityExecutor / workflowRunTaskBranch
                           │
  受控出口          unifiedAiGateway  ← traceUnifiedAiCall + credits L1
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    workflowGenerate   workflowGenerate   workflowGenerate
    ImageJimeng        VideoJimeng        DigitalHumanJimeng
         │                 │                 │
         └─────────────────┼─────────────────┘
                           │
  Phase W0 仓库     services/jimeng/
                    catalog / adapter / client / pickJimengBinding
                           │
  服务端代理        server/jimeng-visual-api.js  ← auth-api 内联挂载
                    POST/GET /api/jimeng/*
                           │
  供货商            visual.volcengineapi.com
```

**虚线说明**：视频/数字人 **不**经过 `geminiService.getClientForTask()`。

**禁止**：

- `geminiService` / `toapisAdapter` 内嵌即梦
- 浏览器持有 `VOLCENGINE_SECRET_KEY`
- 业务组件 import `services/jimeng/adapter`（网关、server、单测除外）
- 业务组件 import `services/jimeng/client`（**仅** `unifiedAiGateway` + 单测）

### 4.2 与 Tripo 代理对照（auth-api 挂载）

| 项 | Tripo（现状） | 即梦 Jimeng（W0） |
|----|---------------|-------------------|
| 挂载 | `auth-api.js` 内联 handler | **同**：`import` `jimeng-visual-api` router 或内联 |
| 路径前缀 | `/api/tripo/*` | `/api/jimeng/*` |
| 鉴权白名单 | `pathOnly.startsWith('/api/tripo')` | 新增 `startsWith('/api/jimeng')` |
| 用户鉴权 | 登录 Cookie | **同** |
| 上游密钥 | 用户 Tripo Key（请求体） | **站点** `VOLCENGINE_*`（平台代付） |
| 积分 L1 | 用户 Key 旁路 | **必须** credits-gate（见 §4.7） |
| 异步 | 上游 task 轮询 | Submit + GetResult 轮询 |
| 超时 | fetch 默认 | 显式 `maxWaitMs`（§4.6） |

**必改文件**：`server/auth-api.js`（路由注册 + 鉴权白名单）。

### 4.3 输出口与 binding（v0.2 冻结）

#### 图类（mirror imageModels）

- 在 `imageModels.ts` 或 `jimengImageRegistry.ts` 登记，`providerRoute: "volcengine-jimeng"`
- `pickBinding(registryId, "image")` → 唯一 channel `volcengine-jimeng`
- **`ModelFamily`** 增加内部值 `"volcengine-jimeng"`（**不**扩展 `ModelResolveRole`）

#### 视频 / 数字人（独立）

```ts
// services/jimeng/pickJimengBinding.ts
export function pickJimengBinding(
  modality: "video" | "digital_human",
  registryId: string
): { channel: "volcengine-jimeng"; upstreamReqKey: string } | null;
```

#### connectionCatalog

```ts
{
  id: "volcengine-jimeng",
  title: "火山引擎 · 即梦",
  subtitle: "站点统一 AK；W0 不在设置页展示",
  channels: ["volcengine-jimeng"],
  credentialKind: "site",  // 对齐 vertex-site
  hidden: true,            // W0
}
```

W0 凭证 **仅** `VOLCENGINE_ACCESS_KEY` / `VOLCENGINE_SECRET_KEY`；M1 再接入 `channelCredentials` 用户 Key（若产品要求）。

### 4.4 类型契约

#### catalog 条目

```ts
export type JimengCatalogEntry = {
  registryId: string;
  label: string;
  modality: "image" | "video" | "digital_human";
  upstreamReqKey: string;
  docRef: string;
  verified: boolean;
  warehouseOnly: boolean;
  visibility?: "warehouseOnly" | "vendor_extended";
  asyncMode: "submit_poll" | "omnihuman_v1";
  maxReferenceImages?: number;
};
```

#### 提交 / 轮询

```ts
export type JimengSubmitInput = {
  registryId: string;
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  referenceImages?: string[];  // URL 或 data URL；server 转 base64
  extra?: Record<string, unknown>;
};

export type JimengPollResult =
  | { status: "pending" | "running"; progress?: number }
  | { status: "done"; images?: string[]; videoUrl?: string; raw: unknown }
  | { status: "failed"; code: number; message: string };
```

#### 数字人（W0）

```ts
export type JimengOmniHumanInput = {
  registryId: "jimeng-dh-omnihuman-v10";
  portraitImage: string;
  driveAudioUrl?: string;
  driveVideoUrl?: string;
};
```

W0：**不强制** OmniHuman 冒烟。若需 server 最小能力：`POST /api/jimeng/staging-upload` 将 multipart 转为 **短期公网 URL**（可复用 R2 预签名或 Tripo upload 模式评估），**不**在 W0 做完整 R2 落盘链。

### 4.5 服务端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/jimeng/status` | `{ enabled, configured }` — 浏览器 `isJimengAvailable()` |
| POST | `/api/jimeng/tasks` | Submit；body 含 `registryId` + `JimengSubmitInput` |
| GET | `/api/jimeng/tasks/:taskId` | Poll；query `registryId` |
| POST | `/api/jimeng/omnihuman` | W0 可选；或合并 tasks + `asyncMode` |
| POST | `/api/jimeng/staging-upload` | W0 可选；数字人/参考图公网 URL |

**启用开关（双层）**：

| 层 | 变量 | 行为 |
|----|------|------|
| 服务端 | `JIMENG_API_ENABLED=false`（默认） | 无 AK 或 false → **503** `JIMENG_NOT_CONFIGURED` |
| 浏览器 | 读 `GET /api/jimeng/status` 或 `VITE_JIMENG_API_ENABLED` | `isJimengAvailable()` false → 网关抛 `JimengNotConfiguredError` |

`.env.example` 追加：

```bash
VOLCENGINE_ACCESS_KEY=
VOLCENGINE_SECRET_KEY=
JIMENG_API_ENABLED=false
JIMENG_VISUAL_HOST=visual.volcengineapi.com
JIMENG_VISUAL_REGION=cn-north-1
JIMENG_VISUAL_SERVICE=cv
JIMENG_VISUAL_VERSION=2022-08-31
# 浏览器可选；优先以 /api/jimeng/status 为准
# VITE_JIMENG_API_ENABLED=false
```

### 4.6 轮询策略（W0 必实现）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `pollIntervalMs` | 2000 | 首轮间隔 |
| `pollIntervalMaxMs` | 10000 | 指数退避上限 |
| `pollBackoffFactor` | 1.5 | 退避系数 |
| `maxWaitMs` | 图 180000 / 视频 600000 | 超时抛 `JimengPollTimeoutError` |
| `maxConcurrentPollsPerUser` | 3 | auth-api 内存计数，防连接空转 |
| 取消 | `AbortSignal` | client 传入；adapter 中断 poll 循环 |

**风险**：火山账号 QPS / 并发配额 → §11 记录；触顶时返回可重试错误 + `[unified-ai] errorHint: rate_limited`。

### 4.7 unifiedAiGateway 出口

扩展 `UnifiedAiJobKind`：

```ts
| "workflow_jimeng_image"
| "workflow_jimeng_video"
| "workflow_jimeng_digital_human"
```

新增函数（**必须** `traceUnifiedAiCall` 包装）：

```ts
export async function workflowGenerateImageJimeng(input: JimengSubmitInput): Promise<{ images: string[] }>;
export async function workflowGenerateVideoJimeng(input: JimengSubmitInput): Promise<WorkflowVideoJobResult>;
export async function workflowGenerateDigitalHumanJimeng(input: JimengOmniHumanInput): Promise<WorkflowVideoJobResult>;
```

现有 `workflowGenerateVideo`（`VITE_WORKFLOW_VIDEO_API_URL`）**行为不变**。

`isJimengAvailable()`：`GET /api/jimeng/status` && 非 `JimengNotConfiguredError`。

调试：与现有约定一致，`VITE_DEBUG_UNIFIED_AI=1` 时输出 `[unified-ai]` + `{ provider: "volcengine-jimeng", registryId, errorHint? }`。

### 4.8 积分与计费

#### L1 预检（提交前）

对齐 [`services/proxyCreditsGate.ts`](services/proxyCreditsGate.ts) + [`shared/credits.ts`](shared/credits.ts)：

| 步骤 | 行为 |
|------|------|
| 浏览器 | `traceUnifiedAiCall` → `assertUnifiedProxyCreditsGate(jobKind)` |
| 服务端 | `POST /api/jimeng/tasks` → **credits-gate**（登录 + `balance >= proxyGateMinCreditsForJob`） |

扩展 `proxyGateMinCreditsForJob`：

```ts
case "workflow_jimeng_image": return 50;   // 对齐 workflow_text_to_image
case "workflow_jimeng_video": return 100;  // 对齐 workflow_generate_video
case "workflow_jimeng_digital_human": return 150;
```

扩展 [`services/platformAiPath.ts`](services/platformAiPath.ts) `isPlatformMeteredJobKind` 包含上述三项。

服务端 credits-gate：复用 gemini-proxy 模式（session Cookie 查余额）或 HMAC 头；**新增** `server/jimeng-credits-gate.js`（若与 gemini 逻辑可共用则提取公共模块）。

#### L2 实扣（成功后）

- `emitMeteredUsage` / `emitMeteredUsageAwait` 在 `status === done` 后
- `idempotencyPrefix: jimeng:{taskId}`
- `resolveBillingSkuForJimeng(registryId)` → `usageBillingSku.ts`

#### billingSku 占位

| 前缀 | 模式 | meterKind |
|------|------|-----------|
| `jimeng-image-*` | `image.jimeng.{slug}` | `task` |
| `jimeng-video-*` | `video.jimeng.{slug}` | `task` |
| `jimeng-dh-*` | `digital_human.jimeng.{slug}` | `task` |

同步：`server/usage-price-catalog.js`、`shared/usageBillingCatalog.ts`（`perUnit` 标注 `estimate`）。

**v1 不做** `credit_reserves` 预扣；失败不扣；超时不扣。

---

## 5. 目录与文件清单

| 路径 | 职责 | W0 |
|------|------|-----|
| `services/jimeng/catalog.ts` | SKU 唯一真源 | 必 |
| `services/jimeng/types.ts` | 契约类型 | 必 |
| `services/jimeng/paramsSchema.ts` | SKU 参数校验 | 必 |
| `services/jimeng/client.ts` | 调 `/api/jimeng/*` | 必 |
| `services/jimeng/adapter.ts` | Submit + poll + 超时 | 必 |
| `services/jimeng/pickJimengBinding.ts` | 视频/数字人选线 | 必 |
| `services/jimeng/errors.ts` | 错误类 | 必 |
| `services/jimeng/omnihumanOrchestrator.ts` | 数字人多步 | 可选 |
| `server/jimeng-sign.js` | HMAC 纯函数 | 必 |
| `server/jimeng-visual-api.js` | 签名 + 转发 handler | 必 |
| `server/jimeng-credits-gate.js` | 服务端积分预检 | 必 |
| `server/auth-api.js` | 挂载路由 + 白名单 | **必改** |
| `services/modelRegistry/types.ts` | `ChannelId` + `ModelFamily` 扩展 | 必 |
| `services/modelRegistry/jimengImageRegistry.ts` | 图类 SKU mirror | 必 |
| `services/modelRegistry/jimengVideoRegistry.ts` | 视频 SKU | 必 |
| `services/modelRegistry/jimengDigitalHumanRegistry.ts` | 数字人 SKU | 必 |
| `services/modelRegistry/connectionCatalog.ts` | hidden 输出口行 | 必 |
| `services/modelRegistry/jimengBindings.ts` | 图类 default binding | 必 |
| `services/unifiedAiGateway.ts` | 出口 + JobKind | 必 |
| `shared/credits.ts` | proxyGateMinCredits 扩展 | 必 |
| `services/platformAiPath.ts` | metered job 扩展 | 必 |
| `services/usageBillingSku.ts` | `resolveBillingSkuForJimeng` | 必 |
| `eslint.config.js` | 禁 import adapter/client | 必 |
| `tests/jimeng.catalog.test.ts` | SKU 完整性 | 必 |
| `tests/jimeng.sign.test.ts` | 签名向量 | 必 |
| `tests/jimeng.adapter.test.ts` | mock 异步 | 必 |
| `tests/jimeng.credits-gate.test.ts` | L1 门禁 | 必 |
| `tests/jimeng.api-route.test.ts` | supertest auth-api mock | 建议 |

签名实现：W1 spike **手写 vs `@volcengine/openapi` SDK**；选型写入 §14 修订记录。

---

## 6. 与现有模块关系

| 模块 | 关系 |
|------|------|
| `geminiService` / `toapisAdapter` | 不改 |
| `pickBinding` | 仅 **图类** jimeng SKU |
| `pickJimengBinding` | **视频 / 数字人** 专用 |
| `workflowVideoBridge` | 并存；M2 可选指向 `/api/jimeng` |
| `generate3d/` | 不改 |
| `capabilityExecutor` | W0 不接；M1 接线 |
| `workflowRunTaskBranch` | W0 不改；M1 增 `generate_digital_human` 分支评估 |
| `workflowAiPickIndex.ts` | W0 末追加 jimeng 条目 |

---

## 7. 测试策略

### 7.1 单元测试

- catalog：`registryId` 唯一；`verified` 仅官方核对项为 true；unverified 的 `upstreamReqKey` 非空
- sign：固定 clock 对齐火山样例
- adapter：Submit → pending → done；超时；`code !== 10000`
- credits-gate：未登录 / 余额不足 / 通过

### 7.2 集成冒烟

```bash
npm run test:jimeng-smoke   # package.json 待增
```

- **必跑**：`jimeng-image-t2i-v40`、`jimeng-video-ti2v-v30-pro`（verified）
- **可选**：OmniHuman（已开通则跑）
- 断言：`taskId`、`done` 结构；**不断言画质**

CI：secrets 可选；无 secrets 时 skip 并 `console.warn`。

### 7.3 回归

- `npm run typecheck`
- Gemini / Tripo / 现有 `workflowRunTaskBranch` 零行为变化
- jimeng 调用产生 usage（mock emit）

---

## 8. ESLint 纪律

在 `eslint.config.js` 增加（路径示例）：

```js
// 业务 components/hooks/services（排除 unifiedAiGateway、jimeng 自身、tests）
no-restricted-imports: [
  { paths: [
      { name: '@/services/jimeng/adapter', message: '请经 unifiedAiGateway' },
      { name: '@/services/jimeng/client', message: '请经 unifiedAiGateway' },
    ]}
]
```

与 Tripo / tencent 现有 ESLint 规则同模式。

---

## 9. 火山业务码映射（M2 可用，W0 预留）

| code / 场景 | errorHint | 用户文案（M2） |
|-------------|-----------|----------------|
| 401 / Invalid Authorization | `auth_failed` | 服务配置异常，请联系管理员 |
| 403 / 未开通能力 | `capability_not_enabled` | 该模型尚未开通 |
| 429 / QPS | `rate_limited` | 请求过于频繁，请稍后重试 |
| 10000 以外 | `upstream_rejected` | 生成失败：{message} |
| poll 超时 | `poll_timeout` | 生成超时，请重试 |

W0：原样透传 `code` + `message`；adapter 填 `errorHint` 供 `[unified-ai]` 日志。

---

## 10. 风险与对策

| 风险 | 对策 |
|------|------|
| req_key 未 verified | W0 冒烟仅 verified；合并前禁止滥标 true |
| 签名错误 | sign 单测 + SDK spike |
| 结果 URL 过期 | M1 转存；W0 文档注明 |
| 数字人公网 URL | W0 skip 或 staging-upload |
| 站点 AK 资损 | credits L1 双端门禁 |
| 轮询占连接 | 退避 + per-user 并发上限 |
| SKU 膨胀 | warehouseOnly + ops allowlist（M1） |

---

## 11. 里程碑（修订）

| 周 | 交付 | 门禁 |
|----|------|------|
| W1 | catalog + types + sign + catalog 单测；**核对 verified SKU req_key** | 至少 2 条 verified |
| W2 | jimeng-visual-api + auth-api 挂载 + credits-gate + status API | POST 503 when disabled |
| W3 | adapter + client + pickJimengBinding + gateway + billing 占位 | traceUnifiedAiCall 单测 |
| W4 | verified 冒烟 + ESLint + workflowAiPickIndex + 交接文档 | §1.4 全通过 |

---

## 12. Phase M1 前端适配清单

### 12.1 运营与配置

- [ ] 运营 JSON / SystemConfig：`jimeng` allowlist 上架 registryId
- [ ] `docs/spec/model-capability-matrix.md` 增补 jimeng 行
- [ ] 设置页展示「火山即梦」输出口（`hidden: false`）

### 12.2 类型与执行链

- [ ] `types.ts` / `CustomAppModule.category`：新增 `generate_digital_human`
- [ ] `workflowRunTaskBranch.ts`：评估新分支或并入 `branch_preset_execute_capability`
- [ ] `capabilityExecutor.ts`：`generate_image` / `generate_video` / `generate_digital_human` → 网关 jimeng 函数
- [ ] `proxyGateJobKindForWorkflowBranch`：digital_human → `workflow_jimeng_digital_human`
- [ ] `workflowAiPickIndex.ts`：jimeng 拣货路径键值

### 12.3 UI

- [ ] 工作流：型号列表接 jimeng image SKU（allowlist 过滤）
- [ ] 工作流：生视频 / 数字人预设与结果落盘（`mediaKind: 'video'`、R2 转存）
- [ ] 快捷条：对 `generate_digital_human` 的排除/纳入规则（对标 `generate_3d`）
- [ ] 积分：任务前展示 `proxyGateMinCreditsForJob` 预估

### 12.4 单测

- [ ] `workflowRunTaskBranch.test.ts` 增 digital_human 分类
- [ ] `creditsGate.test.ts` 增 jimeng jobKind

---

## 13. 评审修订对照（v0.1 → v0.2）

| 评审项 | v0.2 处理 |
|--------|-----------|
| req_key / docRef 不可信 | §3 增 `verified`；W0 冒烟仅 verified |
| ModelResolveRole 扩展 | **撤销**；采用独立 registry + pickJimengBinding（§0.1 D1） |
| 积分仅后扣 | §4.8 L1+L2 双阶段 |
| feature-flag 前后端 | §4.5 双层 + `/api/jimeng/status` |
| 「全部 API」范围 | §0 收窄；§3.4 不计 W0 |
| traceUnifiedAiCall 缺失 | §4.7 强制 |
| M1 清单遗漏 | §12 完整 checklist |
| auth-api 挂载模糊 | §4.2 Tripo 对照表 |
| 轮询策略缺失 | §4.6 |
| 凭证双真相源 | §4.3 W0 仅 site env |
| 数字人 W0 | §4.4 可 skip |
| ESLint | §8 |
| billingSku resolver | §4.8 + §5 文件清单 |

---

## 14. 修订记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-07-06 | v0.1 | 初稿 |
| 2026-07-06 | v0.2 | 架构评审修订：冻结拍板、verified SKU、积分/flag/binding/轮询/ESLint/M1 清单 |
