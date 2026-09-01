# Copilot 运行时感知系统开发文档

版本：v0.1  
状态：草案，可进入 P0 原型  
目标读者：产品、前端、架构、本地伴侣、Workflow、宿主连接器、Agent 工程  
范围：AssetCutter AI Pro 工作台 Copilot、Workflow、本地伴侣、外部宿主软件连接器

## 0. 一句话结论

Copilot 不应该只是聊天框或能力触发器，而应该有一套统一的运行时感知系统：持续知道当前项目、选中对象、Workflow 计划、外部软件状态、最近命令和 Agent 执行链路，再把这些结构化状态提供给 Planner、Executor 和 UI。

没有这层，Copilot 会像“会说话的功能菜单”；有了这层，它才像一个真正坐在用户旁边看着工作现场推进的人。

## 1. 目标

### 1.1 具体目标

建立 `Runtime Perception Layer`，让 Copilot 每次回答或执行前都能回答五个问题：

1. 当前用户在哪里工作：工作台、Workflow、Lightbox，还是外部软件。
2. 当前对象是什么：选中了哪些资产、图层、模型、文件、Workflow 步骤。
3. 当前已有计划是什么：是否已有 Workflow 规划，执行到哪一步，是否阻塞。
4. 最近发生了什么：用户操作、Agent 工具调用、外部软件命令、任务成功或失败。
5. 现在能安全做什么：当前能力清单、权限、成本、风险和需要确认的动作。

### 1.2 非目标

- P0 不做全桌面录屏级监控。
- P0 不用截图识别替代已有结构化 API。
- P0 不让模型直接读无筛选的日志或原始错误堆栈。
- P0 不绕过现有 `ac.*` / BodyHost / Workflow runtime / capability executor 权限与审计链路。
- P0 不承诺所有宿主软件都能实时返回深度选区；没有真实连接时必须明确显示未知。

## 2. 调研摘要

### 2.1 OpenAI / Anthropic Computer Use

成熟的 Computer Use 共同点是 observe-act-observe：先观察当前屏幕或 UI 状态，再执行鼠标键盘动作，动作后重新观察。启发是：Agent 每次行动后必须刷新感知，不能用旧状态连续猜。

参考：
- OpenAI Computer-Using Agent：https://openai.com/index/computer-using-agent/
- Claude computer use：https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool

### 2.2 MCP

MCP 把外部系统标准化为 resources、tools、prompts。启发是：连接外部软件时，优先暴露结构化资源、能力和工具调用结果，而不是让模型看原始 UI。

参考：
- Model Context Protocol：https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro

### 2.3 IDE 插件

VS Code 这类 IDE 不靠截图感知代码现场，而是通过 API 获取 active editor、selection、diagnostics、terminal、commands 等结构化上下文。启发是：AssetCutter 连接 Maya、Blender、Photoshop 等宿主时，也应优先定义 `getSnapshot()`、`listCapabilities()`、`executeCommand()`。

参考：
- VS Code API：https://code.visualstudio.com/api/references/vscode-api
- VS Code commands：https://code.visualstudio.com/api/extension-guides/command

### 2.4 RPA / Task Mining

UiPath 这类产品会记录桌面行为、应用使用、点击和流程，用于流程发现与自动化。启发是：事件流要能还原“刚才发生了什么”，但 Copilot 的实时感知应比流程挖掘更轻、更结构化、更可确认。

参考：
- UiPath Task Mining FAQ：https://docs.uipath.com/task-mining/automation-cloud/latest/user-guide/faq

### 2.5 Agent Runtime 框架

LangGraph、OpenAI Agents SDK、AutoGen 等框架重视状态、checkpoint、tool trace、handoff、human-in-the-loop。启发是：感知系统不仅服务模型上下文，也必须服务审计、恢复和人工确认。

参考：
- LangGraph persistence：https://docs.langchain.com/oss/python/langgraph/persistence
- LangGraph interrupts：https://docs.langchain.com/oss/python/langgraph/interrupts
- OpenAI Agents SDK tracing：https://openai.github.io/openai-agents-python/tracing/
- OpenAI Agents guide：https://developers.openai.com/api/docs/guides/agents

