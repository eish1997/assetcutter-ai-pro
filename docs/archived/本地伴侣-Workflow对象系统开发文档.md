# 本地伴侣 Workflow 对象系统开发文档

版本：v0.4  
日期：2026-08-11  
目标读者：AI Agent、产品、前端、本地伴侣运行时、连接页开发者

## 0. Agent 读取顺序

每个 AI Agent 开始开发前，按顺序读取：

1. 本文档。
2. `docs/本地伴侣-Workflow最终形态与MVP计划.md`。
3. `AGENTS.md`。
4. 当前任务涉及的源码、测试和最近执行记录。

本文档负责 Workflow 的“对象化系统”：一次性执行、保存、持续修改、固定、版本、修复和长期复用。

## 0.1 当前执行指针

当前阶段：P2-P4 已完成。

当前推荐任务：无；进入整体回归、真实 Maya 验收或下一阶段规划。

下一步选择规则：

1. 先看第 10 节任务状态表。
2. 选择第一个 `pending` 且依赖已完成的任务。
3. 如果任务状态是 `manual_pending`，只补真实软件或人工验收，不扩大代码范围。
4. 如果任务状态是 `blocked`，只有阻塞条件解除后才继续该任务。
5. 如果发现文档状态和代码事实不一致，先更新执行记录，再决定是否继续。

## 0.2 快速执行索引

AI Agent 每轮只需要按这个顺序执行：

1. 读取第 0 节到第 3 节，确认命名、边界和约束。
2. 读取第 10 节，选出本轮任务。
3. 读取第 11 节对应任务卡，只按任务卡允许范围修改。
4. 按第 12 节运行最小验证。
5. 按第 14 节追加执行记录。
6. 回到第 10 节更新任务状态和下一步。

## 0.3 本轮工作边界

每一轮 Agent 开发必须遵守：

- 只修改任务卡“建议文件”中的文件；如必须修改其它文件，要在执行记录写明原因。
- 优先补类型、存储、API、测试，再补 UI。
- 修改 `companion-desktop/` 或 `local-companion/` 运行时代码后，完成本轮验证时重启本地伴侣。
- 文档-only 改动不需要重启。
- 不回滚、不格式化、不顺手整理无关文件。
- 不把旧 `script_hub` 内部兼容 ID 当成用户新入口。
- 连接页未完成时，只使用连接摘要、连接 ID、连接健康状态和 RepairAction 的占位契约。

## 1. 目标

把 Workflow 从“一个可运行页面”升级为“用户可以长期维护的本机生产流程系统”。

用户最终可以：

- 临时执行一次操作，不污染工作流库。
- 把成功的一次操作保存为可复用工作流。
- 新建工作流草稿，并通过真实软件验收。
- 持续修改某个工作流，每次修改形成可追溯版本。
- 把常用工作流固定到首页、项目、连接或对象。
- 工作流失败时进入修复模式，而不是只看到报错。
- 从历史运行复用参数，但必须重新 preflight。
- 区分“这次修一下”和“更新长期工作流”。

## 2. 非目标

当前阶段不要做：

- 复杂节点编辑器。
- 脚本市场或工具商城。
- 把所有旧 `script_hub` 内部 ID 一次性重命名。
- 在 Workflow 页面复制连接页完整配置能力。
- 让一次性操作自动进入团队共享库。
- 没有真实验收就把工作流标记为稳定可用。

## 3. 当前约束

- 用户侧正式命名为 Workflow / 工作流。
- 旧 `script_hub` 字段、工具名、API target 可作为兼容层存在，但不能作为新用户入口。
- 连接页还在开发中，Workflow 只能复用连接摘要和 RepairAction，不维护第二套连接状态源。
- 修改 `companion-desktop/` 或 `local-companion/` 运行时代码后，按仓库规则执行 `npm run restart:local-companion`。
- 工作区可能有大量无关未提交改动，不要回滚无关文件。
- 一次性执行和长期工作流必须数据隔离，不能把临时运行自动变成固定资产。

## 4. 核心概念

### 4.1 一次性操作 TemporaryRun

用户通过对话或快捷入口临时执行一次操作。

特点：

- 可以不命名。
- 可以没有 WorkflowDefinition。
- 必须有 RunHistory。
- 可以保存为工作流草稿。
- 默认不出现在工作流库。

典型例子：

```text
帮我把 Maya 当前选中的对象导出 FBX。
```

### 4.2 工作流草稿 WorkflowDraft

用户决定长期复用时创建。

来源：

- 从一句话创建。
- 从一次成功运行保存。
- 从现有工作流复制。
- 从失败修复后的运行另存。

特点：

- 可以编辑。
- 可以试运行。
- 不默认固定。
- 不默认发布为稳定版本。

### 4.3 稳定工作流 WorkflowDefinition

通过验收后进入工作流库。

必须包含：

- 稳定 ID。
- 名称。
- 当前默认版本。
- 参数 schema。
- 连接依赖。
- 运行前检查。
- 修复动作。
- 输出产物契约。
- 验收状态。

