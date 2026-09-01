# 桌面壳 · 全局 Agent（Copilot）— 产品与架构规格

> **产品入口已废止（2026-08-25）。** 壳内管家是 dsh，属大楼不属任何租户。真源：[`架构宪章-本地壳大楼租户.md`](./架构宪章-本地壳大楼租户.md)、[`dsh本地壳-可执行开发计划.md`](./dsh本地壳-可执行开发计划.md)。  
> 本文只保留历史工程契约（`ac.*`、Body MCP、`persist:assetcutter-team`、壳内登录一次）。**禁止**再按「右侧 Copilot 是团队进入工作台的统一入口」做产品。MCP 只给楼门外的外部大脑。

本文定义 **AssetCutter 本机平台** 的 **历史 Copilot 入口**、**Agent 身体层（`ac.*` / Body MCP）**，以及与 **工作台 / Script Hub / 伴侣 / 壳** 的衔接。第一阶段优先接 Codex CLI；长期允许 Hermes、Pi、Claude Code 等成熟 Agent 接入。**平台控制能力、团队权限、用量和审计为长期资产**。

**读者**：

| 角色 | 建议阅读 |
|------|----------|
| **产品经理** | §1 产品篇、§2 资产篇、§12 路线图与指标、§14 用户承诺 |
| **架构 / 研发** | §0 ADR、§3～§11 工程契约、§13 改造清单 |
| **运营 / 交接** | §2.3 资产映射、§11 边界、§14 |

**关联**：[本地伴侣-本地程序开发.md](./本地伴侣-本地程序开发.md) · [本地伴侣-桌面壳工作台与WebView方案.md](./本地伴侣-桌面壳工作台与WebView方案.md) · [Script-Hub-开发规格.md](./Script-Hub-开发规格.md) · [本地伴侣-小工具架开发规格.md](./本地伴侣-小工具架开发规格.md) · [本地伴侣-插件与发行.md](./本地伴侣-插件与发行.md) · [架构宪章-店仓菜单.md](./架构宪章-店仓菜单.md) · [本地伴侣-沙盒目录.md](./本地伴侣-沙盒目录.md)

**文档版本**：v0.3（2026-06-30）  
**状态**：历史工程契约；产品入口已废止，勿当开工任务书。

---

## 1. 产品篇

### 1.1 一句话与定位

> **Copilot 是团队进入工作台的统一 Agent 入口，不是另一个网页聊天机器人。**

| 对比 | 说明 |
|------|------|
| **不是** | 又一个网页聊天机器人、Codex 的替代品、工作流里云端 AI 的替代品 |
| **是** | 把 **Codex 等成熟 Agent 能力、工作台资产/项目/能力、团队权限和用量管理** 接到一起 |
| **用户得到** | 团队成员从右侧 Copilot 开始工作，通过统一入口安全调用工作台：`准备工作台 -> 创建/打开项目 -> 运行能力 -> 列资产 -> 读取产物` |

### 1.2 已决产品形态

| 项 | 决策 |
|----|------|
| **全局 UI** | **C：主窗右侧固定 Copilot**，作为团队进入工作台的统一 Agent 入口 |
| **Script Hub** | **B：第五导航「脚本」+ BrowserView**（`scriptHubUrl`）→ **真源独立仓** `F:/AI/ScriptHub`；主仓 `script-hub/` **已废弃**（2026-06-30） |
| **工作台** | **B：主站 Agent API**（不 CDP 点页面） |
| **大脑** | 第一阶段默认接 **Codex CLI**，复用成熟本机执行和文件操作能力；后续可插拔 |
| **工作台控制层** | **Body MCP / `ac.*`** 暴露标准工作台能力，所有 Agent 必须经同一权限和审计链路 |
| **团队治理** | 凭据分发、权限授权、自动执行策略、Token 用量、日志、审计集中管理 |

### 1.3 用户画像与典型场景