## 3. 产品原则

### 3.1 结构化优先，屏幕识别兜底

优先级：

1. 工作台内部状态：React/store/runtime 直接提供。
2. Workflow 状态：Workflow runtime / task events / audit events 提供。
3. 外部宿主状态：桥接插件或本地 companion API 提供。
4. 操作系统或窗口状态：只作为连接与前台判断辅助。
5. 截图/视觉识别：只用于没有结构化 API 的低可信兜底。

### 3.2 用户必须看得见 Copilot 知道什么

Copilot 右侧面板或确认弹窗应展示简短上下文摘要：

- 当前项目 / 当前工作面。
- 已选资产或外部软件选区数量。
- 已有 Workflow 计划状态。
- 外部软件连接状态。
- 关键风险：过期、未知、批量、扣费、不可撤销。

### 3.3 每次动作后重新观察

任何 Agent 动作完成后，都必须产生事件并触发 snapshot 刷新：

```text
observe -> plan -> confirm -> act -> emit event -> refresh snapshot -> summarize result
```

### 3.4 感知不等于授权

Copilot “知道”某个对象存在，不代表能自动修改它。所有可写、扣费、批量、删除、发布、外部命令动作仍要走统一 action policy、确认和 audit。

## 4. 总体架构

```text
Workbench Store / Workflow Runtime / Local Companion / Host Connectors
                         |
                         v
              Runtime Context Bus
                         |
      +------------------+------------------+
      |                  |                  |
 Runtime Snapshot   Event Stream     Capability Registry
      |                  |                  |
      +------------------+------------------+
                         |
                         v
              Copilot Context Assembler
                         |
      +------------------+------------------+
      |                  |                  |
 Planner / Router   Executor Policy     Visible Context UI
      |                  |                  |
      +------------------+------------------+
                         |
                         v
                   Trace / Audit
```

### 4.1 层级职责

| 层 | 职责 | P0 入口 |
| --- | --- | --- |
| `Runtime Context Bus` | 收集状态、事件、能力，不直接执行高风险动作 | 新增 service |
| `Runtime Snapshot` | 当前状态的只读快照 | 工作台 + Workflow + companion |
| `Event Stream` | 最近发生的关键事件 | 内存 ring buffer，后续持久化 |
| `Capability Registry` | 当前可用命令与风险等级 | 复用 `ac.*` / workflow skill / host bridge |
| `Context Assembler` | 把快照压成模型与 UI 可用上下文 | 接入 `projectAgent/contextAssembly.ts` |
| `Visible Context UI` | 展示 Copilot 当前感知 | 接入 QuickCompose / ProjectAgentDock |
| `Trace / Audit` | 记录判断、调用、结果和恢复信息 | 对齐现有 Agent trace 与 workflow audit |

## 5. 数据契约

### 5.1 RuntimePerceptionSnapshot

```ts
export type RuntimePerceptionSnapshot = {
  version: 1;
  capturedAt: number;
  freshnessMs: number;
  workspace: RuntimeWorkspaceState;
  workflow: RuntimeWorkflowState;
  externalApps: RuntimeExternalAppState[];
  capabilities: RuntimeCapability[];
  recentEvents: RuntimeEvent[];
  risks: RuntimePerceptionRisk[];
};
```

### 5.2 工作台状态

```ts
export type RuntimeWorkspaceState = {
  projectId?: string;
  projectName?: string;
  activeSurface: 'workspace' | 'canvas' | 'lightbox' | 'workflow' | 'external' | 'none';
  activeAssetId?: string;
  selectedAssetIds: string[];
  selectedAssetSummary?: string;
  activeStepId?: string;
  draftDirty?: boolean;
};
```

### 5.3 Workflow 状态

```ts
export type RuntimeWorkflowState = {
  activePlanId?: string;
  activeRunId?: string;
  currentStepId?: string;
  hasPlan: boolean;
  steps: RuntimeWorkflowStep[];
  blockers: RuntimeBlocker[];
  pendingConfirmations: RuntimePendingConfirmation[];
};

export type RuntimeWorkflowStep = {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'blocked' | 'skipped';
  artifactIds?: string[];
  taskIds?: string[];
  lastError?: string;
};
```

