# 产品化 Project Agent 体验开发文档

版本：v0.2
目标读者：产品、前端、架构、工作流/AI 工程
范围：AssetCutter AI Pro 工作区右侧 Project Agent 侧栏

## 1. 目标和验收口径

把当前“能执行任务的工程型 Agent”收敛成“轻输入、懂现场、结果优先、可连续推进”的产品化助手。第一阶段不追求 Agent 大脑重构，先把用户每一次打开、输入、等待、得到结果、失败重试的体验打磨到可用。

一句话验收：

> 用户选中几张图，说“做成高级护肤品主图”，Agent 能识别当前素材，给出少量可预览结果，并提供继续优化、换一种、应用到选中图、保存为预设等明确动作；涉及批量、扣费、覆盖时必须先确认；失败时能给出可点的恢复路径。

核心成功指标：

- 首屏轻：用户打开侧栏先看到输入、上下文摘要和少量推荐动作，而不是参数面板。
- 结果前置：成功消息先展示结果/摘要/下一步，计划、日志、模型细节默认折叠。
- 动作闭环：每个可执行结果至少有一个下一步动作，失败结果至少有一个恢复动作。
- 可控信任：扣费、批量、覆盖、删除、发布、记忆写入、Skill 启用都有明确确认。

## 2. 当前基础和主要问题

已有基础：

- 右侧入口：`components/project-agent/ProjectAgentDock.tsx`
- 对话 UI：`components/workflow/quickComposeChat/*`
- 工作区编排：`components/WorkflowSection.tsx`
- Agent runtime：`services/projectAgent/runtime.ts`
- 规则路由：`services/projectAgent/planTools.ts`
- 上下文组装：`services/projectAgent/contextAssembly.ts`
- 专家与记忆：`services/projectAgent/experts/*`

主要问题：

- 输入区和 header 承载过多控件，像工作台，不像助手。
- Agent 知道上下文，但用户看不出来它知道什么。
- 消息偏执行日志，结果、预览和下一步动作不突出。
- 缺少统一动作协议，导致“继续优化、应用、重试、保存”难以产品化复用。
- 权限、成本、批量、覆盖、记忆写入缺少统一确认口径。
- `WorkflowSection.tsx` 中胶水逻辑偏集中，后续可以逐步外移，但第一阶段不重写。

## 3. 产品原则

### 3.1 体验优先，不展示能力库存

默认信息层级：

1. 当前上下文摘要：我正在处理什么。
2. 结果或建议：我给你什么。
3. 下一步动作：你可以点什么。
4. 可展开详情：我怎么做的、花了多少、哪里失败。
5. 高级入口：参数、专家、导出、历史、Skill 管理。

第一阶段不要新增大型配置中心、复杂 Agent 工作室或完整 Skill 市场。用户先获得“能继续点下去”的轻体验。

### 3.2 Agent 必须有动作边界

Agent 动作分四级：

| 等级 | 说明 | 默认处理 |
| --- | --- | --- |
| `none` | 纯回复、填入输入框、打开面板 | 直接执行 |
| `light` | 单次低风险预览、生成少量候选 | 可直接执行或轻确认 |
| `cost` | 扣费、多张候选、批量应用、可能超余额 | 必须确认成本和范围 |
| `destructive` | 覆盖、删除、发布、启用外部能力、写入品牌规则 | 强确认，明确对象和后果 |

确认文案必须包含：动作、对象范围、成本/额度影响、是否可撤销、失败后是否保留原资产。

### 3.3 少打字，多给可点动作

助手消息应优先附带快捷动作：

- 继续优化
- 换一种
- 应用到选中图
- 应用到同组
- 应用到全部
- 用作参考
- 保存为预设
- 查看原因/详情
- 重试/换模型/降低规格

动作按钮不是装饰，必须能落到统一协议；暂未实现的动作不要展示成可点击主按钮，可放在“更多”或不展示。

### 3.4 记忆必须可控，不能偷偷沉淀

记忆写入需要遵循：

- 明确偏好：轻确认后写入。
- 品牌规则、禁忌、跨项目偏好：必须确认后写入。
- 失败、拒绝、用户临时反馈：先作为会话信号使用，多次出现后再建议保存。
- 所有记忆必须可查看、可删除、可禁用参与上下文。