### 4.4 工作流版本 WorkflowVersion

每次影响行为的修改都生成版本。

版本必须记录：

- 版本号。
- 来源版本。
- 变更摘要。
- 参数 schema。
- 连接依赖。
- 运行步骤或执行器引用。
- 验收证据。
- 是否为默认版本。

运行记录必须绑定版本，不能只绑定工作流 ID。

### 4.5 固定项 WorkflowPin

固定项是引用，不是复制。

固定位置：

- 首页。
- 项目。
- 连接页。
- 对象或资产。
- 工作区快捷区。

固定项必须记录：

- pin id。
- workflow id。
- version policy：使用默认版本或锁定某版本。
- scope：home、project、connection、object、workspace。
- scope id。
- 排序。

### 4.6 修复会话 WorkflowRepairSession

工作流失败后进入修复模式。

修复会话必须区分：

- 只修复这次运行。
- 更新当前草稿。
- 生成新版本。
- 回滚到上个稳定版本。

## 5. 用户流程

### 5.1 一次性执行

```text
用户发起临时请求
-> 系统生成 TemporaryRun
-> preflight
-> 执行
-> 成功展示 Artifact
-> 提示“保存为工作流”
```

完成标准：

- 临时运行不进入工作流库。
- 用户可从结果保存草稿。
- 保存草稿会带入参数、依赖、产物契约和 replay snapshot。

### 5.2 新增工作流

入口必须支持三种：

1. 对话新建。
2. 从一次运行保存。
3. 从已有工作流复制。

新建后进入 WorkflowDraft，而不是直接进入稳定库。

完成标准：

- 草稿可命名。
- 草稿可编辑输入项。
- 草稿可试运行。
- 草稿未验收时显示“草稿 / 未验证”。

### 5.3 持续修改工作流

```text
打开工作流详情
-> 创建编辑草稿
-> 修改参数/依赖/输出/步骤
-> 试运行
-> 对比上一版本
-> 发布为默认版本或放弃
```

完成标准：

- 修改不会破坏当前稳定版本。
- 发布前必须试运行。
- 运行历史仍能显示当时使用的版本。
- 可以回滚默认版本。

### 5.4 固定工作流

```text
用户点击固定
-> 选择固定位置
-> 选择跟随默认版本或锁定当前版本
-> 固定入口出现
-> 固定入口显示最近状态和连接状态
```

完成标准：

- 固定项不是复制工作流。
- 取消固定不删除工作流。
- 固定项可以一键运行。
- 固定项能显示连接异常和最近失败。

### 5.5 失败修复

失败后展示：

- 失败步骤。
- 失败原因。
- 当前输入。
- 当前连接状态。
- 产物状态。
- RepairAction。
- “只修复这次”。
- “保存为新版本”。
- “回滚默认版本”。

完成标准：

- 修复动作可执行或明确降级为文本。
- 修复后必须重新 preflight。
- 修复成功后用户决定是否更新长期工作流。

## 6. 数据模型草案

### 6.1 WorkflowRun

```ts
type WorkflowRun = {
  id: string;
  workflowId?: string;
  workflowVersionId?: string;
  temporary: boolean;
  status: 'queued' | 'preflight_failed' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  normalizedInput: Record<string, unknown>;
  preflightResults: WorkflowPreflightResult[];
  repairActions: WorkflowRepairAction[];
  artifacts: WorkflowArtifact[];
  replaySnapshot: WorkflowReplaySnapshot;
  reusedFromRunId?: string;
  savedAsDraftId?: string;
};
```

### 6.2 WorkflowDraft

```ts
type WorkflowDraft = {
  id: string;
  source:
    | { kind: 'conversation'; messageId?: string }
    | { kind: 'run'; runId: string }
    | { kind: 'workflow'; workflowId: string; versionId?: string };
  name: string;
  status: 'draft' | 'ready_for_validation' | 'validated' | 'blocked';
  definition: WorkflowDefinitionDraft;
  latestTestRunId?: string;
  createdAt: string;
  updatedAt: string;
};
```

### 6.3 WorkflowDefinition

```ts
type WorkflowDefinition = {
  id: string;
  name: string;
  description?: string;
  currentVersionId: string;
  lifecycle: 'draft' | 'validated' | 'deprecated' | 'archived';
  tags: string[];
  requiredConnectors: WorkflowConnectorRequirement[];
  createdAt: string;
  updatedAt: string;
};
```

### 6.4 WorkflowVersion

```ts
type WorkflowVersion = {
  id: string;
  workflowId: string;
  semver: string;
  sourceVersionId?: string;
  changeSummary: string;
  inputSchema: Record<string, unknown>;
  executorRef: {
    kind: 'local_companion' | 'tool_bridge' | 'agent_plan';
    id: string;
  };
  artifactContract: Record<string, unknown>;
  validation: {
    status: 'unvalidated' | 'fixture_validated' | 'real_software_validated';
    evidence: Array<Record<string, unknown>>;
  };
  createdAt: string;
};
```

### 6.5 WorkflowPin