### 5.4 外部软件状态

```ts
export type RuntimeExternalAppState = {
  appId: string;
  name: string;
  connected: boolean;
  foreground?: boolean;
  activeDocument?: string;
  activeDocumentPath?: string;
  selection: RuntimeExternalSelection;
  currentTool?: string;
  unsavedChanges?: boolean;
  recentCommands: RuntimeExternalCommandEvent[];
  health: 'unknown' | 'ok' | 'degraded' | 'disconnected' | 'error';
  lastHeartbeatAt?: number;
};

export type RuntimeExternalSelection = {
  kind: 'none' | 'object' | 'layer' | 'mesh' | 'file' | 'timeline' | 'mixed' | 'unknown';
  count?: number;
  summary?: string;
  ids?: string[];
  stale?: boolean;
};
```

### 5.5 事件流

```ts
export type RuntimeEvent = {
  id: string;
  ts: number;
  source: 'user' | 'agent' | 'workflow' | 'external_app' | 'system';
  type: string;
  summary: string;
  entityRefs?: RuntimeEntityRef[];
  severity?: 'debug' | 'info' | 'warn' | 'error';
  correlationId?: string;
};
```

事件必须是摘要级，不放 base64、完整图片、长堆栈、密钥、cookie、绝对隐私路径。

### 5.6 能力清单

```ts
export type RuntimeCapability = {
  id: string;
  label: string;
  source: 'workbench' | 'workflow' | 'external_app' | 'companion' | 'agent';
  appId?: string;
  enabled: boolean;
  unavailableReason?: string;
  risk: 'read' | 'light' | 'cost' | 'destructive';
  targetScope?: 'current' | 'selected' | 'group' | 'all' | 'external_selection';
  requiresConfirmation: boolean;
};
```

## 6. 外部宿主连接器协议

每个宿主连接器至少实现四类能力。

### 6.1 `getSnapshot`

返回当前宿主状态，不能执行修改。

```ts
type HostConnectorGetSnapshot = () => Promise<RuntimeExternalAppState>;
```

要求：

- heartbeat 过期时 `connected=false` 或 `health='degraded'`。
- 选区未知时必须写 `selection.kind='unknown'`，不能猜。
- 文件路径可返回本机路径，但进入模型上下文前必须脱敏或摘要化。

### 6.2 `listCapabilities`

根据当前宿主状态返回可用命令。

```ts
type HostConnectorListCapabilities = (
  snapshot: RuntimeExternalAppState
) => Promise<RuntimeCapability[]>;
```

示例：

- Maya 选中 mesh：暴露检查 UV、导出 FBX、绑定材质。
- Photoshop 有活动文档：暴露读取图层、导出 PNG、应用蒙版。
- 没有选区：批量对象命令 disabled，并返回原因。

### 6.3 `executeCommand`

执行命令必须经过 policy、确认、审计。

```ts
type HostConnectorExecuteCommand = (
  commandId: string,
  args: Record<string, unknown>,
  policy: RuntimeExecutionPolicy
) => Promise<RuntimeCommandResult>;
```

要求：

- 命令执行前记录 `agent.command.requested`。
- 命令执行后记录 `external_app.command.succeeded` 或 `external_app.command.failed`。
- 执行后必须刷新宿主 snapshot。

### 6.4 `subscribeEvents`

P0 可以没有实时推送，用轮询模拟；P1 再补宿主主动事件。

```ts
type HostConnectorSubscribeEvents = (
  onEvent: (event: RuntimeEvent) => void
) => () => void;
```

## 7. Copilot 接入方式

### 7.1 Planner 输入

当前 `ProjectAgentIntent` 偏用户输入与 surface。P0 增加只读 perception 摘要，不直接把完整 snapshot 塞给模型。

```ts
export type ProjectAgentPerceptionContext = {
  visibleSummary: string;
  targetSummary: string;
  workflowSummary?: string;
  externalSummary?: string;
  recentEventSummary?: string;
  capabilitySummary?: string;
  riskSummary?: string;
  stale: boolean;
};
```

