# 本地伴侣 · Copilot 基础设施改造文档

**版本**：v0.1（2026-07-15）  
**状态**：产品与架构对齐稿；用于把桌面壳 Copilot 从“聊天框”校准为默认安静、必要时浮现的 Agent Console + AssetCutter 身体入口。  
**关联文档**：

| 文档 | 关系 |
|------|------|
| [`docs/本地伴侣-全局Agent规格.md`](./本地伴侣-全局Agent规格.md) | 定义桌面壳 Copilot、`ac.*` 身体层、Agent Store、Body MCP |
| [`docs/网页端项目Agent侧栏-开发规格.md`](./网页端项目Agent侧栏-开发规格.md) | 定义工作台项目 Agent；与本文正交但共享 Agent 基础设施口径 |
| [`docs/本地伴侣-小工具架开发规格.md`](./本地伴侣-小工具架开发规格.md) | 工具页与 shell tool bundle 的产品落点 |

---

## 1. 一句话定位

> Copilot UI 不必成为主聊天入口；它应该是 AssetCutter 的 Agent Console：默认安静，负责授权、任务状态、失败恢复、工具管理和结果落地。

Copilot 不应该被做成“又一个通用聊天机器人”。用户可以直接在 Hermes / Codex / Pi 等外部大脑里对话；AssetCutter 需要自己掌握的是 `ac.*` 身体工具、权限策略、审计、任务状态、Script Hub 工具资产和工作台结果闭环。

长期形态：

```text
外部大脑 / 内置轻量入口
  → Body MCP / ac.*
  → Agent Console 在需要时浮现
  → 执行、确认、恢复、记录、管理
```

---

## 2. 第一性边界

用一个问题拆清楚：**用户到底在让谁对什么对象产生什么改变？**

| 对象 | 第一性职责 | 管什么 | 不管什么 |
|------|------------|--------|----------|
| Pi / Hermes / Codex | 大脑 / Agent Harness / 司机 | 思考、规划、上下文、工具选择 | 不拥有 AssetCutter 业务资产 |
| Copilot UI / Agent Console | 产品内执行面 / 例外处理界面 | 授权、任务、确认、失败恢复、工具管理、结果展示 | 不争夺主对话入口 |
| 工作台 Agent | 项目级业务 Agent | 当前项目、画布、资产、预设、专家、生成队列 | 不负责桌面壳和本机平台治理 |
| `ac.*` 身体层 | 稳定控制接口 | 执行壳/伴侣/Script Hub/工作台动作 | 不承担对话 UI |

推荐心智：

```text
GPT / Claude / Gemini = 发动机
Hermes / Codex / Pi   = 司机或驾驶系统
Agent Console         = 安全带、仪表盘、任务面板、维修入口
ac.*                  = 方向盘、刹车、机械臂、货架接口
工作台 Agent           = 项目车间里的专业工位助手
AssetCutter           = 车、仓库和业务货物
```

因此，后续可以允许 Pi / Hermes / Codex 作为外部大脑接入，但必须通过 `ac.*`、policy、confirm、audit。Copilot UI 的长期资产不是聊天，而是必要时的介入体验：授权、状态、恢复和工具治理。

---

## 3. 当前问题

现在 Copilot 已有 `AgentSessionService`、`AgentBodyHost`、`ac.*` 工具注册和桌面壳面板，但如果继续把它做成常驻聊天/日志/确认中心，长期使用会变成噪音。主要短板不是工具数量，也不是聊天框存在感，而是 Agent 执行层的安静性、可恢复性和可信边界：

| 问题 | 用户感受 | 工程影响 |
|------|----------|----------|
| 运行状态不可见 | 不知道事情有没有卡住 | UI 无法稳定呈现生命周期 |
| 普通动作打扰过多 | 确认疲劳，用户会忽略弹窗 | policy 缺少信任规则 |
| 结果和失败恢复弱 | 成败、产物、下一步不清楚 | 任务记录和恢复动作不成体系 |
| 工具调用呈现弱 | 出问题时不知道它做了什么 | 信任感不足，排错困难 |
| 错误信息偏底层 | 用户看到异常而不是恢复路径 | 客服和自助排障成本高 |
| 授权和审计弱 | 不知道谁在调用什么 | 外部大脑接入风险高 |

结论：**先补 Agent Console 与执行基础设施，再做“对话创建工具”。**

---

## 4. 目标体验

### 4.1 一个月后用户真正会看什么

长期使用后，用户不想看每次工具调用日志，也不想每一步都确认。用户只会稳定关注这些信息：

