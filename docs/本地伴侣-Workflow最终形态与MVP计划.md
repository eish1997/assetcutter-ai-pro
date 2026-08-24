# 本地伴侣 Workflow 循环执行开发文档

## 0. Agent 读取顺序

每个 AI Agent 开始工作前，按顺序读取：

1. 本文档。
2. `AGENTS.md`。
3. 与当前任务相关的源码和测试。
4. 最近一次执行记录。

不要跳过本文档直接按记忆开发。本文档是 Workflow 页面继续推进的任务队列和验收来源。

## 1. 当前状态

| 项目 | 状态 |
| --- | --- |
| 当前阶段 | P0：把 Workflow 页面从技术切片推进到 Maya FBX MVP 闭环 |
| 下一任务 | 已完成；后续进入真实用户试用与回归 |
| 连接页状态 | 未完成，不阻塞 P0 |
| ScriptHub 命名 | 用户侧正式收敛为 Workflow；旧 ScriptHub 只保留兼容层 |
| 真实软件验收 | Maya2022 端到端验收已完成 |
| 下一阶段文档 | `docs/本地伴侣-Workflow对象系统开发文档.md`：一次性操作、长期复用、版本、固定、修复会话 |
| 文档更新规则 | 每完成一个任务，必须更新本文档“执行记录”；若影响架构或交接，也更新 `docs/交接文档.md` |

## 2. 目标

AssetCutter 本地伴侣的 Workflow 页面，要成为用户执行本机生产流程的可靠入口。

目标用户路径：

```text
打开本地伴侣 -> 进入 Workflow -> 选择可靠工作流 -> 检查连接与依赖
-> 填少量参数 -> 运行前检查 -> 执行 -> 获得稳定产物
-> 失败时看到可执行修复动作 -> 成功后可复用、重跑、追溯历史
```

MVP 样板是 Maya 导出选中对象为 FBX：

- 用户从 Workflow 页面看到 Maya FBX 导出工作流。
- 页面展示 Maya 连接、桥接、输出目录、选中对象等依赖状态。
- 用户输入或确认最少参数。
- 运行前检查给出明确通过、警告、失败项。
- 成功后得到真实 FBX 产物，并能打开所在位置。
- 失败后看到可点击修复动作。
- 页面显示最近运行历史。
- 用户能基于历史记录复用参数并重新运行。

## 3. 非目标

当前阶段不要做：

- 独立 ScriptHub Web 产品。
- 工具市场、脚本商城或大 Dashboard。
- 面向用户的原子函数目录。
- 复杂节点编辑器。
- Workflow 页面内置完整连接中心。
- 等连接页完全完成后才继续 Workflow。

## 4. 当前约束

- 连接页仍在开发中。Workflow P0 只能依赖轻量连接摘要和 RepairAction，不依赖连接页最终 UI。
- 工作区可能有大量无关未提交改动。不要回滚、整理或重命名无关文件。
- 修改 `local-companion/` 或 `companion-desktop/` 的运行时代码后，按仓库规则执行 `npm run restart:local-companion`。
- 文档-only 改动不需要重启本地伴侣。
- 新用户侧命名使用 Workflow / 工作流。旧字段或别名如 `scriptHub.*` 可作为兼容层保留，不做大范围重命名。
- 不新增直接 `localStorage` / `sessionStorage` 调用；需要持久化时优先复用已有运行历史或项目内封装。
- UI 不复制连接页全量能力，只展示当前工作流需要的连接摘要和修复入口。

## 5. 连接页未完成时的开发策略

可以继续开发 Workflow。

P0 任务不等待连接页完成，原因：

- 运行历史、preflight、repair、artifact、reuse、fixture、registry 都是 Workflow 自身闭环。
- 连接依赖只需要“摘要”和“动作”，不是完整连接管理 UI。
- 连接页完成后，再把摘要适配器接到正式 `software_connection` 生命周期。

P0 阶段允许的 connector 形态：

```text
WorkflowSkill.requiredConnectors
  -> connector dependency summary
  -> status: ok | warning | blocked | unknown
  -> repair action
  -> optional open connection page target
```

P0 阶段禁止：

- 在 Workflow 页面复制安装器列表。
- 在 Workflow 页面维护第二套连接状态源。
- 为了连接页未完成而硬编码“永远可用”。

## 6. 最终交互定义

### 6.1 新执行

新执行从 WorkflowSkill 开始。

步骤：