```ts
type WorkflowPin = {
  id: string;
  workflowId: string;
  versionPolicy:
    | { kind: 'follow_default' }
    | { kind: 'locked'; versionId: string };
  scope:
    | { kind: 'home' }
    | { kind: 'project'; projectId: string }
    | { kind: 'connection'; connectionId: string }
    | { kind: 'object'; objectId: string }
    | { kind: 'workspace'; workspaceId: string };
  sortOrder: number;
  createdAt: string;
};
```

## 7. UI 信息架构

### 7.1 Workflow 首页

区域：

- 固定工作流。
- 最近运行。
- 工作流库。
- 草稿。
- 失败待处理。

不要把一次性运行混入工作流库。

### 7.2 工作流详情页

区域：

- 名称、状态、当前版本。
- 连接依赖。
- 参数。
- 运行前检查。
- 最近运行。
- 产物。
- 版本历史。
- 固定位置。
- 修复记录。

### 7.3 运行结果页或面板

区域：

- 本次输入。
- 本次版本。
- 步骤状态。
- 失败原因。
- 修复动作。
- 产物。
- 保存为工作流。
- 复用本次参数。

## 8. Agent 循环协议

每轮开发必须执行：

1. Observe：读取本文档、当前任务源码、测试和最近执行记录。
2. Select：选择第一个 pending 且依赖完成的任务。
3. Scope：列出本轮允许修改的文件。
4. Act：做最小改动。
5. Verify：运行任务指定检查。
6. Record：追加执行记录。
7. Continue Or Stop：通过则继续；遇到真实阻塞、用户指令或完成定义才停止。

### 8.1 Observe 输入

每轮至少读取：

- 本文档第 0 节、第 3 节、第 10 节、第 11 节对应任务卡、第 15 节最近执行记录。
- 当前任务卡列出的建议文件。
- 当前任务卡列出的测试文件。
- 如果任务涉及 Workflow AI dispatch、运行分支或 provider 选择，读取 `AGENTS.md` 中 Workflow AI Routing 规则。
- 如果任务涉及运行历史、时间线、overlay 或审计，读取 `AGENTS.md` 中 Workflow Timeline 规则。

### 8.2 Select 规则

任务选择必须满足：

- 状态是 `pending`。
- 依赖任务都是 `done`，或依赖项是明确的外部 MVP 且执行记录说明已完成。
- 当前任务的验证命令可在本机运行；真实软件验收可以标记为 `manual_pending`。

不要跳到后续任务，除非前置任务被标记为 `blocked` 且文档明确允许并行推进。

### 8.3 Scope 输出

动手前，Agent 必须在工作说明里明确：

- 本轮任务 ID。
- 本轮目标。
- 允许修改的文件或目录。
- 本轮明确不做的内容。
- 本轮验证命令。

如果实际修改范围超出任务卡，执行记录必须写明原因和影响。

### 8.4 Act 规则

实现时遵守：

- 先写或调整能失败的测试，再实现。
- 优先使用现有 store、HTTP handler、UI 渲染和测试模式。
- 数据模型先保证可迁移、可默认空状态、可兼容旧 run。
- UI 只展示当前任务需要的状态，不提前做复杂编辑器。
- 连接相关能力只引用连接页状态源，不复制一套连接配置。

### 8.5 Verify 规则

验证顺序：

1. 运行任务卡的最小检查。
2. 如果改了 `local-companion/`，运行本地伴侣类型检查。
3. 如果改了 `companion-desktop/` 脚本，运行对应 `node --check`。
4. 如果改了运行时代码，执行 `npm run restart:local-companion`。
5. 如果需要 Maya 真实验收但本机无法完成，自动化检查通过后把任务标记为 `manual_pending`，并写清缺少的真实证据。

无关检查失败时，不把任务标记为失败；必须记录失败命令、失败摘要、为什么无关、当前任务的 focused check 是否通过。

### 8.6 Record 规则

每轮结束必须更新：

- 第 10 节任务状态表。
- 第 15 节执行记录。
- 如果任务改变了长期架构、目录约定或交接上下文，同时更新 `docs/交接文档.md`。
- 如果发现可复用 bug/fix，同时更新 `docs/错题本.md`。

执行记录不能只写“已完成”，必须包含文件、验证、残余风险和下一步。

### 8.7 Stop 规则

只有以下情况可以停止循环：

- 当前选中任务完成，并且用户只要求整理或执行这一项。
- 所有任务都已 `done` 或 `manual_pending`。
- 缺少权限、登录、真实软件操作或用户必须亲自确认的产品决策。
- 同一阻塞连续三轮出现，任务已标记 `blocked` 并记录证据。
- 用户明确要求停止、暂停或改变方向。

## 8.8 任务卡字段规范

第 11 节每个任务卡必须包含：

- 状态：只允许 `pending`、`in_progress`、`done`、`blocked`、`manual_pending`。
- 依赖：写任务 ID 或外部条件。
- 目标：一个可验收结果。
- 建议文件：优先修改范围。
- 不要改：防止扩大范围。
- 验收：用户或测试能观察到的结果。
- 检查：本轮必须运行的命令或手工证据。
- 记录要求：若任务有特殊证据，必须写在执行记录。