| 画像 | 诉求 | 首选入口 | 典型一句话 |
|------|------|----------|------------|
| **日常创作者** | 少记菜单，串联工作台能力 | 右侧 Copilot | 「帮我准备工作台，创建项目，跑这个能力并把产物列出来」 |
| **技术美术** | Maya / 本机分割 / 卷内资产 | 右侧 Copilot + Codex | 「检查当前项目资产，整理一版预览，再导到 Maya」 |
| **工作流研发 / 管理员** | 研发流程、沉淀预设、治理团队用量 | Copilot / Codex / Body MCP | 「把这个外部 Agent 流程整理成工作台预设，给团队成员使用」 |
| **仅浏览器用户** | 不用 Agent 编排 | 工作台 / Script Hub 手动 | 资产与页面仍正常，但不走统一 Agent 入口 |

### 1.4 用户旅程（Happy Path）

**旅程 A — 团队 Copilot 入口**

```text
打开壳 → 右侧 Copilot 输入意图
  → Codex CLI / 成熟 Agent 规划
  → Body MCP / ac.* 准备工作台、创建或打开项目、运行能力、列资产、读取产物
  → Copilot 展示状态、授权、用量、日志和失败恢复
  → 结果落到工作台项目和资产库
```

**旅程 B — 手动工作台（始终成立）**

```text
侧栏手动切页 → 工作台 / Script Hub / 工具页照常使用
伴侣 compute、小工具、扩展包路径不变
```

**旅程 C — 外部 Agent / 工作流研发**

```text
管理员或研发人员在 Codex / Hermes / Pi 中研发流程
  → 通过 Body MCP 调用工作台能力验证
  → 沉淀为预设能力或 Script Hub 工具
  → 团队成员从 Copilot 或工作台界面直接使用
```

### 1.5 设置信息架构（产品）

**设置 → 本机 Agent**（新区块，与「与网站配对」「本机引擎」并列）：

| 分组 | 内容 | 阶段 |
|------|------|------|
| **统一入口** | Copilot 展开/宽度；快捷键；成员首次引导 | P0 |
| **大脑** | Codex CLI 状态；各适配器启用/连接状态；命令/cwd/model 配置 | P0/P1 |
| **工作台控制** | Body MCP Token；工作台登录态；工具链 e2e 状态 | P0/P1 |
| **团队治理** | 权限模式；自动执行策略；凭据分发；Token 用量；日志和审计 | P1/P2 |
| **数据** | 会话存储位置；导出/清空 audit；团队用量汇总 | P1/P2 |

**文案原则**：区分 **「工作台里的 AI 生成」** 与 **「团队 Copilot 入口」**；区分 **「大脑账号 / Codex 凭据」** 与 **「伴侣配对密码」**。

### 1.6 非目标（产品）

- 替代工作流画布上的 **云端模型节点**。
- 把 Copilot 做成另一个网页聊天机器人。
- 重新发明比 Codex 更强的大脑。
- P0 承诺「用 Hermes 官方 UI 嵌在壳里」。
- 跨产品同步 Copilot 与 Hermes 的 **聊天记忆**（L3 仅保证 **技能/身体能力** 可共享，见 §14）。

---

## 2. 资产架构篇

### 2.1 与「店—仓—菜单」的对齐

借用 [架构宪章-店仓菜单.md](./架构宪章-店仓菜单.md) 比喻：

| 宪章层 | 本特性映射 |
|--------|------------|
| **供货商** | 外部 **大脑**（Hermes、OpenAI、Claude Code…）；只认 Adapter 合同 |
| **仓库** | **`AgentBodyHost` + `ac.*`**：把「意图」翻译成壳/伴侣/主站/Script Hub 可执行调用 |
| **门面 / 菜单** | **内置 Copilot UI**；未来 **MCP 工具列表** 对外展示同一菜单 |
| **拣货 / 编排** | **`AgentSessionService`**（内置 Copilot 路径）；外部大脑自编排，但 **必须经 Body 闸门** |

**依赖方向（单向）**：

```text
用户 / 大脑
  → Session（可选，仅 Copilot 路径）
  → BodyHost（ac.*）— 本站长期资产，版本化
  → 既有子系统（伴侣 HTTP、壳 IPC、主站 Agent API、Script Hub API）
  → 禁止：大脑或 BrowserView 页面直连供货商替代 ac.*
```