1. 用户在 Workflow 页面点击工作流卡片的运行动作。
2. 页面读取 WorkflowSkill 的参数、依赖、默认值、版本。
3. 页面展示必要参数，不展示内部函数目录。
4. 页面执行 preflight。
5. preflight 通过后允许执行；失败时展示失败项和 RepairAction。
6. 执行过程中展示步骤状态。
7. 成功后展示 Artifact。
8. 写入 RunHistory 与 ReplaySnapshot。

完成证据：

- 页面可以从无历史状态运行到成功状态。
- 运行记录里有 run id、skill id、参数快照、状态、artifact 或 failure。

### 6.2 复用

复用从 RunHistory 或 Artifact 开始。

步骤：

1. 用户点击历史记录或产物上的复用动作。
2. 页面读取 ReplaySnapshot。
3. 页面预填上次参数。
4. 页面重新检查当前连接和文件状态。
5. 状态变化必须提示用户，例如输出目录不存在、Maya 未连接。
6. 用户确认后创建新的 WorkflowRun。
7. 新运行记录保留来源关系，例如 `reused_from_run_id`。

完成证据：

- 复用不是直接重放旧结果。
- 复用必须重新 preflight。
- 新旧运行记录可追溯。

## 7. 完成定义

### 7.1 P0 完成定义

P0 完成时必须同时满足：

- P0-001 到 P0-007 状态为 done。
- 自动化检查通过：
  - `npx vitest run tests/localCompanionWorkflowRuntime.test.ts`
  - `npx vitest run tests/shellWorkflowPageUi.test.ts`
  - `npx vitest run tests/shellCapabilityCardSchema.test.ts`
  - `npm run local-companion:typecheck`
  - `node --check companion-desktop/shell/workflow-page.js`
  - `node --check companion-desktop/main.cjs`
- 如果改过运行时代码，已执行 `npm run restart:local-companion` 或记录无法执行原因。
- P1-003 真实 Maya 验收可以仍为 pending，但必须有明确手工验收步骤。

### 7.2 MVP 完成定义

MVP 完成时必须额外满足：

- P1-001 到 P1-003 状态为 done。
- 真实 Maya 导出 FBX 大于 0 字节。
- 文档记录 Maya 版本、输入对象、输出路径、运行结果、失败与修复情况。

## 8. Agent 循环协议

每一轮执行必须按以下步骤：

1. Observe：读取本文档、相关源码、相关测试、最新执行记录。
2. Select：选择第一个状态为 pending 且依赖已完成的任务。
3. Scope：列出本轮只允许触碰的文件范围。
4. Act：做满足任务的最小改动。
5. Verify：运行该任务列出的聚焦检查。
6. Record：更新“执行记录”和任务状态。
7. Continue Or Stop：检查通过则继续下一个任务；遇到真实阻塞、用户指令或完成定义才停止。

禁止：

- 跳过任务顺序做后面的 UI。
- 一轮同时做多个无依赖关系的大任务。
- 用“看起来可以”替代测试或手工证据。
- 因无关测试失败而回滚用户改动。

## 9. 任务状态表

| 任务 | 状态 | 依赖 | 下一步 |
| --- | --- | --- | --- |
| P0-001 运行历史面板 | done | 无 | 已完成 |
| P0-002 运行前检查结果面板 | done | P0-001 | 已完成 |
| P0-003 RepairAction 按钮映射 | done | P0-002 | 已完成 |
| P0-004 Artifact 结果面板 | done | P0-001 | 已完成 |
| P0-005 ReplaySnapshot 复用 UI | done | P0-001, P0-002, P0-004 | 已完成 |
| P0-006 Fixture Runner | done | P0-002, P0-003, P0-004 | 已完成 |
| P0-007 WorkflowSkill 注册表整理 | done | P0-001 | 已完成 |
| P1-001 Connector 依赖摘要适配器 | done | P0-002 | 已完成 |
| P1-002 连接页生命周期复用 | done | P1-001, 连接页可用接口 | 已完成 |
| P1-003 真实 Maya 端到端验收 | done | P0 完成 | 已完成 |

状态值只允许：

- `pending`：未开始。
- `in_progress`：当前轮正在做。
- `done`：代码、测试、记录都完成。
- `blocked`：同一阻塞连续三次出现，且没有可继续的替代路径。
- `manual_pending`：自动化完成，但等待真实软件或人工验收。

## 10. Backlog

### P0-001：运行历史面板

状态：pending

依赖：无