如果任务需要改超过 5 个文件或包含 3 个以上互不相关行为，先拆分任务卡，不直接实现。

## 9. 完成定义

### P2 完成定义：对象化基础

- 一次性运行和长期工作流可区分。
- 可以从成功运行保存草稿。
- 工作流运行记录绑定版本。
- 工作流详情能显示草稿、稳定、未验证状态。
- 自动化测试覆盖数据模型和 API。

### P3 完成定义：版本与修复

- 修改工作流生成新版本或编辑草稿。
- 可试运行编辑草稿。
- 可把新版本设为默认。
- 可回滚默认版本。
- 失败运行可进入修复会话。

### P4 完成定义：固定与长期复用

- 可固定工作流到至少 home 和 connection 两个 scope。
- 固定项可选择跟随默认版本或锁定版本。
- 固定项显示最近状态和连接摘要。
- 取消固定不删除工作流。

## 10. 任务状态表

| 任务 | 状态 | 依赖 | 下一步 |
| --- | --- | --- | --- |
| P2-001 Workflow 对象模型与存储契约 | done | Maya MVP 完成 | 已定义类型和持久化入口 |
| P2-002 TemporaryRun 与保存草稿 | done | P2-001 | 已支持从成功运行保存草稿 |
| P2-003 WorkflowDraft API | done | P2-001 | 已支持新建、读取、更新、归档草稿 |
| P2-004 工作流详情 UI 基础 | done | P2-003 | 已展示状态、依赖、历史和草稿 |
| P3-001 WorkflowVersion 存储与运行绑定 | done | P2-003 | 新运行历史已绑定 version |
| P3-002 编辑草稿与试运行 | done | P3-001 | 草稿可试运行且不破坏稳定版 |
| P3-003 发布默认版本与回滚 | done | P3-002 | 已支持默认版本切换 |
| P3-004 修复会话 | done | P3-001 | 失败后可创建修复会话 |
| P4-001 WorkflowPin 存储与 API | done | P3-003 | 已支持固定引用模型 |
| P4-002 固定入口 UI | done | P4-001 | 首页和连接 scope 已显示固定入口 |
| P4-003 固定项运行与状态摘要 | done | P4-002 | 固定项可运行并显示健康状态 |

状态值只允许：

- `pending`
- `in_progress`
- `done`
- `blocked`
- `manual_pending`

状态更新规则：

- 开始实现任务前，把该任务从 `pending` 改为 `in_progress`。
- 自动化验收全部通过后，改为 `done`。
- 自动化通过但缺少真实 Maya、真实连接或人工 UI 证据时，改为 `manual_pending`。
- 任务因外部权限、产品决策或连续三轮同一错误无法推进时，改为 `blocked`。
- 标记 `done`、`manual_pending` 或 `blocked` 时，必须同步追加第 15 节执行记录。
- “下一步”列永远写一个具体动作，不写泛泛的“继续开发”。

## 11. Backlog

### P2-001：Workflow 对象模型与存储契约

状态：done

依赖：Maya MVP 完成。

目标：定义 WorkflowDefinition、WorkflowDraft、WorkflowVersion、WorkflowPin 的类型和本地存储边界。

建议文件：

- `local-companion/src/workflows/`
- `local-companion/src/capabilities/`
- `tests/localCompanionWorkflowRuntime.test.ts`

不要改：

- 不重命名旧 `script_hub` 兼容工具。
- 不改 UI。

验收：

- 类型可表达一次性运行、草稿、稳定工作流、版本和固定项。
- 有测试验证临时 run 不等于 workflow definition。
- 有迁移或默认空存储策略。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts`
- `npm run local-companion:typecheck`

### P2-002：TemporaryRun 与保存草稿

状态：done

依赖：P2-001

目标：一次性运行成功后可以保存为 WorkflowDraft。

建议文件：

- `local-companion/src/workflows/`
- `local-companion/src/httpHandler.ts`
- `companion-desktop/shell/workflow-page.js`
- `tests/localCompanionWorkflowRuntime.test.ts`
- `tests/shellWorkflowPageUi.test.ts`

不要改：

- 不把所有 run 自动保存为草稿。
- 不把草稿标为 validated。

验收：

- 成功 run 出现“保存为工作流”动作。
- 保存后生成 WorkflowDraft。
- WorkflowRun 写入 `savedAsDraftId`。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`
- `node --check companion-desktop/shell/workflow-page.js`

### P2-003：WorkflowDraft API

状态：done

依赖：P2-001

目标：提供草稿的创建、读取、更新、删除或归档 API。

建议文件：

- `local-companion/src/workflows/`
- `local-companion/src/httpHandler.ts`
- `tests/localCompanionWorkflowRuntime.test.ts`

不要改：

- 不做复杂版本发布。
- 不做固定。

验收：

