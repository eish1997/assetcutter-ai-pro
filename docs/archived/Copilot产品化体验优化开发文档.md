# Copilot 产品化体验优化开发文档

版本：v0.2  
状态：P3 完成，开发文档任务已完成  
目标读者：AI Agent、产品、前端、本地伴侣、Agent 工程、Workflow、宿主连接器  
范围：本地伴侣最右侧 `Copilot codex` 面板、工作台项目 Agent 的边界协调、运行时感知、任务状态、失败恢复、后续桌面观察能力

## 0. 一句话结论

Copilot 要从“能聊天、能调工具”的侧边栏，升级成用户能信任的桌面工作中枢：它要清楚展示自己正在看什么、正在做什么、刚做了什么、卡在哪里、下一步建议什么，以及哪些动作需要用户授权。

当前优先级不是继续堆能力，而是把最右侧 `Copilot codex` 做成稳定、可观察、可恢复、可授权的产品体验。

## 1. 目标

### 1.1 具体目标

1. 最右侧 `Copilot codex` 面板常驻展示 Copilot 当前感知，而不是只在项目 Agent 或内部 QuickCompose Dock 中显示。
2. Copilot 主界面从“消息堆叠”升级为“任务中枢”：当前任务、状态、失败原因、恢复动作和执行时间线清晰可见。
3. Copilot 的回复和执行前确认必须引用最新感知：工作台、当前对象、宿主连接、最近执行、风险和 stale 状态。
4. 失败不重复堆卡片；同一任务应更新状态，必要时给出恢复按钮。
5. 后续支持全桌面观察模式：用户显式开启后，Copilot 可观察当前窗口或全桌面，并把画面转成结构化摘要。
6. 全部执行链路必须保留权限、审计、用量和恢复边界。

### 1.2 非目标

- 不把工作台项目 Agent 当成壳级 Copilot。
- 不让 QuickCompose 内部 Dock 代替最右侧 `Copilot codex`。
- 不默认开启全桌面录屏或截图采样。
- 不把原始截图、录屏、长日志、密钥、cookie、token 直接塞进模型上下文。
- 不绕过 `ac.*`、BodyHost、Workflow runtime、host connector policy 和 audit。
- 不为了体验优化重构无关业务模块。

## 2. 当前状态

### 2.1 真实入口

当前有两个容易混淆的入口：

| 入口 | 定位 | 当前问题 |
| --- | --- | --- |
| 工作台项目 Agent / QuickCompose | 项目内资产、画布、Workflow 协作入口 | 已有部分运行时感知，但不是壳级 Copilot |
| 本地伴侣最右侧 `Copilot codex` | 桌面壳级统一 Agent 入口 | 需要成为产品化主入口，承载全局感知、任务、执行、恢复和桌面观察 |

后续所有“Copilot 产品化体验”默认指最右侧 `#shell-copilot`，除非任务明确写“项目 Agent”。

### 2.2 已有基础

- `companion-desktop/shell/index.html`：右侧 Copilot 面板 DOM、样式、输入区、token 条、任务卡样式。
- `companion-desktop/shell/copilot-panel.js`：右侧 Copilot 行为、发送、历史、任务卡、恢复卡、Codex 状态、工作台上下文读取。
- `companion-desktop/preload-shell.cjs`：壳层 IPC 暴露。
- `companion-desktop/main.cjs`：Agent session、工作台上下文、Copilot 布局和 IPC。
- `services/runtimePerception/*`：工作台侧结构化运行时感知原型。
- `docs/Copilot运行时感知系统开发文档.md`：运行时感知系统主文档。

### 2.3 已知短板

1. 感知入口曾误挂到项目 Agent / QuickCompose，容易造成用户看不到。
2. 右侧 Copilot 的顶部感知还只是轻量摘要，没有统一 `CopilotRuntimeState`。
3. 当前任务卡容易重复出现，失败后不像同一个任务在推进。
4. 工具执行时间线、计划、恢复动作没有统一产品结构。
5. 全桌面观察还只是方向，没有权限、采样、脱敏、缓存和 UI 开关。
6. 部分自动化测试能守住 DOM/字符串，但缺少真实壳窗口视觉验收。

### 2.4 当前约束

- 仓库存在大量用户/历史改动，执行 Agent 不得回滚无关文件。
- 修改 `companion-desktop/` 或 `local-companion/` 运行时代码后，应执行：

```powershell
npm run restart:local-companion
```

- 全量 TypeScript 可能被既有 Storyboard、ImportMeta、union narrowing 等无关错误阻塞；本计划以 focused checks 为强门禁。
- 新增 UI 不应使用大面积说明文案，不应把内部字段直接暴露给用户。
- 高风险动作仍必须走确认、权限和审计。

## 3. 目标体验

### 3.1 第一屏结构