目标：Workflow 页面展示最近运行记录，至少包含工作流名、状态、开始时间、产物摘要、失败原因。

建议文件：

- `companion-desktop/shell/workflow-page.js`
- `local-companion/src/workflows/`
- `tests/shellWorkflowPageUi.test.ts`
- `tests/localCompanionWorkflowRuntime.test.ts`

不要改：

- 不新增独立历史存储。
- 不改连接页完整生命周期。
- 不做复用 UI。

验收：

- 页面能渲染空历史状态。
- 成功与失败历史能稳定展示。
- 历史来自运行时历史或其 API，不来自新的临时全局变量。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`
- `node --check companion-desktop/shell/workflow-page.js`

记录要求：

- 写明历史数据来源。
- 写明空态、成功态、失败态覆盖情况。
- 更新任务状态表。

### P0-002：运行前检查结果面板

状态：pending

依赖：P0-001

目标：用户运行前能看到依赖检查结果，而不是只看到最终失败。

建议文件：

- `companion-desktop/shell/workflow-page.js`
- `local-companion/src/workflows/`
- `tests/shellWorkflowPageUi.test.ts`
- `tests/localCompanionWorkflowRuntime.test.ts`

不要改：

- 不把 preflight 写成纯前端假状态。
- 不把连接页完整检测逻辑搬进 Workflow 页面。

验收：

- 展示通过、警告、失败三类检查项。
- 失败项能关联 RepairAction。
- Maya FBX 工作流至少覆盖软件、桥接、输出目录、选中对象检查。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`
- `node --check companion-desktop/shell/workflow-page.js`

记录要求：

- 写明 preflight 数据结构。
- 写明每类状态的测试覆盖。

### P0-003：RepairAction 按钮映射

状态：pending

依赖：P0-002

目标：失败时把 RepairAction 渲染成用户可点击动作。

建议文件：

- `companion-desktop/shell/workflow-page.js`
- `companion-desktop/main.cjs`
- `tests/shellWorkflowPageUi.test.ts`

不要改：

- 不实现连接页全量功能。
- 不让未知动作渲染成可点击但无效果的按钮。

验收：

- 支持重新检测、打开连接页、打开目录、重试运行等基础动作。
- 未支持动作降级为清晰文本。
- 每个按钮有成功或失败反馈。

检查：

- `npx vitest run tests/shellWorkflowPageUi.test.ts`
- `node --check companion-desktop/shell/workflow-page.js`
- `node --check companion-desktop/main.cjs`

记录要求：

- 写明已支持 action type。
- 写明未知 action 的降级行为。

### P0-004：Artifact 结果面板

状态：pending

依赖：P0-001

目标：成功运行后展示 Artifact，并提供打开位置、复制路径、再次运行。

建议文件：

- `companion-desktop/shell/workflow-page.js`
- `companion-desktop/main.cjs`
- `local-companion/src/workflows/`
- `tests/shellWorkflowPageUi.test.ts`

不要改：

- 不把产物复制到新的私有目录，除非运行时已有该契约。
- 不持久化机器相关 URL。

验收：

- FBX 文件路径、文件大小、生成时间可见。
- 文件不存在时显示失效状态。
- 成功 artifact 渲染有测试覆盖。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`
- `node --check companion-desktop/shell/workflow-page.js`

记录要求：

- 写明 artifact 字段来源。
- 写明文件失效状态如何判断。

### P0-005：ReplaySnapshot 复用 UI

状态：pending

依赖：P0-001, P0-002, P0-004

目标：用户能从历史记录复用一次运行参数。

建议文件：

- `companion-desktop/shell/workflow-page.js`
- `local-companion/src/workflows/`
- `tests/shellWorkflowPageUi.test.ts`
- `tests/localCompanionWorkflowRuntime.test.ts`

不要改：

- 不直接复用旧结果冒充新执行。
- 不绕过 preflight。

验收：

- 复用会预填参数。
- 复用前重新执行 preflight。
- 新运行记录保留来源关系。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`
- `node --check companion-desktop/shell/workflow-page.js`

记录要求：

- 写明来源字段。
- 写明复用前状态变化如何展示。

### P0-006：Fixture Runner

状态：pending

依赖：P0-002, P0-003, P0-004

目标：在没有真实 Maya 的环境下，提供可重复的 Workflow fixture 验证。

建议文件：

- `local-companion/src/workflows/`
- `tests/localCompanionWorkflowRuntime.test.ts`
- `tests/shellWorkflowPageUi.test.ts`

