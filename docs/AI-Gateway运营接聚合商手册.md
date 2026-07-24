# AI Gateway 运营接聚合商手册（OpenAI-compatible）

**日期**：2026-07-24  
**读者**：运营 / 管理员（无需改仓库、无需新写 adapter）  
**适用**：302.AI、AIHubMix、OpenRouter、SiliconFlow 等 OpenAI 兼容聚合商  

专用协议（即梦 / Tripo / 混元 3D 等）仍走现有专用链路，不在本手册范围。

## 目标流程

填表 → Key Check → Route Check → Generation Test → 发布上线

## 步骤

### 1. 写聚合商配置（model-ops）

在管理后台保存的 `model-ops-config` 中填写 `openAiCompatibleProviders`（或由后台表单写入），例如：

```json
{
  "openAiCompatibleProviders": [
    {
      "providerId": "302ai",
      "label": "302.AI",
      "defaultBaseUrl": "https://api.302.ai/v1",
      "asyncCapable": true,
      "timeouts": { "requestMs": 60000 }
    }
  ],
  "providerOverrides": [
    { "providerId": "302ai", "baseUrl": "https://api.302.ai/v1", "requestTimeoutMs": 60000 }
  ]
}
```

保存后服务端会调用 `applyOpenAiCompatibleProvidersFromOps`，**不会**新建 `xxx-adapter.js`。

### 2. 挂 Key

在「供应商 Key」里为该 `providerId` 添加可用平台 Key，跑 **Key Check**。

### 3. 挂路由

- 同步文本/图片：用 `gatewayRouteConfigs`（或发布目录里已有 seed 路由）指向该 `providerId`
- 异步视频等：再补 `endpointMappings`（request/poll/status/artifact 路径）

跑 **Route Check**（不要和 Generation 混淆）。

### 4. Generation Test

在后台对目标模型跑真实/受控 Generation Test；通过后再把 canonical model 放进工作区发布白名单。

### 5. 价格（最小可挂）

1. 打开管理后台「价目表」。
2. 顶部「AI Gateway 待补价 SKU」会列出 `listModelRoutes` + ops `gatewayRouteConfigs` 里尚未定价的路由。
3. 点「补价」会预填 `billingSku`、计量类型，并带最小积分 `1`（可随后改准）。
4. 保存后即可与计费链路对齐；SKU 形状与运行时默认一致：`{modality}.{providerId}.{model}`。

## 平台路由 vs 本地调试

| 路径 | 何时用 | 行为 |
| --- | --- | --- |
| **平台路由（默认）** | 工作流 / 能力块 / 统一生成入口 | 走 AI Gateway + 站点积分；本地陈旧 Key **不会**自动翻成 BYOK，也不会钉死自备供应商 |
| **本地调试 / 自备 Key（显式）** | 仅「自备 Key」类工具或调用方传 `explicitByok: true` | 才按 BYOK 计费与 provider pin；用于排障或个人 Key 实验 |

运营接聚合商时，用户侧默认应只看到平台路由结果；不要靠「用户本机填了 Key」来验证平台链路。

## 不要做的事

- 不要为第 N 家 OpenAI 兼容平台再复制一份 adapter 源文件
- 不要把 Key Check 通过当成 Generation 可用
- 不要只改前端 catalog 而不写 `gatewayRouteConfigs` / endpoint 映射

## 排障

| 现象 | 先查 |
| --- | --- |
| Route Check 找不到 provider | `openAiCompatibleProviders` 是否已保存并 apply |
| Key 不可用 | Key 池 providerId 是否与配置一致 |
| 异步一直 mapping_incomplete | `endpointMappings` 必填字段 |
| 前台看不见模型 | 发布白名单 + `gatewayRouteConfigs` / catalog 叠加 |