### 2.2 资产分层（什么归谁、存活多久）

```text
┌─────────────────────────────────────────────────────────────┐
│ L4 用户工作资产（项目卷、Script Run、Job 结果、云项目）         │  ← 已有，Agent 只读写不拥有
├─────────────────────────────────────────────────────────────┤
│ L3 平台 Agent 资产（agent-store：会话、策略、技能、审计）       │  ← 本产品持久化真源
├─────────────────────────────────────────────────────────────┤
│ L2 身体契约（ac.* schema + BodyHost 实现）                   │  ← 核心 IP；semver bodyToolsVersion
├─────────────────────────────────────────────────────────────┤
│ L1 子系统 API（伴侣 /v1、主站 Agent API、Script Hub /api）      │  ← 已有资产，Agent 复用
├─────────────────────────────────────────────────────────────┤
│ L0 可插拔大脑（Adapter + 用户 Provider 登录）                 │  ← 可替换；不拥有业务数据
└─────────────────────────────────────────────────────────────┘
```

**口诀**：**L2 及以上是 AssetCutter 资产；L0 是用户的推理供应商选择。**

### 2.3 与现有仓库资产的映射

| 已有资产 | 角色 | Agent 层接入方式 | 是否新建平行 API |
|----------|------|------------------|------------------|
| `local-companion` HTTP | 本机算力与存储 | `ac.companion.*` → 现有 `/v1/*` | **否** |
| `companion-desktop` 壳 IPC | 导航、BrowserView、bootstrap | `ac.shell.*` | **否** |
| `shell_tool_bundle` | 第四页小工具 | `ac.shell_tool.run`（P1） | **否** |
| `host_plugin_bundle` | 扩展包 compute | `ac.host_bundle.*`（P1） | **否** |
| Script Hub 云 API | 脚本库与 Run 记录 | `ac.script_hub.*`（P1） | **否**（独立仓 Tool Bridge HTTP） |
| 主站工作区 + 能力预设 | 工作台业务 | `ac.workbench.*` + **新** `/api/agent/workbench/*` | **仅 Agent 薄 API** |
| Relay / `local-bridge` | 网站 WSS 浏览器中转 | **不经过 ac.***；并行能力 | **否** |
| 工作流 `capabilityExecutor` | 画布拣货 | Agent **调用相同执行语义**，不嵌入画布 | **否** |

**资产原则**：新增能力时 **先登记 `ac.*`**，再实现 BodyHost 转发；**禁止**为 Copilot 单独开一套伴侣 API。

### 2.3.1 路径分层（执行真源 vs 对外插头）

> **操作工作台不必强制经过 MCP。** 执行真源永远是 `ac.*`（`AgentBodyHost`）。MCP 是把同一套工具暴露给 Cursor / Codex / 外部 Agent 的标准插头。

| 路径 | 怎么进身体 | 何时用 |
|------|------------|--------|
| 壳内 Copilot | IPC → Session/Runtime → **直连 BodyHost** | 日常团队入口；可不经 MCP 协议 |
| Cursor / Codex / 外部 Agent | **Body MCP** → 同一 BodyHost | 调试期与外部大脑复用同一工具表 |
| 禁止 | 绕过 `ac.*` 直调工作台私有接口；以 DOM/点选 UI 当主控制路径 | — |

```text
Copilot UI ──IPC──► BodyHost (ac.*) ──► 工作台 / Script Hub / 伴侣
Cursor/Codex ─MCP─► BodyHost (ac.*) ──► 同一实现、同一 policy + audit
```

**权限梯度（产品口径）**：只读默认可自动；可写/花钱首次确认并可记住信任规则；删除/发布/本机写盘等高风险始终确认。「全权 / Auto」是**显式模式**，不是默认裸奔。

**覆盖率目标**：人在工作台 UI 能完成的操作，应逐步登记为对等 `ac.*`；用「人可点动作数 / 已有工具覆盖数」衡量，而不是用聊天聪明程度衡量。