不要改：

- 不把 fixture 结果标记为真实 Maya 验收。
- 不依赖开发者本机特定路径。

验收：

- 自动测试覆盖成功、失败、修复建议、产物失效。
- fixture 输出可清理、可重复。
- 真实 Maya 验收仍单独保留。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`

记录要求：

- 写明 fixture 与真实软件的边界。
- 写明生成文件是否需要忽略或清理。

### P0-007：WorkflowSkill 注册表整理

状态：pending

依赖：P0-001

目标：让 WorkflowSkill 定义更像产品资产，而不是散落的测试函数。

建议文件：

- `local-companion/src/workflows/`
- `tests/localCompanionWorkflowRuntime.test.ts`
- `tests/capabilityPackages.test.ts`

不要改：

- 不删除旧 `scriptHub.*` alias。
- 不做大范围文件重命名。

验收：

- 每个 WorkflowSkill 有稳定 id、版本、显示名、描述、参数 schema、依赖声明。
- 旧 ScriptHub alias 明确标注为兼容层。
- 测试覆盖 id 与 alias。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/capabilityPackages.test.ts`
- `npm run local-companion:typecheck`

记录要求：

- 写明注册表入口。
- 写明兼容 alias 行为。

### P1-001：Connector 依赖摘要适配器

状态：pending

依赖：P0-002

目标：把 Workflow 所需连接依赖解析成页面可展示的摘要。

建议文件：

- `local-companion/src/capabilities/`
- `local-companion/src/workflows/`
- `companion-desktop/shell/workflow-page.js`
- `tests/localCompanionWorkflowRuntime.test.ts`
- `tests/shellWorkflowPageUi.test.ts`

不要改：

- 不要求连接页最终 UI 完成。
- 不维护第二套连接状态源。

验收：

- 能从 required connectors 得到连接名、状态、严重程度、建议动作。
- 能与 `software_connection` 能力包对齐。
- 连接页不可用时仍能显示 unknown 或 blocked 摘要。

检查：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts tests/shellConnectionPageUi.test.ts`
- `npm run local-companion:typecheck`

记录要求：

- 写明摘要字段。
- 写明连接页未完成时的降级行为。

### P1-002：连接页生命周期复用

状态：pending

依赖：P1-001, 连接页可用接口

目标：Workflow 页面不重复实现连接安装/修复，而是调用连接页或连接能力包已有生命周期。

建议文件：

- `companion-desktop/shell/workflow-page.js`
- `companion-desktop/shell/connection-page.js`
- `local-companion/src/capabilities/`
- `tests/shellWorkflowPageUi.test.ts`
- `tests/shellConnectionPageUi.test.ts`

不要改：

- 不复制连接页 UI。
- 不在 Workflow 页面新增连接配置表单。

验收：

- Workflow 的“修复连接”能打开或定位到连接页对应项。
- 连接页状态变化后，Workflow 页面可重新检测。
- 无重复状态源。

检查：

- `npx vitest run tests/shellWorkflowPageUi.test.ts tests/shellConnectionPageUi.test.ts`
- `node --check companion-desktop/shell/workflow-page.js`

记录要求：

- 写明跳转或打开连接页的契约。
- 写明状态刷新方式。

### P1-003：真实 Maya 端到端验收

状态：pending

依赖：P0 完成

目标：用真实 Maya 完成一次从选中对象到 FBX 产物的闭环。

建议文件：

- `docs/宿主中心-真实软件验收记录.md`
- `docs/本地伴侣-Workflow最终形态与MVP计划.md`

不要改：

- 不用 fixture 冒充真实验收。
- 不把本机绝对输出路径写入可复用配置。

验收：

- Maya 已打开并有选中对象。
- 从 Workflow 页面执行导出。
- 产物 FBX 大于 0 字节。
- 记录 Maya 版本、输出路径、运行结果、失败与修复情况。

检查：

- 手工验收。
- 如验收后改动代码，再跑 P0 验证矩阵。

记录要求：

- 写明 Maya 版本。
- 写明导出对象或测试场景。
- 写明 FBX 字节数。
- 写明是否需要后续修复。

## 11. 验证矩阵

| 类型 | 命令或证据 | 何时运行 |
| --- | --- | --- |
| Workflow 运行时 | `npx vitest run tests/localCompanionWorkflowRuntime.test.ts` | 改 `local-companion/src/workflows/` 时 |
| Workflow 页面 | `npx vitest run tests/shellWorkflowPageUi.test.ts` | 改 `companion-desktop/shell/workflow-page.js` 时 |
| 能力卡片 schema | `npx vitest run tests/shellCapabilityCardSchema.test.ts` | 改 workflow card/action schema 时 |
| 连接页 UI | `npx vitest run tests/shellConnectionPageUi.test.ts` | 改 connector 摘要或连接页复用时 |
| 能力包 | `npx vitest run tests/capabilityPackages.test.ts` | 改 capability package / registry 时 |
| 本地伴侣类型检查 | `npm run local-companion:typecheck` | 改 `local-companion/` TypeScript 时 |
| Workflow 页面语法 | `node --check companion-desktop/shell/workflow-page.js` | 改该文件时 |
| 桌面主进程语法 | `node --check companion-desktop/main.cjs` | 改该文件时 |
| 本地伴侣重启 | `npm run restart:local-companion` | 改运行时代码后 |
| 真实 Maya 验收 | Maya 版本、选中对象、输出路径、FBX 字节数 | MVP 手工验收时 |

如果只改文档，运行 `git diff --check -- <changed-docs>` 即可。

## 12. 阻塞规则

- 无真实 Maya：自动化任务继续推进；P1-003 标记为 `manual_pending`。
- 连接页未完成：继续 P0；P1-002 等连接页可用接口。
- 权限、登录、真实软件安装需要用户操作：停止并明确说明需要用户做什么。
- 无关测试失败：记录失败命令、失败摘要、为何无关；不要回滚无关改动。
- 同一阻塞连续三轮出现：把对应任务标记为 `blocked`，并写明证据。
- 产品决策不明确：若保守方案不扩大范围，可以先做；涉及信息架构、数据契约、用户承诺时停止询问。

## 13. 执行记录模板

每完成或阻塞一个任务，在本节追加：

```text
### YYYY-MM-DD：P?-??? 任务名

