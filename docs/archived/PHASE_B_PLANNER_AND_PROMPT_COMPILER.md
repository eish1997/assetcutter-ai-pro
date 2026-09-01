# 阶段 B：规则型 Planner + Prompt 编译器 — 详细开发文档

> **定位**：在阶段 A 已落地的 **VGP（语义 / 版本链 / PromptArtifact）** 之上，引入 **可解释的自动流程规划（Planner）** 与 **结构化 Prompt 编译（Compiler）**，使「从意图到多步执行」不再依赖单次黑盒 LLM 写全文 prompt。  
> **上级文档（已归档）**：[`docs/archived/VISUAL_AGENT_GAP_AND_ROADMAP.md`](../archived/VISUAL_AGENT_GAP_AND_ROADMAP.md) 阶段 B。  
> **前置依赖**：[`docs/spec/PHASE_A_VGP_FOUNDATION.md`](./PHASE_A_VGP_FOUNDATION.md) 已实现并可验收。

---

## 1. 文档目的与读者

| 读者 | 用途 |
|------|------|
| 前端 / 全栈 | Planner 调用点、规则表加载、编译器接入执行链 |
| 产品 / 策划 | **附录 A**（场景、文案、与拖拽心智差异）；阶段 B 交付范围与验收 |
| 算法 / 后端 | 规则优先级、与能力块 id 对齐、可追溯输出 |

---

## 2. 阶段 B 在整体架构中的位置

```text
用户意图（自然语言 / 选择目标）
        ↓
【阶段 B】PipelinePlanner（规则优先）→ PipelinePlan（steps + trace）
        ↓
【阶段 B】PromptCompiler（每步）→ PromptArtifact（compiler_version: rule-compiler-*）
        ↓
【已有 Harness】executeCapability / 队列 / VGP 写入
        ↓
模型层
```

**与阶段 A 的分工**

- 阶段 A：保证**每一步**可追溯（父版本、语义快照、artifact）。  
- 阶段 B：保证**计划**与**主 prompt 文本**来自**可配置规则 + 模板**，LLM 仅可选参与「分类 / 补全 / 润色」，且必须进入 `applied_rules` 或 `decision_trace`。

---

## 3. 目标与非目标

### 3.1 必须达成（DoD）

1. **Planner（规则版）**  
   - 输入：`input_profile`（见 §5.2）+ `SemanticState`（或等价目标语义）+ 可选 `constraints`。  
   - 输出：`PipelinePlan`：有序 **`steps[]`**，每步绑定 **`presetId`**（与 `CustomAppModule.id` 一致）或内置 **`step_kind`**（如 `noop` / `direct_render`）。  
   - **可解释**：附带 **`decision_trace: DecisionTraceEntry[]`**，每条含 `ruleId`、`matched_on`（简述匹配条件）、`priority`（数字，越大越先尝试）。  
   - **稳定**：相同输入 + 相同规则表版本 → 相同 `steps[]`（无随机性；除非显式标注 `experimental` 规则且可开关）。

2. **Prompt 编译器**  
   - 输入：`SemanticState` + 当前 `PlannedStep` + `compiler_policy`（可选）。  
   - 输出：写入 **`PromptArtifact`**（与阶段 A 结构兼容）：  
     - `compiled_prompt`：发往生图模型的主指令（自然语言或模板填充结果）；  
     - `compiler_version`：**`rule-compiler-<semver>`**（与 `legacy-understand-1` 区分）；  
     - `applied_rules`：**至少一条**真实规则 id（如 `compiler.template.lineart_v1`），若经 LLM 润色则追加 `compiler.llm_polish`；  
     - `negative_prompt`：若模板或策略提供则写入。  
   - **优先级（硬约束）**：`用户硬约束 / locks` → **步级模板** → **语义维度拼接** → **可选 LLM 润色**（润色不得删除 locks 中声明的保留项）。

3. **与 Harness 对接**  
   - 存在一条清晰路径：用户选择「接受建议流程」后，将 `PipelinePlan.steps` **展开为队列**（或逐步执行并每步写 VGP），**不破坏**现有 `WorkflowPendingTask` / `executeCapability` 行为。  
   - **回退**：用户关闭「使用编译器」或规则未命中时，行为与阶段 A 一致（`legacy-understand-1`）。

