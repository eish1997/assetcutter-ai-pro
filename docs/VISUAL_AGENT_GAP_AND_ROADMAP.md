# 视觉 Agent 北极星：当前状态 vs 目标差距与路线图

> **用途**：产品 / 架构长期对齐；先定「差什么」，再按附录索引去写细则规范。  
> **现状依据**：以本仓库当前实现为准（能力块、工作流、对话生图、设计文档等），非愿景复述。

---

## 1. 北极星（最终目标，一句话）

**理解用户的视觉意图，自动规划与执行多阶段生成，并在结果未达标时调整策略直至达成目标**——即从「可控生图工具」演进为 **Visual Agent / Visual Generation OS**。

### 1.1 四层骨架（长期不变）

| 层 | 职责 | 北极星要求 |
|----|------|------------|
| 用户意图层 | 入口：拖拽能力、复合能力、自然语言 | 表达「要什么」 |
| Agent 决策层 | 解析目标、拆 pipeline、选策略、根据评估调整 | 决定「怎么做、要不要改」 |
| Harness 执行层 | 能力块、复合图、中间图、队列与资源 | 把步骤**真正执行**出来 |
| 模型层 | 各厂商生图 API | 只提供算力，**不参与**产品与流程决策 |

### 1.2 运行闭环（与「工具」的分水岭）

```text
意图 → 规划 → 执行 → 评估 → 未达标则调整（prompt / pipeline / 步骤）→ 再执行 → …
```

---

## 2. 当前实现状态（事实核对）

### 2.1 已具备：强 Harness + 半自动意图

- **能力块（预设）**：`public/capability-seed/capability-presets.json`、`services/capabilityPresetStore.ts`；支持 `gen_image` / `builtin` 等。
- **单步执行链路**：`services/capabilityExecutor.ts` 中工作流生图为 **「理解预设 → 生图」**（`understandImageEditIntent` 后再 `dialogGenerateImage`），与对话模式思路一致。
- **复合能力（图结构 pipeline）**：`executeCapabilitySet` 按 DAG 拓扑执行，支持多支汇聚到输出（能力集合编辑器 + JSON 配置）。
- **工作流资产模型**：`types.ts` 中 `WorkflowAsset` — `results` 按能力 id 存图、`resultOrder` / `resultMeta` 记录顺序与时间；组切割、父子组用 `parentAssetId`、`cutImageGroup` 等（详见 `docs/FIRST_PRINCIPLES_WORKFLOW_REVIEW.md`）。
- **对话侧**：多版本历史、重新生成、自然语言 + 图驱动生图（`DOCS.md` / `hooks/useDialogGeneration.ts` 等）。
- **反馈与记录（局部）**：`docs/PROMPT_SCORING_DESIGN.md` 定义对话/贴图 **生成记录 + 可选用户评分**（一期前端 localStorage），为优化闭环预留结构，**尚未等同于**工作流级自动评估与重试。

### 2.2 明确未实现或已下线（避免误判）

- **独立「语义状态层」**：代码中无统一的跨步 `SemanticState` 对象；每步主要依赖**当次图像理解**，易漂移。
- **版本链（Lineage）**：`WorkflowAsset` 有组父子关系与 `results[stepId]`，但**没有**「每一张输出图 = 一等公民版本节点 + parent_version + 绑定语义快照」的一贯模型。
- **Pipeline Planner（自动拆流程）**：无独立规划服务；复合能力依赖**用户配置的图**；无「输入草图 + 目标写实 → 系统自动给出步骤序列」的规则/Agent 规划层。
- **Prompt 编译器（结构化）**：当前为 **LLM 理解自然语言/预设** 生成指令，**非**「语义字段 → 模板/规则 → 可审计 prompt 产物」的编译管线。
- **评估器 + 自动优化循环**：无统一 `Evaluator` 驱动重试；`PROMPT_SCORING_DESIGN` 偏**记录与人工分析**，未接工作流自动 replan。
- **学习系统**：无基于历史 pipeline 分数的策略学习。
- **曾规划的异步批量 Job**：管理端说明对话「批量出图」相关 Job API 已移除（`components/admin/AdminPlaceholder.tsx`）；**全局一句指令批量改多张图**仍属产品/技术缺口。

---

## 3. 差距总表（目标 vs 现状）

| 能力域 | 北极星要求 | 当前状态 | 缺口摘要 |
|--------|------------|----------|----------|
| 语义控制 | 跨步骤一致的「视觉语言」目标（风格/结构/光照等） | 每步单独理解，无持久语义对象 | 缺 **SemanticState** 与步间继承/锁定策略 |
| 状态链 | 任意结果可回溯父版本与生成路径 | 能力 id 维度结果 + 组父子，非通用版本 DAG | 缺 **AssetVersion + parent** 与 pipeline 步骤绑定 |
| 规划 | 规则/Agent 自动产出 pipeline | 用户配复合图或单步拖能力 | 缺 **Planner** 与可解释 `decision_trace` |
| 执行 | 可靠多步、中间图 | 已有能力集合 + 单步，较强 | 需与**语义 + 版本链**对齐，避免「只串联无状态」 |
| Prompt | 结构化、可调试、可追溯 | LLM 理解输出 | 缺 **PromptCompiler + PromptArtifact**（规则 trace） |
| 评估 | 对「结果 vs 语义目标」打分并驱动重试 | 用户主观评分设计（对话侧）、无工作流闭环 | 缺 **Evaluator** 与 **Refinement 策略** |
| 学习 | 历史 pipeline 优化推荐 | 无 | V3+ |
| 多候选 | 一次多方案选优 | 对话侧可能有多 prompt 路径，非体系统一 | 缺统一 **Multi-candidate** 协议与 UI |
| 批量/全局 NL | 「前 N 张图统一目标」 | 批量下载等 UI；异步批量 Job 已移除相关说明 | 缺 **批量编排 + 共享语义** |
| 可视化 | 流程 A→B→C 可见 | 复合能力有编辑器；运行态流程面板弱 | 缺 **Run 视图**（步骤状态 + 每步产物） |