状态：done | blocked | manual_pending

变更：
- 文件 1：做了什么
- 文件 2：做了什么

验证：
- 命令：pass | fail，摘要
- 手工证据：如有

残余风险：
- 如无，写“无”

下一步：
- P?-???：任务名
```

## 14. 执行记录

### 2026-08-10：建立 Workflow 循环执行开发文档

状态：done

变更：

- `docs/本地伴侣-Workflow最终形态与MVP计划.md`：整理为 AI Agent 可循环执行的开发文档，补齐当前状态、约束、完成定义、任务状态表、逐任务验收、验证矩阵、阻塞规则和执行记录模板。

验证：

- 文档-only 改动。

残余风险：

- 未运行代码测试；后续代码任务按各自检查执行。

下一步：

- P0-001：运行历史面板。

### 2026-08-10：P0-001 运行历史面板

状态：done

变更：

- `local-companion/src/httpHandler.ts`：新增 `GET /v1/workflows/runs`，直接暴露运行时 `listWorkflowRuns()`，历史数据来源为 file-backed Workflow run history。
- `companion-desktop/shell/index.html`：新增 Workflow 最近运行区域，包含空态、摘要和历史列表容器。
- `companion-desktop/shell/workflow-page.js`：刷新时同时读取 WorkflowSkill 与运行历史；用历史记录重建每个工作流最近运行；渲染空态、成功态、失败/预检失败态。
- `tests/localCompanionWorkflowRuntime.test.ts`：验证 `runWorkflowCapability` 写入的运行历史可由 `listWorkflowRuns()` 读取。
- `tests/shellWorkflowPageUi.test.ts`：验证页面包含历史区域、调用历史 API，并能渲染空态、成功历史和失败历史。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`：pass，2 个文件 7 个测试通过。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- 历史面板目前只展示最近运行摘要，不包含复用动作；复用属于 P0-005。
- Artifact 详细操作仍未完成；属于 P0-004。

下一步：

- P0-002：运行前检查结果面板。

### 2026-08-10：P0-002 运行前检查结果面板

状态：done

变更：