### 2.4 多客户端模型（门面可选）

**Copilot 不是身体的独占客户端。**

| 客户端 | `clientId` | 会话存储 | 适用用户 |
|--------|------------|----------|----------|
| 内置 Copilot | `copilot` | `agent-store/sessions/` | 默认 |
| Body MCP Server | `mcp` | 可选仅 audit；对话在对方大脑 | 外部大脑复用 / 调试入口 |
| Body HTTP（备选） | `http` | 同上 | 自动化脚本 / P2+ |

```text
         ┌─────────────┐     ┌─────────────┐
         │ Copilot UI  │     │ Cursor/Codex│
         └──────┬──────┘     └──────┬──────┘
                │ IPC               │ MCP（插头）
                ▼                   ▼
         ┌──────────────┐    ┌──────────────┐
         │ AgentSession │    │ Body MCP     │
         │ （可选编排）  │    │ → BodyHost   │
         └──────┬───────┘    └──────┬───────┘
                └────────┬──────────┘
                         ▼
                  AgentBodyHost
                  同一 ac.* 注册表
                  同一 policy + audit
```

**产品承诺**：

| 能力 | 内置 Copilot | 外部大脑 + MCP |
|------|--------------|----------------|
| 切壳页面、查伴侣状态 | ✅ | ✅ |
| 跑 Script / 工作台能力 | ✅（直连 `ac.*`） | ✅（同工具，经 MCP） |
| 对话历史与 Copilot 互通 | ✅ | **不承诺** |
| 统一确认与审计 | ✅ | ✅ |

### 2.5 身体工具（`ac.*`）资产治理

| 规则 | 说明 |
|------|------|
| **命名** | 仅 `ac.<domain>.<action>`；大脑原生 `brain.<brainId>.*` |
| **版本** | `agent-store/manifest.json` 的 `bodyToolsVersion`；构建生成 `tools-manifest.json` |
| **废弃** | 只标 `deprecated`，不改名 |
| **新增** | PR 必含：schema、risk、surfaces、单测快照、本表 §7 更新 |
| **扩展域** | 新子系统先增 `surfaces` 枚举，再增 tool |

---

## 0. 架构决策摘要（ADR）

| ID | 决策 | 产品/资产理由 |
|----|------|----------------|
| **A-1** | Session 在 **`companion-desktop` 主进程** | 身体触达壳 IPC；伴侣保持无 UI 可独立演进 |
| **A-2** | **`ac.*` 唯一稳定身体契约**；原生 `brain.<id>.*` | L2 资产可版本化、可对外 MCP |
| **A-3** | **单槽 BrowserView**（工作台/脚本二选一） | 控制实现成本；中间区仍是「一个主舞台」 |
| **A-4** | 工作台 / Script Hub / 后续一方网页：统一本地壳一方网页 session partition `persist:assetcutter-team` | 壳内登录一次，工作台、Script Hub、Copilot/MCP 复用同一主站登录态；第三方外链仍外部打开 |
| **A-5** | P0：**openai_compat** 验证身体；**Hermes P1** 默认大脑 | 大脑供货商不阻塞身体资产落地 |
| **A-6** | **profile.yaml** 为产品 system 真源 | 换大脑门面行为一致 |
| **A-7** | L2 跨脑 E2E **P2 验收** | P0 只交付协议与存储 |
| **A-8** | **Body 经 MCP 对第三方大脑暴露（P2）**；默认关闭 | Copilot 可选；身体资产仍服务进阶用户 |

---

## 3. 交互与壳布局（摘要）

三栏：**左导航 56px | 中间内容 / BrowserView 槽 | 右 Copilot 360px（可折叠 48px）**。  
侧栏：**首页 → 工作台 → 脚本 → 工具 → 设置**。

**布局公式**（实现必守）：

```text
BrowserView: x=56, y=30,
  width = contentWidth - 56 - copilotEffectiveWidth,
  height = contentHeight - 30
```