最右侧 `Copilot codex` 面板应稳定分为四块：

```text
Header：Copilot / 当前大脑 / 设置 / 清空
Perception：我现在看到什么
Task Focus：我正在推进什么
Conversation：必要对话、结果、恢复
Composer：输入 / 停止 / 上下文用量
```

### 3.2 顶部感知条

常驻在 `#shell-copilot .copilot-head` 下方，示例：

```text
观察：工作台 · 画布 | 选中 2 个资产 | Maya 未连接 | 屏幕监控未开启 | 12s 前刷新
```

开启桌面观察后：

```text
观察中：当前窗口 AssetCutter | 前台 Chrome | 最近动作：点击资产卡片 | 3s 前刷新
```

状态要求：

- 正常：低调中性色。
- 有明确目标：目标 chip 高亮。
- 断开/未知/stale：黄色警示。
- 屏幕观察开启：显示“观察中”，且有暂停入口。
- 屏幕观察关闭：明确显示“屏幕监控未开启”，避免用户误以为 Copilot 正在看桌面。

### 3.3 当前任务卡

同一任务应更新同一张卡，而不是每次失败都追加一张。

```text
目标：给当前选中资产生成 Maya 插件方案
状态：失败，等待处理
卡点：Maya Connector 未连接
下一步：重连 Maya / 只生成方案 / 查看详情
```

状态集合：

```text
idle / observing / planning / waiting_confirm / running / failed / succeeded / cancelled / unknown
```

### 3.4 执行时间线

默认折叠，只显示摘要：

```text
已观察工作台 -> 已读取选中资产 -> 已生成方案 -> 执行失败
```

展开后显示：

- 时间。
- 来源：user / copilot / tool / workflow / external / desktop。
- 动作摘要。
- 结果。
- 恢复建议。

### 3.5 失败恢复

失败卡必须给行动，不只给错误：

| 错误类型 | 用户看到 | 恢复动作 |
| --- | --- | --- |
| 未登录 | 工作台未登录 | 打开登录 / 重试 |
| 宿主断开 | Maya 未连接 | 打开连接页 / 只生成方案 / 重试 |
| 权限不足 | 需要授权 | 打开授权 / 只读继续 |
| 任务不明确 | 目标不够清楚 | 选择范围 / 补充条件 |
| 工具失败 | 执行失败 | 查看详情 / 回到上一步 / 重试 |

### 3.6 桌面观察模式

桌面观察是后续核心能力，但必须显式开启：

```text
屏幕观察：关闭
范围：未选择
按钮：开启观察
```

开启流程：

1. 用户点击“开启观察”。
2. 选择范围：当前窗口 / 指定应用 / 全桌面。
3. 显示权限说明：采样频率、本地缓存、脱敏、停止方式。
4. 启动后顶部显示录制状态。
5. Agent 使用结构化摘要，不默认把原始帧长期进模型。

## 4. 信息架构

### 4.1 CopilotRuntimeState

壳级 Copilot 应汇总为一个只读状态：

```ts
export type CopilotRuntimeState = {
  version: 1;
  capturedAt: number;
  freshnessMs: number;
  brain: {
    id: string;
    label: string;
    ready: boolean;
    mode: 'ask' | 'sandbox' | 'full';
  };
  perception: {
    workspace: string;
    object: string;
    external: string;
    desktop: string;
    stale: boolean;
    risks: string[];
  };
  activeTask?: CopilotTaskState;
  timeline: CopilotTimelineEvent[];
};
```

### 4.2 CopilotTaskState

```ts
export type CopilotTaskState = {
  id: string;
  goal: string;
  status: 'idle' | 'observing' | 'planning' | 'waiting_confirm' | 'running' | 'failed' | 'succeeded' | 'cancelled' | 'unknown';
  currentStep?: string;
  blocker?: string;
  recoveryActions: CopilotRecoveryAction[];
  updatedAt: number;
};
```

### 4.3 CopilotTimelineEvent

```ts
export type CopilotTimelineEvent = {
  id: string;
  ts: number;
  source: 'user' | 'copilot' | 'tool' | 'workflow' | 'external' | 'desktop' | 'system';
  title: string;
  detail?: string;
  status?: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  risk?: 'read' | 'light' | 'cost' | 'destructive';
};
```

### 4.4 DesktopObservationState

```ts
export type DesktopObservationState = {
  enabled: boolean;
  scope: 'none' | 'current_window' | 'app' | 'desktop';
  foregroundApp?: string;
  foregroundWindowTitle?: string;
  lastFrameAt?: number;
  lastSummary?: string;
  privacyMode: 'redact' | 'strict';
  recordingIndicatorVisible: boolean;
};
```

## 5. Agent Loop Protocol

后续 AI Agent 执行本文档任务时必须按以下循环：