- `local-companion/src/workflows/runtime/workflowRuns.ts`：将 preflight 状态扩展为 `passed | warning | failed`。
- `local-companion/src/workflows/runWorkflowCapability.ts`：新增 `preflightWorkflowCapability()`，复用现有 Maya preflight、normalized input 与 RepairAction 收集，不写运行历史。
- `local-companion/src/httpHandler.ts`：新增 `POST /v1/workflows/:id/preflight`。
- `companion-desktop/shell/workflow-page.js`：新增“检查”动作和运行前检查面板；点击“运行”时先执行 preflight，未通过则停在检查结果，不进入导出执行。
- `tests/localCompanionWorkflowRuntime.test.ts`：验证 preflight-only 不执行导出、不写历史，并返回失败检查项与 RepairAction。
- `tests/shellWorkflowPageUi.test.ts`：验证页面调用 preflight API，并能展示通过、提醒、未通过三类检查项。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`：pass，2 个文件 9 个测试通过。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- 当前 RepairAction 仍只在 preflight 面板中显示为文本；按钮映射属于 P0-003。
- Maya 真实端到端仍未在本轮重新验收。

下一步：

- P0-003：RepairAction 按钮映射。

### 2026-08-10：P0-003 RepairAction 按钮映射

状态：done

变更：

- `companion-desktop/shell/workflow-page.js`：将 preflight RepairAction 渲染为可点击按钮；支持 reconnect、retry、confirm、revise_input、manual_repair；未知动作降级为文本。
- `companion-desktop/shell/workflow-page.js`：`reconnect` 与 Maya FBX 能力修复打开连接页；`confirm` 和 `revise_input` 应用建议输入补丁后重新检测；`retry` 和普通 manual repair 重新检测。
- `tests/shellWorkflowPageUi.test.ts`：验证支持动作渲染为按钮、未知动作渲染为文本、允许覆盖补丁会写回表单并重新 preflight、连接修复会打开连接页。

验证：

- `npx vitest run tests/shellWorkflowPageUi.test.ts`：pass，1 个文件 6 个测试通过。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `node --check companion-desktop/main.cjs`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- Artifact 上的打开位置、复制路径等动作仍未完成；属于 P0-004。
- 连接页的最终生命周期复用仍未完成；属于 P1-002。

下一步：

- P0-004：Artifact 结果面板。

### 2026-08-10：P0-004 Artifact 结果面板

状态：done

变更：

- `companion-desktop/shell/workflow-page.js`：新增 Artifact 结果面板，成功 run 展示产物路径、大小、生成时间和文件状态。
- `companion-desktop/shell/workflow-page.js`：新增产物动作：打开位置、复制路径、再次运行；missing/rejected 产物禁用打开位置。
- `tests/shellWorkflowPageUi.test.ts`：验证成功产物展示路径、大小、动作；验证打开位置调用 shell `openFolderPath()`；验证复制路径调用 clipboard；验证 missing 产物显示“文件失效”并禁用打开。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`：pass，2 个文件 11 个测试通过。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- “再次运行”使用当前表单参数重新运行，不从 ReplaySnapshot 预填；历史复用属于 P0-005。
- Artifact 是否真实存在仍依赖运行时写入的 `artifact.status`，后续 fixture/真实验收需要继续补强。

下一步：

- P0-005：ReplaySnapshot 复用 UI。

### 2026-08-10：P0-005 ReplaySnapshot 复用 UI

状态：done

变更：

- `local-companion/src/workflows/runtime/workflowRuns.ts`：新增可选 `reused_from_run_id`。
- `local-companion/src/workflows/runWorkflowCapability.ts`：`runWorkflowCapability()` 支持 `reusedFromRunId`，保存运行历史时写入来源关系。
- `local-companion/src/httpHandler.ts`：`POST /v1/workflows/:id/run` 透传 `reusedFromRunId`。
- `companion-desktop/shell/workflow-page.js`：运行历史和 Artifact 面板新增复用入口；复用会从 ReplaySnapshot/normalized input 预填参数，重新 preflight，并在正式运行时带上来源 run id。
- `tests/localCompanionWorkflowRuntime.test.ts`：验证复用运行写入 `reused_from_run_id`。
- `tests/shellWorkflowPageUi.test.ts`：验证复用会预填参数、重新 preflight，并在 rerun 时提交 `reusedFromRunId`。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`：pass，2 个文件 12 个测试通过。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- 复用目前使用 ReplaySnapshot 中的 normalized input；更复杂的依赖变化说明可在 P1 connector 摘要中继续增强。
- 真实 Maya 验收未在本轮执行。

下一步：

- P0-006：Fixture Runner。

### 2026-08-10：P0-006 Fixture Runner

状态：done

变更：

- `local-companion/src/workflows/runtime/workflowFixtureRunner.ts`：新增可重复 Workflow fixture runner，覆盖成功、preflight 失败、执行失败、产物失效四类样本。
- `tests/localCompanionWorkflowRuntime.test.ts`：验证 fixture runner 不依赖真实 Maya，且覆盖 Artifact、ReplaySnapshot、RepairAction、missing artifact 状态。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts`：pass，2 个文件 13 个测试通过。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- Fixture runner 只证明运行时行为可重复，不替代真实 Maya 验收。