4. **非开发者可感知（推荐与阶段 B 同迭代）**  
   - 在「生成记录」或独立「流程建议」区展示：**建议步骤列表** + **命中规则摘要**（人话，非 JSON）；可选「一键加入队列」。

### 3.2 明确不做（阶段 B 不包含）

- **自动评估与重试**（阶段 C）。  
- **学习系统 / 在线调参**（阶段 E）。  
- **全屏 DAG 编辑器替代**现有能力集合画布（阶段 D 或独立迭代）。  
- **Planner 完全 LLM 驱动**（阶段 B 以规则为主；可将「仅当规则未命中时调用 LLM 建议」列为 **B-扩展**，默认关闭）。  
- 替换现有全部预设 `instruction` 为编译器输出（可渐进：**按能力块 / 按开关** 灰度）。

---

## 4. 核心概念

| 概念 | 说明 |
|------|------|
| **PipelinePlan** | 一次规划结果：步骤列表 + trace + 元数据（规则表版本、planner 版本）。 |
| **PlannedStep** | 单步：`presetId` 或 `step_kind`、可选 `params`（如 gear、aspectRatio）、**本步语义覆盖**（可选）。 |
| **RuleRow** | 规则表中的一行：条件 + 产出 `steps[]` 片段或插入指令。 |
| **PromptCompiler** | 纯函数或服务：`(semantic, step, ctx) → Partial<PromptArtifact>` + 合并策略。 |
| **decision_trace** | 仅供解释与调试；可展示给用户摘要。 |

---

## 5. 数据模型（建议 TypeScript / JSON 对齐）

### 5.1 `PipelinePlan`

| 字段 | 必填 | 说明 |
|------|------|------|
| `plan_id` | ✓ | uuid |
| `schema_version` | ✓ | 如 `vgp-plan-1` |
| `created_at` | ✓ | 时间戳 |
| `planner_id` | ✓ | 如 `rules-v1` |
| `ruleset_version` | ✓ | 规则文件或包的版本号 / hash |
| `steps` | ✓ | `PlannedStep[]` |
| `decision_trace` | ✓ | `DecisionTraceEntry[]` |
| `fallback_used` | ✓ | 是否走了兜底（如 `direct_single_gen`） |

### 5.2 `PlannedStep`

| 字段 | 必填 | 说明 |
|------|------|------|
| `ordinal` | ✓ | 0..n-1 |
| `preset_id` | 条件 | 与 `CustomAppModule.id` 一致；内置步可用占位 id |
| `step_kind` | 条件 | 与 `preset_id` 二选一或并存（以 `preset_id` 优先执行） |
| `label` | | 展示用，默认取预设 label |
| `overrides` | | 可选：`imageGear` / `imageAspectRatio` / `imageSize` |
| `semantic_patch` | | 可选：仅本步生效的语义补丁（合并入编译器上下文） |

### 5.3 `DecisionTraceEntry`

| 字段 | 必填 | 说明 |
|------|------|------|
| `rule_id` | ✓ | 稳定字符串 id |
| `priority` | ✓ | 匹配时使用的优先级 |
| `matched` | ✓ | boolean |
| `reason` | ✓ | 短句，可本地化 |
| `detail` | | 结构化可选：如 `{ input_tags: [...], target_style: "..." }` |

### 5.4 `input_profile`（Planner 输入侧）

用于规则匹配，**由产品定义枚举**，避免无边际自然语言：

| 字段 | 说明 |
|------|------|
| `source_kind` | 如 `photo` \| `sketch` \| `lineart` \| `unknown`（可由轻量分类器或用户选择） |
| `has_alpha` | 可选 |
| `dominant_tags` | 可选 string[]（未来视觉标签） |

阶段 B **最小实现**：允许 `source_kind` 默认为 `unknown`，仅依赖 `SemanticState.dimensions` 与 `target.summary` 做规则匹配。

### 5.5 与 `PromptArtifact` 的衔接（阶段 A 扩展）