1. Observe：阅读本文档、相关源文件、最新测试输出、当前 git 状态。
2. Select：选择第一个依赖已完成的 pending task。
3. Act：做满足该任务的最小代码或文档改动。
4. Verify：运行任务列出的 focused checks；涉及壳层运行时代码时重启本地伴侣。
5. Record：在本文档“执行记录”追加文件、命令、结果、人工证据、剩余风险。
6. Continue Or Stop：验证通过则继续下一任务；只有用户指令、真实阻塞或阶段完成时停止。

### 5.1 执行游标

每次恢复本文档时，Agent 必须先读取本表，再读取“执行记录”。如果二者冲突，以“执行记录”的最新日期为准，并在本表修正状态。

| 任务 | 状态 | 依赖 | 下一步判定 |
| --- | --- | --- | --- |
| P0-001 锚定真实 Copilot 入口 | done | 无 | 已锚定 `#shell-copilot` 和 `data-shell-copilot-perception-bar` |
| P0-002 壳级感知条视觉产品化 | done | P0-001 | 已补齐桌面观察 chip、刷新时间 chip 和壳级覆盖样式 |
| P0-003 当前任务卡单例化 | done | P0-002 | 已按当前任务复用主任务卡，同一目标重试递增 attempt |
| P0-004 失败恢复卡产品化 | done | P0-003 | 已补齐详情折叠、连接页、只生成方案、重试和设置入口 |
| P0-005 发送前与执行后感知刷新 | done | P0-004 | 已补齐发送前等待刷新、工具状态/完成/停止/错误后刷新 |
| P1-001 定义壳级 CopilotRuntimeState | done | P0 完成 | 已定义 JS schema、构建函数，并让顶部感知条从状态渲染 |
| P1-002 时间线环形缓存 | done | P1-001 | 已接入 50 条环形缓存、脱敏摘要和默认折叠 UI |
| P1-003 确认卡引用感知 | done | P1-002 | 已在确认卡展示感知摘要、stale 提示，并记录批准/拒绝时间线 |
| P2-001 桌面观察权限与状态 UI | done | P1 基础可用 | 已补齐权限/范围/开启暂停停止 UI，未授权不采集 |
| P2-002 桌面观察短期环形缓存 | done | P2-001 | 已在主进程接入 30 条内存环形缓存、摘要事件和停止清空 |
| P2-003 桌面观察摘要接入 CopilotRuntimeState | done | P2-002 | 已将前台应用、窗口标题、最近摘要和原始帧确认边界接入运行时状态 |
| P3-001 动作后统一刷新 | done | P2-003 | 已统一成功、失败、取消、工具返回后的观察刷新和时间线事件 |
| P3-002 低风险自动执行规则 | done | P3-001 | 已支持低风险工具记住授权、高风险仍确认、权限状态卡撤销 |

状态只允许使用：

```text
pending / in_progress / done / blocked / skipped
```

### 5.2 单轮执行规则

一个 Agent 循环默认只选择一个任务，除非任务验证通过且没有真实软件、权限或产品决策阻塞。继续下一任务前必须满足：

- 任务列出的自动验证已运行并记录结果。
- 修改 `companion-desktop/` 或 `local-companion/` 运行时代码后，已运行 `npm run restart:local-companion`，或记录无法重启的原因。
- 如果需要真实壳窗口、真实 Maya/Blender/Photoshop 或桌面录屏权限，自动验证先绿，人工验收可标记 `pending`。
- 不得因为全量检查存在无关失败而跳过 focused checks。
- 不得跳过 `#shell-copilot` 锚点去改项目 Agent / QuickCompose，除非任务标题明确要求项目 Agent。

### 5.3 任务执行模板

每个 Backlog 任务都按同一格式理解：

````markdown
#### P0-XXX 任务名

目标：一个用户可感知的结果。

建议文件：
- 尽量少的文件清单。

验收：
- 自动化可验证项。
- 手工可观察项。
- 明确不改变的边界。

验证：
```powershell
最小必要命令
```
````

## 6. Definition Of Done

### P0 完成定义

1. 最右侧 `Copilot codex` 面板顶部可见当前感知。
2. 感知条明确区分工作台、对象、外部连接、桌面观察、最近刷新。
3. 当前任务只有一张主任务卡，失败/重试更新同一任务。
4. 失败卡有明确恢复动作。
5. 发送前、执行后、对象切换后都会刷新感知。
6. 测试锚定真实 `#shell-copilot`，不是项目 Agent / QuickCompose。

### P1 完成定义

1. 壳级 `CopilotRuntimeState` 成为 UI 的单一只读来源。
2. 时间线事件进入环形缓存，可展开查看。
3. 确认卡引用最新感知、风险、作用范围和恢复策略。
4. 权限策略和低风险自动执行规则可见、可撤销。

### P2 完成定义