下一步：

- P0-007：WorkflowSkill 注册表整理。

### 2026-08-10：P0-007 WorkflowSkill 注册表整理

状态：done

变更：

- `local-companion/src/workflows/runtime/workflowSkills.ts`：WorkflowSkill 增加 `legacyIds`，并将 `scriptHub.maya.export_selection_fbx` 明确标为兼容 alias。
- `local-companion/src/workflows/runtime/workflowSkills.ts`：WorkflowSkill 增加 `systemContract.requiredConnectors`，声明 Maya Connector 对应 `software_connection` 依赖。
- `local-companion/src/workflows/runtime/workflowSkills.ts`：`getWorkflowSkill()` 支持 canonical id 与 legacy alias 解析到同一个 WorkflowSkill；`listWorkflowSkills()` 仍只列 canonical 工作流。
- `local-companion/src/workflows/runtime/index.ts`：导出 fixture runner。
- `tests/localCompanionWorkflowRuntime.test.ts`：验证 canonical registry、legacy alias、required connectors，以及旧 alias 可通过 canonical Workflow runtime 执行。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/capabilityPackages.test.ts`：pass，2 个文件 32 个测试通过。
- `npm run local-companion:typecheck`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- Connector 摘要尚未映射到页面；属于 P1-001。

下一步：

- P1-001：Connector 依赖摘要适配器。

### 2026-08-10：P1-001 Connector 依赖摘要适配器

状态：done

变更：

- `local-companion/src/capabilities/workflowConnectorSummary.ts`：新增 Workflow connector 摘要适配器，将 WorkflowSkill 的 `requiredConnectors` 解析为页面可展示的状态、严重程度和建议动作。
- `local-companion/src/httpHandler.ts`：`GET /v1/workflows/skills` 返回 `connectorSummaries`。
- `companion-desktop/shell/workflow-page.js`：Workflow 卡片展示连接依赖摘要，并支持按连接标题、标签和状态搜索。
- `tests/capabilityPackages.test.ts`：验证未配置 software_connection 时返回 unknown；存在连接草稿且有路径信号时返回 warning。
- `tests/shellWorkflowPageUi.test.ts`：验证 Workflow 卡片渲染连接摘要。

验证：

- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/shellWorkflowPageUi.test.ts tests/shellConnectionPageUi.test.ts tests/capabilityPackages.test.ts`：pass，4 个文件 48 个测试通过。
- `npm run local-companion:typecheck`：pass。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- Workflow 页面尚未把连接摘要动作定位到连接页对应项；属于 P1-002。

下一步：

- P1-002：连接页生命周期复用。

### 2026-08-10：P1-002 连接页生命周期复用

状态：done

变更：

- `companion-desktop/shell/connection-page.js`：新增 `focusConnection(connectionId)`，连接页可高亮并滚动到指定连接卡；未找到时显示明确状态。
- `companion-desktop/shell/workflow-page.js`：Workflow 的连接修复动作打开连接页后，会通过 `ShellConnectionPage.focusConnection()` 定位到对应 `software_connection` 能力包。
- `tests/shellWorkflowPageUi.test.ts`：验证 Workflow 的 reconnect RepairAction 会切到连接页并定位 `maya`。
- `tests/shellConnectionPageUi.test.ts`：验证连接页可高亮目标连接卡，缺失目标时显示“未找到连接草稿”。

验证：

- `npx vitest run tests/shellWorkflowPageUi.test.ts tests/shellConnectionPageUi.test.ts`：pass，2 个文件 16 个测试通过。
- `node --check companion-desktop/shell/workflow-page.js`：pass。
- `node --check companion-desktop/shell/connection-page.js`：pass。
- `npm run restart:local-companion`：pass。

残余风险：

- P1-003 仍需要真实 Maya 打开、有选中对象，并从 UI 或真实 connector 完成一次端到端导出。

下一步：

- P1-003：真实 Maya 端到端验收。

### 2026-08-10：P1-003 真实 Maya 端到端验收

状态：done

变更：