## 4. 目标体验形态

### 4.1 顶部上下文条

目标：让用户一眼知道 Agent 当前“看见了什么”，但不占空间。

展示内容：

- 项目名或当前任务名。
- 选中资产数量，例如“已选 4 张图”。
- 当前场景：画布 / 大图 / 局部编辑 / 批量列表。
- 输入来源：拖入附件、粘贴图、引用资产。
- 模式：自动执行 / 先问我 / 只建议。
- 仅在必要时显示成本或余额提示。

要求：

- 以 chip 或一行摘要呈现，不做大卡片。
- 摘要必须来自当前真实上下文，不展示过期选择。
- 点击可展开“Agent 已读取的上下文”，用于建立信任。

### 4.2 对话流

消息类型收敛为四类：

- 用户输入：保留原话、附件和引用对象。
- Agent 建议：短摘要 + 推荐动作。
- Agent 结果：结果卡片 + 下一步动作 + 可展开详情。
- Agent 失败：失败原因摘要 + 恢复动作 + 可展开错误。

默认展示：

- 成功时：结果、预览、动作。
- 进行中：当前步骤和可取消/查看详情。
- 失败时：一句原因和恢复按钮。

默认折叠：

- 计划步骤。
- 子任务日志。
- 模型、预设、参数、成本明细。
- 原始错误堆栈或供应商错误。

### 4.3 结果卡片

视觉类任务必须优先展示可判断的结果，而不是只展示文字。第一阶段可以用运行时视图模型派生，不要求重构资产持久化。

结果卡片基础信息：

- 缩略图或文本摘要。
- 关联资产数和任务状态。
- 使用的模型/预设摘要，默认折叠。
- 主要动作：采用、继续优化、换一种、应用、保存预设。

### 4.4 底部输入区

默认保留：

- 一句话输入。
- 拖图/粘贴图。
- `@资产`、`@专家`、`@能力`。
- 发送按钮。

默认折叠：

- 附件明细。
- 生成参数。
- 专家工作室。
- 导出、清空、加载更早。

第一阶段不做复杂 Prompt Builder；参数只能作为“更多设置”存在，不能重新占据主体验。

## 5. 核心动作协议

### 5.1 Suggested Action 数据结构

在 `QuickComposeThreadMessage` 或其视图模型上扩展推荐动作。第一阶段优先支持运行时派生，避免先改大范围持久化。

```ts
type AgentSuggestedAction = {
  id: string;
  label: string;
  kind:
    | 'reply'
    | 'preview'
    | 'run'
    | 'apply'
    | 'save_preset'
    | 'open_panel'
    | 'retry'
    | 'cancel';
  confirmLevel: 'none' | 'light' | 'cost' | 'destructive';
  targetScope?: 'current' | 'selected' | 'group' | 'all';
  costHint?: {
    estimatedCredits?: number;
    estimatedItems?: number;
    mayExceedBalance?: boolean;
  };
  payload?: Record<string, unknown>;
};
```

使用规则：

- `reply`：填入输入框或直接发送追问，默认 `none`。
- `preview`：生成少量候选，低成本可 `light`，多候选或扣费为 `cost`。
- `run`：执行单次明确任务，按成本和风险定级。
- `apply`：把结果应用到当前/选中/同组/全部，批量必须 `cost`，覆盖必须 `destructive`。
- `save_preset`：保存为预设，默认 `light`；保存为跨项目默认能力时升为 `destructive`。
- `open_panel`：打开记录、参数、专家、记忆管理等，默认 `none`。
- `retry`：基于失败上下文重试；换模型、降规格、减少张数必须写入 payload。
- `cancel`：取消进行中任务，默认 `light`；如果会丢弃已完成结果，升为 `destructive`。

### 5.2 动作生命周期

每个可执行动作都应经历同一条状态线：

1. `suggested`：Agent 给出动作。
2. `confirming`：需要确认时展示范围、成本和风险。
3. `queued`：动作已进入执行队列。
4. `running`：展示当前步骤，可查看详情。
5. `succeeded`：展示结果和下一步动作。
6. `failed`：展示原因和恢复动作。
7. `cancelled`：展示取消结果，说明是否保留中间产物。