- 阶段 A 已有 `compiler_version: legacy-understand-1`。  
- 阶段 B 成功路径写入 **`rule-compiler-1.0.0`**（示例）。  
- `applied_rules` 示例：  
  - `{ ruleId: 'planner.row.sketch_to_photo_v1' }`  
  - `{ ruleId: 'compiler.template.step.lineart' }`  
  - `{ ruleId: 'compiler.llm_polish', detail: 'gemini-3-flash-preview' }`（若启用）

---

## 6. 规则表（Planner）设计

### 6.1 存储形态

- **推荐**：`public/planner-rules/` 或 `services/planner/rules/*.json`，随构建打包；热更新可走远程 JSON（与 capability seed 类似）。  
- 每文件含 `ruleset_version` 与 `rules[]`。

### 6.2 单条规则 `RuleRow`（逻辑模型）

| 字段 | 说明 |
|------|------|
| `id` | 稳定 id，进入 `decision_trace` |
| `priority` | 整数，越大越先评估（或明确文档：先按 priority 排序再短路） |
| `when` | 条件对象：对 `input_profile`、`SemanticState.dimensions`、`target.summary` 关键字等的谓词 |
| `then` | `steps: PlannedStep[]` 或 `append_steps` / `replace_plan` 策略（阶段 B 建议仅 `steps` 全量替换以简化） |
| `enabled` | 默认 true |

### 6.3 匹配与冲突

- **单计划输出**：阶段 B 采用 **首条命中且 `matched===true` 的最高 priority 规则** 生成完整 `steps[]`，或 **多规则合并**（仅限明确支持的 `compose` 模式）。**默认推荐：单规则全量计划**，避免不可解释的组合爆炸。  
- **未命中**：`fallback_used: true`，`steps` 为单步 `preset_id: 用户当前选择` 或 `style_transfer` 等默认 id，并在 trace 中记录 `planner.fallback.default`。

### 6.4 与能力块 id 对齐

- `preset_id` **必须**存在于当前工作区的 `CustomAppModule` 列表；加载规则表时做 **校验**（dev 报错 / prod 跳过非法步并降级）。  
- 文档维护：**规则表附录**列出依赖的 preset id 列表（与 `capability-presets.json` 同步检查）。

---

## 7. Prompt 编译器（Compiler）设计

### 7.1 输入上下文 `CompilerContext`

- `semantic: SemanticState`（含 locks / constraints）  
- `step: PlannedStep` 或等价 `preset: CustomAppModule`  
- `locale_policy`：如固定输出英文给生图模型  
- `forbidden_phrases`：可选，来自合规

### 7.2 模板来源

- **按 `preset_id` + `step_kind` 映射**到模板 id，例如：  
  - `compiler.template.preset.lineart_83f822d9c4`  
  - 或通用：`compiler.template.category.image_gen.default`  
- 模板语法：**建议 Mustache 风格** `{{dimension.style}}` 或简单 `{{summary}}`，避免 Turing-complete。

### 7.3 与 `understandImageEditIntent` 的关系

| 模式 | 行为 |
|------|------|
| **B0（开关关）** | 与阶段 A 相同：仅用 LLM 理解预设 instruction。 |
| **B1（编译器主路径）** | 编译器生成 `compiled_prompt`；**可选**调用 LLM **仅做** `polish(compiled_prompt)`，长度与语义受约束。 |
| **B2（混合）** | 结构部分来自模板，细节来自 LLM 填空（需 schema 校验）。 |

阶段 B **建议先实现 B1 的「无润色」与「可开关润色」**，降低风险。

### 7.4 输出合并进 VGP

- 执行前由 `WorkflowSection`（或薄封装 `runCompiledStep`）创建/更新 `PromptArtifact`，再调用 `dialogGenerateImage`。  
- `ImageVersion.promptArtifactId` 仍指向该 artifact（阶段 A 不变）。

---

## 8. 执行与产品流程（建议）

### 8.1 半自动模式（阶段 B 主场景）

1. 用户输入目标语义（或选择「目标：写实 / 二次元」等）并选定资产。  
2. 点击 **「生成流程建议」** → 调用 `planPipeline(input_profile, semantic)` → 展示步骤列表 + trace 摘要。  
3. 用户 **编辑步骤**（删除/重排/换预设）→ 再 **「加入队列」**。  
4. 每步执行时：**若开启编译器**则走 `compilePrompt`，否则 legacy。