### 7.2 计划文案升级

当前计划不应只显示工具名。感知系统接入后，计划文案要变成业务计划。

例：

```text
不理想：计划：图生图
理想：我会处理当前选中的 5 张商品图，统一背景与光照，保留原图并生成新版本。
```

### 7.3 执行前确认

确认弹窗必须引用感知快照：

- 范围：当前选中 5 张资产 / Maya 当前选中 3 个 mesh。
- 影响：生成新版本 / 写入外部软件 / 覆盖原文件。
- 成本：预计消耗积分或本地计算。
- 可恢复：是否保留原始资产、是否可撤销。
- 新鲜度：snapshot 是否过期，过期则必须刷新或重新确认。

### 7.4 结果复盘

执行完成后，Copilot 应基于新 snapshot 和结果事件生成短复盘：

- 已完成什么。
- 产生了哪些资产或外部变更。
- 是否有失败或部分成功。
- 推荐下一步动作。

## 8. UI 形态

### 8.1 Copilot 顶部感知条

一行 chip，不做大卡片：

```text
工作区：护肤品主图项目 | 已选 5 张图 | Workflow：3/6 已完成 | Maya：已连接，选中 3 mesh
```

状态：

- 正常：灰色/中性。
- 有选区：高亮目标数量。
- 过期：显示“上下文可能过期”。
- 外部软件断开：显示连接修复动作。

### 8.2 “Copilot 已看到”展开面板

面向信任建立，不面向技术调试：

- 当前项目与工作面。
- 当前选择。
- Workflow 计划状态。
- 外部软件状态。
- 最近 5 条关键事件。
- 当前可用动作。

### 8.3 Workflow 计划卡

当 `workflow.hasPlan=true` 时，Copilot 不应像新对话一样重新开始，而应显示：

```text
当前已有计划：Maya FBX 导出
进度：预检完成，正在等待宿主连接
阻塞：Maya Connector 未连接
推荐：打开连接页修复 / 重试预检 / 只生成操作说明
```

### 8.4 外部软件状态卡

P0 只显示当前主宿主：

```text
Maya 已连接
活动场景：product_scene.mb
选中：3 个 mesh
最近命令：export_selection_fbx 失败，原因：目标目录不可写
```

## 9. 隐私、安全与权限

### 9.1 禁止进入模型上下文的内容

- 密钥、cookie、token。
- 原始 base64 图片或大文件内容。
- 未脱敏的完整本机路径列表。
- 原始长日志、完整堆栈。
- 用户未授权的软件窗口截图。

### 9.2 Snapshot 新鲜度

每个 snapshot 必须有 `capturedAt` 和 `freshnessMs`。默认规则：

| 动作类型 | 最大可接受新鲜度 |
| --- | --- |
| 只读回答 | 30 秒 |
| 低风险预览 | 15 秒 |
| 扣费/批量 | 5 秒 |
| 删除/覆盖/发布/外部写入 | 必须动作前刷新 |

### 9.3 权限边界

感知层只读；执行层必须走既有 BodyHost / workflow runtime / host connector policy。感知层不能直接调用外部软件写命令。

## 10. Agent Loop Protocol

后续执行本文档任务的 Agent 按以下循环工作：

1. Observe：阅读本文档、相关源文件、最新测试输出和当前 git 状态。
2. Select：选择第一个依赖已完成的 pending task。
3. Act：做满足任务的最小代码或文档改动。
4. Verify：运行任务列出的 focused checks。
5. Record：在本文档“执行记录”追加文件、命令、结果、剩余风险。
6. Continue Or Stop：绿灯则继续下一任务；遇到真实阻塞、用户指令或连续三次同类失败才停止。

## 11. Task Backlog

### P0：工作台 + Workflow 结构化感知

#### P0-001 定义感知类型契约

目标：新增 perception 类型，不接 UI，不接模型。  
建议文件：

- `types/runtimePerception.ts`
- `tests/runtimePerceptionTypes.test.ts` 或邻近类型测试

验收：