切换视图时 **`layoutShellChrome()`** 统一重算；离嵌入页 **`detachEmbeddedBrowserView()`**。

Script Hub：`scriptHubUrl`；与工作台、后续一方网页和 Copilot/MCP 共用本地壳一方网页 partition `persist:assetcutter-team`，复用同一主站登录态；第三方外链不进入该 partition。

---

## 4. 进程与模块

```text
Copilot UI ──IPC──► AgentSessionService ──► AgentBodyHost ──► 子系统 API / 壳 IPC
                         │                      ▲
                         └── BrainAdapter       └── MCP Server（P2，同 BodyHost）
local-companion：不承载 Session；继续承担 L1 伴侣 API
```

| 模块 | 路径 |
|------|------|
| Session | `companion-desktop/agent-session/` |
| BodyHost | `companion-desktop/agent-body-host.cjs` |
| Store | `companion-desktop/agent-store.cjs` |
| Brain 适配器 | `companion-desktop/brain-adapters/*.cjs` |
| 嵌入 Web | `companion-desktop/embedded-browser-manager.cjs` |
| Copilot UI | `companion-desktop/shell/copilot-panel.js` |
| Body MCP（P2） | `companion-desktop/agent-body-mcp.cjs` |
| 主站 Agent API（P1） | `server/` + `services/agentWorkbenchApi.ts` |

---

## 5. 接口契约（研发）

### 5.1 Body Port

```ts
type AgentToolRisk = 'safe' | 'confirm' | 'forbidden';

type AgentToolSchema = {
  name: string;              // ac.*
  description: string;
  inputSchema: object;
  risk: AgentToolRisk;
  surfaces?: ('shell' | 'workbench' | 'script_hub' | 'companion' | 'os')[];
  deprecated?: boolean;
};

interface AgentBodyPort {
  listTools(ctx: AgentContext): Promise<AgentToolSchema[]>;
  executeTool(name: string, args: Record<string, unknown>, ctx: AgentContext): Promise<AgentToolResult>;
}
```

`args` 必须 schema 校验；失败 `AGENT_TOOL_INVALID_ARGS`。

### 5.2 Brain Port

```ts
interface AgentBrainPort {
  readonly id: string;
  probe(): Promise<{ ok: boolean; detail?: string }>;
  streamTurn(input: { messages; tools; signal? }): AsyncIterable<AgentStreamEvent>;
  listNativeTools?(): Promise<AgentToolSchema[]>;  // brain.<id>.*
  executeNativeTool?(name, args, ctx): Promise<AgentToolResult>;
}
```

### 5.3 Session 循环（Copilot 路径）

加载 profile + snapshot → merge tools → streamTurn → 执行 ac.* / brain.*（policy + confirm）→ 写 messages.jsonl → audit。  
**MCP 路径（P2）**：直连 BodyHost，无 Session 也可；**同一 policy/audit**。

### 5.4 IPC（Copilot）

`agent-session:send` | `abort` | `confirm` | `subscribe` — **仅** shell preload，BrowserView **不得**注册。

---

## 6. Agent Store（L3 资产）

路径：`sandbox/agent-store/`（见 [本地伴侣-沙盒目录.md](./本地伴侣-沙盒目录.md)）。

| 目录 | 资产类型 | 阶段 |
|------|----------|------|
| `sessions/` | 对话 canonical | P0 |
| `profile.yaml` / `policy.json` | 产品策略 | P0 简 / P1 全 |
| `audit/` | 合规追溯 | P1 |
| `skills/` / `memory/` | 可复用剧本与记忆 | P2 |
| `brains/` | 大脑连接元数据（无私钥） | P1 |

**单写者** Session；append-only `messages.jsonl`；失败停 tool。

---

## 7. 身体工具清单（`ac.*`）

### 7.1 P0 — 「能指挥壳」

| name | risk | 用户可见价值 |
|------|------|--------------|
| `ac.shell.navigate` | safe | 口述切到脚本/工作台等 |
| `ac.shell.get_state` | safe | 一句话查伴侣与本机引擎 |
| `ac.companion.runtime_status` | safe | 诊断 SamLocal/rembg 等 |

