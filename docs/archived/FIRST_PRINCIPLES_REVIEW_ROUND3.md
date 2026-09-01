# 第一性原理代码审查报告（第三轮）

## 本轮目标
第三轮聚焦两个问题：

1. `App.tsx` 入口负担过重
2. 构建主包体积过大，影响首屏加载与后续演进

## 第一性判断
- 许多页面模块天然按 `mode` 切换，属于“用户不会同时访问”的内容，不应全部放进首屏主包。
- `three`、`@xyflow/react`、`@google/genai` 都是高体积依赖，应该按职责分包，而不是跟业务入口混在同一 chunk。

## 已完成优化
- 在 [`App.tsx`](../App.tsx) 中把以下模块改为 `React.lazy + Suspense`：
  - `HomeSection`
  - `WorkflowSection`
  - `CapabilityPresetSection`
  - `PromptArenaSection`
  - `SeamRepairSection`
  - `GenerateTextureSection`
  - `SettingsSection`
  - `StoreSection`
  - `SiteAssistant`
  - `UnifiedModelViewer3D`
- 在 [`vite.config.ts`](../vite.config.ts) 中新增 `manualChunks`，将 vendor 依赖按职责拆分：
  - `react-vendor`
  - `genai-vendor`
  - `xyflow-vendor`
  - `three-examples`
  - `three-core`

## 结果
- 第三轮前：
  - 主入口 `index` 约 `651KB`
- 第三轮后：
  - 主入口 `index` 约 `196KB`
  - 页面模块被拆成独立 chunk
  - `three` 相关资源被拆到独立 vendor chunk

## 收益
- `首屏更轻`：用户首次进入不再加载所有页面模块。
- `边界更清晰`：页面层与资源层的装配关系更明确。
- `后续更容易继续拆`：现在可以针对单个页面独立优化体积，而不必牵动整个入口包。

## 验证结果
- `npm run typecheck` 通过
- `npm run lint` 通过（仍保留历史 warning，未新增 error）
- `npm run test` 通过
- `npm run build` 通过

## 剩余风险
- `three-core` 仍约 `544KB`，说明 3D 运行时仍是当前最大的单点体积来源。
- `App.tsx` 仍然偏大，虽然入口依赖变轻，但内部状态编排还需要继续拆。

## 下一轮建议
- 第四轮优先拆 `App.tsx` 的对话状态编排。
- 然后再针对 3D 能力做更细粒度的按功能懒加载，继续压缩 `three-core` 依赖面。