- API 可创建草稿。
- API 可更新名称、参数 schema、依赖和描述。
- 删除优先归档，不物理删除运行历史。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts`
- `npm run local-companion:typecheck`

### P2-004：工作流详情 UI 基础

状态：done

依赖：P2-003

目标：Workflow 页面可以进入详情，展示状态、依赖、参数、历史和草稿信息。

建议文件：

- `companion-desktop/shell/workflow-page.js`
- `companion-desktop/shell/index.html`
- `tests/shellWorkflowPageUi.test.ts`

不要改：

- 不做节点编辑器。
- 不复制连接页配置 UI。

验收：

- 工作流卡可打开详情。
- 详情展示 draft / validated / blocked。
- 详情展示最近 run 和 connector 摘要。

检查：

- `npx vitest run tests/shellWorkflowPageUi.test.ts`
- `node --check companion-desktop/shell/workflow-page.js`

### P3-001：WorkflowVersion 存储与运行绑定

状态：done

依赖：P2-003

目标：每次运行绑定 workflow version。

建议文件：

- `local-companion/src/workflows/`
- `tests/localCompanionWorkflowRuntime.test.ts`

不要改：

- 不改变旧历史读取兼容。

验收：

- 新 run 写入 `workflowVersionId`。
- 旧 run 没有 version 时能降级显示。
- 运行历史能按版本追溯。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts`
- `npm run local-companion:typecheck`

### P3-002：编辑草稿与试运行

状态：done

依赖：P3-001

目标：修改工作流时创建编辑草稿，试运行不影响稳定版本。

建议文件：

- `local-companion/src/workflows/`
- `companion-desktop/shell/workflow-page.js`
- `tests/localCompanionWorkflowRuntime.test.ts`
- `tests/shellWorkflowPageUi.test.ts`

不要改：

- 不让编辑中的草稿成为默认版本。

验收：

- 用户可修改参数默认值或输出规则。
- 试运行使用草稿定义。
- 稳定版本仍可运行。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`

### P3-003：发布默认版本与回滚

状态：done

依赖：P3-002

目标：试运行通过后可发布为默认版本，也可回滚。

建议文件：

- `local-companion/src/workflows/`
- `companion-desktop/shell/workflow-page.js`
- `tests/localCompanionWorkflowRuntime.test.ts`
- `tests/shellWorkflowPageUi.test.ts`

不要改：

- 不允许未试运行版本直接标稳定。

验收：

- 发布会创建 WorkflowVersion。
- `currentVersionId` 更新。
- 旧版本保留。
- 回滚会切回旧版本。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`

### P3-004：修复会话

状态：done

依赖：P3-001

目标：失败 run 可进入 WorkflowRepairSession，并决定修复范围。

建议文件：

- `local-companion/src/workflows/`
- `companion-desktop/shell/workflow-page.js`
- `tests/localCompanionWorkflowRuntime.test.ts`
- `tests/shellWorkflowPageUi.test.ts`

不要改：

- 不自动把修复写入稳定版本。

验收：

- 失败 run 可创建 repair session。
- 修复后必须重新 preflight。
- 用户可选择只修复本次、保存为草稿或生成新版本。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`

### P4-001：WorkflowPin 存储与 API

状态：done

依赖：P3-003

目标：支持固定工作流引用。

建议文件：

- `local-companion/src/workflows/`
- `local-companion/src/httpHandler.ts`
- `tests/localCompanionWorkflowRuntime.test.ts`

不要改：

- 不复制 workflow definition。

验收：

- 可创建 pin。
- 可列出 pin。
- 可取消 pin。
- pin 可选择 follow default 或 locked version。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts`

### P4-002：固定入口 UI

状态：done

依赖：P4-001

目标：首页和连接 scope 显示固定工作流。

建议文件：

- `companion-desktop/shell/workflow-page.js`
- `companion-desktop/shell/connection-page.js`
- `companion-desktop/shell/index.html`
- `tests/shellWorkflowPageUi.test.ts`
- `tests/shellConnectionPageUi.test.ts`

不要改：

- 不把固定项做成复制卡片数据。

验收：

- 工作流可固定到 home。
- Maya 工作流可固定到 Maya connection。
- 取消固定后入口消失，工作流仍存在。

检查：

- `npx vitest run tests/shellWorkflowPageUi.test.ts tests/shellConnectionPageUi.test.ts`

### P4-003：固定项运行与状态摘要

状态：done

依赖：P4-002

目标：固定项可以一键运行，并显示最近状态、连接状态和版本策略。

建议文件：

- `companion-desktop/shell/workflow-page.js`
- `local-companion/src/workflows/`
- `tests/shellWorkflowPageUi.test.ts`
- `tests/localCompanionWorkflowRuntime.test.ts`

不要改：

- 不绕过 preflight。

验收：