第一阶段 UI 可以只实现 `suggested/running/succeeded/failed`，但数据和处理逻辑要按完整生命周期预留。

### 5.3 可见上下文摘要

当前 `AgentSurfaceContext` 面向模型和执行链路，需补一个面向用户和确认弹窗的摘要。

```ts
type AgentVisibleContextSummary = {
  title: string;
  chips: string[];
  targetIds?: string[];
  targetCount?: number;
  source: 'project' | 'selection' | 'lightbox' | 'local_edit' | 'attachment' | 'conversation';
  risk?: 'none' | 'cost' | 'batch' | 'destructive';
  stale?: boolean;
};
```

要求：

- 用于顶部上下文条、确认弹窗和动作按钮可用性判断。
- 不直接等同模型上下文，避免把 UI 文案当作推理依据。
- `stale` 为 true 时，不允许执行批量或覆盖动作，必须刷新上下文或让用户重新确认。

### 5.4 结果卡片视图模型

```ts
type AgentResultCardView = {
  id: string;
  kind: 'image' | 'text' | 'batch' | 'error';
  title: string;
  status: 'preview' | 'final' | 'failed' | 'partial';
  assetIds?: string[];
  taskIds?: string[];
  summary?: string;
  actions: AgentSuggestedAction[];
};
```

第一阶段从 `QuickComposeChatMessageView` 派生即可，不新增数据库表；后续再与资产 lineage 对齐。

## 6. 权限、成本和确认

确认矩阵：

| 场景 | 确认等级 | 必须展示 |
| --- | --- | --- |
| 打开面板、查看详情、填入回复 | `none` | 无 |
| 单张低成本预览 | `light` 或 `none` | 目标对象、预计结果数 |
| 多候选生成 | `cost` | 预计张数、额度、模型/规格 |
| 应用到选中/同组/全部 | `cost` | 范围、数量、是否覆盖 |
| 覆盖原图、删除、发布 | `destructive` | 对象、不可逆后果、替代方案 |
| 保存记忆/品牌规则 | `light`/`destructive` | 记忆内容、作用范围、管理入口 |
| 启用外部 Skill | `destructive` | 能力说明、工具权限、风险说明 |

工程要求：

- 确认逻辑不要散落在按钮组件里，应由统一 action handler 判断。
- `costHint` 缺失时，不能展示“确认扣费”类动作，只能先估算或降级为询问。
- 批量动作必须带 `targetScope` 和可解释的目标数量。
- 强确认要优先提供非破坏性替代：复制生成、另存、仅预览。

## 7. 失败恢复

失败消息必须避免只显示错误文本。结构固定为：

- 一句话说明：发生了什么。
- 影响范围：哪些资产失败，哪些已成功。
- 推荐恢复：默认 1-3 个按钮。
- 详情折叠：供应商错误、日志、参数、任务 ID。

恢复动作优先级：

1. 原参数重试。
2. 换模型/供应商重试。
3. 降低尺寸或减少张数。
4. 拆成多步执行。
5. 修改提示词。
6. 联系/查看错误详情。

部分成功时必须保留成功结果，不允许把整批表现成完全失败。结果卡片状态使用 `partial`。

## 8. 知识、记忆和 Skill 边界

### 8.1 知识库：知道资料，不直接执行

知识库用于检索说明、规则和背景，不负责触发工具。

范围：

- System Knowledge：产品能力、模型、预设说明。
- Project Knowledge：项目品牌、风格、素材要求。
- User Knowledge：跨项目偏好。
- Expert Knowledge：专家专属知识。

第一阶段不做完整向量库。只预留结构化短文本接口：

```ts
type AgentKnowledgeSnippet = {
  id: string;
  scope: 'system' | 'project' | 'user' | 'expert';
  title: string;
  text: string;
  tags: string[];
  updatedAt: number;
};
```

### 8.2 记忆：保存偏好，不等于训练模型

记忆类型：

- `preference`：用户喜欢什么。
- `rejection`：用户不喜欢什么。
- `brand_rule`：品牌规则或禁忌。
- `workflow_success`：可复用成功流程。
- `pointer`：指向资产、预设或产物。

写入规则：