1. 桌面观察模式可显式开启、暂停、停止。
2. 用户始终能看到观察范围和录制状态。
3. 屏幕采样转成结构化摘要，默认不长期保存原始帧。
4. 隐私脱敏和本地环形缓存可验证。

## 7. Task Backlog

### P0：最右侧 Copilot 产品化闭环

#### P0-001 锚定真实 Copilot 入口

目标：建立测试和文档约束，确保后续改动挂在 `#shell-copilot`。

建议文件：
- `tests/copilotSettingsUi.test.ts`
- `docs/错题本.md`
- `docs/Copilot产品化体验优化开发文档.md`

验收：
- 测试检查 `data-shell-copilot-perception-bar`。
- 测试检查相关逻辑存在于 `companion-desktop/shell/copilot-panel.js`。
- 文档明确项目 Agent 与壳级 Copilot 的边界。

验证：

```powershell
npx vitest run tests/copilotSettingsUi.test.ts
```

#### P0-002 壳级感知条视觉产品化

目标：把当前轻量 chip 升级为可读、稳定、不被样式覆盖的顶部感知条。

建议文件：
- `companion-desktop/shell/index.html`
- `companion-desktop/shell/copilot-panel.js`

验收：
- 位于 `#shell-copilot .copilot-head` 下方。
- 展示：工作台、对象、外部连接、桌面观察、刷新时间。
- 断开/未知/stale 有警示样式。
- 不挤压消息区和输入区。

验证：

```powershell
node --check companion-desktop/shell/copilot-panel.js
npx vitest run tests/copilotSettingsUi.test.ts
npm run restart:local-companion
```

人工验收：
- 打开最右侧 Copilot，标题下方能看到感知条。
- 选中资产、打开对象会话或切换宿主状态后，感知条刷新。

#### P0-003 当前任务卡单例化

目标：同一用户目标只维护一张当前任务卡，状态更新而不是重复堆叠。

建议文件：
- `companion-desktop/shell/copilot-panel.js`
- `tests/copilotSettingsUi.test.ts`

验收：
- `startCopilotWorkTask()` 创建或复用当前任务卡。
- 失败、重试、取消、完成更新同一 `taskId`。
- 重试生成新 attempt，但仍归属同一目标。
- 普通闲聊不创建任务卡。

验证：

```powershell
node --check companion-desktop/shell/copilot-panel.js
npx vitest run tests/copilotSettingsUi.test.ts
```

#### P0-004 失败恢复卡产品化

目标：失败后显示原因和恢复动作，不只显示红字或底层错误。

建议文件：
- `companion-desktop/shell/copilot-panel.js`
- `tests/copilotSettingsUi.test.ts`

验收：
- 常见错误映射为用户可读原因。
- 恢复按钮包含：重试、查看详情、打开设置、打开连接页、只生成方案。
- 底层错误进入折叠详情。

验证：

```powershell
node --check companion-desktop/shell/copilot-panel.js
npx vitest run tests/copilotSettingsUi.test.ts
```

#### P0-005 发送前与执行后感知刷新

目标：每次发送前、工具完成后、任务失败后刷新壳级感知。

建议文件：
- `companion-desktop/shell/copilot-panel.js`
- `tests/copilotSettingsUi.test.ts`

验收：
- `sendMessage()` 发送前刷新。
- `turn_done` / `tool_status` / `error` 后刷新。
- 刷新失败时 UI 显示 stale 或读取失败，而不是静默。

验证：

```powershell
node --check companion-desktop/shell/copilot-panel.js
npx vitest run tests/copilotSettingsUi.test.ts
```

### P1：统一状态与时间线

#### P1-001 定义壳级 CopilotRuntimeState

目标：让壳级 UI 不再散读多个局部变量，而是从统一状态生成。

建议文件：
- `companion-desktop/shell/copilot-panel.js`
- 可选新增 `companion-desktop/shell/copilot-runtime-state.js`
- `tests/copilotSettingsUi.test.ts`

验收：
- 定义 `CopilotRuntimeState` 结构或 JS schema 注释。
- 有 `buildCopilotRuntimeState()`。
- 顶部感知条和任务卡从该状态渲染。

验证：

```powershell
node --check companion-desktop/shell/copilot-panel.js
npx vitest run tests/copilotSettingsUi.test.ts
```

#### P1-002 时间线环形缓存

目标：记录最近关键动作，让用户能展开“刚才发生了什么”。

建议文件：
- `companion-desktop/shell/copilot-panel.js`
- `tests/copilotSettingsUi.test.ts`

验收：
- 保留最近 50 条摘要事件。
- 不记录密钥、cookie、token、base64、原始大日志。
- UI 默认折叠，任务失败时可展开。

验证：

```powershell
node --check companion-desktop/shell/copilot-panel.js
npx vitest run tests/copilotSettingsUi.test.ts
```

