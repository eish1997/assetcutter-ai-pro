# 网页端 · 项目 Agent 侧栏 — 开发规格

**版本**：v0.6.2（2026-07-10）  
**状态**：产品与架构对齐稿 + Agent 工程契约；**阶段 3 / U2、阶段 4 / U3、阶段 5 / U4 已出口**；§0.3 **P0.5-a/b/d 已落地**（c/e 仍可选）；**专家 invoke 已接真 LLM**（Host `generateText`；失败回退模板草稿）。  
**定位**：工作区**项目内**常驻的 IDE 式 Agent 面板；主 Agent 编排；专家可 `@` 点名，带 **Profile（身份）** 与 **Memory（沉淀记忆）**；聊天可调优、**专家工作室**可治理；交付分层见 §5.0；持久化与商业级会话见 **§17.10 / §18**；P0 硬度见 §16；专家工程见 **§17**；**对标尺子与体验债见 §0.1～§0.3**。

**读者**

| 角色 | 建议阅读 |
|------|----------|
| 产品 | **§0.1～§0.3**、§1、§2（含 P16–P25）、§4.2、§5.0、§11.0、§15、§17.1、§17.9～§17.10、**§18** |
| 架构 / 前端 | **§0.1～§0.3**、§3、§5、§15、§16、**§17～§18**、§7～§11 |
| Agent 工程 / QA | **§0.2**、**§16、§17、§18**、§12、§15.3 |
| 交接 | **§0.2**、§2、§3、§13、§15～§18 |

**关联文档**

| 文档 | 关系 |
|------|------|
| [`docs/VISUAL_AGENT_GAP_AND_ROADMAP.md`](./VISUAL_AGENT_GAP_AND_ROADMAP.md) | 视觉 Agent 北极星；本规格是其**网页入口与 Harness 编排面**，不替代语义/评估闭环 |
| [`docs/本地伴侣-全局Agent规格.md`](./本地伴侣-全局Agent规格.md) | **桌面壳** Copilot / `ac.*` 身体层；与本规格**正交**（见 §3 A3） |
| [`docs/adr/统一派发积分闸门-v2.md`](./adr/统一派发积分闸门-v2.md) | Agent 调工具仍经统一积分闸门 |
| 现实现：`WorkspaceQuickComposeBar` / `QuickComposeChatDock` / `quickComposeThreadStore` / `WorkflowSection.submitQuickCompose*` | **被本规格取代的入口形态**；队列与能力执行可复用 |

---

## 〇、架构摘要（30 秒）

```text
App 壳（已进入 workspaceProject）
├─ 中间：可变表面（画布 / 大图 / 分镜表 / 资产集 / …）
└─ 右侧：项目 Agent 侧栏（常驻，可收起；不随表面卸载）
         ├─ 项目一条主会话（2A；清空/新开→归档，§18）
         ├─ 当前表面上下文芯片
         ├─ Composer（A+C + @资产|预设|专家）
         │    └─ send → ProjectAgentRuntime
         │          ├─ 路由（规则 / @expert）
         │          ├─ B 层上下文装配（滑动 + compaction，§18）
         │          ├─ 媒体工具 → 队列 → L1 画布
         │          └─ invoke_expert → Profile + Memory → Artifact
         │               └─（确认）Promote → L3 预设
         ├─ 会话存档：本机热窗口 + P0 异步云备份 → P1 云真源（1C，§18）
         └─ 专家工作室（侧栏菜单/设置入口；非独立管理站）
              └─ 查看/确认人设 · 删记忆 · 工具白名单 · 最近调用摘要
```

**一句话**：侧栏是项目级 Agent；专家可点名、有人设与沉淀记忆；**聊天调优 + 工作室治理**；会话按商业级三层（存档/装配/记忆）；画布与预设是交付物；不是网页 Hermes。

### 0.1 我们不是 ChatGPT / Gemini（对标尺子）

> **评审与演示请用本表，勿用「整页通用聊天」当完成标准。**  
> 产品锚点是 **Cursor / Lovart 式「右侧 Agent + 中间真源」**，不是 ChatGPT 整页会话产品（§1.2、§1.4）。

| 维度 | ChatGPT / Gemini | 本产品 | 规格态度 |
|------|------------------|--------|----------|
| 入口 | 整页对话即产品 | 项目内右侧侧栏；中间画布/大图为真源 | **有意不同** |
| 意图表达 | 纯自然语言为主 | **A+C**：芯片 + 可拖预设 + `@`（显式路由） | **坚持**；自动挡仅 P2 可选 |
| 交付物 | 聊天气泡内为主 | **画布 L1 + 会话计划/进度**；聊天是编排面 | **坚持** |
| 多会话列表 | 左侧线程历史 | **一项目一热线程**；清空/新开→归档 | **明确不做**（§18.4）；最多「恢复上一段」 |
| 换设备续聊 | 云为真源 | P0 本机热 + 异步备份；**P1 云真源** | **已计划（P1e）** |
| 长对话 | compaction / 摘要 | 热窗 80；B 层 + compaction v0 | **已计划（P1e / §18.5）** |
| 记忆 / 人设 | Memory、Custom GPT | Expert Profile + Memory + Studio | **已计划（P1 / U3）** |
| 流式打字机 | SSE / 逐 token | 计划模板 + 队列进度；文结果整段回写 | **体验债（§0.3）**；不挡 U2/U3 门禁 |
| 消息编辑 / 分支 / 变体 | 常见 | 无 | **体验债（§0.3）** |
| 多工人进度卡 | 部分产品有 | 无 | **已计划（P2 / U4）** |

**禁止用下列缺口否定 U1/U2 出口**：多会话列表、网页 Hermes、独立专家管理站、P0 向量库、聊天写入 `workflow.json`。

### 0.2 完成态看板（工程事实；随合流更新）

> 符号：✅ 已合流可测 · 🚧 进行中 / 手测硬化 · ⬜ 未开工。  
> **门禁**：未过 U1 不进阶段 4；未标 U2 不宣称「P0d 完成」。更新日期：**2026-07-10**。

| 对内阶段 | 规格 | 用户里程碑 | 状态 | 备注 |
|----------|------|------------|------|------|
| **1** | P0a + P0b | U0 | ✅ | 路由评测 / Host mock / Runtime 契约 |
| **2** | P0c | **U1** | ✅ | Dock + `submitTurn` + 计划模板 + 画布交付；壳级抽离仍可继续还债 |
| **3** | P0d + §18 P0 | **U2** | ✅ | **已出口**（2026-07-10：工程代测 66 绿 + 产品点验通过） |
| **4** | P1a–e + §17/§18 P1 | **U3** | ✅ | **已出口**（2026-07-10：工程合流+审查修复 113 绿 + 产品 U3 五屏点验通过） |
| **5** | P2+ | **U4** | ✅ | **已出口**（2026-07-10：5A+5B+5C + 审查修复 vitest 绿 + 产品手测通过） |

#### 2026-07-10 U2 代测记录

| 项 | 结果 |
|----|------|
| vitest：phase2 / routing / cloudSync / archive / quotas / turnContext | **66 绿** |
| 接线：取消/重试 UI、`cancelInFlight`、turnId 幂等、`scheduleBackup`、App flush、清空归档、配额 guarded、闪红先 pending、取消粘性 | **已接线** |
| 浏览器 E2E（自动化） | 卡在登录页未跑通 |
| **产品点验**（发送不闪红 / 取消粘性 / 清空+大图同线程） | **通过**（用户确认 2026-07-10） |
| 已知已修竞态 | 发送闪 orphan；取消后变 orphan（finally 清 cancelled + 粘性） |

**U2 正式出口。** 下一跳：阶段 4 / U3（§11.1）；hydrate orphan 误报等实现债不挡开阶段 4。

#### 2026-07-10 U3 出口记录

| 项 | 结果 |
|----|------|
| 工程合流 + 审查修复 | vitest 相关 **113 绿** |
| **产品 U3 五屏点验** | **通过**（用户确认 2026-07-10） |

**U3 正式出口。** 下一跳：阶段 5 / U4，或弱并行 §0.3（a→b→d）。

#### 2026-07-10 U4 出口记录

| 项 | 结果 |
|----|------|
| 工程合流（5A/5B/5C）+ 审查修复 | 发送门禁/@专家、双注入、计费 surface、childRuns 均分；相关 vitest 绿 |
| 代测（Playwright） | 核心项 PASS；自动挡偏图曾 SKIP |
| **产品手测** | **通过**（用户确认 2026-07-10：基本没什么问题） |

**U4 正式出口。** 后置可选：§0.3-c 流式（先冻契约）、Dreaming/伴侣桥、云 archive list。专家真 LLM：**已接线**（2026-07-10）。

| 能力切片 | 状态 | 落点 |
|----------|------|------|
| 统一发送 / 计划可见 / 画布出活 | ✅ | U1 |
| 取消 · 重试 · turnId 幂等 | ✅ | 3A + 取消粘性 / 假停硬化 |
| 异步云备份 + 重试 flush | ✅ | 3B；`threadCloudSync` + App online/visibility |
| 清空/新开→归档 | ✅ | 3C；清空竞态已修 |
| 本机配额可感知裁剪 | ✅ | 3D |
| 发送不闪 orphan / 闲时先 pending | ✅ | 手测回归项见上表 1 |
| 云为真源 + pull/LWW | ✅ | 4F + hydrate getFreshLocal 防盖本地 |
| B 层装配 + compaction v0 | ✅ | assembly 已接 submitTurn（文/专家）；生图不贴 |
| `@专家` + Profile + Memory + Studio | ✅ | 多专家+调优；**真 LLM**（Host generateText，失败回退模板） |
| Artifact 试跑 + Promote→预设 | ✅ | Studio UI + confirmed 门闩 |
| 子 run 进度卡 | ✅ | 5A；U4 手测通过 |
| §0.3 对话抛光（流式/MD/编辑） | 🚧 | **a+b+d 已做**；c/e 仍可选；流式须先冻契约 |
| 模态自动挡（P23） | ✅ | 5B；U4 手测通过 |
| 加载更早 / 导出 | ✅ | 5C（本机归档/冷袋）；U4 手测通过 |

**实现层已知债（非产品范围变更）**：大量 Host 适配仍在 `WorkflowSection`；真壳级 Dock 迁出未完；状态 effect 与队列生命周期耦合紧——阶段 4 前宜继续收敛边界（§16.6）。hydrate `assetCatalogEmpty` orphan 误报（审查 medium）不挡 U2。

### 0.3 对话体验抛光 backlog（P0.5 / 可选并行）

> **定位**：补「看起来像商业聊天」的体感；**不是**第二套产品方向。  
> **纪律**：可与阶段 3 收口或阶段 4 **弱并行**；**不得**阻塞 U2 出口判定，也**不得**替代 U3 专家里程碑。  
> **传输**：若做流式，须先冻结「文工具结果通道」契约（队列整段 vs chat stream），禁止无契约直接改 UI。

| 优先级 | 项 | 用户可见 | 依赖 / 风险 | 状态 |
|--------|-----|----------|-------------|------|
| P0.5-a | 空态 / 忙态 / 错误态文案与禁用态统一 | 高 | 低；纯 UI | ✅ 2026-07-10 |
| P0.5-b | 助手气泡 Markdown（代码块/列表） | 高 | 中；XSS 与样式隔离 | ✅ 2026-07-10（安全子集，无 raw HTML） |
| P0.5-c | 文生文流式（打字机） | 高 | **高**；需流式契约 + 与队列进度并存规则 | ⬜ |
| P0.5-d | 细粒度步骤时间线（计划→排队→工具→完成） | 中 | 中；复用/对齐 Trace，勿造第二套状态机 | ✅ 2026-07-10（消息 status+planSteps 派生） |
| P0.5-e | 编辑已发送用户消息并重跑 | 中 | 中；新 turnId + 积分 | ⬜ |
| P0.5-f | 从某条分支重说 / 多变体 | 低 | 高；与「一项目一热线程」冲突风险大，默认不做 | ⬜ 默认否决 |
| P0.5-g | 分享/导出单段对话 | 低 | →P2 导出更合适 | ⬜ |