- 定义 `RuntimePerceptionSnapshot`、`RuntimeWorkspaceState`、`RuntimeWorkflowState`、`RuntimeExternalAppState`、`RuntimeEvent`、`RuntimeCapability`。
- 类型中不能包含媒体 bytes、base64、密钥字段。
- TypeScript 检查通过。

验证：

```powershell
npx tsc --noEmit
```

#### P0-002 实现 Runtime Context Bus 内存原型

目标：提供只读 snapshot 与最近事件 ring buffer。  
建议文件：

- `services/runtimePerception/contextBus.ts`
- `tests/runtimePerceptionContextBus.test.ts`

验收：

- 支持 `getSnapshot()`、`updatePartial()`、`emitEvent()`、`listRecentEvents()`。
- ring buffer 默认保留最近 100 条。
- 事件摘要长度有限制，自动剔除 base64。
- 不依赖 React。

验证：

```powershell
npx vitest run tests/runtimePerceptionContextBus.test.ts
```

#### P0-003 接入工作台状态适配器

目标：从现有工作台状态生成 `RuntimeWorkspaceState`。  
建议文件：

- `services/runtimePerception/workbenchAdapter.ts`
- `components/WorkflowSection.tsx` 只做最小注入

验收：

- 能反映 active surface、selectedAssetIds、activeAssetId、activeStepId。
- 选区变化产生 `user.selection.changed` 事件。
- 不改变现有选择行为。

验证：

```powershell
npx vitest run tests/workflowRunTaskBranch.test.ts
```

如果缺少现成 UI 测试，先补 focused pure test，再人工验证选择变化。

#### P0-004 接入 Workflow 计划状态

目标：让 perception 知道 workflow 是否已有计划、执行到哪一步。  
建议文件：

- `services/runtimePerception/workflowAdapter.ts`
- 复用 `services/workflowStepTimeline.ts`
- 复用 `services/workflowAuditEvents.ts`
- 复用 `services/workflowOverlaySnapshots.ts` 时必须阅读 `docs/工作流步骤时间线审计与Overlay快照.md`

验收：

- `workflow.hasPlan`、`steps`、`blockers`、`pendingConfirmations` 可从现有状态派生。
- 失败任务会产生 `workflow.step.failed` 事件。
- 不改变现有 workflow 执行顺序。

验证：

```powershell
npm run test:workflow-rings
```

#### P0-005 接入本地 companion / 宿主连接摘要

目标：P0 先读连接摘要，不要求所有软件深度选区。  
建议文件：

- `services/runtimePerception/externalAppAdapter.ts`
- `local-companion/src/bridges/*` 仅在必要时补只读接口

验收：

- 能输出已连接宿主、健康状态、活动文档摘要、选区摘要、最近命令。
- 未知选区必须显示 unknown。
- 断开连接时提供修复 capability。

验证：

```powershell
npx vitest run tests/shellConnectionPageUi.test.ts tests/shellWorkflowPageUi.test.ts
npm run local-companion:typecheck
```

#### P0-006 生成 Copilot 可见上下文摘要

目标：把 snapshot 压成短摘要，接入 Project Agent。  
建议文件：

- `services/runtimePerception/visibleSummary.ts`
- `services/projectAgent/contextAssembly.ts`

验收：

- 生成 `ProjectAgentPerceptionContext`。
- 摘要不超过配置长度。
- 不包含密钥、base64、长路径列表。
- 对 stale 状态有明确文案。

验证：

```powershell
npx vitest run tests/projectAgentContextAssembly.test.ts tests/runtimePerceptionContextBus.test.ts
```

若现有测试文件不存在，新增 focused test。

#### P0-007 Copilot 顶部感知条

目标：用户能看见 Copilot 当前知道什么。  
建议文件：

- `components/workflow/quickComposeChat/QuickComposePerceptionBar.tsx`
- `components/workflow/quickComposeChat/QuickComposeChatDock.tsx`

验收：

- 显示项目、选区、workflow、外部软件连接摘要。
- stale / disconnected 有状态提示。
- 不挤压输入框，不新增大面积说明文案。

验证：

```powershell
npx vitest run tests/copilotSettingsUi.test.ts
```

人工验收：

