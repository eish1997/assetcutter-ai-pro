# Vertex AI 接入说明（本站实现）

本文描述 **AssetCutter** 如何通过已有 **Gemini 异步代理**（`server/gemini-proxy-api.js`）调用 **Google Cloud Vertex AI** 上的 Gemini，与浏览器内 **AI Studio API Key**、ToAPIs 等供应商并列。

## 1. 架构与安全

- **浏览器不持有 GCP 凭证**：Vertex 使用 **Application Default Credentials（ADC）** 或服务账号，仅在 **部署了 `gemini-proxy-api` 的服务器**上配置。
- **前端多传一个字段（可选）**：在 `POST /proxy/gemini/async`（及同步 `POST /proxy/gemini/generate-content`）的 JSON 中增加 `aiBackend: "vertex"`，代理在服务端用 `@google/genai` 的 **Vertex 模式**转发。站点设置选择 **「Vertex AI」** 供应商时，前端异步/批量请求会自动附带；选择「试用（代理）」时不附带，代理走 `GEMINI_API_KEY`。
- **同源与 CORS**：与现有代理相同，通过 `PROXY_ALLOWED_ORIGINS` 限制前端 Origin；前端通过 `VITE_BULK_IMAGE_API` 指向代理根 URL（或本地 `same-origin` + Vite 反代）。

## 2. 环境变量（代理进程）