### 7.2 P1 — 「能干活」

| name | risk | 映射资产 |
|------|------|----------|
| `ac.workbench.*` | mixed | 主站 Agent API + capabilityExecutor 语义 |
| `ac.script_hub.*` | mixed | ScriptHub Tool Bridge `/tool-bridge/*`（integration v1） |
| `ac.companion.compute` | confirm | `/v1/compute/jobs` |
| `ac.shell_tool.run` | confirm | shell_tool_bundle |
| `ac.shell.bootstrap` | confirm | 本机引擎 bootstrap |

### 7.3 P2 — 「可复用剧本」

能力预设 / Script / shell_tool → `agent-store/skills/`（agentskills.io）。

---

## 8. 主站 Agent API（P1）

| 方法 | 路径 |
|------|------|
| `GET` | `/api/agent/workbench/context` |
| `POST` | `/api/agent/workbench/open-project` |
| `POST` | `/api/agent/workbench/run-capability` |

鉴权：**P1a** partition Cookie；**P1b** `/api/agent/session-token`。  
未登录 → `AGENT_AUTH_REQUIRED` + 引导打开对应 BrowserView 登录。

---

## 9. 大脑适配器

| 阶段 | 大脑 | 角色 |
|------|------|------|
| P0 | `openai_compat` | 验证 Session + 身体 |
| P1 | `hermes` | **生产默认**；模型在 Hermes 内配置 |
| P2+ | `claude_code`、`codex` | 仅增 Adapter |

Hermes：Gateway `127.0.0.1:19119`；`hermes-bootstrap/`；开工前 **spike** 协议。

---

## 10. 安全

| 级别 | 行为 |
|------|------|
| safe | 自动 |
| confirm | 对话卡片 |
| forbidden | 不注册 |

- 大脑输出 **不可信**；schema + policy。  
- MCP **默认关**；开启需 Token + 设置明示（A-8）。  
- audit 记 `clientId, brainId, tool, argsDigest`（无密钥明文）。

---

## 11. 边界（避免产品打架）

| 系统 | 关系 |
|------|------|
| **工作流云端 AI** | 画布生成；**不共用** Copilot session；可共用 **L4 项目资产** |
| **Relay** | 网站 WSS→浏览器；**不替代** ac.* |
| **伴侣管理页** | 运维/debug；Copilot 是 **产品向** 入口 |
| **外部 Hermes UI** | P2 经 MCP 调 **同一身体**；不是第二套平台 API |

---

## 12. 路线图：阶段交付物与指标

### 12.1 阶段表（产品结果导向）

| 阶段 | 用户可感知交付 | 资产交付 | 成功指标（建议） |
|------|----------------|----------|------------------|
| **P0** | 右侧 Copilot；口述切页+查状态；脚本第五导航 | `ac.*`×3、agent-store、BodyHost、单槽 BrowserView | Copilot 周活（壳内）；`navigate` 成功率；P0 验收 5 条全过 |
| **P1** | 口述跑脚本/能力/本机 Job；Hermes 默认大脑 | 全量 P1 `ac.*`、主站 Agent API、audit | 任务完成率；`AGENT_AUTH_REQUIRED` 转化（登录后重试） |
| **P1-A** | **壳内 Hermes 引导**（新用户不出壳即可聊） | `hermes-gateway-host`、settings 持久化、Copilot 空态 + 设置页状态灯 | 一键配置成功率；Gateway 探测通过率 |
| **P1-B** | **老用户一条命令连接** | `companion-connect.cjs`、`npm run companion:connect`、壳内「连接已有 Hermes」 | 探测命中率；MCP 导入成功率 |
| **P1-C** | **发行与新手默认** | 打包 `hermes-bootstrap`、首启 Copilot 引导、`brainSetupCompleted` | 首启完成配置比例 |
| **P2** | 换大脑不断能力；外部 MCP；skills | 第二 Adapter、Body MCP、memory/skills | 跨脑切换成功率；MCP 调用占比 |
| **P3** | 多步计划、定时、工作流联动 | plans、调度器 | 长任务完成率 |