#### P1-003 确认卡引用感知

目标：所有高风险确认都展示当前范围、外部连接、桌面观察、风险和 stale。

建议文件：
- `companion-desktop/shell/copilot-panel.js`
- `tests/copilotSettingsUi.test.ts`

验收：
- `confirm_required` 卡包含感知摘要。
- stale 时必须提示重新确认范围。
- 拒绝/批准写入时间线。

验证：

```powershell
node --check companion-desktop/shell/copilot-panel.js
npx vitest run tests/copilotSettingsUi.test.ts
```

### P2：桌面观察原型

#### P2-001 桌面观察权限与状态 UI

目标：先做开关、状态、权限口径，不做模型视觉识别。

建议文件：
- `companion-desktop/shell/index.html`
- `companion-desktop/shell/copilot-panel.js`
- `companion-desktop/preload-shell.cjs`
- `companion-desktop/main.cjs`
- `tests/copilotSettingsUi.test.ts`

验收：
- Copilot 顶部显示“屏幕监控未开启”。
- 用户可点击开启/暂停/停止。
- UI 显示观察范围：当前窗口 / 指定应用 / 全桌面。
- 未授权时不采集。

验证：

```powershell
node --check companion-desktop/shell/copilot-panel.js
npx vitest run tests/copilotSettingsUi.test.ts
npm run restart:local-companion
```

#### P2-002 桌面观察短期环形缓存

目标：建立本地短期缓存和摘要事件，不接入模型。

建议文件：
- `companion-desktop/main.cjs`
- `companion-desktop/preload-shell.cjs`
- `companion-desktop/shell/copilot-panel.js`
- `tests/copilotSettingsUi.test.ts`

验收：
- 最近帧只保留短期环形缓存。
- 默认不落长期文件。
- 可输出 `desktop.observe.frame` 摘要事件。
- 停止观察后清空缓存。

验证：

```powershell
node --check companion-desktop/main.cjs
node --check companion-desktop/preload-shell.cjs
node --check companion-desktop/shell/copilot-panel.js
npx vitest run tests/copilotSettingsUi.test.ts
```

#### P2-003 桌面观察摘要接入 CopilotRuntimeState

目标：把桌面观察结果作为结构化摘要进入 Copilot，而不是原始画面直塞。

建议文件：
- `companion-desktop/shell/copilot-panel.js`
- `tests/copilotSettingsUi.test.ts`

验收：
- 顶部感知显示前台应用、窗口标题、最近动作、刷新时间。
- 模型上下文只得到摘要文本。
- 原始帧进入模型前需要二次确认。

验证：

```powershell
node --check companion-desktop/shell/copilot-panel.js
npx vitest run tests/copilotSettingsUi.test.ts
```

### P3：observe-act-observe 闭环

#### P3-001 动作后统一刷新

目标：任何工具执行后都触发观察刷新和时间线事件。

验收：
- 成功、失败、取消都刷新。
- 刷新失败显示 stale。
- 下一次回复使用新摘要。

验证：

```powershell
npx vitest run tests/copilotSettingsUi.test.ts tests/agentP2L2.test.ts
```

#### P3-002 低风险自动执行规则

目标：减少确认疲劳，同时保留高风险边界。

验收：
- 低风险可记住授权。
- 高风险仍确认。
- 用户可撤销规则。

验证：

```powershell
npx vitest run tests/copilotSettingsUi.test.ts tests/agentP2.test.ts tests/agentP2L2.test.ts
```

## 8. Verification Matrix

| 范围 | 自动验证 | 人工验证 |
| --- | --- | --- |
| 壳级入口 | `npx vitest run tests/copilotSettingsUi.test.ts` | 最右侧 Copilot 标题下方可见感知条 |
| 壳层 JS | `node --check companion-desktop/shell/copilot-panel.js` | 面板可打开、发送、停止 |
| 本地伴侣运行时代码 | `npm run restart:local-companion` | 重启后新 UI 生效 |
| 项目 Agent 边界 | focused UI tests | 感知不误挂到 QuickCompose |
| 任务卡 | `tests/copilotSettingsUi.test.ts` | 失败/重试更新同一目标 |
| 桌面观察 | shell tests + 手工权限验收 | 开启/暂停/停止、状态可见 |
| 宿主连接 | shell connection tests | Maya/Blender/PS 至少一个真实软件抽样 |

## 9. Evidence Log Rules

每完成一个任务，在本文档追加：

```markdown
### YYYY-MM-DD P0-XXX 状态
- 文件：...
- 命令：...
- 结果：通过 / 失败
- 人工证据：...
- 剩余风险：...
- 下一任务：P0-YYY
```

规则：