- 选中资产后打开 Copilot，顶部能看到选中数量。
- 外部宿主断开时显示断开而不是假装已连接。

#### P0-008 Planner 业务计划文案升级

目标：计划不再只显示工具名，而是引用感知上下文。  
建议文件：

- `services/projectAgent/planTemplate.ts`
- `services/projectAgent/planner.ts`

验收：

- 有选中 5 张图时，计划文案包含范围和目标。
- 有 Workflow active plan 时，不重新开始，先说明当前计划状态。
- 缺少对象时返回澄清，而不是直接执行。

验证：

```powershell
npx vitest run tests/agentP2.test.ts tests/agentP2L2.test.ts
```

### P1：外部软件实时事件与命令审计

#### P1-001 标准化 Host Connector Snapshot API

目标：每个宿主连接器有统一 `getSnapshot()`。  
验收：

- Maya 样板返回选区、活动文件、当前工具或 unknown。
- Photoshop / Blender 等可先返回健康状态与活动文档摘要。
- heartbeat 过期不算 connected。

#### P1-002 标准化 Host Connector Capability API

目标：能力清单由当前宿主状态派生。  
验收：

- 没有选区时禁用对象级命令。
- 不可写路径时禁用导出命令并给原因。
- capability risk 与 action policy 对齐。

#### P1-003 命令事件链路

目标：所有宿主命令进入统一事件流和 trace。
验收：

- request / started / succeeded / failed / refreshed 五类事件可追溯。
- failure 能生成 RepairAction 或恢复建议。

#### P1-004 本地壳级 Copilot 感知条

目标：感知条必须挂在本地伴侣右侧 `Copilot codex` 面板本身，而不是只挂在工作台项目 Agent、QuickCompose 或内部 Dock。

验收：

- `#shell-copilot` 标题下方常驻显示当前工作台、对象会话、外部宿主连接和最近执行摘要。
- 本地壳启动时刷新一次，之后按固定间隔刷新；发送消息和切换对象会话时立即刷新。
- 断开、未知、过期状态用明确提示，不伪装成已知。
- 测试必须锚定 `data-shell-copilot-perception-bar`，防止误挂回网页内部 Dock。

#### P1-005 全桌面录屏监控原型

目标：在用户显式开启后，提供全桌面观察能力，作为结构化 API 不足时的兜底感知来源。

验收：

- 必须有显式开关、录制中状态、暂停/停止入口和作用范围提示。
- 默认不采集；未授权时 Copilot 明确显示“屏幕监控未开启”。
- 采集结果先转成结构化摘要：前台应用、窗口标题、粗粒度 UI 区域、最近动作，不把原始截图长期进入模型上下文。
- 原始帧只短期环形缓存，默认本地保存，上传或进入模型前必须脱敏并二次确认。
- 与 `Runtime Context Bus` 对齐，输出 `desktop.observe.frame`、`desktop.window.changed`、`desktop.input.activity` 等摘要事件。

### P2：跨应用计划与恢复

#### P2-001 Workflow Plan State 持久化

目标：Copilot 重新打开后知道已有计划。  
验收：

- active plan、step status、artifact refs 可恢复。
- 过期计划显示 stale，不能直接继续 destructive 动作。

#### P2-002 跨软件任务编排

目标：支持“工作台生成贴图 -> Maya 绑定材质 -> 导出预览”的连续计划。  
验收：

- 每一步都有输入、输出、阻塞和恢复动作。
- 外部软件断开时停在可恢复状态，不丢上下文。

## 12. Verification Matrix

| 范围 | 自动验证 | 人工验证 |
| --- | --- | --- |
| 类型契约 | `npx tsc --noEmit` | 无 |
| Context Bus | `npx vitest run tests/runtimePerceptionContextBus.test.ts` | 无 |
| 工作台选区 | focused unit/UI test | 选中资产后感知条刷新 |
| Workflow 状态 | `npm run test:workflow-rings` | 失败步骤能显示阻塞 |
| 外部宿主摘要 | companion typecheck + shell tests | Maya/Blender/PS 至少一个真实软件 |
| Copilot UI | chat dock / settings UI tests | 感知条不挤压输入框 |
| Planner 文案 | agent P2 tests | 计划包含范围、对象、原因 |