### 8.2 全自动（预留）

- 阶段 D 可接同一 `PipelinePlan`；阶段 B 只要求 **API 级** `plan` + `compile` 可独立调用。

---

## 9. 模块与文件布局（建议）

| 路径 | 职责 |
|------|------|
| `types/planner.ts` 或 `types/vgp.ts` 扩展 | `PipelinePlan`, `PlannedStep`, `DecisionTraceEntry` |
| `services/planner/loadRuleset.ts` | 加载、校验、版本 |
| `services/planner/planPipeline.ts` | 纯函数：匹配 → `PipelinePlan` |
| `services/compiler/promptCompiler.ts` | `compilePrompt(ctx): PromptArtifact 草稿` |
| `services/compiler/templates/*.md` 或 `.json` | 模板正文 |
| `components/WorkflowPlannerSuggest.tsx`（名可调整） | 建议流程 UI + 加入队列 |
| `services/capabilityExecutor.ts` | 根据 feature flag 选择 legacy / compiler 路径 |

---

## 10. 配置与功能开关

- `localStorage` 或用户设置：`ac_feature_prompt_compiler` / `ac_feature_pipeline_planner`。  
- **默认**：阶段 B 上线初期可 **默认关闭**，仅内测账号开启；避免影响现网「拖能力即执行」心智。

---

## 11. 测试计划

| 类型 | 内容 |
|------|------|
| 单元 | 规则匹配：同输入同规则表 → 同 `steps`；priority 覆盖 |
| 单元 | 非法 `preset_id` → 降级 + trace 记录 |
| 单元 | 编译器：locks 维度必须出现在 `compiled_prompt` |
| 快照 | `compiled_prompt` 文本快照（防模板回归） |
| 集成 | 半自动：建议流程 → 入队 → 执行一步 → `PromptArtifact.compiler_version === rule-compiler-*` |
| 回归 | 开关关闭 → `legacy-understand-1` 行为与阶段 A 一致 |

---

## 12. 任务拆解（建议工单）

1. **B-01**：`PipelinePlan` / `PlannedStep` / `DecisionTraceEntry` 类型与 JSON schema 草案。  
2. **B-02**：规则表格式 + `loadRuleset` + 启动时校验 preset id。  
3. **B-03**：`planPipeline` 实现 + 单元测试 + 默认 fallback。  
4. **B-04**：模板库 + `compilePrompt` + `compiler_version` 写入。  
5. **B-05**：`capabilityExecutor` 或并行路径 `runWithCompiler` 接入开关。  
6. **B-06**：工作流 UI「流程建议」面板 + 一键入队。  
7. **B-07**：生成记录中展示「本步是否规则编译」与 trace 摘要（可读性）。  
8. **B-08**：文档：`DOCS.md` 功能说明 + 本 spec 修订号。

---

## 13. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 规则与预设不同步 | CI 校验；启动时过滤非法步 |
| 编译 prompt 质量下降 | 保留 legacy 开关；模板迭代 + 可选润色 |
| 用户困惑「两套流程」 | 半自动默认：建议 → 可改 → 再执行；文案强调「建议」 |
| 规则表膨胀 | 命名空间 + 版本；文档要求每条规则有 `reason` |

---

## 14. 与阶段 C 的衔接

- `PipelinePlan` 可挂在「一次 Run」实体上（阶段 C 的 `pipeline_runs` 概念）；评估失败时 **在 plan 上插入/替换步** 而不破坏 VGP 版本链。  
- `decision_trace` 为评估器提供「当时为何选此流程」的依据。

---

## 15. 验收清单（签字用）

1. 固定 `input_profile` + `SemanticState` 夹具，**连续 10 次** `planPipeline` 输出 **完全一致** 的 `steps[]`。  
2. 关闭编译器开关时，全站行为与阶段 A **无回归**（抽样 E2E）。  
3. 开启编译器时，随机抽 3 个预设步，`PromptArtifact.applied_rules` 中 **可见** `compiler.*` 与 `planner.row.*`。  
4. 产品/非开发可在界面读出「建议了哪几步、因何规则」。