- 不能用“看起来可以”替代验证。
- 不能用截图替代自动测试，除非任务本身是视觉/真实软件验收。
- 真实软件、权限、录屏能力缺失时，自动测试仍必须绿，人工验收标记 pending。
- 遇到无关失败，要记录失败文件、失败原因和为什么无关。

## 10. Blocked Rules

- unrelated failing check：记录失败与无关原因，继续 focused check。
- missing real software：自动测试必须绿，人工验收标记 pending。
- permission/auth required：停止并请用户提供具体动作。
- desktop capture permission missing：保留 UI 和状态测试，标记真实采集 pending。
- repeated same failure：同一阻塞连续三次后标记 blocked。
- ambiguous product decision：优先选择可见、只读、可关闭的方案；涉及默认开启录屏、自动执行或上传原始帧必须问用户。

## 11. 执行记录

### 2026-08-11 P3-002 完成
- 文件：
  - `companion-desktop/agent-types.d.ts`
  - `companion-desktop/agent-tool-schemas.cjs`
  - `companion-desktop/agent-policy.cjs`
  - `companion-desktop/agent-session/index.cjs`
  - `companion-desktop/shell/copilot-panel.js`
  - `companion-desktop/shell/index.html`
  - `tests/agentP2.test.ts`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - `node --check companion-desktop/agent-policy.cjs`
  - `node --check companion-desktop/agent-session/index.cjs`
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts tests/agentP2.test.ts tests/agentP2L2.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：策略、会话、壳层 JS 语法检查；P3-002 验证组合 3 个测试文件、58 项测试；本地伴侣重启。
- 人工证据：
  - `AgentToolSchema` 新增 `autoConfirmEligible`，当前仅 `ac.workbench.run_capability` 标记为可记住低风险授权。
  - `agent-policy.gateTool()` 只有在工具为 confirm 且 `autoConfirmEligible` 为真或命中低风险白名单时才允许 `autoConfirmTools` 自动通过。
  - 即使 `ac.usage.upload_cloud_draft` 被写入 `autoConfirmTools`，测试仍证明它保持 `confirm`。
  - 低风险确认卡新增“允许并记住”；高风险确认卡不会显示该入口。
  - 大脑/权限状态卡新增“已记住的低风险授权”列表，可逐项“撤销”。
- 剩余风险：
  - 第一批低风险记住范围故意保守，仅包含工作台轻量能力执行；更多工具必须逐个评估后再标记。
  - 真实壳窗口仍需人工抽样确认按钮布局、记住后下一次同工具不再弹确认、撤销后恢复确认。
- 下一任务：
  - 无。本文档 P0/P1/P2/P3 任务已完成，后续可另起文档进入真实桌面采集、视觉摘要模型和系统级录屏授权。

### 2026-08-11 P3-001 完成
- 文件：
  - `companion-desktop/shell/copilot-panel.js`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts tests/agentP2L2.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：壳层 JS 语法检查；Copilot UI 与 Agent P2L2 共 36 项测试；本地伴侣重启。
- 人工证据：
  - 新增 `refreshCopilotObservationAfterAction()`，统一动作后的工作台、外部连接、桌面观察状态刷新。
  - 工具 `done/error`、`tool_result`、任务完成、任务停止、任务失败都会触发统一刷新。
  - 刷新成功写入“观察已刷新”，刷新失败写入“观察刷新失败”，并让感知条进入 stale 警示。
- 剩余风险：
  - 真实工具执行后的视觉变化仍需在壳窗口中人工抽样确认。
  - P3-002 涉及记住低风险授权和撤销规则，需要单独评估默认策略。
- 下一任务：
  - P3-002 低风险自动执行规则。

### 2026-08-11 P2-003 完成
- 文件：
  - `companion-desktop/shell/copilot-panel.js`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - `node --check companion-desktop/main.cjs`
  - `node --check companion-desktop/preload-shell.cjs`
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：主进程、预加载、壳层 JS 语法检查；Copilot UI 测试 22 项；本地伴侣重启。
- 人工证据：
  - `CopilotRuntimeState` 新增 `desktopObservation` 结构化摘要。
  - 顶部桌面感知 chip 可从短期缓存摘要展示范围、前台应用、窗口标题和最近摘要。
  - `rawFrameRequiresConfirmation: true` 明确原始帧进入模型前需要二次确认。
- 剩余风险：
  - 当前未接入真实桌面图像采集和视觉模型；真实授权、前台窗口识别和屏幕摘要质量需后续任务验收。
- 下一任务：
  - P3-001 动作后统一刷新。