## 13. Evidence Log Rules

每完成一个任务，在本节追加：

```markdown
### YYYY-MM-DD P0-XXX 状态

- 文件：...
- 命令：...
- 结果：通过 / 失败
- 人工证据：...
- 剩余风险：...
- 下一任务：P0-YYY
```

不能用“看起来可以”替代验证；不能用截图或本地日志替代自动测试，除非任务本身必须真实软件验收。

## 14. Blocked Rules

- unrelated failing check：记录失败与无关原因，继续 focused check。
- missing real software：自动测试必须绿，人工验收标记 pending。
- permission/auth required：停止并请用户提供具体动作。
- repeated same failure：同一阻塞连续三次后标记 blocked。
- ambiguous product decision：保守选择只读或需要确认；涉及自动执行策略必须问用户。

## 15. P0 完成定义

P0 完成时，用户应该能看到：

1. Copilot 顶部明确显示当前项目、选区、Workflow 状态和外部宿主连接摘要。
2. Copilot 计划文案能引用当前对象，而不是只显示工具名。
3. Workflow 已有计划时，Copilot 会继续围绕当前计划说话。
4. 外部宿主断开或选区未知时，Copilot 不假装知道。
5. 批量、扣费、外部写入动作会基于最新 snapshot 做确认。
6. 每次执行后 recent events 与 snapshot 都会刷新。

## 16. 执行记录

### 2026-08-10 P0-001 至 P0-008 完成
- 文件：
  - `types/runtimePerception.ts`
  - `services/runtimePerception/contextBus.ts`
  - `services/runtimePerception/sanitize.ts`
  - `services/runtimePerception/workbenchAdapter.ts`
  - `services/runtimePerception/workflowAdapter.ts`
  - `services/runtimePerception/externalAppAdapter.ts`
  - `services/runtimePerception/connectionPackageClient.ts`
  - `services/runtimePerception/visibleSummary.ts`
  - `services/projectAgent/intent.ts`
  - `services/projectAgent/runtime.ts`
  - `services/projectAgent/planTemplate.ts`
  - `components/workflow/quickComposeChat/QuickComposePerceptionBar.tsx`
  - `components/workflow/quickComposeChat/QuickComposeChatDock.tsx`
  - `components/workflow/quickComposeChat/chatUiCopy.ts`
  - `components/WorkspaceQuickComposeBar.tsx`
  - `components/WorkflowSection.tsx`
  - `tests/runtimePerceptionContextBus.test.ts`
  - `tests/runtimePerceptionTypes.test.ts`
  - `tests/runtimePerceptionExternalAppAdapter.test.ts`
  - `tests/projectAgentPerceptionPlanTemplate.test.ts`
  - `tests/projectAgentChatUiPolish.test.ts`
  - `tests/quickComposeChatDockSkillRegistry.test.tsx`
- 命令：
  - `npx vitest run tests/runtimePerceptionContextBus.test.ts tests/runtimePerceptionTypes.test.ts tests/runtimePerceptionExternalAppAdapter.test.ts tests/projectAgentPerceptionPlanTemplate.test.ts tests/projectAgentChatUiPolish.test.ts tests/quickComposeChatDockSkillRegistry.test.tsx`
  - `npx vitest run tests/projectAgentChatUiPolish.test.ts tests/runtimePerceptionContextBus.test.ts tests/runtimePerceptionExternalAppAdapter.test.ts tests/projectAgentPerceptionPlanTemplate.test.ts`
  - `npx vitest run tests/workflowRunTaskBranch.test.ts tests/workflowAuditAndOverlaySnapshots.test.ts tests/agentP2L2.test.ts`
  - `npx vitest run tests/shellConnectionPageUi.test.ts tests/shellWorkflowPageUi.test.ts`
  - `npm run local-companion:typecheck`
  - `npx tsc --noEmit --pretty false --skipLibCheck --jsx react-jsx --moduleResolution bundler --module ESNext --target ES2022 --lib ES2022,DOM,DOM.Iterable --types node services/runtimePerception/externalAppAdapter.ts services/runtimePerception/connectionPackageClient.ts tests/runtimePerceptionExternalAppAdapter.test.ts`
  - `npx tsc --noEmit --pretty false --skipLibCheck --jsx react-jsx --moduleResolution bundler --module ESNext --target ES2022 --lib ES2022,DOM,DOM.Iterable --types node components/workflow/quickComposeChat/chatUiCopy.ts tests/projectAgentChatUiPolish.test.ts services/runtimePerception/externalAppAdapter.ts services/runtimePerception/connectionPackageClient.ts`
  - `npx tsc --noEmit --pretty false --skipLibCheck --jsx react-jsx --moduleResolution bundler --module ESNext --target ES2022 --lib ES2022,DOM,DOM.Iterable --types node components/WorkflowSection.tsx services/runtimePerception/externalAppAdapter.ts services/runtimePerception/connectionPackageClient.ts`
  - `npx vitest run tests/agentP2.test.ts tests/agentP2L2.test.ts`