- 会话内临时偏好不自动升为长期记忆。
- 品牌规则、跨项目偏好、禁忌必须确认。
- 记忆必须有来源：来自哪次对话、哪次操作或哪条用户确认。
- 记忆管理入口需要支持查看、删除、禁用参与上下文。

### 8.3 Skill：新增能力，不是外部 prompt 直跑

Skill 负责“会做一类新事情”，不能绕过权限、成本和工具白名单。

```ts
type AgentSkill = {
  id: string;
  name: string;
  description: string;
  triggerExamples: string[];
  requiredContext: Array<'text' | 'image' | 'selectedAsset' | 'project'>;
  allowedTools: string[];
  outputMode: 'answer' | 'plan' | 'execute' | 'preset';
  safetyNotes?: string[];
};
```

外部 Skill 启用流程：

1. 导入并解析。
2. 展示能力摘要和所需权限。
3. 检查工具白名单和危险指令。
4. 用户强确认。
5. 启用后可禁用、删除。

第一阶段不做外部 Skill 导入，只保留协议和风险边界。

## 9. 资产卡片与预设

### 9.1 资产卡片

第一阶段不重构资产模型，只增加 Agent 快捷入口和运行时动作。

可增加入口：

- 继续优化。
- 用这张做参考。
- 应用同款到其他图。
- 查看生成记录。

后续再补 lineage：

- 来源对话。
- 来源任务。
- 父资产。
- 使用预设。
- 使用模型。
- prompt/参数快照。

### 9.2 预设

预设逐步升级为 Agent 可理解的能力单元，但第一阶段只做“保存为预设”的动作入口和确认。

后续 metadata：

```ts
type AgentPresetMetadata = {
  agentDescription: string;
  useCases: string[];
  requiredInputs: Array<'text' | 'main_image' | 'reference_image'>;
  outputKind: 'image' | 'text' | '3d' | 'batch';
  styleTags: string[];
  limitations: string[];
  costHint?: string;
};
```

## 10. 分阶段开发计划

### Phase 1：轻体验 MVP

目标：不重构底层执行链路，让侧栏立刻更像可用产品助手。

范围：

- 精简 dock header，把专家、导出、清空、历史等收进更多菜单。
- 空状态改为 3-5 个真实场景建议，点击后填入输入框。
- 输入区默认折叠附件明细和生成参数。
- 助手消息结果优先，计划、时间线、模型细节默认折叠。
- 增加 `AgentSuggestedAction` 视图模型、渲染和基础点击处理。
- 默认生成基础动作：继续优化、换一种、查看详情、重试。
- 失败气泡增加恢复按钮。
- 增加轻量确认弹窗，先覆盖 `cost/destructive` 的文案和拦截。

不做：

- 完整记忆管理。
- 完整 Skill Registry。
- LLM Planner。
- 资产 lineage 重构。
- 大范围抽离 `WorkflowSection.tsx`。

验收：

- 用户打开侧栏不会被参数淹没。
- 完成一次生成后，可以不输入新文字继续推进。
- 失败后至少可一键重试或换策略。
- 批量、扣费、覆盖动作不会无确认执行。

### Phase 2：上下文感知与动作闭环

目标：让 Agent 明显知道当前对象，并能把结果应用回工作区。

范围：

- 增加顶部上下文条。
- 把 selected/lightbox/local edit/attachments 转成 `AgentVisibleContextSummary`。
- 支持应用到当前、选中、同组、全部的动作流。
- 资产卡片增加 Agent 快捷入口。
- 结果卡片支持预览、采用、继续优化、应用。
- 上下文过期时禁用高风险动作并提示刷新。

验收：

- 用户选中图后，侧栏能显示当前对象和数量。
- 用户可以从一次结果连续推进到应用。
- 应用范围和成本在执行前可确认。

### Phase 3：记忆与知识产品化

目标：让 Agent 越用越顺，但保持可控。

范围：

- 记忆确认写入 UI。
- 记忆管理入口。
- 项目知识短文本。
- 专家记忆和项目记忆进入上下文组装。
- 支持“保存这次风格/流程”。

验收：

- 用户确认的偏好会影响后续回复或生成。
- 用户能查看、删除、禁用记忆。
- 品牌规则不会被静默写入。