| 变量                                           | 必填             | 说明                                                                                                                                                                  |
| -------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERTEX_PROJECT_ID` 或 `GOOGLE_CLOUD_PROJECT` | 选 Vertex 时必填   | GCP 项目 ID。                                                                                                                                                          |
| `VERTEX_LOCATION` / `GOOGLE_CLOUD_LOCATION` | 否              | 默认 **`us-central1`**（[Agent Platform 区域端点](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations)）。加积分只改浏览器→auth-api 中继，Google 侧仍为 `aiBackend:vertex` + ADC。 |
| `VERTEX_API_VERSION`                         | 否              | 默认 **`v1`**（与官方生图 REST 一致）。预览能力若需可设 `v1beta1`。 |
| ADC                                          | 选 Vertex 时必填   | 任选一：`GOOGLE_APPLICATION_CREDENTIALS` 指向服务账号 JSON 文件路径；**或**（Render 等）将整段 JSON 粘贴到 `GOOGLE_APPLICATION_CREDENTIALS_JSON`（别名 `GCP_SERVICE_ACCOUNT_JSON` / `GOOGLE_SERVICE_ACCOUNT_JSON`），代理启动时会写入临时文件并设置 ADC。GCE/Cloud Run 等可用内置身份。作用域需能调用 Vertex AI。                                                                           |
| `GEMINI_API_KEY`                             | 非 Vertex 请求仍需要 | 仅当请求**未**带 `aiBackend: "vertex"` 时，代理仍走 AI Studio Key。可同时配置：同一代理既服务 Key 用户又服务 Vertex。                                                                               |
| `GEMINI_FAIRNESS_ENABLED`                    | 否              | 默认 `false`。为 `true` 时启用 **公平排队 / 每用户限流**（内存态，**单副本**有效）。详见 **[Gemini代理-公平排队与每用户限流.md](./Gemini代理-公平排队与每用户限流.md)**。 |
| `GEMINI_PROXY_FAIRNESS_HMAC_SECRET`          | 否              | 非空时要求 `X-AC-Fairness-Signature`（与 `X-AC-Fairness-Key` 配套），公网直连代理时防伪造。内网可信转发可仅传 Key。 |
| `GEMINI_FAIRNESS_CONFIG_PATH`                | 否              | 磁盘覆盖配置路径，默认 `server/data/gemini-fairness-config.json`；**gemini-proxy** 约 3s 重读；与 **auth-api** 管理接口写同一路径。 |
| `GEMINI_FAIRNESS_TRUST_CLIENT_KEY_HEADER`    | 否              | 为 `true` 且无 HMAC、非内网 relay 时，可接受浏览器自带的 **`X-AC-Fairness-Key`**（公网慎用，优先 HMAC 或 BFF）。 |


- **管理端**：站点 **`/admin/gemini-fairness`**（管理员）经 auth-api **`GET` / `PUT` / `DELETE`** **`/api/admin/gemini-fairness-config`** 读写或清空上述 JSON（仅白名单数值键；**PUT 与磁盘已有项合并**；**DELETE** 写 `{}`）。
- **前端**：代理 JSON **`error: rate_limited` / `queue_overflow`** → **`throwFairnessRejected`** + 顶栏；经 **`workflow*`** 的 Google/上游 **429、RESOURCE_EXHAUSTED、503 过载**等 → **`ac:unified-ai-soft-notice`**（**`unifiedAiSoftNotice.ts`**，同栏展示、按类节流）；对话等直连 **`getDialogTextResponse`** 仍以页面内错误为主。

无需在仓库中提交密钥文件；Render/Vercel 等用 Dashboard 注入或 Secret。

## 3. 前端环境变量


| 变量                    | 说明                                                                 |
| --------------------- | ------------------------------------------------------------------ |
| `VITE_BULK_IMAGE_API` | **Vertex 供应商下必填**（或 `same-origin` + 本地起代理）。与现有「官方 Gemini 走后端代理」相同。 |


设置页选择 **Vertex AI（GCP · 经本站代理）** 后，所有 `generateContent` 均走上述代理，且自动附带 `aiBackend: "vertex"`。用户**不需要**在浏览器填写 GCP 密钥。

## 4. 生图模型 ID 与 Agent Platform 请求配置

站内 model id 与 [Gemini Enterprise Agent Platform](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/image-generation) **Model ID 一致**，代理不做改名。

**生图必填**（官方）：`config.responseModalities: ["TEXT", "IMAGE"]`。本站于 `buildGeminiConfig`（前端）与 `mergeAgentPlatformImageConfig`（代理）自动注入。

**区域**：`gemini-3.1-flash-image`、`gemini-2.5-flash-image` 等在 [Deployments and endpoints](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations) 列出 **us-central1** 可用；勿为生图整站设 `global`（Console 会计入 Gemini for Google Cloud API）。

| 站内 ID                            | Vertex Model ID                           |
| -------------------------------- | ----------------------------------------- |
| `gemini-2.5-flash-image`         | `gemini-2.5-flash-image`（GA）              |
| `gemini-3.1-flash-image`         | `gemini-3.1-flash-image`（GA，**默认**）   |
| `gemini-3-pro-image`             | `gemini-3-pro-image`（GA）                  |
| `gemini-3.1-flash-image-preview` | `gemini-3.1-flash-image-preview`（Preview） |
| `gemini-3-pro-image-preview`     | `gemini-3-pro-image-preview`（Preview）     |


参考：[Google models 总览](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/models) 及各模型专页。

## 5. 请求协议（给二次开发）

**异步（推荐，与现网一致）**

1. `POST {BULK}/proxy/gemini/async`
  Body: `{ "model": "...", "contents": ..., "config": ..., "aiBackend": "vertex" }`
2. `GET {BULK}/proxy/gemini/async/:jobId` 轮询直至 `completed` / `failed`；若启用公平队列，创建后可能为 `queued` 再 `running`。

**公平排队（可选）**：`GEMINI_FAIRNESS_ENABLED=true` 时，可传请求头 **`X-AC-Fairness-Key`**（如 `user:<id>`）、可选 **`X-AC-Fairness-Signature`**（HMAC）、**`X-AC-Client-Ip`**（内网 BFF 解析后的客户端 IP，用于 `anon:` 桶）。完整约定见 **[Gemini代理-公平排队与每用户限流.md](./Gemini代理-公平排队与每用户限流.md)**。

**同步**

- `POST {BULK}/proxy/gemini/generate-content`，Body 同样可带 `aiBackend: "vertex"`。

`config` 与现网一致：`systemInstruction`、`responseMimeType`、`responseSchema`、`imageConfig`（`aspectRatio` / `imageSize`）等，由 `@google/genai` 在 Vertex 端转换。

## 6. 健康检查

`GET /healthz` 返回 JSON 中含 `vertex.configured`（是否已配置项目 ID）、`vertex.location`（解析后的区域），以及 **`fairness`**（公平队列开关与近似队列深度，见 `docs/Gemini代理-公平排队与每用户限流.md`），便于运维确认。

## 7. 排错摘要


| 现象                                                      | 方向                                                 |
| ------------------------------------------------------- | -------------------------------------------------- |
| `Vertex: set VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT` | 代理未配置项目。                                           |
| `403` / `PERMISSION_DENIED`                             | GCP 项目未开通 Vertex、计费、或服务账号权限不足。                     |
| `404` / model not found                                 | `VERTEX_LOCATION` 与模型可用区域不一致，尝试 `global` 或文档列出的区域。 |
| 前端提示未配置代理                                               | 未设置 `VITE_BULK_IMAGE_API`，或构建未包含该变量。               |


## 8. 后续可迭代项（未做）

- 按环境拆分 `VERTEX_LOCATION`（开发/生产不同区域）。
- 代理层对 Vertex 错误码做更细的中文映射（与 `normalizeApiErrorMessage` 对齐）。
- 若需「仅 Vertex、禁止 AI Studio Key」的专用部署，可在代理侧加 `VERTEX_ONLY=true` 拒绝无 `aiBackend` 的请求（当前为可选增强）。
- **公平排队 / 每用户限流**（多用户共单 GCP 项目时的队列公平与防刷）：规格见 **[Gemini代理-公平排队与每用户限流.md](./Gemini代理-公平排队与每用户限流.md)**；实现后本节「请求协议」「环境变量」应与之同步。