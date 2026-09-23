# AI Gateway 运营接聚合商（OpenAI-compatible）

**日期**：2026-09-23（R4/R5 对齐）  
**读者**：运营 / 管理员（无需改仓库、无需新写 adapter）  
**适用**：302.AI、AIHubMix、OpenRouter、SiliconFlow 等 OpenAI 兼容聚合商  

专用协议（即梦 / Tripo / 混元 3D 等）仍走专用 adapter，不在本手册范围。  
归档旧稿见 `docs/archived/AI-Gateway运营接聚合商手册.md`（其中「必须手写 gatewayRouteConfigs」已过时）。

## 目标流程

填表 → 保存发布范围（自动挂路由）→ Key Check → Route Check → Generation Test → 上线

## 步骤

### 1. 写聚合商配置

在管理后台「OpenAI 兼容聚合商」填写：

| 字段 | 说明 |
| --- | --- |
| providerId / 显示名 / baseURL | 必填身份与入口 |
| 请求超时 / syncEndpoints / 生图协议 | 文/图同步调用细节 |
| 异步 | 勾选后可接视频异步模板（R5） |
| 模型映射 | 每行 `canonical=upstream` |

点「保存发布范围」后：

- **文/图**：对已发布白名单中的 text/image canonical，幂等 upsert `gatewayRouteConfigs`（`ruleId=openai-compatible-auto-sync`）
- **视频**：仅当 `asyncCapable=true` 且白名单含 video 类模型时，幂等 upsert `endpointMappings` + `gatewayRouteConfigs`（`ruleId=openai-compatible-async-auto-sync`，`adapterId=openai-compatible-async`）
- **不会**新建 `xxx-adapter.js`
- 手工改过的非 auto 行默认保留；需要覆盖时点「同步已发布模型路由」（`forceOpenAiCompatibleRouteSync`）

**注意**：发布白名单为空时自动同步会**静默跳过**；Admin 会显示黄字提示。

### 2. 挂 Key

在「供应商 Key」为该 `providerId` 添加可用平台 Key，跑 **Key Check**。

### 3. 路由检查（一般不必再手写三处）

| 模态 | 自动挂什么 | 何时仍需手工 |
| --- | --- | --- |
| 文本 / 图片 | `gatewayRouteConfigs` | 特殊 path 用 `syncEndpoints` 覆盖 |
| 视频（异步） | `endpointMappings` 最小模板 + route | 上游 path 不同时改 mapping 或 `asyncEndpoints` |
| 即梦 / Tripo / 混元 | — | 专用链路，勿塞进 OpenAI 模板 |

跑 **Route Check**（不要和 Generation 混淆）。

### 4. Generation Test

对目标模型跑 Generation Test；通过后再确认发布白名单。

### 5. 价格

管理后台「价目表」→「AI Gateway 待补价 SKU」→ 补价。SKU：`{modality}.{providerId}.{model}`。

## 本地冒烟

```powershell
# 进程内适配器生图（无需登录）
npm run smoke:ai-gateway-local-image

# 经 POST /api/ai/jobs 的 HTTP 生图（需本机 auth-api + 登录凭据）
$env:AUTH_API_BASE='http://127.0.0.1:9100'
$env:SMOKE_USER='...'
$env:SMOKE_PASS='...'
npm run smoke:ai-gateway-local-http-image

# 缺凭据时可选跳过
$env:AI_GATEWAY_SMOKE_OPTIONAL='1'
npm run smoke:ai-gateway-local-http-image
```

契约守卫：`npm run guard:ai-gateway-job-contract`

## 平台路由 vs 本地调试

| 路径 | 何时用 |
| --- | --- |
| **平台路由（默认）** | 工作流 / 能力块；走 Gateway + 站点积分 |
| **本地调试 / BYOK** | 仅显式自备 Key |

详见 `docs/AI-Gateway-BYOK旁路审计表.md`。