---

## 4. 分阶段路线图（建议）

阶段命名与你们内部 V2/V3 可一一映射；每阶段有**可验收句**。

### 阶段 A — 契约与数据骨架（V2 地基）

- 引入 **语义状态 + 版本链 + 单步编译产物** 的最小协议（可与对话中的「VGP」半页契约对齐：语义 / PipelineStep / Evaluation）。
- 持久化策略：先前端状态机 + 可选后端；与现有 `WorkflowAsset` **并存迁移**，避免大爆炸改写。
- **验收**：同一任务多步可在数据层回答「这一步的父图是谁、用的哪份语义、prompt 从哪条规则来」。
- **详细开发说明**（类型、不变量、挂接文件、任务拆解、测试）：[`docs/spec/PHASE_A_VGP_FOUNDATION.md`](spec/PHASE_A_VGP_FOUNDATION.md)；含 **「生成记录」** 面向非开发者的显式验收 UI（阶段 A 必填）。

### 阶段 B — Planner（规则优先）+ Prompt 编译器

- 规则表输出 `steps[]`；Planner 输出必须可解释（命中规则 id）。
- Prompt 由 **语义 + step + 策略** 编译，LLM 仅作**补全或润色**（可选），且写入 `applied_rules`。
- **验收**：给定「输入类型 + 目标语义」可稳定产出 pipeline，且不依赖黑盒单次 prompt。
- **详细开发说明**：[`docs/spec/PHASE_B_PLANNER_AND_PROMPT_COMPILER.md`](spec/PHASE_B_PLANNER_AND_PROMPT_COMPILER.md)。

### 阶段 C — 评估与一次重试闭环

- 轻量 Evaluator（可先 vision + 结构化 JSON 分数）；阈值与 `recommended_action` 枚举。
- 与工作流执行器挂钩：**未达标 → 限定次数内** 调整 prompt 或插入步骤。
- **验收**：失败场景可自动重试并有日志；非无限循环。

### 阶段 D — 体验与规模

- 运行态 **Pipeline 可视化**；多候选统一协议；批量任务 **共享 SemanticState**。
- 对话侧生成记录与 **工作流 run** 打通（可选同一张「生成记录」表抽象）。
- **验收**：半自动 / 全自动两种模式共用同一套后端事件与前端视图。

### 阶段 E — 学习系统（V3）

- 基于历史 `pipeline + score` 做推荐/淘汰；仍须服从阶段 A 协议，不绕过评估与语义。

---

## 5. 非目标（当前文档边界）

- 不绑定单一云厂商或模型；模型层可替换。
- 不在此文档写具体 SQL/OpenAPI 字段实现（放到子文档）。
- 不将「更多预设能力块」等同于 Agent 完成度；**壁垒在协议与闭环**。

---

## 6. 建议的扩展子文档索引（按需撰写）

| 文档 | 内容 |
|------|------|
| `docs/spec/PHASE_A_VGP_FOUNDATION.md` | **阶段 A 全文**：SemanticState / ImageVersion / PromptArtifact、`WorkflowAsset.vgp` 扩展、执行路径挂接、迁移与测试 |
| `docs/spec/PHASE_B_PLANNER_AND_PROMPT_COMPILER.md` | **阶段 B 全文**：PipelinePlan、规则型 Planner、Prompt 编译器、Harness 衔接、任务与验收 |
| `docs/spec/VGP_PROTOCOL.md` | （可选）跨阶段总表：PipelineStep / Evaluation 等与 OpenAPI 对齐的 JSON Schema |
| `docs/spec/WORKFLOW_VERSION_MIGRATION.md` | 从 `WorkflowAsset.results` 迁移到版本 DAG 的策略与兼容层 |
| `docs/spec/PLANNER_RULES.md` | （可选拆分）规则表字段细则、与 `capability-presets` 同步清单 |
| `docs/spec/PROMPT_COMPILER.md` | （可选拆分）模板语法、与 `understandImageEditIntent` 混合格式 |
| `docs/spec/EVALUATOR.md` | 分数维度、阈值、重试状态机 |
| `docs/spec/BATCH_ORCHESTRATION.md` | 多资产共享语义、并发与配额（若恢复异步能力） |

**已有可参考文档**：`docs/PROMPT_SCORING_DESIGN.md`、`docs/FIRST_PRINCIPLES_WORKFLOW_REVIEW.md`。

---

## 7. 一句话给评审用

**现在已经有了能执行多步的 Harness；要成为 Agent，必须补齐「语义状态 + 可追溯版本链 + 评估驱动的调整」三件事，并写成同一套协议，而不是再堆能力块数量。**

---

*文档版本：初稿（与仓库实现同步盘点）。后续仅通过子规范扩展细节，本页保持「北极星 + 差距 + 阶段」稳定。*
