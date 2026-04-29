# Vertex AI 接入说明（本站实现）

本文描述 **AssetCutter** 如何通过已有 **Gemini 异步代理**（`server/gemini-proxy-api.js`）调用 **Google Cloud Vertex AI** 上的 Gemini，与浏览器内 **AI Studio API Key**、ToAPIs 等供应商并列。

## 1. 架构与安全

- **浏览器不持有 GCP 凭证**：Vertex 使用 **Application Default Credentials（ADC）** 或服务账号，仅在 **部署了 `gemini-proxy-api` 的服务器**上配置。
- **前端仅多传一个字段**：在 `POST /proxy/gemini/async`（及同步 `POST /proxy/gemini/generate-content`）的 JSON 中增加 `aiBackend: "vertex"`，代理在服务端用 `@google/genai` 的 **Vertex 模式**转发，响应形状与现有 Gemini API Key 路径一致（`text` + `candidates[].content.parts`，含 `inlineData` 生图）。
- **同源与 CORS**：与现有代理相同，通过 `PROXY_ALLOWED_ORIGINS` 限制前端 Origin；前端通过 `VITE_BULK_IMAGE_API` 指向代理根 URL（或本地 `same-origin` + Vite 反代）。

## 2. 环境变量（代理进程）


| 变量                                           | 必填             | 说明                                                                                                                                                                  |
| -------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERTEX_PROJECT_ID` 或 `GOOGLE_CLOUD_PROJECT` | 选 Vertex 时必填   | GCP 项目 ID。                                                                                                                                                          |
| `VERTEX_LOCATION`                            | 否              | 默认 `global`。预览版生图模型文档推荐使用 **global**；若你的账号/政策要求区域端点，可改为如 `us-central1`（需与 [官方区域说明](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations) 一致）。 |
| ADC                                          | 选 Vertex 时必填   | 任选一：`GOOGLE_APPLICATION_CREDENTIALS` 指向服务账号 JSON 文件路径；**或**（Render 等）将整段 JSON 粘贴到 `GOOGLE_APPLICATION_CREDENTIALS_JSON`（别名 `GCP_SERVICE_ACCOUNT_JSON` / `GOOGLE_SERVICE_ACCOUNT_JSON`），代理启动时会写入临时文件并设置 ADC。GCE/Cloud Run 等可用内置身份。作用域需能调用 Vertex AI。                                                                           |
| `GEMINI_API_KEY`                             | 非 Vertex 请求仍需要 | 仅当请求**未**带 `aiBackend: "vertex"` 时，代理仍走 AI Studio Key。可同时配置：同一代理既服务 Key 用户又服务 Vertex。                                                                               |


无需在仓库中提交密钥文件；Render/Vercel 等用 Dashboard 注入或 Secret。

## 3. 前端环境变量


| 变量                    | 说明                                                                 |
| --------------------- | ------------------------------------------------------------------ |
| `VITE_BULK_IMAGE_API` | **Vertex 供应商下必填**（或 `same-origin` + 本地起代理）。与现有「官方 Gemini 走后端代理」相同。 |


设置页选择 **Vertex AI（GCP · 经本站代理）** 后，所有 `generateContent` 均走上述代理，且自动附带 `aiBackend: "vertex"`。用户**不需要**在浏览器填写 GCP 密钥。

## 4. 生图模型 ID（与 Vertex 文档一致）

站内 `types.ts` 中三个生图模型与 Vertex **Model ID 一致**，代理**不做改名映射**：


| 站内 ID                            | Vertex Model ID                           |
| -------------------------------- | ----------------------------------------- |
| `gemini-2.5-flash-image`         | `gemini-2.5-flash-image`（GA）              |
| `gemini-3.1-flash-image-preview` | `gemini-3.1-flash-image-preview`（Preview） |
| `gemini-3-pro-image-preview`     | `gemini-3-pro-image-preview`（Preview）     |


参考：[Google models 总览](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/models) 及各模型专页。

## 5. 请求协议（给二次开发）

**异步（推荐，与现网一致）**

1. `POST {BULK}/proxy/gemini/async`
  Body: `{ "model": "...", "contents": ..., "config": ..., "aiBackend": "vertex" }`
2. `GET {BULK}/proxy/gemini/async/:jobId` 轮询直至 `completed` / `failed`。

**同步**

- `POST {BULK}/proxy/gemini/generate-content`，Body 同样可带 `aiBackend: "vertex"`。

`config` 与现网一致：`systemInstruction`、`responseMimeType`、`responseSchema`、`imageConfig`（`aspectRatio` / `imageSize`）等，由 `@google/genai` 在 Vertex 端转换。

## 6. 健康检查

`GET /healthz` 返回 JSON 中含 `vertex.configured`（是否已配置项目 ID）、`vertex.location`（解析后的区域），便于运维确认。

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