- `scripts/workflow-maya-real-smoke.mjs`：新增真实 Maya smoke。脚本启动临时 Maya Connector 兼容服务，调用真实 `mayapy.exe` 创建并选中测试对象，然后通过本地伴侣 Workflow API 执行 `workflow.maya.export_selection_fbx`。
- `package.json`：新增 `npm run workflow:maya-real-smoke`。
- `local-companion/src/workflows/runtime/workflowSkills.ts`：更新真实 Maya validation evidence 为 Maya2022 mayapy 产物证据。
- `docs/宿主中心-真实软件验收记录.md`：补充 Maya2022 Workflow 真实导出记录。

验证：

- `$env:MAYA_MAYAPY='D:\Program Files\Autodesk\Maya2022\bin\mayapy.exe'; npm run workflow:maya-real-smoke`：pass。
- Maya 版本入口：`D:\Program Files\Autodesk\Maya2022\bin\mayapy.exe`。
- Workflow run id：`run_workflow_maya_export_selection_fbx_1786360422698`。
- 输出路径：`C:/Users/ZYF/AppData/Local/Temp/ac-workflow-maya-real-XC0Ml5/exports/workflow_real_1786360422667.fbx`。
- FBX 字节数：21792。
- 运行结果：`succeeded`。

残余风险：

- 本轮真实验收通过 mayapy standalone 创建测试对象并经 Workflow API 导出；未要求用户手动打开 Maya UI。若必须验收“用户在 Maya UI 中手动选择的对象”，还需要追加一轮 UI 手工验收。

下一步：

- 进入真实用户试用与回归；如后续要求 UI 手工选择对象，再追加手工验收记录。

### 2026-08-11：P1-004 真实 Maya UI 选择对象验收
状态：done

变更：
- `scripts/workflow-maya-ui-selection-smoke.mjs`：新增真实 Maya UI 选择验收脚本。脚本连接已打开的 Maya Command Port，只读取当前 UI 选择；如果没有选中对象则失败，不自动创建或选择测试物体。脚本启动临时 Workflow Connector 兼容服务，并通过本地伴侣 Workflow API 执行 `workflow.maya.export_selection_fbx`。
- `package.json`：新增 `npm run workflow:maya-ui-selection-smoke`。
- `local-companion/src/workflows/runtime/workflowSkills.ts`：补充真实 Maya UI 选择导出的 validation evidence。
- `docs/宿主中心-真实软件验收记录.md`：补充本次 Maya2022 UI 选择验收记录。

验证：
- `node --check scripts/workflow-maya-ui-selection-smoke.mjs`：pass。
- `npm run workflow:maya-ui-selection-smoke`：pass。
- Maya 版本：2022。
- Maya 连接：`127.0.0.1:7001` Command Port。
- UI 当前选择：3 个对象，`|pCube1`、`|pCube3`、`|pCube2`。
- Workflow run id：`run_workflow_maya_export_selection_fbx_1786438706080`。
- 输出路径：`C:/Users/ZYF/AppData/Local/Temp/ac-workflow-maya-ui-selection-jIQ3V2/exports/workflow_ui_selection_1786438706054.fbx`。
- FBX 字节数：30256。
- 运行结果：`succeeded`。

残余风险：
- 该脚本验证的是“已打开 Maya UI + 用户/当前 UI 已选中对象 + Workflow API 执行导出”的用户场景闭环；它不自动点击桌面壳按钮。页面按钮使用同一条 `/v1/workflows/:id/run` 路由，后续若要做像素级页面验收，可再补浏览器/桌面壳点击记录。

下一步：
- 进入真实用户试用与回归；继续把连接页最终生命周期和 Workflow 页面连接摘要对齐。

### 2026-08-24：Workflow 消费连接页已连通 Maya

状态：done

变更：
- Workflow 运行/预检在没有显式 HTTP Connector URL 时，读取连接页已连通的 Maya `software_connection`（不要求草稿 id 必须是 `maya`），使用 `lastProbe.host/port` 走 Command Port。
- 连接摘要会归并到该真实连接卡，修复动作可定位同一张卡。
- 仓库根目录 smoke 脚本只保留为回归，不再是产品路径。

验证：
- `npx vitest run tests/localCompanionWorkflowRuntime.test.ts tests/capabilityPackages.test.ts tests/shellWorkflowPageUi.test.ts`：pass，78 条测试。

残余风险：
- 仍需 Maya UI 有选中对象；空选区会失败并提示先在 Maya 里选物体。

下一步：
- 在本地伴侣 Workflow 页面对已连通 Maya 点运行，确认不再需要仓库根目录脚本。