**默认推荐顺序**：a → b → d；**c 单独开契约评审**后再做。f 默认否决，除非产品书面改 §18.4。

---

## 1. 产品篇

### 1.1 问题与机会

| 现状问题 | 后果 |
|----------|------|
| 底部条与展开侧栏**两套发送语义**（预设卡 / 强制文 / 伪多轮） | 用户无法建立稳定心智；难教、难测 |
| 对话挂在工作流局部，大图另开会话 | 「对话」不像 IDE Agent，像附属输入条 |
| 伪多轮 = 最近几轮贴进 prompt | 无工具边界、无计划可见性，达不到商业 Agent 体感 |
| 与伴侣壳 Copilot 易混淆 | 需产品文案与架构边界写死 |

**机会**：对齐 Cursor / Lovart「右侧 Agent + 中间真源」；同时保留 Flow 式 **显式控件（A+C）**，降低纯自然语言猜意图的失败率。

### 1.2 一句话定位

> **在网页工作区项目内，提供常驻右侧 Agent：用户用同一 Composer 说话与附带意图控件；Agent 编排现有生成/能力工具；产物落在画布。**

| 是 | 不是 |
|----|------|
| 项目级 IDE 式 Agent 面板 | ChatGPT 整页聊天产品 |
| 画布 / 队列的编排入口 | 替代工作流节点与能力编辑器 |
| 网页端、登录用户、项目作用域 | 桌面壳 Copilot / Body MCP（伴侣规格） |

### 1.3 用户旅程（Happy Path）

```text
进入项目 → 右侧 Agent 可展开
  →（可选）打开大图 / 分镜表 / 资产集 — 侧栏仍在，上下文芯片更新
  → Composer：打字 + 可选文/图/3D + 可选拖入预设 + @/附图
  → 发送 → Agent 给出简短计划 + 工具进度
  → 资产出现在画布；气泡可预览/重试
  → 收起侧栏后会话保留；再展开同一线程
```

### 1.4 竞品锚点（设计约束，非抄 UI）

| 锚点 | 采纳 | 不采纳 |
|------|------|--------|
| Cursor | 侧栏 = Agent；中间 = 真源；可收起 | 代码 diff 隐喻硬套到多媒体 |
| Lovart | `@`、点选上下文、Talk→Tune | 强制一切只能聊、无显式模式芯片 |
| Google Flow | Ingredients/`@`、结果进网格 | 默认「直发快门」与 Agent 双入口（我们已否决直发） |
| 即梦 Octo | 资产卡一致性 | 画布任意处 `/` 唤起可作为 P2，非 P0 |

### 1.5 业界与官方经验对照（必读）

> 结论先说：**我们在做的是 agentic system；P0 更接近 Anthropic 所说的 workflow（代码编排路径）+ 透明计划，而不是一上来全自主 Agent。这与官方「先简单、可测、再加自主」一致，应坚持。**

#### 1.5.1 核心文献（优先）