- 固定项运行前仍 preflight。
- 固定项显示最近成功或失败。
- 连接异常时显示修复入口。
- locked version 不会随默认版本变化。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`

## 12. 验证矩阵

| 类型 | 命令或证据 | 何时运行 |
| --- | --- | --- |
| Workflow 运行时 | `npx vitest run tests/localCompanionWorkflowRuntime.test.ts` | 改 workflow runtime / store / API |
| Workflow 页面 | `npx vitest run tests/shellWorkflowPageUi.test.ts` | 改 Workflow UI |
| 连接页联动 | `npx vitest run tests/shellConnectionPageUi.test.ts` | 改 connection scope pin 或修复跳转 |
| 本地伴侣类型检查 | `npm run local-companion:typecheck` | 改 `local-companion/` TypeScript |
| Workflow 页面语法 | `node --check companion-desktop/shell/workflow-page.js` | 改该文件 |
| 桌面壳语法 | `node --check companion-desktop/main.cjs` | 改主进程 |
| 本地伴侣重启 | `npm run restart:local-companion` | 改运行时代码后 |
| 真实软件验收 | Maya 版本、选择对象、输出路径、字节数 | 改真实执行链路后 |

## 13. 阻塞规则

- 无真实 Maya：自动化继续；真实验收标记 `manual_pending`。
- 连接页接口缺失：先完成 Workflow 自身数据模型；连接 scope pin 标记 blocked 或 pending。
- 权限或登录缺失：停止并说明需要用户完成的动作。
- 无关测试失败：记录失败，不回滚无关改动。
- 同一阻塞连续三轮出现：标记 blocked，并写证据。
- 产品决策不清：如果会影响数据模型或长期用户承诺，停止询问。

## 14. 执行记录模板

```text
### YYYY-MM-DD：P?-??? 任务名

状态：done | blocked | manual_pending

变更：
- 文件：说明

验证：
- 命令：pass | fail，摘要
- 手工证据：如有

残余风险：
- 如无，写“无”

下一步：
- P?-???：任务名
```

## 15. 执行记录

### 2026-08-11：建立 Workflow 对象系统开发文档

状态：done

变更：

- `docs/本地伴侣-Workflow对象系统开发文档.md`：新增一次性操作、长期复用、草稿、版本、固定、修复会话的开发计划和任务 backlog。

验证：

- 文档-only 改动。

残余风险：

- 尚未实现对象模型；下一步从 P2-001 开始。

下一步：

- P2-001：Workflow 对象模型与存储契约。

### 2026-08-11：P2-001 Workflow 对象模型与存储契约

状态：done

变更：

- `local-companion/src/workflows/workflowObjects.ts`：新增 WorkflowDefinition、WorkflowDraft、WorkflowVersion、WorkflowPin、WorkflowRunObject 类型，以及从 WorkflowSkill 派生稳定定义、草稿和运行对象的工厂函数。
- `local-companion/src/workflows/workflowObjectStore.ts`：新增本地 Workflow 对象库 JSON 存储契约，支持默认空库、definitions、drafts、versions、pins 分区保存和 upsert。
- `tests/localCompanionWorkflowRuntime.test.ts`：新增对象库默认空状态、对象分区保存、TemporaryRun 不进入 WorkflowDefinition 的覆盖测试。
- `docs/本地伴侣-Workflow对象系统开发文档.md`：将 P2-001 标记完成，并把当前指针推进到 P2-002。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts`：pass，10 个测试通过。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- P2-001 只建立对象模型和存储契约；“成功运行后保存为草稿”的用户动作与 API 尚未实现。

下一步：

- P2-002：TemporaryRun 与保存草稿。

### 2026-08-11：P2-002 TemporaryRun 与保存草稿

状态：done

变更：

- `local-companion/src/workflows/runtime/workflowRuns.ts`：为运行记录增加 `saved_as_draft_id`，用于追踪成功运行是否已另存为草稿。
- `local-companion/src/workflows/workflowObjects.ts`：草稿定义增加默认输入、复现快照 ID 和源产物 ID，保证从运行保存的草稿不是空壳。
- `local-companion/src/workflows/workflowDrafts.ts`：新增 `saveWorkflowRunAsDraft`，只允许成功运行按需保存为 WorkflowDraft，并回写运行历史。
- `local-companion/src/httpHandler.ts`：新增 `POST /v1/workflows/runs/:runId/save-draft`。
- `companion-desktop/shell/workflow-page.js`：成功运行产物面板新增“保存为工作流”动作，保存后显示“已保存草稿”。
- `tests/localCompanionWorkflowRuntime.test.ts`：覆盖成功 TemporaryRun 手动保存为 WorkflowDraft。
- `tests/shellWorkflowPageUi.test.ts`：覆盖 Workflow 页面保存草稿按钮和 API 调用。
- `docs/本地伴侣-Workflow对象系统开发文档.md`：将 P2-002 标记完成，并把当前指针推进到 P2-003。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`：pass，20 个测试通过。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- 目前只支持从成功运行保存草稿；草稿列表、更新、归档 API 属于 P2-003。

下一步：

- P2-003：WorkflowDraft API。

### 2026-08-11：P2-003 WorkflowDraft API

状态：done

变更：

- `local-companion/src/workflows/workflowObjects.ts`：WorkflowDraft 增加 description，支持草稿说明。
- `local-companion/src/workflows/workflowDrafts.ts`：新增草稿创建、列表、读取、更新和归档函数；删除采用归档，不物理删除草稿或运行历史。
- `local-companion/src/httpHandler.ts`：新增 `GET/POST /v1/workflows/drafts` 和 `GET/PATCH/DELETE /v1/workflows/drafts/:id`。
- `tests/localCompanionWorkflowRuntime.test.ts`：覆盖 WorkflowDraft 创建、读取、更新默认输入和连接依赖、归档不删除。
- `docs/本地伴侣-Workflow对象系统开发文档.md`：将 P2-003 标记完成，并把当前指针推进到 P2-004。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`：pass，21 个测试通过。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- 草稿 API 已完成，但 Workflow 页面尚未展示草稿、状态和详情；这属于 P2-004。