| 会看 | 原因 |
|------|------|
| 当前是否在跑 | 判断任务有没有卡住 |
| 最终结果 | 成没成，产物在哪 |
| 失败原因和恢复按钮 | 出错时继续推进 |
| 高风险确认 | 删除、覆盖、花钱、发布、本机写入 |
| 常用工具入口 | 不想每次重复描述 |
| 连接状态 | Maya / UE / 伴侣 / 工作台是否在线 |

用户会厌烦：

- 每次工具调用日志。
- 模型思考过程。
- 每个安全操作确认。
- 大段 JSON / 参数。
- 重复的权限弹窗。
- “我正在分析你的需求”这类无效文案。

### 4.2 三层 UI 介入

```text
L0 无 UI：直接完成
L1 轻提示：状态条 / toast / 任务角标显示进度与结果
L2 介入 UI：授权、确认、选择、失败恢复、详情
```

默认策略：

| 场景 | UI 行为 |
|------|---------|
| 安全、低成本、可撤销、已授权 | L0 或 L1，不打断 |
| 常规后台状态查询 | L0 |
| 普通工具运行 | L1 进度和结果 |
| 首次访问新系统 | L2 授权 |
| 花钱、删除、覆盖、发布、本机写入、执行脚本 | L2 确认 |
| 目标不明确 | L2 选择器 |
| 失败 | L2 恢复面板 |
| 用户主动打开 | 任务历史、工具、授权、连接状态 |

### 4.3 信任策略

“每次都确认”不可取。确认应该变成可撤销的信任规则：

```text
首次确认
  → 记住规则
  → 同类低风险动作自动执行
  → 高风险动作仍确认
  → 用户可撤销授权
```

示例：

```text
允许 Hermes 调用 Maya 导入工具：
- 仅导入当前工作台选中资产
- 不覆盖已有文件
- 不执行任意脚本
- 目标为当前打开 Maya 场景
- 有效期：30 天
```

### 4.4 任务和工具详情

工具调用卡片不应默认铺满屏幕，而应在 L2 或任务详情中出现：

| 状态 | 展示内容 |
|------|----------|
| queued | 工具名、等待原因 |
| running | 当前步骤、可取消 |
| confirm | 动作、对象范围、风险、批准/拒绝、记住规则 |
| succeeded | 摘要、关键结果、下一步 |
| failed | 可读错误、恢复动作、详情折叠 |
| cancelled | 取消结果、是否保留中间产物 |

重启壳后，Agent Console 至少恢复：

- 最近任务列表。
- 最近工具调用摘要。
- 当前大脑连接状态。
- 进行中任务的可查询状态，若无法恢复则明确标记为“状态未知，可刷新”。

---

## 5. 分阶段路线

### P0：Agent Console 与执行地基

目标：默认安静、关键时刻可靠介入。

| 项 | 内容 | 验收 |
|----|------|------|
| 任务状态机 | `queued / running / waiting_confirm / succeeded / failed / cancelled` | 每个外部调用和内置调用都能追踪 |
| 轻提示 | L1 toast/状态角标展示进度和结果 | 普通成功不打开大面板 |
| 介入面板 | L2 授权、确认、选择、失败恢复 | 只有必要时打扰 |
| 取消 | 中断当前 turn / task，并取消可取消工具 | UI 显示取消结果，不继续写脏状态 |
| 重试 | 基于失败 task 重新执行 | 新 taskId，不覆盖旧结果 |
| 错误收敛 | 错误码映射为用户可读文案 | 不直接暴露底层堆栈作为主文案 |
| 任务恢复 | 默认任务列表落盘并恢复 | 重启后能看到最近任务和未知状态 |

建议优先命令：

```powershell
npm run smoke:agent-p1
npm run smoke:agent-p2-p3
```

### P1：权限策略与工具详情闭环

目标：减少确认疲劳，同时保留风险边界。

| 项 | 内容 | 验收 |
|----|------|------|
| 信任规则 | 首次授权后可记住低风险规则 | 同类动作不重复弹窗 |
| Confirm 卡片 | `confirm` 风险工具必须等待用户批准 | 拒绝后写入 task 和 audit |
| Audit 摘要 | 写入 `clientId / brainId / tool / argsDigest / ok / errorCode` | 可排查，无敏感明文 |
| 工具结果摘要 | structured result 生成短摘要 | 用户不用读 JSON |
| 工具失败恢复 | 针对常见错误给动作 | 例如登录、重连、打开设置、重试 |
| 详情折叠 | 工具参数、日志、JSON 进详情 | 默认不污染主界面 |

### P2：长期可用

目标：每天都能用，不只是 demo。