| 来源 | 文档 | 对我们的硬启示 |
|------|------|----------------|
| Anthropic | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | **Workflow vs Agent** 二分；成功三原则：简单、**展示规划步骤**、打磨 **ACI（工具接口）**；框架可少用，生产常直接 API + 组合模式 |
| Anthropic | [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) | 工具描述 = 一等公民 prompt；工具要少而清、可组合、可评测；用评测驱动改工具而非堆 prompt |
| Anthropic | [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Context 是有限注意力预算；**JIT 取上下文**（引用 id，用时再加载）；避免把整段历史/大图塞进每次推理 |
| OpenAI | [Orchestration / handoffs](https://developers.openai.com/api/docs/guides/agents/orchestration) | 多 Agent 前先单 Agent；**Agents-as-tools**（经理保留回复权）vs **Handoffs**（专家接管）；我们 P2 子 Agent 进度卡更贴近 **as-tools** |
| Google ADK | [Multi-agent patterns](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) / [ADK patterns](https://adk.dev/workflows/patterns/) | Sequential / Parallel / Coordinator / Loop / HITL；**先顺序链再并行**；子 Agent `description` 即路由 API |
| 工程实践 | LangGraph / Harness 工程共识 | 有类型状态、**步数上限**、工具错误回传、可观测轨迹、人审节点；评测分单步 / 轨迹 / 端到端 |

#### 1.5.2 Anthropic 模式 → 我们的映射

| 官方模式 | 含义 | 本产品落点 |
|----------|------|------------|
| Augmented LLM | LLM + 检索/工具/记忆 | Composer 意图 + 表面上下文 + 工具适配器 |
| Prompt chaining | 固定多步 | 理解 → 生图；局部重绘管线 |
| **Routing** | 分类后走专用路径 | **A+C 芯片/预设卡 = 显式路由**（P0 主路径） |
| Parallelization | 并行子任务 / 投票 | 张数×N、多预设卡；P1 再谈真并行 turn |
| Orchestrator–workers | 动态拆任务给工人 | **P2 子 Agent**（经理合成；工人不抢用户会话） |
| Evaluator–optimizer | 生成↔评审循环 | 视觉 Agent 路线图后续；P0 不做 |
| Autonomous agent | LLM 在环里自选工具 | P1+ 可选；须有步数帽与沙箱式失败恢复 |

#### 1.5.3 三条官方原则 → 规格约束

| 原则 | 规格动作 |
|------|----------|
| **Keep it simple** | P0 = 规则/显式意图路由 + 现有队列；不引入重型 Agent 框架除非可证明收益 |
| **Show the plan** | 助手气泡必须先有短计划 + `toolCalls[]`（已定）；禁止「静默入队无说明」 |
| **Invest in ACI** | 每个 `ProjectAgentTool` 要有：清晰 name/description、参数 schema、错误字符串可被下一轮理解、与其它工具边界不重叠（生图/改图/跑预设/局部重绘分开） |

#### 1.5.4 Context engineering → 我们的硬规则

| 规则 | 做法 |
|------|------|
| 高信号、少 token | 上下文芯片用 **assetId / 行 id**，不把 base64 进会话；缩略图仅 UI |
| JIT | Agent 需要像素时由工具按 id 从资产店取，而非预塞历史图 |
| 历史不污染生图 | 延续 §5.2：生图工具默认不贴伪多轮全文；文工具可短摘要 |
| 工具集要瘦 | P0 工具枚举可控（plain 文/图/3D、预设执行、lightbox 局部、查询选中资产）；禁止一次暴露「整个能力库几十个同质工具」给 LLM |

#### 1.5.5 多 Agent（P2）官方推荐选型

| 模式 | 何时用 | 我们的选择 |
|------|--------|------------|
| **Agents as tools** | 主 Agent 保留对用户的回复权，专家只做有界子活 | **默认**：子进度卡挂在主气泡下 |
| **Handoffs** | 专家接管整段对话 | 仅当「进入专用模式且 UI 明确切换」时考虑，P0/P1 不做 |
| 过早拆多 Agent | 成本↑、轨迹难读、审批面变多 | 官方与我们一致：**先单 Agent 做强** |

#### 1.5.6 Harness（安全带）清单 — P0 起就要有

| 项 | P0 最低要求 |
|----|-------------|
| 工具白名单 | Runtime 只能调注册表内工具 |
| 步数/轮次上限 | 单 turn 工具步上限（建议 ≤ 8）；防死循环 |
| 错误回传 | 工具失败 → 结构化 error 进 toolCall，可重试；不吞异常 |
| 积分闸门 | 已有 v2；工具执行前仍走 |
| 人审（可选） | 高危（批量删资产、大额积分）P1 再加确认卡 |
| 可观测 | turnId / toolCallId / taskId / correlationId 可串到现有审计/用量 |

#### 1.5.7 对本规格的修订性结论

1. **命名诚实**：对外可叫「项目 Agent」；对内 P0 文档与代码注释应标明 **agentic workflow（routing + tools）**，避免团队误以为已是全自主 Agent。  
2. **A+C 不是妥协，是 Routing 最佳实践**：显式模态/预设 = 降低 LLM 选错工具的主因。  
3. **子 Agent 后置正确**：符合 OpenAI「先单后多」与 Anthropic「复杂度要可证明收益」。  
4. **缺口（应在 P0/P1 补进工程）**：工具 ACI 文档与评测集、turn 步数帽、轨迹日志；P1 再考虑轻量 LLM router（仅当规则不够时）。  
5. **场景只作验收故事，不作架构特例**：用户举例的「提示词专家 → 试跑 → 存为能力预设 → 再派工」应抽象为 §5.0 / §15 的通用原语（专家工具、会话产物、晋升、路由），**禁止**按单一垂直场景硬编码运行时。

---

## 2. 已决产品拍板（冻结）

| ID | 决策 | 备注 |
|----|------|------|
| **P1** | 底部 Composer **全部走 Agent** | 取消收起态「直发快门」与展开态分叉语义 |
| **P2** | Composer **A+C**：P0/P1 **保留**文/图/3D 芯片 + 可拖预设卡；**不**为「先纯聊天」砍芯片 | Agent **优先尊重**芯片与预设；无芯片时仅薄规则/追问（非 LLM 全量规划） |
| **P3** | 子 Agent：产品要进度卡，**实现后置** | P0 仅主 Agent + **工具级**进度；P2 用 **agents-as-tools** |
| **P4** | 侧栏为网页端 **项目内真全局**：大图 / 分镜表 / 资产集等打开时**不卸载** | 项目外（设置、管理端、无项目）不挂载；文案用「项目 Agent」避免与壳 Copilot 抢「全局」 |
| **P5** | **项目一条主会话** | **已冻结**；大图等只改上下文（A5） |
| **P6** | 大图 / 全屏表面：**让宽 + 可一键收起** | **已冻结**；`100% - dockWidth` |
| **P7** | **交付分层**（修正原「唯画布真源」） | 见 §5.0：画布媒体 / 会话产物 / 可复用工具资产 三层；气泡不存 base64 |
| **P8** | 积分 | 入队/执行仍遵守统一派发积分闸门 v2；侧栏不另造账本 |
| **P9** | 运行时演进按 **通用原语**，不按垂直场景定制 | 提示词炼丹、分镜助手等均为 Skill/Tool 实例，共享路由·产物·晋升协议（§15） |
| **P10** | P0 **计划文案用确定性模板**，不为「像 Agent」单独打 LLM | 降成本、可测；LLM 只用于真工具（文生文等） |
| **P11** | P0 **瘦工具集**（注册表 ≤ 6 个原子工具）；多预设共用 `run_preset` | 禁止按预设 id 暴露成 N 个 LLM 工具 |
| **P12** | Artifact **默认不自动进入**下一 turn 模型上下文 | 须 `@artifact` 或显式「用此试跑」；防静默污染 |
| **P13** | Promote 默认写入 **个人/当前用户作用域** 预设 | 团队共享后置 |
| **P14** | **评测 + 轨迹** 与 Dock UI **同级 P0**（见 §11 P0a/P0b） | 禁止只迁 UI、不建路由纯函数与用例 |
| **P15** | P0/P1 **不引入** LangGraph / OpenAI Agents SDK 等重框架 | 薄自研 Runtime + 现有队列 Harness；框架引入须可证明收益 |
| **P16** | 产品目标包含 **可点名专家（Named Expert）+ 可沉淀记忆（Durable Memory）** | 不是网页 Hermes；专家挂在主项目 Agent 下（as-tools） |
| **P17** | 专家 = **Skill 注册项 + Profile（人设档案）+ Memory（记忆存储）** | `@专家` 走 Mention；禁止为单一专家分叉第二套会话壳 |
| **P18** | 记忆分层：**工作记忆**（当次 turn）/ **专家记忆**（跨 turn 沉淀）/ **工具资产**（Promote→L3） | 专家记忆默认 **userId + expertId**（可加 projectId 作用域）；须可查看/删除 |
| **P19** | **不做**专家独立 Hermes 运行时、不做默认 handoff 抢主会话 | 主侧栏始终是项目 Agent；专家进度在主气泡 toolCall / 日后 childRuns |
| **P20** | **聊天可调优专家，但分层**：Memory 可聊即写（确认）；Profile 可聊须确认卡+升 version；Skill/`toolIds` 聊天只发起申请，默认进工作室确认 | 禁止一句闲聊静默改人设/工具面；见 §17.9 |
| **P21** | **P1 提供专家工作室（Expert Studio）**，不做独立管理端、不做用户向重型运维看板 | 聊天=写入入口；工作室=查看/删除/回滚/白名单；工程轨迹仍用 §16.3 环缓 |
| **P22** | **持久化五层 + 硬配额**：本机热窗口 / Profile / Memory / Artifact 元数据 / Trace 环缓；禁止媒体字节进会话与 Memory | 防打爆 `localStorage`；云策略见 **P24 / §18**（不再「云同步纯 P2」） |
| **P23** | **模态「自动挡」后置**：P0/P1 不做；P2+ 可加可选「自动」档（意图推断模态）；芯片始终可作覆盖；默认仍建议显式芯片 | 须单独评测集；猜错须可纠正；**禁止**用自动挡替换芯片作为唯一入口 |
| **P24** | **会话真源 1C**：P0 本机热窗口为主路径 + **异步云备份**（失败不挡发送）；P1 起 **云为真源**、本机为缓存/离线 | 换设备续聊自 P1；见 §18 |
| **P25** | **一项目一主线程（2A）**：「清空 / 新开对话」= 归档旧热线程后开新热线程；**不做**多线程历史列表 | 大图等仍只改上下文（P5）；设置最多「恢复上一段」单入口 |

---

## 3. 架构决策（ADR）

| # | 决策 | 理由 | 代价 / 后续 |
|---|------|------|-------------|
| **A1** | 侧栏挂载在 **App / 项目壳**，不挂在 `WorkflowSection` 内部树 | 真全局；表面切换不丢实例 | 需从壳注入 `surfaceContext`；WorkflowSection 变 **HostPort** 提供者 |
| **A2** | 引入 **`ProjectAgentRuntime`**（编排）与 **`ProjectAgentTool`**（适配现有执行） | 把「发送」从 `submitQuickCompose*` 语义提升为 Agent turn | P0 runtime 可为规则机；禁止再在 UI 里分叉直发 |
| **A3** | 与伴侣 **全局 Copilot 正交** | 网页 Agent 调云端/工作流工具；壳 Copilot 调 `ac.*` 本机身体 | 文案区分「项目 Agent」vs「本机助手」；P2 再谈桥接 |
| **A4** | Composer 状态（草稿、附图、模式、预设卡、生成参数）**单例**，收起/展开共享 | 落实 P1 | 废弃大图专用第二套条状态（局部重绘改为上下文 + 同一 Composer） |
| **A5** | 会话键：`userId + workspaceProjectId` 一条**热**线程；清空/新开→归档（P25） | 落实 P5/P25；心智简单 | 迁移期合并/废弃 `lightbox` scope 存储 |
| **A6** | 布局：壳级 `agentDockExpanded` + 固定宽度 CSS 变量；中间表面让宽 | 落实 P6；避免浮层挡大图 | 各全屏面板需认 `dockInset` |
| **A7** | **表面上下文**（`AgentSurfaceContext`）由当前表面上报，Composer 展示可清除芯片 | Agent 少猜「正在看什么」 | P0：画布选中 + 大图；P1：分镜/资产集；上下文是 Intent 输入之一，不是唯一路由源 |
| **A8** | 助手气泡进度 = **工具调用列表**（queued/running/done/error），不是子 Agent 树 | P3 后置 | 预留 `childRuns[]`；P1 起 toolCall 可挂 **artifactIds**（会话产物） |
| **A9** | P0 规划：**显式意图优先** + 薄规则路由；P1 起路由表可挂 **Skill/Tool 注册项**（含 `@skill`）；**自动挡**见 P23（P2+） | 与官方 Routing 一致；避免垂直场景 if-else 膨胀 | 全自主 tool-loop / Evaluator 走更后阶段 |
| **A10** | **媒体执行**复用 `WorkflowPendingTask` + capability 链；**非媒体工具**（改写、规划、晋升）可同步返回 artifact，不强制进 pending | 修正「一切皆 pending」的过窄假设 | HostPort 需同时支持 `enqueueTasks` 与 `emitArtifact` / `promoteArtifact` |
| **A11** | 串行策略：P0 **发送阻塞**至当前 turn 工具终态 | 避免积分与队列风暴 | P1 可配置并行 turn |
| **A12** | 持久化继续走 `clientPersist` 作用域键；消息/产物不存媒体字节；**五层+配额见 §17.10**；云备份/真源见 **P24 / §18** | 跨设备规范；体积可控 | P0 异步备份；P1 云真源；QuotaExceeded 须裁剪 |
| **A13** | **`@` 统一为 Mention 总线**：可指资产 / 能力预设 / **Expert（专家）** | 「@提示词专家」与「@某张图」同一语法 | Mention → Intent；禁止第二套 @ |
| **A14** | **晋升（Promote）** 为一等运行时动作：会话产物 → 可复用工具资产（默认能力预设） | 「炼熟后固化」；不限提示词场景 | 确认 UX；默认个人域（P13） |
| **A15** | **Expert = Skill 工具包 + Profile + Memory 句柄**；主 Runtime 以 **agents-as-tools** 调用 | 落实 P16–P19；提示词专家仅为首个实例 | P0 预留类型；P1 实现；禁止网页 Hermes |
| **A16** | **ExpertProfile**：稳定人设（displayName、mission、style、taboos、fewShotRefs、knowledgeRef） | 「独立身份档案」产品需求 | 版本化；改 Profile 须跑专家评测子集 |
| **A17** | **ExpertMemoryStore**：append-only 条目（偏好、否决、摘要、指向 artifact/preset 的指针）；注入受 **token 预算** 约束 | 「可沉淀记忆」；非全量聊天重放 | 用户可清除；P1b 再上检索/向量（可选） |
| **A18** | 专家调用时 Context = **主 Intent 切片 + Profile + Memory 检索结果 + 显式 Artifact**；仍遵守 P12（不自动塞全历史） | Context engineering | 轨迹须记录注入了哪些 memoryId |
| **A19** | **调优三层协议**：Memory（聊+确认）/ Profile（聊→diff 确认→version++）/ Skill（申请→工作室确认） | 落实 P20；可审计、可回滚 | Profile 变更后跑专家评测子集 |
| **A20** | **Expert Studio** 挂项目侧栏菜单或项目设置，非 Admin、非全量轨迹看板 | 落实 P21；与 `ExpertMemoryPanel` 合并升格 | 用户可见「最近调用摘要」即可；完整 toolCalls 属 debug |
| **A21** | **存储分层**：L0 媒体真源（现有资产/R2）∥ L1 聊天瘦消息 ∥ L2 Profile ∥ L3 Memory ∥ L4 Artifact 元数据 ∥ L5 Trace 环缓；Runtime 状态只持 id | 落实 P22；JIT 取像素 | 写前估大小；`QuotaExceeded` → 裁剪本机热；云策略见 §18 |
| **A22** | Agent 会话云对象走 R2 轻量 JSON（`…/projects/{id}/agent/`），**不**进 `workflow.json`、**不**新建 Postgres 聊天表 | 复用 workspace R2 通路与 LWW merge | 见 §18.3；禁止 base64 |
| **A23** | 每次 turn 的 **B 层装配** = 可选 compaction 摘要 + 最近 K 轮瘦消息 + Intent +（专家时）Profile/Memory；**不等于**全量存档 | 商业级长对话；控 token/积分 | P1 compaction v0 优先无 LLM 截断摘要；见 §18.5 |

---

## 4. 信息架构与 UI

### 4.1 壳布局

```text
┌──────────────────────────────────────────────────────────┐
│ App chrome（项目名 / 导航）                                │
├────────────────────────────┬─────────────────────────────┤
│ 中间表面（让宽）            │ Agent Dock                   │
│ 画布 | 大图 | 分镜 | 资产集 │ 标题 · 收起                   │
│                            │ 线程（消息 + 工具进度）        │
│                            │ 上下文芯片                    │
│                            │ Composer（A+C）               │
└────────────────────────────┴─────────────────────────────┘
```

| 状态 | 行为 |
|------|------|
| 展开 | 固定宽度（沿用或微调现 `WORKFLOW_QUICK_COMPOSE_DOCKED_WIDTH_*`） |
| 收起 | 窄轨或底缘迷你 Composer；**发送仍进同一 Runtime** |
| 无项目 / 非工作区模式 | **不渲染** Dock |

### 4.2 Composer（A+C）

| 控件 | 语义（给 Agent 的意图） |
|------|------------------------|
| 文 / 图 / 3D 芯片 | **优先模态**（P0/P1 **必保留**）；有附图时「文」不强制改图，但 Agent 应提示冲突 |
| 拖入预设卡 | **显式工具请求**：按该 `presetId` 执行（可多卡 → 多工具步） |
| `@` / 主图·参考槽 | **Mention**：资产 / 能力预设 / Skill（P0 至少资产+预设；Skill 槽位 P1） |
| 模型 / 比例 / 尺寸 / 张数 / 理解开关 | 生成参数覆盖（写入工具入参，不改预设库） |
| 发送 | `ProjectAgentRuntime.submitTurn` |

**路由优先级（冻结）**

```text
1. 拖入预设卡 / @preset / @expert
2. 显式文|图|3D 芯片
3. 无芯片：薄规则或追问（P0/P1）；不得假装「已全自动规划」
4. （P2+ 可选）自动挡开启时：意图推断模态，仍可被芯片覆盖（P23）
```

**禁止**：收起发送走旧 `submitQuickCompose` 直发；展开发送另走伪多轮拼接；为某一垂直场景单独做第二套输入语法；**P0/P1 去掉模态芯片改纯聊天**。

### 4.3 上下文芯片

```ts
type AgentSurfaceContext =
  | { kind: 'canvas'; selectedAssetIds: string[]; stepId?: string }
  | { kind: 'lightbox'; assetId: string; displayKey: string; hasLocalEdit?: boolean }
  | { kind: 'storyboard_table'; tableAssetId: string; selectedRowIds?: string[] }
  | { kind: 'asset_set'; setAssetId: string; selectedComponentIds?: string[] }
  | { kind: 'none' };
```

- UI 展示一行：`正在看：大图「角色A」`；用户可清除 → `none`（仍可 `@`）。
- P0 必达：`canvas` + `lightbox`；其余 kind 可先上报 `none` 或最小字段。

### 4.4 消息与进度（P0）

| 角色 | 内容 |
|------|------|
| user | 文本 + 附件资产 id + 当时意图快照（mode / presetIds / 参数，可选） |
| assistant | 短计划文案 + `toolCalls[]` 进度 + 结果缩略图引用 |

```ts
type AgentToolCallView = {
  id: string;
  label: string;           // 如「生图」「理解」「改写」
  status: 'queued' | 'running' | 'done' | 'error';
  taskId?: string;         // 媒体执行进队列时
  assetId?: string;        // 画布媒体结果
  artifactIds?: string[];  // 会话产物（文本/计划/候选等）
  errorMessage?: string;
};
```

子 Agent 进度卡：**不实现**；类型可留 `childRuns?: never` 或注释预留。

---

## 5. 运行时（P0 基线 + 演进接口）

### 5.0 交付分层（架构修正 · 必读）

原 P7「结果真源 = 画布」对**媒体交付**成立，但对「炼提示词 / 出计划 / 再固化」过窄。统一为三层：

| 层 | 名称 | 存什么 | 谁消费 |
|----|------|--------|--------|
| L1 | **画布媒体资产** | 图/视频/3D 等 `WorkflowAsset` | 画布、大图、队列 |
| L2 | **会话产物 Artifact** | 文本候选、计划、结构化草稿等（id 引用，可版本） | 侧栏气泡、试跑入参、晋升源 |
| L3 | **可复用工具资产** | 能力预设（及未来其它注册工具） | `@`/拖入、路由、执行 |

```text
意图 → Runtime 路由 → Tool/Skill
         ├─→ enqueue → L1 画布结果
         └─→ emitArtifact → L2 会话产物
                              └─（用户确认）promote → L3 工具资产
```

**不变量**

- 气泡与线程**不**存 base64；L1 用 assetId，L2 用 artifactId。  
- **晋升必须显式确认**（防误把试跑垃圾写入预设库）。  
- L3 默认写入现有 **能力预设** 存储；协议上 `promote(targetKind)` 可扩展，避免写死「只能变预设」。  
- 垂直场景（提示词、分镜文案、风格卡…）只实现为 **Skill + 产物 kind + 晋升映射**，不新增第二套 Runtime。

### 5.1 Turn 生命周期

```text
submitTurn(input)
  → gate：积分只读检查 / 登录 / in-flight 策略（A11）
  → buildIntent：surfaceContext + composer 控件 + 文本 + mentions（资产|预设|skill）
  → planTools：规则路由（§5.2）；P1+ 可查 Skill 注册表
  → 追加 user + assistant(queued) 消息
  → 执行：
       · 媒体类 → enqueue → executePending → 回写 taskId/assetId
       · 非媒体类 → 同步/异步 emitArtifact → 回写 artifactIds
  → patch toolCalls 状态
  → 终态 done | error；支持按 assistant 消息重试
  →（可选动作）promoteArtifact → L3
```

### 5.2 规则路由（显式优先）

| 优先级 | 条件 | 工具计划 |
|--------|------|----------|
| 0 | Mention 含 **skill:*** | 调用该 Skill 工具包（P1；P0 可忽略未知 skill 并提示） |
| 1 | 存在预设卡或 mention 能力预设 | 每项 → 对应 capability；用户文本拼入策略与现卡逻辑对齐 |
| 2 | 无预设 + 模式 3D | 已启用 `generate_3d` 预设或明确失败提示 |
| 3 | 无预设 + 模式 图 | 有主图 → i2i plain；无主图 → t2i plain；lightbox+localEdit → 局部重绘 |
| 4 | 无预设 + 模式 文 | 文生文 plain（P1 起可再细路由到某文本 Skill） |
| 5 | 冲突 | 以**更具体**为准：skill/预设 > 模式芯片；计划文案说明取舍 |

> P0 **不**把「最近 N 轮全文」无结构贴进生图 prompt；文工具可短摘要。避免伪多轮污染生图。

### 5.3 与积分 / 队列

- 规划阶段可 `plan*Routes` 做展示；媒体入队遵守闸门 v2 **策略 B**。  
- 非媒体工具若走平台 LLM，同样经统一闸门，**不**另造账本。  
- 每个 toolCall 对齐 `taskId` 和/或 `artifactIds`；任务出队后错误态仍可展示。

### 5.4 HostPort（壳 ↔ 工作流，防膨胀）

Runtime **不得**直接操作 `WorkflowSection` 内部 state。约定端口（名称可调，职责冻结）：

```ts
type ProjectAgentHostPort = {
  enqueueTasks: (tasks: WorkflowPendingTask[]) => string[] /* taskIds */;
  getQueueSnapshot: () => { pending; executing; assetErrors; ... };
  resolveAssetDisplay: (assetId: string) => { previewSrc?: string; label?: string };
  reportSurfaceContext?: () => AgentSurfaceContext; // 或由壳订阅推送
  // P1+
  emitArtifact?: (a: AgentArtifactDraft) => string /* artifactId */;
  promoteArtifact?: (artifactId: string, target: PromoteTarget) => Promise<{ ok: boolean; id?: string }>;
};
```

P0 可先实现媒体相关方法；`emitArtifact` / `promoteArtifact` **接口预留**，实现放 P1，避免 P1 改 Host 形状。
---

## 6. 非目标（本阶段不做）

| 类别 | 不做 |
|------|------|
| 子 Agent | 可开子 Agent、子 Agent 进度卡 UI |
| 双入口 | Flow 式「关 Agent 直发」 |
| 作用域 | 设置页 / Admin / 未选项目挂载侧栏 |
| 大脑 | 默认绑定 Hermes/伴侣 Copilot；网页 Agent ≠ 壳身体 |
| 记忆 | 跨项目「一条会话」合并；**多线程历史列表产品**（P25 禁止）；Dreaming 式夜间全量合成（P2+） |
| 会话云 | P0 **不以云为读写真源**（仅异步备份）；未登录不上云 |
| 治理 UI | 独立 Admin「专家管理站」、用户向全量轨迹运维看板（P1 仅 Expert Studio） |
| 自主 | 评估器驱动自动 replan（见视觉 Agent 路线图）；**P0/P1 模态自动挡**（→P23 / 阶段 P2+） |
| 替换 | 能力编辑器、复合能力画布、管理端 |
| 垂直定制 | **禁止**为「提示词炼丹」等单一场景分叉 Runtime / 第二套会话 / 第二套 @ |
| 存储 | Postgres 聊天表；把完整 Trace 当用户历史；聊天塞进 `workflow.json` |

---

## 7. 模块边界（建议落点）

| 模块 | 职责 |
|------|------|
| `components/project-agent/ProjectAgentDock.tsx` | 壳级侧栏 UI（由现 ChatDock 演进） |
| `components/project-agent/ProjectAgentComposer.tsx` | Composer（由 QuickComposeBar 抽离） |
| `services/projectAgent/runtime.ts` | `submitTurn` / plan / 回写 |
| `services/projectAgent/intent.ts` | 控件 + 上下文 → Intent |
| `services/projectAgent/tools/*.ts` | 适配 enqueue 生图/文/3D/局部重绘/预设 |
| `services/projectAgent/skills/registry.ts` | **P1**：Skill 注册表（描述、工具列表、知识引用）；P0 可空壳 |
| `services/projectAgent/experts/*` | **P1**：Expert 注册表 / Memory / invoke / 调优协议（§17） |
| `services/projectAgent/persist/quotas.ts` | 本机热窗口与存储配额（§17.10 / §18） |
| `services/projectAgent/artifacts.ts` | **P1**：Artifact 存取；P0 类型预留 |
| `services/projectAgent/promote.ts` | **P1**：晋升到能力预设等 |
| `services/projectAgent/threadStore.ts` | 由 `quickComposeThreadStore` 演进；键仅 project；瘦消息+热窗口；归档新开（P25） |
| `services/projectAgent/threadCloudSync.ts` | **P0**：异步备份；**P1**：pull + LWW 真源（§18） |
| `services/projectAgent/contextAssembly.ts` | **P1**：B 层滑动窗口 + compaction 注入 |
| `services/projectAgent/compaction.ts` | **P1**：滚动摘要读写（优先无 LLM） |
| `types/projectAgent.ts` | Intent、消息、toolCall、surfaceContext、Artifact、Skill、PromoteTarget、Expert* |
| `components/project-agent/ExpertStudio.tsx` | **P1**：专家工作室（人设/记忆/白名单） |
| `App.tsx`（或项目壳） | 挂载 Dock、`dockInset`、展开态 |
| `WorkflowSection` | 实现 **HostPort**；上报上下文；**不再拥有**全局对话挂载 |

**原则**：`WorkflowSection` 继续变瘦；Agent 编排不堆进万行组件。

---

## 8. 表面适配清单

| 表面 | P0 | 上报上下文 | 布局 |
|------|----|------------|------|
| 工作流画布 | 必做 | 选中资产 | 让宽 |
| 大图预览 | 必做 | assetId + displayKey + localEdit 标志 | 让宽；局部重绘走同一 Composer |
| 分镜表 | 壳不卸载；上下文可弱 | 有则报 table + 行 | 让宽 |
| 资产集 | 同左 | 有则报 set + 组件 | 让宽 |
| 擂台等非项目主路径 | 不挂 Dock | — | — |

---

## 9. 迁移策略

| 阶段 | 动作 |
|------|------|
| M1 | 壳级挂载 + 单线程键；UI 仍可暂时调旧 submit，但**统一一个入口函数** |
| M2 | Runtime 规则路由替换 `submitQuickCompose` / `submitQuickComposeWithThread` / lightbox 分叉 |
| M3 | 删除伪多轮默认路径；删除 lightbox 独立 thread scope；存储迁移或丢弃旧 lightbox 键 |
| M4 | 底栏仅保留收起态迷你 Composer；去掉「直发」代码路径与文案 |

**兼容**：旧 `ac_quick_compose_thread_v1` workspace 键可升为 `project_agent_thread_v1`；lightbox 键只读迁移一次后不再写入。

---

## 10. 风险与对策

| 风险 | 对策 |
|------|------|
| Agent 猜错模态 | A+C 显式控件优先；计划文案可见 |
| 全局侧栏挡大图操作 | P6 让宽 + 一键收起；快捷键（P1） |
| WorkflowSection 膨胀 | A1/A2 强制抽 Runtime |
| 与伴侣 Copilot 用户混淆 | 设置/文案：「项目 Agent（网页）」vs「本机助手（桌面壳）」 |
| 积分与并发 | A11 发送阻塞；闸门 v2 |
| 伪多轮污染生图 | §5.2 默认不对生图贴历史全文 |

---

## 11. 分阶段交付

### 11.0 用户可见里程碑（防「做完像没做」）

> 工程顺序仍是 P0a→P0d；**对产品负责人/用户的演示节奏**按下表。  
> **约定**：合并进主分支、可给你点开试用的，至少要到 **U1**；只合 P0a/P0b 必须在 PR 标题标明 `internal-only`，并口头说明「界面尚未变」。

| 用户里程碑 | 对应工程 | **你（用户）能看见 / 能点的变化** | 若只做到这 | 观感风险 |
|------------|----------|----------------------------------|------------|----------|
| **U0 内部** | P0a + P0b | 几乎无界面变化；仓库多了类型、路由单测变绿 | 仅 CI / 开发者 | **极高**——必须标 internal，勿当产品交付 |
| **U1 可感知 Agent** | P0c 为主（可含部分 P0d） | 见下方「U1 五屏」；发送语义统一、侧栏像项目搭档 | **首个应对你演示的版本** | 低 |
| **U2 更稳** | P0d 补齐 | 取消/重试按钮行为正确；连点不双发；忙时提示清晰 | 体验加固 | 低 |
| **U3 专家与记忆** | P1（§17） | `@专家`、人设生效、记忆可沉淀/可清除、产物可试跑/可晋升 | **第二轮应对你演示的能力跃迁** | — |
| **U4 多工人可见** | P2 | 专家/子 run 进度卡 | 体验增强 | — |

#### U1 五屏（验收时请你按此点一遍）

1. **进项目**：右侧有可展开的项目 Agent 侧栏（或收起后的迷你条）；标题像「项目搭档」而非「又一个输入框」。  
2. **发送一句生图**：侧栏出现「你的话 + 助手计划（模板）+ 进度」；**画布同时出现**排队/结果——不是只在聊天里出图。  
3. **拖一张能力预设再发**：计划里能看出「在跑这个预设」；结果进画布。  
4. **打开大图再回来**：侧栏**还在**、**同一条会话**还在；芯片显示「正在看：这张图」（或等价）。  
5. **收起再展开**：历史还在；再发仍走同一套逻辑（没有「收起直发 / 展开聊天」两套脾气）。

**U1 一句话验收**：  
「我感觉在跟项目里的 Agent 说话，它会亮计划、台上出活；进大图也不换人。」

**明确不会在 U1 出现的**（避免预期错位）：`@专家`、专家记忆、一键存预设、子 Agent 进度卡——那些是 **U3/U4**。

#### U3 五屏（专家 + 记忆，P1 验收）

1. **点名**：Composer 输入 `@` 能选出至少 2 个专家（含「提示词」类）；发送后计划里写明调用了该专家。  
2. **身份**：同一意图下，换专家（或改 Profile 后）产出风格可区分（评测或侧视对比）；聊天改人设须出确认卡。  
3. **沉淀 + 工作室**：多轮后专家记住纠正过的偏好（刷新仍在）；**专家工作室**可查看/删除记忆、看 Profile 版本、确认待生效改稿。  
4. **外置记忆**：专家产出 Artifact → 「试跑」上画布 → 「存为能力预设」；之后可拖预设，不依赖聊天里那句原文。  
5. **不换壳**：全程仍在**同一项目 Agent 侧栏**；没有跳进另一个 Hermes 窗口或独立管理站。

**U3 一句话验收**：  
「我能点名专家；它有脾气（Profile）；它记得我教过的（Memory）；我能在工作室里管它；炼熟的能变成预设。」

#### 交付纪律

- 每个对你可见的 PR / 演示，必须对应上表 **U1+**，或明确写「U0 仅工程」。  
- P0c 未完成前，**不以「项目 Agent 做好了」对外表述**。  
- UI 文案与空态（无消息时的一句说明、发送中禁用态）算 U1 必做，不是锦上添花。

---

### P0 — 项目 Agent 舞台（按工程顺序，禁止跳步）

**目标**：统一入口、真全局壳、**可检验**的 routing workflow；并对用户交付到 **U1**。

| 子阶段 | 交付 | 完成定义 | 用户可见？ |
|--------|------|----------|------------|
| **P0a 契约** | HostPort 类型 + mock；Turn 状态机；§16.2 工具 ACI 表落地为 `tools/registry`；轨迹 schema 类型 | 单测可 mock Host 跑通 `planTools`；无 UI 也可合并 | **否（U0）** |
| **P0b 路由+评测** | `planTools(intent)` 纯函数；§16.4 最低评测集变绿 | CI：`vitest` 跑路由用例；改路由破用例即红 | **否（U0）** |
| **P0c UI 迁移** | 壳级 Dock；单会话；A+C；全部 `submitTurn`；计划**模板**文案；媒体进度回写；空态/忙态文案；热窗口 80；写后 **异步云备份**（失败不挡发送，P24） | **§11.0 U1 五屏**全部可手测通过 | **是（U1）** |
| **P0d 硬度** | 取消/重试语义；turn 幂等键；与积分闸门对齐；步数帽强制；备份重试队列；「新开/清空」归档确认（P25，云+本地尽力） | 连点不双入队；取消行为符合 §16.1；备份失败可重试 | **是（U2）** |

**节奏建议（对人）**：P0a/P0b 可短（数日级）且可与 P0c 设计稿并行；**不要把「只做完 a/b」当成一轮产品交付**。优先尽快打通 **P0c → U1 演示**。

并行可做但**不得替代** P0a/b：类型预留 Artifact/Skill/Promote；Mention 资产+预设（Skill 可灰显）。

**架构健康验收**：`ProjectAgentRuntime` 不 import `WorkflowSection`（§16.6 lint）；新工具 = 注册表 + HostPort。

**验收句（工程）**：进大图再回画布会话不断；发送经计划+工具进度；拖预设与模式芯片被尊重；**路由评测集全绿**；无垂直场景硬编码。  
**验收句（用户）**：同 §11.0 U1 一句话。

---

### P1 — 可点名专家 + 可沉淀记忆（§17）+ 会话云真源（§18）

**目标**：通用 **Expert** 协议（Profile + Memory + Skill 工具），主 Agent as-tools 调用；**提示词专家仅为首个实例**，须同时落地第二个专家证明无垂直分叉；会话 **云为真源**（P24）+ compaction v0（A23）。

| 子阶段 | 交付 | 用户可见 |
|--------|------|----------|
| **P1a 专家可点名** | Expert 注册表；`@expert`；Profile v0（人设）；调用进 toolCall；轨迹含 expertId | 能 @、计划里看得见 |
| **P1b 可沉淀记忆** | ExpertMemoryStore；§17.9 写入触发；注入预算；**Expert Studio** 记忆页；Memory 可随会话路径备份/拉 | 刷新后仍记得；工作室可删 |
| **P1c 产物与晋升** | Artifact + 试跑 + Promote→预设（个人域） | 「存为能力预设」闭环 |
| **P1d 第二专家 + 评测 + 治理** | 第二 Expert 同管道；§17.6 评测；聊天调优三层（P20）；Studio 人设/白名单；§17.10 配额 | 工作室可管；闲聊不静默改人设 |
| **P1e 会话云真源 + compaction** | 打开项目 pull+LWW；本机变缓存；B 层 K 轮 + compaction v0（优先无 LLM）；可选「加载更早」 | **换设备可续聊**；长对话不静默永久丢 |

**验收故事（示例）**：`@提示词专家` 炼提示词 → 聊天「记住」→ 工作室可见 → 试跑 → 存预设；`@另一专家` 走同一套，无第二套代码；换浏览器登录同项目仍见热线程。

**非目标（P1 仍不做）**：专家独立会话窗、独立管理端/重型运维看板、handoff 抢主栏、网页 Hermes、子 Agent 进度卡 UI（→P2）、向量库、多线程历史列表、Dreaming 全量合成、导出 JSON。

**P1 并行体验项**：分镜/资产集富上下文；Composer 快捷键；可选并行 turn。

---

### P2 — 多工人可见化与生态

- 专家/子 run **进度卡**（兑现「要看见」；仍 as-tools）  
- **可选模态「自动挡」**（P23）：意图推断文/图/3D；芯片可覆盖；须评测 + 猜错可纠正  
- 冷段分页「加载更早」、会话导出、合规硬删云数据 UI  
- 可选服务端 compaction / Dreaming 精简版  
- 可选与伴侣 Copilot 桥接  
- Expert 分享/市场（仍同一注册表）  

---

### P3+ — 对齐视觉 Agent 北极星（另册）

Evaluator–optimizer、语义状态、自动 replan 等见 `VISUAL_AGENT_GAP_AND_ROADMAP.md`；专家 Memory/Artifact 轨迹应可被未来 Evaluator 消费。

---

### 11.1 分阶段并行开发（子 Agent 派活表）

> **对外 3 波 / 对内 5 阶段**。阶段间有硬依赖，禁止跳步；**阶段内**可多子 Agent 并行。  
> 每阶段开头先 **冻结共享契约**（类型/文件边界），再 fork；每阶段末由集成人合流 + 手测/CI。  
> **完成态以 §0.2 看板为准**（避免「规格写了 = 已做」）；体验抛光见 **§0.3**（不挡门禁）。

#### 总览

| 对内阶段 | 规格 | 用户里程碑 | 出口 |
|----------|------|------------|------|
| **1** | P0a + P0b | U0 | 路由评测全绿；HostPort mock 可跑 turn 规划 |
| **2** | P0c | **U1** | U1 五屏手测过 |
| **3** | P0d + §18 P0 | U2 | 取消/重试/幂等；备份失败不挡发；新开归档 |
| **4** | P1a–e + §17/§18 P1 | **U3** | `@专家`、Memory、Studio、换设备续聊、compaction v0 |
| **5** | P2+ | U4+ | 进度卡、自动挡、加载更早/导出 |

对外沟通可压成：**地基（1+2）→ 可靠（3）→ 智能体（4，5 后置）**。

#### 并行纪律

1. **阶段门禁**：未过阶段 1 评测不进阶段 2 UI；未过 U1 不进阶段 4 专家。  
2. **共享契约优先**：每阶段首任务冻结 `types/projectAgent.ts` 与目录归属，减少同文件互踩。  
3. **合流人**：每阶段留集成审查（接线 + U1/U3 手测）；子 Agent 不得各自宣称「产品完成」。

#### 阶段 1 — 契约与路由（本阶段开工）

**先冻结**：`types/projectAgent.ts`（Intent / Trace / HostPort / ToolId）+ 目录 `services/projectAgent/**`。

| 子任务 | 文件归属 | 完成定义 |
|--------|----------|----------|
| 1A 状态机 + Trace | `runtime/turnState.ts`、`trace.ts` | 状态枚举与转移；可序列化 `AgentTurnTrace` |
| 1B 工具注册表 | `tools/registry.ts`、`tools/types.ts` | §16.2 六工具 ACI；≤6 |
| 1C 路由 + 评测 | `planTools.ts`、`tests/projectAgentRouting.test.ts` | §16.4 最低集全绿 |
| 1D Host mock | `host/memoryHostPort.ts` | `createMemoryHostPort()` 可供单测 |

**合流**：`planTools` + mock 可规划一条 turn（无 UI）；§12.0 勾选。

#### 阶段 2 — U1 可感知

| 子任务 | 文件归属 |
|--------|----------|
| 2A Dock 壳 + 让宽 | `components/project-agent/ProjectAgentDock.tsx`、App inset |
| 2B Composer A+C | `ProjectAgentComposer.tsx` |
| 2C threadStore | `threadStore.ts`（热窗口 80、迁旧键） |
| 2D Host 真接 WorkflowSection | 适配器（非 Runtime import UI） |
| 2E submitTurn + 计划模板 + 进度 | `runtime.ts` |

**合流**：发一句 → 计划 → 画布出图；U1 五屏。

#### 阶段 3 — 硬度 + 会话 P0

| 子任务 | 归属 |
|--------|------|
| 3A 取消/重试/幂等 | runtime |
| 3B 异步云备份 | `threadCloudSync.ts` |
| 3C 新开/清空归档 | threadStore + UI 确认 |
| 3D 配额裁剪 | `persist/quotas.ts` |

#### 阶段 4 — 专家 + 记忆 + 云真源

| 子任务 | 归属 |
|--------|------|
| 4A Expert 注册 + @ + invoke | `experts/*` |
| 4B MemoryStore | `experts/memoryStore.ts` |
| 4C Expert Studio | `ExpertStudio.tsx` |
| 4D Artifact + Promote | `artifacts.ts` / `promote.ts` |
| 4E 第二专家 + §17.6 评测 | tests |
| 4F 云真源 + compaction + assembly | `threadCloudSync` / `compaction` / `contextAssembly` |

#### 阶段 5 — P2 增强（U4）

**先冻结（2026-07-10）**：`AgentChildRun` / `AgentComposerMode` 含 `'auto'`（`types/projectAgent.ts`）；消息可选 `childRuns`（`types/quickComposeThread.ts`）。  
**本波不做**：Dreaming、伴侣桥接、专家市场、P0.5-c 流式。

| 子任务 | 文件归属 | 完成定义 |
|--------|----------|----------|
| **5A 进度卡** | `services/projectAgent/childRuns.ts`；`ChildRunProgressCards.tsx`；Message + status patch | ✅ 2026-07-10 |
| **5B 自动挡** | `autoMode.ts`；`planTools`；Composer「自动」芯片 | ✅ 2026-07-10 |
| **5C 加载更早/导出** | `threadColdLoad.ts` / `threadExport.ts`；Dock props | ✅ 2026-07-10（本机归档/冷袋；无 R2 list） |

**合流**：✅ 工程 + 审查修复 + **产品手测通过** → **U4 正式出口**（2026-07-10）。

进度卡 ∥ 自动挡 ∥ 加载更早/导出 ∥ 可选 Dreaming — 弱依赖，可再拆波并行。

---

## 12. 验收清单（P0）

### 12.0 工程门禁（P0a/P0b，先于或并行于 UI）

- [ ] `planTools` 为纯函数，单测不依赖 React / WorkflowSection  
- [ ] §16.4 最低路由评测集全部通过（CI）  
- [ ] 轨迹类型 `AgentTurnTrace` 已定义；至少 debug 可序列化一条完整 turn  
- [ ] HostPort mock 可驱动 Runtime 单测  
- [ ] ESLint 或等价：`services/projectAgent/**` 禁止 import `WorkflowSection`  
- [ ] P0 工具注册表条目 ≤ 6，且与 §16.2 表一致  

### 12.1 产品 / UI

- [ ] 无 `workspaceProjectId` 时不出现 Agent Dock  
- [ ] 打开大图 / 分镜表 / 资产集，Dock 实例不卸载，线程 id 不变  
- [ ] 中间表面宽度随 Dock 展开/收起变化（让宽），非永久遮挡主内容  
- [ ] 收起与展开发送均进入 `ProjectAgentRuntime.submitTurn`（无直发分支）  
- [ ] 助手计划文案来自**模板**（P10），非额外 LLM 规划调用  
- [ ] 仅模式芯片、仅预设卡、芯片+预设、仅附图、lightbox 局部选区 五类路径有单测或固定手工脚本  
- [ ] 助手气泡工具进度与 pending/错误态一致；任务出队后错误仍可展示  
- [ ] 积分不足时不可发送（或明确禁用），文案走现有 normalize  
- [ ] 取消 / 重试行为符合 §16.1；连点发送不双入队（§16.5）  
- [ ] `types/projectAgent.ts` 已预留 Artifact / Skill / PromoteTarget（可未实现逻辑）  
- [ ] 文档与交接注明：已取代快捷栏双语义；关联本规格路径  
- [ ] 本机热窗口上限生效（建议 80）；消息无 base64（§18.6）  
- [ ] 登录用户写线程后触发 **异步云备份**；备份失败 **不**阻止发送；有重试（P24）  
- [ ] 「新开对话 / 清空」经确认后归档旧热线程并开新线程（P25）；大图切换不新开线程  

### 12.2 P1 / U3 追加验收（专家 + 记忆）

- [ ] 至少 **2 个 Expert** 走同一注册表（含 Profile）；禁止第二条垂直管道  
- [ ] `@expert` 可点名；轨迹含 `expertId`；计划模板可见专家名  
- [ ] Profile 变更可导致可测的行为差异（评测或固定对比脚本）；聊天改人设须确认卡 + version++  
- [ ] ExpertMemory：跨刷新仍在；**Expert Studio** 可查看/删除；注入受 token 预算限制  
- [ ] 记忆写入有明确触发（纠正 / 显式记住 / 晋升摘要），禁止静默记下全部聊天  
- [ ] Skill/`toolIds` 变更不因一句闲聊生效；须工作室确认（或等价确认卡）  
- [ ] 会话消息与 Memory **无** base64/媒体字节；热窗口与 Memory/Trace 配额生效（§17.10 / §18）  
- [ ] `QuotaExceeded` 时有裁剪/提示路径（单测或手工脚本）  
- [ ] Artifact + 试跑 + Promote→个人预设；确认前不写 L3  
- [ ] Artifact 不自动进模型上下文（P12）  
- [ ] **§11.0 U3 五屏**手测通过  
- [ ] §17.6 专家评测集变绿  
- [ ] 无独立 Hermes 窗、无 handoff 抢主侧栏  

### 12.3 P1e / 商业级会话验收（§18）

- [ ] 打开项目 **pull + LWW**：云为真源；本机为缓存（P24 P1）  
- [ ] **换设备**登录同用户同项目可续上热线程（瘦消息）  
- [ ] B 层装配：compaction? + 最近 K 轮；**不**把全量存档塞进每次推理（A23）  
- [ ] compaction **不**替代 Expert Memory；静默全聊天入 Memory 仍禁止  
- [ ] 未登录不上云；删项目级联清理 `agent/`（或软删）有路径  
- [ ] 冲突以较新 `updatedAt` 为准并记 trace；无复杂冲突 UI 要求  
- [ ] 聊天 JSON **未**写入 `workflow.json`  

---

## 13. 与现有代码对照（开工索引）

| 现有 | 去向 |
|------|------|
| `QuickComposeChatDock` | → `ProjectAgentDock` |
| `WorkspaceQuickComposeBar` | → 壳级 Composer + 收起迷你条 |
| `quickComposeThreadStore` + lightbox scope | → `threadStore`（单 project 热线程）+ `threadCloudSync`（§18）；lightbox 键废弃 |
| `formatQuickComposeTurnContextForPromptOverride` | 生图默认停用；文工具可选；B 层见 `contextAssembly` |
| `submitQuickCompose` / `WithThread` / `submitLightboxQuickCompose` | → tools 适配器 + runtime |
| `App` `workspaceQuickComposeExpanded` | → `projectAgentDockExpanded` + inset |
| `capabilityPresetStore` / 预设 CRUD | P1 Promote 的默认 L3 后端 |
| `workspaceCloudSync` / R2 put-get | Agent 会话备份复用轻量 JSON 路径（A22）；**不**塞进 workflow.json |
| `QuickComposeMentionField` | 扩展 Mention（资产\|预设\|expert）；ExpertProfile/Memory/Studio 见 §17 |

---

## 14. 修订记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-07-10 | v0.1 | 初稿：全走 Agent、A+C、真全局、子 Agent 后置；单会话、让宽 |
| 2026-07-10 | v0.2 | §1.5 官方/业界对照；P0=workflow+routing |
| 2026-07-10 | v0.3 | 交付三层 L1/L2/L3；Skill/Artifact/Promote；HostPort；P1 演进 |
| 2026-07-10 | v0.4 | **§16 Agent 工程契约**：状态机/取消重试、ACI 表、轨迹 schema、评测格式与最低集、幂等与积分、Host 边界 lint、并发；P0 拆 P0a–d；拍板 P10–P15 |
| 2026-07-10 | v0.4.1 | **§11.0 用户可见里程碑 U0–U3**：防「工程做完用户无感」；U1 五屏手测；交付纪律（P0a/b 仅 internal） |
| 2026-07-10 | v0.5 | **可点名专家 + 可沉淀记忆**：P16–P19；A15–A18；§11 U3 五屏；P1 拆 P1a–d；**§17** 工程规划（Profile/Memory/评测）；明确非网页 Hermes |
| 2026-07-10 | v0.5.1 | **聊天调优三层 + 专家工作室 + 持久化配额**：P20–P22；A19–A21；§17.9～§17.10；U3/P1/验收同步；不做独立管理端与用户向重看板 |
| 2026-07-10 | v0.5.2 | **保留模态芯片；自动挡后置**：澄清 P2；新增 P23；§4.2 路由优先级；P2 阶段可开自动挡且芯片可覆盖 |
| 2026-07-10 | v0.6 | **商业级会话（1C+2A）**：P24/P25；A22/A23；**§18** 三层存档/装配/记忆；P0 异步云备份、P1 云真源+compaction；修订 P22/A12/§6/§11/§12/§17.10 |
| 2026-07-10 | v0.6.1 | **§11.1 分阶段并行开发表**：对外 3 波 / 对内 5 阶段；阶段内子任务与文件归属；阶段 1 开工门禁 |
| 2026-07-10 | v0.6.2 | **§0.1～§0.3**：对标尺子（非 ChatGPT）、完成态看板、对话体验抛光 backlog（P0.5）；文首状态改为阶段 3/U2 收口 |

---

## 15. 运行时演进详述（P1：专家与记忆）

> **产品冻结**：可点名专家 + 可沉淀记忆（P16–P19）；聊天调优 + 工作室 + 配额（P20–P22）；模态芯片保留/自动挡后置（P23）；**商业级会话 1C+2A（P24–P25，§18）**。垂直场景（提示词等）只作 Expert **实例**与验收故事。

### 15.1 核心原语

| 原语 | 定义 |
|------|------|
| **Intent** | 文本 + 模式芯片 + mentions + 表面上下文 + 生成参数 + 附件槽 |
| **Expert** | 可 `@` 点名的专家：`Profile` + `Memory` + Skill 工具包（A15–A18） |
| **Expert Studio** | 专家治理面板（人设/记忆/白名单）；非独立管理端（P21） |
| **Skill** | Expert 内的有界工具列表（亦可无 Memory 的轻量技能，仍走同一注册表） |
| **Tool** | 原子动作：媒体入队 / 产出 Artifact / 晋升 / 记忆读写 / 调优提案 |
| **Artifact** | L2 会话产物 |
| **Promote** | L2→L3（默认能力预设） |
| **Route** | Intent → 有序 Tool/Expert 调用计划 |
| **Tune** | 聊天调优三层：Memory / Profile-confirm / Skill-request（P20） |
| **Session A/B/C** | 存档 / 装配 / 记忆三层（§18）；勿与交付 L1/L2/L3 媒体层混淆 |

### 15.2 意图路由优先级

```text
1. 显式 @expert / @preset / 拖入预设卡
2. 显式模式芯片 + 附图/选区
3. 表面上下文作为默认操作对象
4. （可选）轻量分类器 — 可关、可评测
```

### 15.3 反模式

| 反模式 | 正确做法 |
|--------|----------|
| 为提示词单独做 Hermes | Expert 协议 + 主侧栏 as-tools |
| 专家独立聊天窗抢会话 | 主项目 Agent 始终对用户负责 |
| 把全部聊天当记忆 | 结构化 Memory 条目 + 预算 + 可清除 |
| 只靠聊天、无管理面 | Expert Studio：查看/删记忆/确认人设/白名单 |
| 独立管理端或重型看板 | 工作室挂侧栏菜单；完整轨迹仅 debug |
| 会话/Memory 塞 base64 | 只存 id；像素走 L0 / Host JIT |
| 超 N 条就永久扔掉当商业方案 | A 层云存档 + 本机热缓存卸下；B 层滑动/compaction（§18） |
| 把全量聊天当每次推理上下文 | B 层 K 轮 + 摘要；C 层 Memory 另计 |
| `if (promptExpert) ...` 垂直管道 | 注册表；第二专家必须同管道 |
| 只迁 UI 无评测 | P0a/b + §17.6 |

### 15.4 与视觉 Agent 北极星

- 本规格：Harness、Expert/Memory、Promote、可观测 turn。
- 评估闭环见 `VISUAL_AGENT_GAP_AND_ROADMAP.md`；应消费同一轨迹与 Artifact。

---

## 16. Agent 工程契约（P0 必读）

> 目标：把项目 Agent 做成**可停、可测、可追责**的系统，而不是对话皮。
> 实现顺序：**P0a → P0b → P0c → P0d**（§11）。

### 16.1 Turn 状态机 · 取消 · 重试

```text
idle
  → planning          // planTools；同步；失败则 error 且不入队
  → executing         // 工具进行中（媒体 pending 与/或非媒体进行中）
  → done | error      // 终态
```

| 事件 | 行为（P0 冻结） |
|------|-----------------|
| 发送时已有 in-flight turn | **拒绝**新 turn（发送阻塞，A11）；Composer 可编辑草稿 |
| **取消 turn** | 标记 turn=`error`（原因 cancelled）；对仍 `queued`/`running` 的媒体 task 走现有队列取消/跳过能力；已 `done` 的 L1 **不自动删除** |
| **重试** | 默认 **整 turn 重放**（同一 Intent 快照新 turnId）；不默认「只重跑失败 tool」（P1 可加） |
| 部分成功 | 任一步 `error` 且无全部成功 → 助手消息终态 `error`，但已成功的 `assetId`/`artifactIds` **保留展示**；文案标明部分完成 |
| 单 turn 工具步上限 | **强制 ≤ 8**（超出 → error，不继续 enqueue） |

计划文案：P0 使用模板，例如
`计划：{toolLabel}×{n}` / `计划：运行预设「{name}」`；禁止为生成该句单独调用 LLM（P10）。

### 16.2 P0 工具 ACI 表（瘦注册表）

| tool id | description（给人/评测） | 主要入参 | 成功出参 | 失败 | 执行 |
|---------|--------------------------|----------|----------|------|------|
| `run_plain_text` | 文生文（无预设） | text, textModel? | artifactId? 或 text assetId | 空文本/积分 | 非媒体或 text 资产入队（与现 plain 文对齐） |
| `run_plain_t2i` | 无主图文生图 | text, imageSettings | taskIds, assetIds | 无提示词 | pending |
| `run_plain_i2i` | 有主图图生图 | text, mainAsset/url, refs, imageSettings | taskIds, assetIds | 无主图 | pending |
| `run_preset` | 按能力预设执行（可多卡多次调用） | presetId, text?, refs, overrides | taskIds, assetIds | 预设无效/不匹配 | pending |
| `run_lightbox_local_edit` | 大图局部重绘 | assetId, displayKey, localEdit 标志, text? | taskIds, assetIds | 无选区 | pending（复用现管线） |
| `run_plain_3d` | 快捷 3D | text?, main ref, 启用的 3D 预设 | taskIds, assetIds | 无可用 3D 预设 | pending |

**约束**

- 注册表 **≤ 6**；不得为每个用户预设生成一个 tool id（P11）。
- 每个 tool 实现须返回**结构化错误字符串**（可供下一 turn / UI 展示），禁止吞异常。
- `description` 与入参 schema 视为 ACI：改描述须跑 §16.4 评测。
- 与积分：媒体类映射现有 `jobKind` / `plan*Routes`；禁止工具内私自扣费。

### 16.3 轨迹 schema（可观测）

每条 turn 至少可序列化为：

```ts
type AgentTurnTrace = {
  turnId: string;
  threadId: string;
  workspaceProjectId: string;
  startedAt: number;
  endedAt?: number;
  status: 'planning' | 'executing' | 'done' | 'error' | 'cancelled';
  intentSnapshot: {
    text: string;
    mode: 'text' | 'image' | '3d';
    mentionIds: string[];
    presetIds: string[];
    surface: AgentSurfaceContext;
    // 生成参数摘要，勿含 base64
  };
  plan: { toolId: string; label: string }[];
  toolCalls: {
    id: string;
    toolId: string;
    status: string;
    taskIds?: string[];
    assetIds?: string[];
    artifactIds?: string[];
    errorMessage?: string;
    correlationId?: string; // 对接用量/审计
  }[];
  errorMessage?: string;
};
```

**落盘（P0）**：开发态可 `debug` 日志 + 内存环缓；生产可先写现有全局日志通道。P1 再考虑进审计表。
**硬要求**：失败 turn 必须能凭 trace 回答「计划了什么 / 哪步失败 / 对应 taskId」。

### 16.4 评测用例格式与最低集

**格式**（建议 `tests/projectAgentRouting.test.ts`）：

```ts
type AgentRouteCase = {
  id: string;
  intent: /* 最小 Intent 字面量 */;
  expectToolIds: string[];       // 有序
  expectForbiddenToolIds?: string[];
  expectError?: boolean;         // planning 即失败
};
```

**P0 最低集（必须全绿）**

| id | 意图要点 | expectToolIds |
|----|----------|---------------|
| `mode_text_plain` | 模式文、无预设、无图 | `[run_plain_text]` |
| `mode_image_t2i` | 模式图、无主图 | `[run_plain_t2i]` |
| `mode_image_i2i` | 模式图、有主图 | `[run_plain_i2i]` |
| `preset_single` | 一张预设卡 | `[run_preset]` |
| `preset_multi` | 两张预设卡 | `[run_preset, run_preset]` |
| `preset_over_mode` | 模式文 + 生图预设卡 | `[run_preset]`（预设优先） |
| `lightbox_local` | lightbox + localEdit | `[run_lightbox_local_edit]` |
| `mode_3d` | 模式 3D、有可用预设 | `[run_plain_3d]` |
| `mode_3d_none` | 模式 3D、无 3D 预设 | `expectError` |
| `empty_text_no_ref` | 空文本无附图无预设 | `expectError` |
| `step_cap` | 构造 >8 步计划 | 截断或 error（与实现一致并测死） |

P1 追加：`@skill`、promote 确认前后、artifact 试跑等——**不得**删减上表。

### 16.5 幂等 · 积分 · 与画布队列并发

| 规则 | P0 |
|------|-----|
| **turnId** | 客户端提交前生成（uuid）；Runtime 对同一 turnId **只执行一次** planning+enqueue |
| **连点发送** | UI disabled + turnId 去重双保险 |
| **积分** | 遵守闸门 v2 策略 B；媒体工具执行前仍走既有 reserve/settle；Agent 层不另造账本 |
| **重试** | 新 turnId；新积分检查；不复用已 settle 的旧 reserve |
| **与画布并发** | Agent in-flight 时：**阻塞 Agent 发送**；画布拖能力入队 P0 默认**允许**（共用执行器，受现有 workflow 并发上限）。若 `isAiTaskBusy()` 全局忙，Agent 与画布均应提示等待 |
| **理解降并发等** | 不在 Agent 层复制；沿用执行链既有策略 |

### 16.6 HostPort 边界与 mock

- 生产：`WorkflowSection`（或等价适配器）实现 HostPort。
- 测试：`createMemoryHostPort()` 提供内存 pending/assets。
- **Lint**：`services/projectAgent/**` 禁止 `import` 自 `components/WorkflowSection`（及过厚 UI 模块）。
- Runtime 只依赖 `types` + HostPort + tool registry。

### 16.7 安全与权限（P0 最低）

| 项 | P0 |
|----|-----|
| 工具白名单 | 仅注册表 |
| 步数帽 | ≤ 8 |
| Promote | P1 才开放；须确认；默认个人域（P13） |
| Skill 知识包 | P1；须有来源与大小限制（另表） |
| 轨迹中的媒体 | 只记 id，禁止 base64 |

### 16.8 上下文策略（工程默认）

| 通道 | P0 | P1 |
|------|----|----|
| 生图类工具 | **不**贴会话历史全文 | 同左 |
| 文生文 | 可选最近 1～3 轮短文本（结构化），可关 | Skill 自带记忆策略但受 P12 约束 |
| Artifact | 不自动注入 | `@artifact` 或试跑显式带入 |
| 表面上下文 | 芯片字段进 Intent | 富上下文 |

### 16.9 P0 开工检查清单（合并用）

1. 落地 `types/projectAgent.ts`（Intent、Trace、HostPort、Tool 定义）
2. `planTools` + §16.4 用例变绿
3. tool registry 六工具适配现有 enqueue（可先薄包装）
4. 壳 Dock 接 `submitTurn`；删直发路径
5. 取消/重试/turnId；轨迹打日志
6. lint 边界 + 交接文档勾选

---

## 17. 可点名专家 + 可沉淀记忆（Agent 工程规划）

> 对应产品：「像有独立身份与记忆的搭档」，**工程实现为 Expert Profile/Memory，不是网页 Hermes。**

### 17.1 产品定义（给用户的话）

| 能力 | 用户感知 |
|------|----------|
| **可点名** | `@提示词专家` / `@…`；主侧栏计划里出现该专家 |
| **身份** | 稳定脾气与禁区（Profile）；换专家产出可区分 |
| **沉淀记忆** | 教过的偏好刷新后还在；可查看/删除 |
| **外置沉淀** | 炼熟 → 存为能力预设（L3），可拖可复用 |
| **不做什么** | 不另开 Hermes 窗；不让专家默默接管整栏对话 |

### 17.2 数据模型（P1 必落类型）

```ts
type ExpertId = string;

type ExpertProfile = {
  expertId: ExpertId;
  version: number;
  displayName: string;
  mentionAliases: string[];
  mission: string;          // 一句话职责
  styleRules: string[];     // 风格/格式
  taboos: string[];         // 禁区
  fewShotRefIds?: string[]; // 指向知识/示例，非内联长文
  knowledgeRef?: string;
  toolIds: string[];        // 可调工具白名单
};

type ExpertMemoryScope = {
  userId: string;
  expertId: ExpertId;
  workspaceProjectId?: string; // 缺省 = 用户级跨项目
};

type ExpertMemoryEntry = {
  id: string;
  scope: ExpertMemoryScope;
  kind: 'preference' | 'rejection' | 'summary' | 'pointer';
  text: string;             // 短；禁止 base64
  pointer?: { type: 'artifact' | 'preset' | 'asset'; id: string };
  sourceTurnId?: string;
  createdAt: number;
  deletedAt?: number;
};
```

**存储**：见 **§17.10** 与 **§18**（商业级三层 + 1C 真源）。P0 本机分键 + 异步云备份；P1 云为会话/Memory 真源。键须 `scopedStorageKey`，遵守 client-persist 规范。

### 17.3 调用与上下文装配

```text
主 Agent plan 含 invoke_expert(expertId)
  → load Profile
  → retrieve Memory（最近 K 条 + 可选关键词；总 token ≤ 预算）
  → 组装 expertContext = Profile + Memory + 显式 Artifact/选中资产
  → 跑 expert 工具（常产出 Artifact）
  → 可选 writeMemory / proposeProfilePatch / proposeSkillChange（仅允许的触发器）
  → 回写主气泡 toolCall（expertId, memoryIdsInjected, artifactIds）
```

| 规则 | P1 |
|------|-----|
| 会话壳 | 始终主项目线程 |
| 注入预算 | 默认 ≤ ~2k tokens 等价字符；超出截断并记 trace |
| P12 | 主会话全文不自动进专家；专家也不自动吞全历史 |
| 写入触发 | 见 §17.9；**禁止**每句都记、禁止闲聊静默改 Profile/toolIds |

### 17.4 分期（工程顺序）

| 阶段 | 内容 | 完成定义 |
|------|------|----------|
| **P1a** | 注册表 + Profile v0 + `@expert` + invoke | U3 屏 1–2；两专家可点名 |
| **P1b** | MemoryStore + 注入 + **Expert Studio** 记忆页 + §17.9 Memory 触发 | U3 屏 3；刷新仍在；可删 |
| **P1c** | Artifact + 试跑 + Promote | U3 屏 4 |
| **P1d** | 第二专家 + §17.6 评测 + Profile/Skill 确认流 + §17.10 配额 | 工作室可管人设/白名单；CI 绿 |

**首个实例建议**：`expert.prompt_smith`（提示词）。
**第二实例建议**（证明通用，可换）：`expert.brief_outliner`（大纲/分镜文案）或 `expert.style_locker`（风格锁定说明）——须 **工具不同、管道相同**。

### 17.5 模块落点

| 模块 | 职责 |
|------|------|
| `services/projectAgent/experts/registry.ts` | Expert 元数据 + Profile |
| `services/projectAgent/experts/memoryStore.ts` | Memory CRUD / 检索 / 预算 |
| `services/projectAgent/experts/invoke.ts` | 装配上下文 + 调工具 |
| `services/projectAgent/experts/tuneProtocol.ts` | §17.9 调优提案（memory / profilePatch / skillRequest） |
| `services/projectAgent/persist/quotas.ts` | §17.10 / §18 热窗口裁剪、配额、QuotaExceeded |
| `services/projectAgent/threadCloudSync.ts` | §18 异步备份 / P1 pull+LWW |
| `services/projectAgent/contextAssembly.ts` | §18.5 B 层装配 |
| `services/projectAgent/compaction.ts` | §18.5 滚动摘要 |
| `components/project-agent/ExpertStudio.tsx` | 专家工作室（升格原 ExpertMemoryPanel） |
| Mention 候选 | 资产 \| 预设 \| expert |

### 17.6 评测最低集（P1）

| id | 要点 | 期望 |
|----|------|------|
| `mention_expert_routes` | `@prompt_smith` + 文本 | plan 含该 expertId |
| `second_expert_same_pipe` | `@` 第二专家 | 同 invoke 路径，不同 profile |
| `memory_survives_reload` | 写入 preference 后 reload store | 仍可读 |
| `memory_budget_truncates` | 塞入超预算条目 | 注入条数/长度截断且 trace 有标记 |
| `no_silent_memory` | 普通闲聊一轮 | 不新增 memory（除非显式触发） |
| `profile_chat_needs_confirm` | 聊天请求改人设 | 仅产生 pending patch；确认前 version 不变 |
| `skill_chat_needs_studio` | 聊天请求改 toolIds | 不直接改白名单；进申请态 |
| `promote_pointer_memory` | Promote 成功 | 可选 pointer 类 memory；L3 有预设 |
| `clear_memory` | 用户删除 | 条目 deleted；不再注入 |
| `thread_hot_window` | 消息超过本机热窗口 | 本机仅保留窗口内；已备份则可卸下；无 base64 |

### 17.7 安全与隐私

- 记忆不出站到无关专家；按 expertId 隔离。
- 禁止存 API Key、原图像素、整段机密提示词库（可用 pointer）。
- Profile/Knowledge 变更走版本号；恶意过长 knowledge 须拒收。

### 17.8 与 Hermes / 壳 Copilot

| | 网页 Expert | 壳 Hermes |
|--|-------------|-----------|
| 身份 | ExpertProfile | 大脑人设 |
| 记忆 | ExpertMemoryStore | 大脑/会话侧 |
| 手脚 | 工作流工具 / 预设 | `ac.*` 本机 |
| 关系 | **正交**；P2 才谈桥接 | 不互相替代 |

### 17.9 聊天调优三层协议（P20）

> **分工**：对话 = 写入入口；工作室 = 治理；存储 = 分层指针。

| 维度 | 聊天能否调 | 生效条件 | 落点 |
|------|------------|----------|------|
| **Memory** | **要** | 「记住/以后都…」或纠正确认；Promote 成功可写 pointer | ExpertMemoryStore |
| **Profile** | **要，须确认** | 出 diff 确认卡 → 用户确认 → `version++`；可回滚 | ExpertProfile |
| **Skill / toolIds** | **慎用** | 聊天只产生 **skillRequest**；默认在工作室确认后改白名单 | Profile.toolIds / 注册表 |

```text
你：@提示词专家 以后都偏胶片
系统：记入记忆？（确认）→ Memory ✓

你：@提示词专家 把人设改成更像广告文案，禁区加「不要血腥」
系统：Profile 变更对照 → 确认 → version N+1

你：给提示词专家加上「能直接存预设」
系统：技能申请 → 工作室确认（不默认一句生效）
```

**禁止**：静默把全聊天当记忆；闲聊一句改人设或工具面；为调优另开第二套会话壳。

### 17.10 专家工作室与持久化配额（P21 / P22）

#### 专家工作室（Expert Studio）

挂载：**项目 Agent 侧栏菜单**或**项目设置**入口；**不是** Admin 管理端，**不是**用户向全量轨迹看板。

```text
专家工作室
├─ 专家列表（Profile 版本、工具白名单摘要）
├─ 人设：查看 / 确认待生效改稿 / 回滚版本
├─ 记忆：列表、删除、清空
├─ 最近产物：Artifact / 已晋升预设指针
└─ 最近调用摘要（可选）：用过的 memoryId、成败（完整 toolCalls → debug）
```

| 动作 | 主入口 |
|------|--------|
| 「以后都偏胶片」 | 聊天 → Memory |
| 「看看记了啥 / 删一条」 | 工作室 |
| 「人设改稿确认 / 回滚」 | 聊天确认卡 + 工作室 |
| 「改工具白名单」 | 工作室为主 |
| 排障整段 toolCalls | 开发态 Trace（§16.3） |

#### 持久化五层

```text
L0 媒体/资产真源     → 画布 / R2 / 预设存储（字节只在这）
L1 聊天 UI 线程      → 瘦消息：文本 + assetId/artifactId/turnId；禁止 base64
L2 Expert Profile    → 小人设 JSON + version
L3 Expert Memory     → 短条目 append-only（偏好/指针）
L4 Artifact 元数据   → 指向 L0；可试跑
L5 AgentTurnTrace    → 环缓；失败可查；默认不进聊天持久化
```

**与商业级会话的关系**：上表是**对象类型**分层；**真源演进、热/冷、compaction、隐私**见 **§18**（禁止与「每次推理上下文」混谈）。

云策略（P24）：**P0** 本机为主 + 异步备份 R2；**P1** 云为 L1/L3 真源，本机缓存。键须 `scopedStorageKey` / R2 `users/…/agent/`（A22）。

#### 硬配额（起步，可调但须有上限）

| 项 | 建议上限 |
|----|----------|
| 本机热窗口 | 最近 **80** 条常驻；超出若已上云可从本机**卸下**（非永久销毁）；P1 UI 可「加载更早」 |
| 云热段 | 约 **200～500** 条瘦消息留在 `thread-hot.json`；更早滚冷段或只留 compaction 指针（§18.4） |
| Memory / 专家 | ≤ **100** 条且总字符帽；超则删最旧或合并 summary |
| 注入专家 | ≤ ~**2k** tokens 等价（已有） |
| B 层滑动 K | 最近约 **12～20** 轮原文进模型（§18.5） |
| Trace 环缓 | 最近 **30** turn；不进 L1 消息 JSON；默认不上云 |
| 单条消息/条目 | 禁止媒体字节；超长 text 截断拒收 |
| 写盘 | 写前估大小；`QuotaExceeded` → 裁剪本机热并提示；云失败入重试队列（不挡发送） |

#### Runtime 瘦状态（防打爆浏览器）

```text
用户发一句
  → B 层：compaction? + 最近 K 轮 + Intent 切片 +（专家时）Profile + Memory 预算切片
  → 工具执行：Host 按 assetId JIT 取图（不把图拷进 Agent 状态机）
  → 回写：气泡结果卡（assetId）+ 可选 Artifact 元数据
  → A 层：本机热窗口；P0+ 异步云备份
  → Trace：ids/状态进环缓
```

**风险主因**（须避免）：会话塞 base64、无限追加聊天+全量 trace 进 `localStorage`、每 turn 塞全历史、Profile/Knowledge 超长文、把聊天写入 `workflow.json`。  
**推理本身**在服务端；浏览器只扛瘦状态与热窗口。

---

## 18. 商业级会话存档与上下文（1C + 2A）

> 对应产品：「聊很久不丢、换设备能续、模型侧不爆」——**存档、装配、记忆三层分离**；拍板 **P24 / P25**，ADR **A22 / A23**。

### 18.1 目标心智

- 刷新、换设备（**P1 起**）：同一项目还能续上最近对话。
- 聊很久：侧栏仍流畅；很早的气泡可「加载更早」或已归档，**不是**静默永久消失且无法找回。
- Agent「记得」靠 **Memory（C）+ 可选摘要（B）**，不靠把全文永远塞进每次推理。

### 18.2 三层模型（禁止混谈）

```text
A 存档 Archive     → 用户能翻的历史（本机热 + 云热/冷）
B 装配 Assembly    → 每次 turn 送给模型的窗口（滑动 + compaction）
C 记忆 Memory      → 结构化偏好（Expert Memory；P20 显式触发）
```

| 层 | 职责 | 商业对应 |
|----|------|----------|
| **A** | 用户可见历史；云 + 本机缓存 | ChatGPT 会话历史 |
| **B** | 有限 context window 装配 | sliding + compaction |
| **C** | 跨 turn 结构化偏好 | Memory（非全聊天重放） |

### 18.3 真源演进（1C / P24）

| 阶段 | 真源 | 本机 | 云 | 用户可见 |
|------|------|------|-----|----------|
| **P0** | 本机 `threadStore` | 热窗口 80 + 写后 debounce 备份 | R2 轻量 JSON；失败静默重试，**不挡发送** | U1：刷新本机仍在；换设备**不保证** |
| **P1** | **云** | 打开项目 pull+merge；本地为缓存；离线可写队列 | LWW by `updatedAt` | **换设备可续聊** |
| **P2+** | 云 | 分页加载更早、导出、合规删除 | 冷段分片；可选服务端 compaction | 长历史可翻 |

**R2 键**（A22；复用 workspace 账号前缀，不新建 Postgres 聊天表）：

```text
users/{user}/workspace/projects/{projectId}/agent/
  thread-hot.json
  thread-archive/{threadId}.json
  compaction.json
  # Memory：同目录或 experts/{expertId}/memory.json（P1）
```

**禁止**：聊天写入 `workflow.json`；base64/媒体进 thread JSON。  
**复用**：`workspaceCloudSync` put/get/debounce；merge 参考 `workspaceUserCloudConfig` LWW + soft delete。

### 18.4 一项目一主线程（2A / P25）

| 动作 | 行为 |
|------|------|
| 日常发送 | 追加到当前 `threadId` 热段 |
| **新开 / 清空** | UI 确认 → 当前热段写入 `thread-archive/{id}`（云+本地尽力）→ 新建空热线程 |
| 大图等表面 | **不**新开线程（P5 / A5） |
| 多线程列表 | **不做**；设置最多「恢复上一段」单入口 |

会话键：`userId + workspaceProjectId` → 当前热 `threadId`；归档用独立 id。

### 18.5 热窗口 · 卸下 · 压缩（纠正「超 N 条就扔」）

| 机制 | 规则 |
|------|------|
| **本机热缓存** | 常驻最近 80 条；超出若已上云可从本机卸下；P1 可「加载更早」。P0 卸下前须备份成功，否则保留或提示 |
| **云热段** | 约 200～500 条留在 `thread-hot.json`；更早滚冷段或留 compaction 指针 |
| **B 滑动** | 每次推理默认最近 **K≈12～20** 轮原文 |
| **Compaction** | 热段超阈值或 token 预算 → 摘要写入 `compaction.json`；下一 turn = 摘要 + 最近 K 轮；**不**替代 Memory |
| **Memory（C）** | 仍按 P20；禁止静默全聊天入 Memory |

P0 最低：瘦消息 + 热窗口 + 异步云备份 + Trace 不进 L1。  
P1 最低：云真源 + pull/LWW + compaction v0（**优先无 LLM 截断式摘要**）+ Memory 同备份路径。  
Dreaming 式后台全量合成：**P2+**。

**每次 `submitTurn` 装配**：

```text
B = compaction摘要? + 最近K轮瘦消息
  + Intent（芯片/预设/@/表面）
  +（若 @expert）Profile + Memory预算切片
  + 显式 Artifact
→ 媒体工具仍不贴全文历史
```

compaction 若调 LLM：须走积分闸门或标内部廉价路径；P1 默认无 LLM。

### 18.6 消息字段与配额

单条持久化（演进自 `QuickComposeThreadMessage`）：

- 必有：`id, role, text, timestamp, turnId?`
- 指针：`assetIds, taskIds, artifactIds, expertId?, memoryIdsInjected?`
- 状态：`status, errorMessage?`
- **禁止**：preview base64、完整 tool 日志、原图像素、超长 knowledge 内联

配额总表见 §17.10；云失败 → 重试队列，**不挡发送**。

### 18.7 隐私 · 合规 · 产品面

| 项 | 要求 |
|----|------|
| 作用域 | 会话属 **用户 + 项目**；不进团队共享除非另开 |
| 删除 | 「清空」默认归档；设置提供 **删除本项目 Agent 云数据**（P2 可做硬删 UI；P1 至少有级联路径） |
| 导出 | P2：导出瘦消息 JSON；P0/P1 不做 |
| 密钥 | 禁止写入 thread/Memory |
| 登录态 | 未登录：仅本机临时线程，**不上云**；登录后可选一次迁移 |
| 多设备 | P1 LWW；冲突不弹复杂 UI；较新 `updatedAt` 胜出并打 trace |
| 删项目 | 级联删或软删 `agent/` 前缀，避免孤儿 JSON |

### 18.8 模块落点与评测

| 模块 | 职责 |
|------|------|
| `threadStore.ts` | 热线程 CRUD、热窗口、归档新开 |
| `threadCloudSync.ts` | backup / pull / LWW |
| `contextAssembly.ts` | B 层装配 |
| `compaction.ts` | 摘要生成与读写 |
| 现有 `quickComposeThreadStore` | 迁移；50→80 |

| 评测 id | 期望 |
|---------|------|
| `backup_fail_does_not_block_send` | 云失败仍可完成本地 turn |
| `new_chat_archives_hot` | 新开后旧 thread 在 archive；热线程为空 |
| `p1_cloud_is_source` | 清本机后 pull 可恢复热段 |
| `assembly_uses_k_not_full` | 超长线程装配长度 ≤ K（+摘要） |
| `compaction_not_memory` | 仅 compaction 不产生 Memory 条目 |
| `no_thread_in_workflow_json` | 守卫或单测：workflow 包无 agent 消息 |

### 18.9 明确不做

- P0/P1：多会话列表产品、向量全库检索、Dreaming 夜间全量合成、Postgres 聊天表、完整 Trace 当用户历史。
- 不把会话做成第二个 Hermes；不与壳 Copilot 会话合并。

---

**文档维护**：拍板变更只改 §2 表并递增版本；实现细节以 PR 与错题本补充，避免规格与代码长期分叉。