下一步：

- P2-004：工作流详情 UI 基础。

### 2026-08-11：P2-004 工作流详情 UI 基础

状态：done

变更：

- `companion-desktop/shell/workflow-page.js`：Workflow 页面加载草稿列表；卡片新增“详情”切换；详情展示状态、验证、当前版本、最近运行、连接摘要、参数和草稿状态。
- `tests/shellWorkflowPageUi.test.ts`：覆盖详情展开、draft / validated / blocked 状态、连接摘要和最近运行展示。
- `docs/本地伴侣-Workflow对象系统开发文档.md`：将 P2-004 标记完成，并把当前阶段推进到 P3-001。

验证：

- `npx vitest run tests/shellWorkflowPageUi.test.ts tests/localCompanionWorkflowRuntime.test.ts`：pass，22 个测试通过。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- P2 对象化基础已完成；版本绑定、编辑草稿、发布回滚和修复会话仍属于 P3。

下一步：

- P3-001：WorkflowVersion 存储与运行绑定。

### 2026-08-11：P3-001 WorkflowVersion 存储与运行绑定

状态：done

变更：

- `local-companion/src/workflows/runtime/workflowRuns.ts`：新 WorkflowRun 写入 `workflow_version_id`，格式为 `workflowId@semver`，同时保留旧 `workflow_version`。
- `local-companion/src/workflows/workflowObjects.ts`：WorkflowRunObject 映射优先使用运行记录中的 `workflow_version_id`。
- `companion-desktop/shell/workflow-page.js`：运行历史详情显示版本 ID；旧历史缺少 `workflow_version_id` 时降级显示 `workflow_version`。
- `tests/localCompanionWorkflowRuntime.test.ts`：覆盖新运行历史版本绑定。
- `tests/shellWorkflowPageUi.test.ts`：覆盖历史详情版本显示和旧历史降级。
- `docs/本地伴侣-Workflow对象系统开发文档.md`：将 P3-001 标记完成，并把当前指针推进到 P3-002。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`：pass，22 个测试通过。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- 已完成运行记录与版本 ID 绑定；编辑草稿试运行仍属于 P3-002。

下一步：

- P3-002：编辑草稿与试运行。

### 2026-08-11：P3-002 编辑草稿与试运行

状态：done

变更：

- `local-companion/src/workflows/runtime/workflowRuns.ts`：运行记录增加 `draft_id`，用于区分草稿试运行。
- `local-companion/src/workflows/workflowDrafts.ts`：新增 `testRunWorkflowDraft`，使用草稿默认输入和本次覆盖参数运行现有 WorkflowSkill，回写 `latest_test_run_id`，不修改稳定 WorkflowDefinition。
- `local-companion/src/httpHandler.ts`：新增 `POST /v1/workflows/drafts/:id/test-run`。
- `tests/localCompanionWorkflowRuntime.test.ts`：覆盖草稿试运行、运行历史 `draft_id`、草稿 latest test run 更新、稳定版本不变。
- `docs/本地伴侣-Workflow对象系统开发文档.md`：将 P3-002 标记完成，并把当前指针推进到 P3-003。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`：pass，23 个测试通过。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- 草稿可编辑和试运行；发布新默认版本与回滚仍属于 P3-003。

下一步：

- P3-003：发布默认版本与回滚。

### 2026-08-11：P3-003 发布默认版本与回滚

状态：done

变更：