### 2026-08-11 P2-002 完成
- 文件：
  - `companion-desktop/main.cjs`
  - `companion-desktop/preload-shell.cjs`
  - `companion-desktop/shell/copilot-panel.js`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - `node --check companion-desktop/main.cjs`
  - `node --check companion-desktop/preload-shell.cjs`
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：主进程、预加载、壳层 JS 语法检查；Copilot UI 测试 22 项；本地伴侣重启。
- 人工证据：
  - 主进程新增 `DESKTOP_OBSERVATION_FRAME_LIMIT = 30` 的内存环形缓存。
  - 预加载桥新增 `desktopObservationStart`、`desktopObservationFrame`、`desktopObservationStatus`、`desktopObservationStop`。
  - 缓存只保留结构化摘要事件 `desktop.observe.frame`，默认不写长期文件。
  - 未授权、未开启或暂停时，写入帧会返回 `desktop_observation_not_authorized`。
  - 停止观察会清空 `desktopObservationFrames`。
- 剩余风险：
  - 当前没有真实帧输入源；缓存通道已准备好，后续接入采集时必须继续保持显式授权和可见指示。
- 下一任务：
  - P2-003 桌面观察摘要接入 CopilotRuntimeState。

### 2026-08-11 P2-001 完成
- 文件：
  - `companion-desktop/shell/index.html`
  - `companion-desktop/shell/copilot-panel.js`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：壳层 JS 语法检查、Copilot UI 测试 22 项、本地伴侣重启。
- 人工证据：
  - 真实右侧 `#shell-copilot` 内新增桌面观察权限与状态面板。
  - 顶部感知显示“屏幕监控未开启 / 待授权 / 已暂停 / 观察中”等状态。
  - 用户可选择“当前窗口 / 指定应用 / 全桌面”，并可开启、暂停、停止。
  - 可见文案明确“未授权时不采集”。
- 剩余风险：
  - 当前只做权限口径和 UI，不触发系统级录屏授权，也不采集真实桌面画面。
- 下一任务：
  - P2-002 桌面观察短期环形缓存。

### 2026-08-11 P1-003 完成
- 文件：
  - `companion-desktop/shell/copilot-panel.js`
  - `companion-desktop/shell/index.html`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：壳层 JS 语法检查、Copilot UI 测试 22 项、本地伴侣重启。
- 人工证据：
  - `confirm_required` 卡现在包含 `copilot-confirm-perception` 当前范围摘要。
  - 摘要来自 `CopilotRuntimeState`，包含工作台、对象、外部连接、桌面观察、刷新状态和风险。
  - stale 时确认卡显示“上下文可能过期，请确认范围后再继续”。
  - 批准、拒绝和确认提交失败都会写入时间线。
- 剩余风险：
  - 真实高风险工具确认需要人工触发一次，确认 UI 文案和时间线显示符合预期。
- 下一任务：
  - P2-001 桌面观察权限与状态 UI。

### 2026-08-11 P1-002 完成
- 文件：
  - `companion-desktop/shell/copilot-panel.js`
  - `companion-desktop/shell/index.html`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：壳层 JS 语法检查、Copilot UI 测试 22 项、本地伴侣重启。
- 人工证据：
  - 新增 `COPILOT_TIMELINE_LIMIT = 50` 和 `copilotTimelineEvents` 环形缓存。
  - 新增 `sanitizeTimelineText()`，对 token/cookie/secret/password/authorization、Bearer 和长 base64 做脱敏，并限制摘要长度。
  - `CopilotRuntimeState.timeline` 现在来自最近时间线事件。
  - 壳级 UI 新增 `data-shell-copilot-timeline` 折叠区，失败事件会自动展开。
- 剩余风险：
  - 当前时间线为内存态，清空对话会清空；持久化不属于 P1-002。
  - 真实壳窗口需人工确认“刚才发生”折叠区展示和失败自动展开。
- 下一任务：
  - P1-003 确认卡引用感知。

### 2026-08-11 P1-001 完成
- 文件：
  - `companion-desktop/shell/copilot-panel.js`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：壳层 JS 语法检查、Copilot UI 测试 22 项、本地伴侣重启。
- 人工证据：
  - 已新增 `CopilotRuntimeState` JS schema 注释、`buildCopilotRuntimeState()`、`buildActiveTaskState()` 和 `renderShellCopilotPerceptionBar()`。
  - 顶部感知条现在由 `CopilotRuntimeState.perception` 和 `perceptionTones` 渲染，不再在渲染函数里散读所有局部变量。
  - 当前任务卡状态会写入 `data-task-status`，可被 `activeTask` 状态读取。
- 剩余风险：
  - 时间线仍为空数组，需在 P1-002 接入最近事件环形缓存。
- 下一任务：
  - P1-002 时间线环形缓存。

### 2026-08-11 P0-005 完成
- 文件：
  - `companion-desktop/shell/copilot-panel.js`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：壳层 JS 语法检查、Copilot UI 测试 22 项、本地伴侣重启。