### 12.2 P0 验收（不变）

1. Copilot 流式对话；重启恢复 `messages.jsonl`。  
2. 「打开脚本页」→ `scripts` + 正确 URL。  
3. 「伴侣状态」→ runtime 摘要。  
4. 未注册 P1 工具不可被调用。  
5. BrowserView 切换无残留。

### 12.3 风险（产品向表述）

| 风险 | 用户影响 | 缓解 |
|------|----------|------|
| 大脑 API 不确定 | 晚上线 Hermes | P0 不依赖 Hermes |
| 工作台未登录 | 口述跑工作台能力失败 | 明确提示打开壳内工作台登录，并通过 `persist:assetcutter-team` 复用登录态 |
| 右栏占空间 | 小屏憋屈 | 默认折叠策略 |

---

## 13. P0 改造清单

| 路径 | 动作 |
|------|------|
| `companion-desktop/main.cjs` | embedded-browser-manager；Copilot 宽；`scripts` |
| `companion-desktop/shell/*` | 三栏 + copilot-panel |
| `companion-desktop/agent-*` | Session、Store、BodyHost、openai_compat |
| `tests/agentToolSchema.test.ts` | ac.* 快照 |
| `docs/本地伴侣-桌面壳工作台与WebView方案.md` | 第五导航 + 三栏（实现时） |

---

## 14. 用户承诺（对外口径）

| 承诺 | 说明 |
|------|------|
| **不用 Copilot 也能正常用壳** | 侧栏与既有 API 不变 |
| **换大脑不换「能干什么」** | `ac.*` 稳定；L1 |
| **换大脑可接着聊（内置 Copilot）** | L2；跨脑 E2E P2 |
| **自带 Hermes 也能控盘** | **P2 MCP**；与 Copilot 会话 **不合并** |
| **不承诺** | 免费模型、绕过 confirm、替代工作流 AI |

---

## 15. 配置项速查

| 键 / 环境变量 | 含义 |
|---------------|------|
| `scriptHubUrl` | 脚本 BrowserView |
| `defaultBrainId` | agent-store/settings.json |
| `COMPANION_HERMES_GATEWAY_PORT` | 默认 19119 |
| `COMPANION_AGENT_OPENAI_*` | P0 联调大脑 |
| `agent-store/policy.json` | 白名单与 confirm |
| MCP 开关 | P2；设置 → 外部 Agent |

---

## 16. 可观测性与测试

- 日志 `[agent-session]` / `[agent-body]`；audit 按 `clientId` 分渠道。  
- 单测：schema、tool 冲突、navigate 枚举。  
- E2E（P1）：发消息 → 切 view / 跑脚本。

---

## 17. 相关文档

- [附录-伴侣错误码.md](./附录-伴侣错误码.md)（`AGENT_*` 前缀）  
- [本地伴侣-待决策清单与建议.md](./本地伴侣-待决策清单与建议.md) §3  

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-06-30 | 初稿 |
| v0.2 | 2026-06-30 | 架构评审：ADR、P0/P1 拆分、鉴权、单槽 BrowserView |
| v0.3 | 2026-06-30 | **产品+资产优化**：§1 产品篇（画像/旅程/设置 IA）；§2 资产篇（店仓对齐、L0–L4、现有资产映射、多客户端 A-8/MCP）；路线图改用户指标；§14 用户承诺；结构分读者；工程章节压缩引用 |

### v0.2 → v0.3 优化要点

1. **产品经理**：补画像、旅程 A/B/C、设置 IA、阶段成功指标、对外承诺表。  
2. **资产架构**：对齐店仓菜单；L0–L4 分层；明确 **不新建平行伴侣 API**；`ac.*` 治理规则。  
3. **外部 Hermes/Codex**：升格为 A-8 + §2.4，避免与「可选 Copilot」矛盾。  
4. **文档结构**：读者导读；产品/资产/工程分层，避免纯工程文档难评审。