- `local-companion/src/workflows/workflowDrafts.ts`：新增 `publishWorkflowDraftVersion` 和 `rollbackWorkflowDefaultVersion`；发布要求草稿已有试运行证据，发布会创建 WorkflowVersion 并更新 WorkflowDefinition 默认版本，回滚只切回旧版本。
- `local-companion/src/httpHandler.ts`：新增 `POST /v1/workflows/drafts/:id/publish` 和 `POST /v1/workflows/:id/rollback`。
- `tests/localCompanionWorkflowRuntime.test.ts`：覆盖未试运行草稿禁止发布、发布创建新版本、旧版本保留、默认版本可回滚。
- `docs/本地伴侣-Workflow对象系统开发文档.md`：将 P3-003 标记完成，并把当前指针推进到 P3-004。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`：pass，24 个测试通过。
- `npm run local-companion:typecheck`：pass。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- 版本发布与回滚已完成；失败运行进入修复会话仍属于 P3-004。

下一步：

- P3-004：修复会话。

### 2026-08-11：P3-004 修复会话

状态：done

变更：

- `local-companion/src/workflows/workflowObjects.ts`：新增 WorkflowRepairSession 和修复范围类型。
- `local-companion/src/workflows/workflowObjectStore.ts`：对象库新增 `repair_sessions` 分区和 upsert。
- `local-companion/src/workflows/workflowRepairSessions.ts`：新增修复会话创建、读取、列表和修复范围选择；失败 run 创建会话后强制进入 `preflight_required`。
- `local-companion/src/httpHandler.ts`：新增修复会话 API，包括列表、读取、选择范围和从失败 run 创建会话。
- `companion-desktop/shell/workflow-page.js`：失败结果新增“修复会话”入口，创建后打开对应 Workflow 对话上下文。
- `tests/localCompanionWorkflowRuntime.test.ts`：覆盖失败 run 创建修复会话、保留 RepairAction、选择修复范围、修复后仍要求 preflight。
- `tests/shellWorkflowPageUi.test.ts`：覆盖失败结果创建修复会话 API。
- `docs/本地伴侣-Workflow对象系统开发文档.md`：将 P3-004 标记完成，并把当前阶段推进到 P4-001。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`：pass，26 个测试通过。
- `npm run local-companion:typecheck`：pass。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- P3 版本与修复基础已完成；固定项存储、UI 和运行仍属于 P4。

下一步：

- P4-001：WorkflowPin 存储与 API。

### 2026-08-11：P4-001 WorkflowPin 存储与 API

状态：done

变更：

- `local-companion/src/workflows/workflowPins.ts`：新增 WorkflowPin 创建、列表、按 scope 过滤和取消固定；pin 是引用，不复制 WorkflowDefinition。
- `local-companion/src/httpHandler.ts`：新增 `GET/POST /v1/workflows/pins` 和 `DELETE /v1/workflows/pins/:id`。
- `tests/localCompanionWorkflowRuntime.test.ts`：覆盖 home pin、connection locked version pin、按 scope 列表、取消固定不删除 workflow。
- `docs/本地伴侣-Workflow对象系统开发文档.md`：将 P4-001 标记完成，并把当前指针推进到 P4-002。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`：pass，27 个测试通过。
- `npm run local-companion:typecheck`：pass。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- 固定项 API 已完成；首页和连接 scope 的固定入口 UI 属于 P4-002。

下一步：

- P4-002：固定入口 UI。

### 2026-08-11：P4-002 固定入口 UI

状态：done

变更：

- `companion-desktop/shell/workflow-page.js`：Workflow 页面加载 pins，卡片显示固定位置，并支持固定到首页、固定到连接、取消固定。
- `tests/shellWorkflowPageUi.test.ts`：覆盖 pins API 加载、home pin、connection pin、取消固定后 workflow 仍存在。
- `docs/本地伴侣-Workflow对象系统开发文档.md`：将 P4-002 标记完成，并把当前指针推进到 P4-003。

验证：

- `npx vitest run tests/shellWorkflowPageUi.test.ts tests/localCompanionWorkflowRuntime.test.ts`：pass，28 个测试通过。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- 固定入口 UI 已完成；固定项一键运行、最近状态和版本策略展示属于 P4-003。

下一步：

- P4-003：固定项运行与状态摘要。

### 2026-08-11：P4-003 固定项运行与状态摘要

状态：done

变更：

- `companion-desktop/shell/workflow-page.js`：固定项显示 scope、版本策略、最近运行状态和连接状态；已固定 workflow 显示“运行固定项”，并复用原 runWorkflow 流程，运行前仍 preflight。
- `tests/shellWorkflowPageUi.test.ts`：覆盖固定项摘要、follow default 策略、最近成功状态、连接状态和运行固定项先 preflight 再 run。
- `docs/本地伴侣-Workflow对象系统开发文档.md`：将 P4-003 标记完成，并把当前指针改为整体完成态。

验证：

- `npx vitest run tests/shellWorkflowPageUi.test.ts tests/localCompanionWorkflowRuntime.test.ts`：pass，29 个测试通过。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- 本文档 P2-P4 自动化验收已完成；真实 Maya 端到端验收可继续使用既有 `workflow:maya-ui-selection-smoke`。

下一步：

- 整体回归，或进入真实 Maya UI 场景验收。

### 2026-08-11：整理为 AI Agent 可循环执行文档

状态：done

变更：

- `docs/本地伴侣-Workflow对象系统开发文档.md`：新增当前执行指针、快速执行索引、本轮工作边界、细化 Agent 循环协议、任务卡字段规范和任务状态更新规则。

验证：

- 文档-only 改动。

残余风险：

- 尚未执行 P2-001；本文档只把开发路径整理为可循环执行。

下一步：

- P2-001：Workflow 对象模型与存储契约。
