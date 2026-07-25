# AI Gateway · BYOK / 工具级旁路审计表（B13）

**日期**：2026-07-25  
**权威规则**：`shared/billingRoute.ts` → `resolveBillingRoute`  
**机器可读副本**：`shared/aiGatewayByokPathAudit.ts`（测试防回归）

## 一句话

用户可达路径**默认 platform（站点积分 + Gateway）**；BYOK **仅**显式自备 Key 工具 / `explicitByok: true`；预检与结算同一套路由。

## 易混淆点（先读）

| 名 | 是什么 | 不是什么 |
| --- | --- | --- |
| `byokSupported`（catalog / Admin 列） | 供应商**能力**旗标：允许接自备 Key | **不是**默认 BYOK 计费开关 |
| `workflowCreditsBypass` / `proxyCreditsBypassed*` | 计划步骤全 BYOK 时跳过站点预扣的**派生** | **不是**第二张硬编码旁路表 |
| 本机有 Tripo / 腾讯 / Gemini Key | 可被显式工具使用 | **不会**单独把工作流默认路径翻成 BYOK（A6） |
| `explicitByok` | 调用方显式声明「走自备 Key」 | 缺省 `false` |

## 用户可达路径

| pathId | 入口 | jobKind | 默认 | BYOK 条件 | 预检=结算 |
| --- | --- | --- | --- | --- | --- |
| workflow.chat | 工作流对话/理解 | workflow_chat | platform | 仅 explicitByok | 是（C7：Gateway Job） |
| workflow.understand | 工作流图像理解 | workflow_understand | platform | 仅 explicitByok | 是（C7：Gateway Job） |
| workflow.text_to_image | 文生图 / 统一生成 | workflow_text_to_image | platform | 仅 explicitByok | 是 |
| workflow.image_edit | 图编辑 | workflow_image_edit | platform | 仅 explicitByok | 是 |
| workflow.jimeng_* | 即梦图/视频（Gateway-only） | workflow_jimeng_* | platform | 不翻 BYOK（ALWAYS_PLATFORM） | 是 |
| workflow.generate_video | 视频任务 | workflow_generate_video | platform | 不翻 BYOK | 是 |
| workflow.generate_3d.platform | 3D Tripo/腾讯默认 | workflow_generate_3d | platform | 本机凭证不够 | 是 |
| workflow.generate_3d.explicit_byok | 显式自备 Key · 3D | workflow_generate_3d | byok | explicitByok + 凭证 | 是 |
| tool.explicit_byok_channel | 显式自备 Key 工具 | （各 jobKind） | byok | explicitByok + BYOK channel | 是 |

## 预检 = 结算

| 环节 | 模块 | 约定 |
| --- | --- | --- |
| 预检 / 规划 | `aiBillingGate` → `resolveBillingRoute` / `plan*Routes` | 与结算同决策 |
| 统一生成钉供应商 | `runUnifiedGeneration` | 默认不钉 BYOK；仅 `explicitByok` 或 `vertex-proxy` |
| 结算 / usage | Gateway usage-event + pricing-engine | platform 才扣站点积分；BYOK `costUsdEst` 可空 |

## 运营注意

接聚合商时用**平台 Key 池**验证；不要用「用户本机填了 Key」当平台链路冒烟。见 `docs/AI-Gateway运营接聚合商手册.md`。