- 人工证据：
  - `sendMessage()` 发送前会 `await refreshShellCopilotPerceptionBar()`，确保发送前读取最新感知。
  - `tool_status`、`done`、停止和 `error` 事件后都会触发壳级感知刷新。
  - 刷新两侧来源都不可用时，顶部刷新 chip 会显示“刷新：读取失败”警示。
- 剩余风险：
  - 真实壳窗口仍需要人工确认：发送消息、工具失败、停止任务后顶部刷新时间会变化。
  - P0 是壳级产品化闭环；统一状态源、时间线和桌面观察原型仍进入 P1/P2。
- 下一任务：
  - P1-001 定义壳级 CopilotRuntimeState。

### 2026-08-11 P0-004 完成
- 文件：
  - `companion-desktop/shell/copilot-panel.js`
  - `companion-desktop/shell/index.html`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：壳层 JS 语法检查、Copilot UI 测试 22 项、本地伴侣重启。
- 人工证据：
  - `appendRecoveryCard()` 现在统一提供重试、查看详情、打开设置入口。
  - 宿主软件连接类失败会显示“宿主软件未连接”，并提供“打开连接页”和“只生成方案”。
  - 底层错误进入 `copilot-recovery-detail` 折叠详情，并对 token/cookie/secret/password/authorization 字段做脱敏。
- 剩余风险：
  - 真实宿主连接错误需要在实际 Maya/Blender/Photoshop 断开场景下人工确认按钮路径。
- 下一任务：
  - P0-005 发送前与执行后感知刷新。

### 2026-08-11 P0-003 完成
- 文件：
  - `companion-desktop/shell/copilot-panel.js`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：壳层 JS 语法检查、Copilot UI 测试 22 项、本地伴侣重启。
- 人工证据：
  - `appendTaskThreadCard()` 现在优先复用当前主任务卡，设置稳定 `data-task-id` 和 `data-task-attempt`。
  - 同一目标重试会递增 attempt，不再追加重复主任务卡；复用时会清理 `is-done` / `is-error` 并重置进度、结果和恢复行。
  - 清空对话会重置当前任务 key 和 attempt；普通 composer 闲聊仍不创建任务卡。
- 剩余风险：
  - 真实壳窗口需要人工点一次快速任务和重试，确认视觉上只保留一张当前任务卡。
- 下一任务：
  - P0-004 失败恢复卡产品化。

### 2026-08-11 P0-002 完成
- 文件：
  - `companion-desktop/shell/index.html`
  - `companion-desktop/shell/copilot-panel.js`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：壳层 JS 语法检查、Copilot UI 测试 22 项、本地伴侣重启。
- 人工证据：
  - `#shell-copilot` 标题下方的 `data-shell-copilot-perception-bar` 已包含工作台、对象、外部连接、屏幕监控、最近任务、刷新时间六类 chip。
  - 已明确显示“屏幕监控未开启”，不让用户误以为 Copilot 正在录屏观察桌面。
  - 已在靠后的壳级样式覆盖区补强 `#shell-copilot .copilot-perception-bar` 和 `.copilot-perception-chip`，降低被后续 CSS 覆盖或挤压的风险。
- 剩余风险：
  - 真实壳窗口视觉验收仍需用户打开最右侧 `Copilot codex` 确认标题下方可见感知条。
  - 当前只是桌面观察状态展示，未实现真实录屏采集；真实桌面观察仍属于 P2。
- 下一任务：
  - P0-003 当前任务卡单例化。

### 2026-08-11 文档循环化整理完成
- 文件：
  - `docs/Copilot产品化体验优化开发文档.md`
- 命令：
  - 未运行代码验证；本次只整理开发文档。
- 结果：
  - 通过：已升级到 v0.2，补充执行游标、状态枚举、单轮执行规则和任务模板。
- 人工证据：
  - 文档现在明确下一任务为 `P0-002`，并要求后续 Agent 优先锚定真实 `#shell-copilot`，不得误改项目 Agent / QuickCompose。
- 剩余风险：
  - P0-002 仍需要代码实现、自动验证和真实壳窗口人工验收。
- 下一任务：
  - P0-002 壳级感知条视觉产品化。

### 2026-08-11 P0-001 部分完成
- 文件：
  - `companion-desktop/shell/index.html`
  - `companion-desktop/shell/copilot-panel.js`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot运行时感知系统开发文档.md`
  - `docs/错题本.md`
- 命令：
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：壳层 JS 语法检查、壳层 UI 测试、本地伴侣重启。
- 人工证据：
  - 已确认真实目标入口是最右侧 `Copilot codex` / `#shell-copilot`，不是项目 Agent / QuickCompose。
  - 已新增测试锚点 `data-shell-copilot-perception-bar`。
- 剩余风险：
  - P0-002 仍需要继续做视觉产品化和真实窗口验收。
- 下一任务：
  - P0-002 壳级感知条视觉产品化。