### Phase 4：Skill Registry

目标：把预设、专家、外部流程统一成可安装能力。

范围：

- 定义 `AgentSkill` schema。
- 本地 Skill Registry。
- 外部 Skill 导入预览。
- 安全检查：工具白名单、危险指令、权限等级。
- Skill 可启用、禁用、删除。

验收：

- 用户可以安装一个新 Skill，并通过自然语言触发。
- 未确认的外部 Skill 不会执行。
- Skill 不能绕过动作确认矩阵。

### Phase 5：可控 Planner

目标：从规则路由升级为可验证的自然语言规划。

范围：

- 增加结构化 planner 输出。
- 校验 `toolId`、`assetId`、`presetId`、步数、成本、目标范围。
- 不通过校验时回退到现有 `planTools` 或要求用户澄清。
- planner 输出可解释 decision trace。

验收：

- 复杂需求可以拆成多步计划。
- 所有计划都能被校验、确认、追踪。
- planner 不能绕过现有工作流校验。

## 11. 第一阶段工程落点

优先改动：

- `types/quickComposeThread.ts`：补 action/result card 相关类型或扩展字段。
- `services/quickComposeChatView.ts`：从消息和任务状态派生 actions/result cards。
- `components/workflow/quickComposeChat/QuickComposeChatMessage.tsx`：结果优先渲染、动作按钮、详情折叠。
- `components/workflow/quickComposeChat/QuickComposeChatComposer.tsx`：输入区轻量化、附件/参数折叠。
- `components/workflow/quickComposeChat/QuickComposeChatDock.tsx`：header 精简、更多菜单、空状态建议。
- `components/workflow/quickComposeChat/chatUiCopy.ts`：统一动作、确认、失败恢复文案。
- `components/WorkflowSection.tsx`：只接入必要 action handler，不做大重写。

第二阶段再新增或外移：

- `services/projectAgent/actions.ts`：统一动作执行与确认判断。
- `services/projectAgent/visibleContext.ts`：用户可见上下文摘要。
- `services/projectAgent/skillRegistry.ts`：Skill 注册。
- `services/projectAgent/knowledgeStore.ts`：知识短文本。

测试建议：

- action 派生单测：不同消息状态应生成正确按钮。
- 确认矩阵单测：批量/扣费/覆盖必须被拦截。
- 失败视图单测：失败消息必须有恢复动作。
- 轻量 UI 回归：空状态、结果卡片、详情折叠、输入区折叠。

## 12. 非目标

第一阶段明确不做：

- 完整向量数据库。
- 自动训练模型。
- 大规模资产 lineage 重构。
- 多 Agent 分布式调度。
- 外部 Skill 直接控制系统工具。
- LLM Planner 替换现有 `planTools`。
- 重写 `WorkflowSection.tsx`。
- 完整 Prompt Builder 或专家工作室重设计。

## 13. 风险和防线

- 侧栏继续堆功能：所有高级能力默认折叠，主路径只保留输入、上下文、结果、动作。
- 动作误触带来成本风险：统一确认矩阵，缺少成本估算时不允许执行扣费动作。
- 批量或覆盖误操作：必须展示对象范围、数量和是否可撤销。
- 记忆降低信任：不静默写入长期记忆，提供管理入口。
- Skill 安全风险：外部 Skill 第一阶段不做；后续必须经白名单和强确认。
- Planner 不稳定：第五阶段才做，且必须经过结构校验和现有工作流兜底。

## 14. 推荐第一张开发票

标题：

> Project Agent 轻体验 MVP：结果优先消息 + 快捷动作 + 失败恢复

范围：

- 新增 `AgentSuggestedAction` 视图模型。
- 助手消息渲染动作按钮。
- 默认派生基础动作：继续优化、换一种、重试、查看详情。
- 计划、时间线、模型细节默认折叠。
- 空状态改成场景建议。
- 输入区附件和参数默认折叠。
- 增加成本/破坏性动作的确认拦截。
- 不改底层执行链路。

验收：

- 完成一次生成后，用户可以通过按钮继续推进。
- 失败后用户可以一键重试或换策略。
- 侧栏视觉密度降低，输入更轻。
- 批量、扣费、覆盖动作不会绕过确认。