| 项 | 内容 | 验收 |
|----|------|------|
| 对话入口可选 | 内置轻量对话可开关 | 普通用户可用，高级用户可关闭 |
| 上下文压缩 | 内置对话有 compaction | 不无限塞历史 |
| 会话归档 | 清空/新开/恢复 | 不丢历史，不污染当前会话 |
| 大脑状态 | Hermes / Codex / Pi / OpenAI compatible 状态可见 | 用户知道当前谁在开车 |
| Body MCP | 外部大脑通过同一 `ac.*` 入口调用 | 不绕过 policy/audit |
| 记忆与 Skills | 可控保存、查看、删除 | 不偷写记忆 |

### P3：对话创建工具

目标：用户把重复工作沉淀成自己的工具。

这一步必须在 P0/P1 稳定后做。Agent Console 负责创建草稿、解释和确认；Script Hub 负责工具资产化、版本、运行和审计；工具页负责展示、编辑、运行和禁用；`ac.*` 负责正式执行入口。

```text
外部大脑 / 内置轻量入口
  → 生成用户工具草稿
  → Agent Console 让用户确认名称、输入项、步骤、风险、权限
  → 写入 Script Hub / agent-store 工具资产
  → 工具页出现新工具
  → 外部大脑和内置入口都可调用
```

建议工具定义：

```ts
type UserToolDefinition = {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  inputs: ToolInputSchema[];
  steps: Array<{
    tool: string; // ac.*
    argsTemplate: Record<string, unknown>;
  }>;
  risk: 'safe' | 'confirm' | 'destructive';
  surfaces: Array<'shell' | 'workbench' | 'script_hub' | 'companion'>;
  createdBy: 'agent_console';
  enabled: boolean;
  createdAt: string;
  updatedAt?: string;
};
```

原则：优先组合已有 `ac.*`，不要让 Copilot 直接生成任意脚本并执行。确实需要脚本时，也必须进入工具页/Script Hub 的受控发布、确认和审计链路。

---

## 6. 推荐实现切片

### 6.1 数据模型

在 `agent-store` 里把任务、工具调用、授权规则和审计分开；内置对话只是可选客户端：

```text
agent-store/
  tasks/
    recent.jsonl
  sessions/
    default/
      messages.jsonl
      tool-calls.jsonl
      context-snapshot.json
  trust-rules/
  audit/
  skills/
  tools/
```

任务负责用户可见生命周期；消息只负责可选内置对话呈现；工具调用负责细节；trust-rules 负责减少重复确认；audit 负责合规排查；用户工具是可复用资产。

### 6.2 前端事件协议

Agent Console 不要直接猜状态，应消费稳定事件：

```ts
type AgentConsoleEvent =
  | { type: 'task_status'; taskId: string; status: string; summary?: string }
  | { type: 'message_delta'; messageId: string; text: string }
  | { type: 'message_status'; messageId: string; status: string }
  | { type: 'tool_call_started'; toolCallId: string; name: string; summary?: string }
  | { type: 'tool_call_confirm_required'; toolCallId: string; confirmId: string; meta: object }
  | { type: 'tool_call_finished'; toolCallId: string; ok: boolean; summary?: string; error?: string }
  | { type: 'turn_finished'; sessionId: string; ok: boolean; error?: string };
```

### 6.3 风险分级

沿用当前 `AgentToolRisk`，但 UI 必须有明确动作：

| risk | 行为 |
|------|------|
| safe | 可自动执行，记录任务；默认最多 L1 轻提示 |
| confirm | 首次或超出 trust-rule 时弹确认卡片 |
| forbidden | 不暴露给大脑，不进入工具列表 |

未来用户自定义工具默认至少 `confirm`，除非它只读、无成本、无外部副作用。

---

## 7. 不做什么

P0/P1 期间明确不做：

- 不做“对话创建工具”的完整闭环。
- 不强迫 Copilot UI 成为主聊天入口。
- 不把每次工具调用日志默认展示给用户。
- 不对每个安全动作重复确认。
- 不把 Copilot 做成工作台项目 Agent 的替代品。
- 不让大脑直接绕过 `ac.*` 调工作台、Script Hub 或本机伴侣。
- 不默认执行任意 AI 生成脚本。
- 不承诺 Copilot 与外部 Pi/Hermes/Codex 会话历史互通。

---

## 8. 成功标准

Copilot 基础设施完成后，应满足：

1. 普通低风险任务默认不打开大面板，只给必要轻提示。
2. 高风险、首次授权、目标不明确、失败时必须出现可操作 UI。
3. 任一 confirm 工具必须可批准、拒绝、取消、记住规则，并写 audit。
4. 重启壳后能恢复最近任务、授权规则和工具结果。
5. 外部大脑可通过同一身体层调用，且不绕过权限闸门。
6. 内置对话入口可以存在，但不是产品唯一入口，也不是默认注意力中心。

做到这里，再进入“用户对话创建工具”，才会有可信的产品体验。