- 结果：
  - 通过：Runtime Perception 类型、Context Bus、外部连接摘要、Planner 感知文案、QuickCompose 感知条、执行前确认感知文案、Workflow 分支、Workflow audit/overlay、Agent P2L2、连接页 UI、Workflow 页 UI、local companion typecheck、新增文件窄类型检查。
  - 未通过但判定为无关：`tests/agentP2.test.ts` 中 `ALL_TOOL_SCHEMAS` 期望 59、实际 61；该断言来自当前工具总数漂移，不由 Runtime Perception 改动引入。
  - 未通过但判定为无关：包含 `components/WorkflowSection.tsx` 的窄编译被既有 Storyboard、ImportMeta、union narrowing 等错误挡住；输出未出现本次新增 `services/runtimePerception/*` 的错误。
- 人工证据：
  - Copilot 侧栏现在接入一行 `QuickComposePerceptionBar`，展示项目/工作面、选区、Workflow、外部连接、风险和 stale。
  - WorkflowSection 在打开 Copilot 时读取本机 companion 的 capability packages，只读生成外部软件连接摘要；连接断开或选区未知时不会伪装成已知。
  - Planner 文案通过 `ProjectAgentIntent.perception` 引用当前对象和 Workflow 状态。
  - 批量、扣费、破坏性或外部写入动作执行前，`WorkflowSection` 会重新构建最新 perception，并由 `chatUiCopy.ts` 在确认文案中展示作用范围、Workflow、外部连接、风险和 stale 提示。
- 剩余风险：
  - P0 已完成结构化只读感知；真实 Maya/Blender/Photoshop 深度选区仍属于 P1 `HostConnector.getSnapshot()` 范围，需要各宿主桥接器继续提供更细的结构化 selection/document/tool。
  - 仓库全量 `npm run typecheck` 仍受既有无关错误影响，本次记录使用 focused checks 和 local companion typecheck 作为证据。
- 下一任务：
  - P1-004 本地壳级 Copilot 感知条。

### 2026-08-11 P1-004 壳级 Copilot 感知条补齐
- 文件：
  - `companion-desktop/shell/index.html`
  - `companion-desktop/shell/copilot-panel.js`
  - `tests/copilotSettingsUi.test.ts`
  - `docs/Copilot运行时感知系统开发文档.md`
- 命令：
  - `node --check companion-desktop/shell/copilot-panel.js`
  - `npx vitest run tests/copilotSettingsUi.test.ts`
  - `npm run restart:local-companion`
- 结果：
  - 通过：壳层 JS 语法检查、Copilot 设置/壳层 UI 测试、本地伴侣重启。
- 人工证据：
  - `#shell-copilot` 标题下方新增 `data-shell-copilot-perception-bar`，展示工作台、对象、外部宿主连接、最近执行四类感知 chip。
  - 感知条启动时刷新，之后每 15 秒刷新；发送消息前、对象会话切换时也会刷新。
- 剩余风险：
  - 当前仍是结构化摘要感知；全桌面录屏监控已列为 P1-005，需要单独实现权限、采样、脱敏、短期环形缓存和可见开关。
- 下一任务：
  - P1-005 全桌面录屏监控原型。