---

## 附录 A：产品可读说明（给策划 / 非开发评审）

本节用**场景与白话**说明阶段 B 交付后，用户**能感知到什么**、与现在「自己拖能力块」差在哪里；技术实现仍以正文为准。

### A.1 用户多了一件什么事？

**现在（阶段 A）**：用户自己决定顺序——拖「线稿」→ 再拖「色块」→ 再拖「转风格」。

**阶段 B 之后（半自动）**：用户先说一句目标（或选几个目标标签，如「更写实」），系统给出一份 **「建议流程」**——列出建议执行的几步、**为什么这样排**（一句话因由）。用户可以 **改顺序 / 删掉某步 / 换能力**，再一键执行。

👉 产品心智：**系统给草稿，用户拍板**；不是黑盒一键出图，也不是强迫用某条流程。

### A.2 两个典型场景（故事）

**场景 1：草图想变照片感**

- 用户：上传草图，目标选「偏写实 / 照片感」。  
- 系统建议：例如「线稿化 → 平涂色块 → 光影与材质强化」（具体能力名以你们预设为准）。  
- 界面上除步骤列表外，还有 **「因由」**：例如「草图到写实通常需要先稳定结构与色域，再加重光影」。  
- 用户：可以删掉一步，或把某步换成自己更熟的能力，再执行。

**场景 2：已经有一步「线稿」结果，想从中间继续**

- 用户：在资产里切到**某张中间结果**（阶段 A 已支持「从任意展示图继续生图」），再选目标。  
- 系统建议：只排「后续还缺几步」，**不会**假设用户永远从原图开始。  
- 因由里会体现：**当前输入类型** + **目标** 共同决定（正文里的 `input_profile` + 语义）。

### A.3 界面上建议长什么样（文案层）

| 区域 | 用户读到什么 | 目的 |
|------|----------------|------|
| 标题 | 「建议流程」或「推荐步骤」 | 明确是建议，非强制 |
| 步骤列表 | 第 1 步：线稿；第 2 步：色块；… | 可扫描、可对照 |
| 因由 / 说明 | 1～2 句人话 + 可选「查看规则详情」 | 建立信任、可解释 |
| 操作 | 「编辑」「一键加入队列」「用传统方式」 | 老用户可退回纯拖拽 |

**不**要求普通用户理解「规则 id」「priority」；这些放在「详情」或仅给支持/研发。

### A.4 「规则」在产品语言里是什么？

可以对外说成：**「流程策略」** 或 **「推荐策略」**。

- 每条策略对应：**在什么条件下**（例如：草图 + 目标是写实）→ **推荐哪几步**。  
- 对内研发仍用「规则表」一词；对外的帮助文档用「策略」更顺。

### A.5 与「Prompt 编译器」对用户的说法

用户侧不必强调「编译器」三字。可统一为：

- **「按你的目标与每一步生成说明」**：即结构化生成指令，而不是随机一段英文。  
- 在「生成记录」里（阶段 A 已有）：可标注 **「本步说明由系统模板生成」** 与 **「本步为传统理解模式」**（对应 legacy），便于区分。

### A.6 极简示例（仅帮助对齐预期，非最终配置）

下面用**表格**表达「条件 → 建议步骤」，**不等于**真实规则表字段；真实格式以工程实现为准。

| 用户侧条件（简述） | 建议步骤（示例） |
|--------------------|------------------|
| 输入像草图、目标偏写实 | 线稿 → 色块 → 偏写实渲染 |
| 输入已是照片、只想换风格 | 转风格（或单步） |
| 未识别类型、目标模糊 | 单步「通用增强」或保持现状（由兜底策略说明） |

### A.7 和「能力块生态」的关系

- **能力块**仍是用户与系统**可复用的积木**；阶段 B **不**替代能力块。  
- **Planner** 只**引用**已有能力块 id 来排顺序；没有对应能力块时，对应策略应**降级**或**提示用户去能力页安装**。  
- 产品叙事：**「策略」是「怎么搭积木」；积木本身还是你们维护的预设。**

---

*文档版本：1.1 — 增加附录 A（产品可读）；正文技术约定不变。*
