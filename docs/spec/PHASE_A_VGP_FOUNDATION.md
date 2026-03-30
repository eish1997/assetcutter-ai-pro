# 阶段 A：VGP 契约与数据骨架 — 详细开发文档

> **定位**：在不大改现有工作流 UX 的前提下，引入 **语义状态（SemanticState）**、**图像版本链（ImageVersion）**、**单步 Prompt 产物（PromptArtifact）** 的最小可实现协议，并与 `WorkflowAsset` **双轨并存**。  
> **上级文档**：[`docs/VISUAL_AGENT_GAP_AND_ROADMAP.md`](../VISUAL_AGENT_GAP_AND_ROADMAP.md) 阶段 A。  
> **协议别名**：VGP（Visual Goal Protocol）— 阶段 A 只落地其中 **S + 版本链 + PromptArtifact**；**Evaluation** 仅预留类型与存储位，**不实现自动重试**（阶段 C）。

---

## 1. 文档目的与读者

| 读者 | 用途 |
|------|------|
| 前端 / 全栈 | 类型定义、写状态、挂接 `executeCapability` / 待处理队列 |
| 产品 | 阶段 A 交付边界与验收句 |
| 后续阶段 | Planner / Compiler / Evaluator 依赖本契约，不得绕开 |

---

## 2. 目标与非目标

### 2.1 阶段 A 必须达成（DoD）

1. **任意一次工作流生图步骤**（单能力或能力集合中的一步）在数据层可查询到：
   - **父图像版本** `parentVersionId`（首步为 `null` 或指向 original 占位版本）；
   - **该步生效的语义快照** `semanticStateId`；
   - **该步用于生图的 Prompt 产物** `promptArtifactId`（含最终下发模型的字符串 + 可追溯 trace）。
2. 上述数据与现有 **`WorkflowAsset.results` / `resultOrder`** 同步一致或可推导，**不破坏**当前网格、组、归档、R2 hydrate 行为。
3. 持久化：**至少**会话级（内存 + `localStorage` 或现有工作流持久化管道）；若已有云端资产 JSON，则 **扩展字段可选**，服务端忽略未知字段不报错。
4. **非开发者可验证**：实现 **第 8 节「生成记录」** 中的入口与文案，使**不懂代码的用户**仅凭界面即可判断「步骤顺序、父子关系、每步目标与生成说明」是否合理；不得以「仅控制台 / 仅 JSON」作为唯一验收手段。

### 2.2 明确不做（阶段 A 不包含）

- 自动 Pipeline 规划（阶段 B）。
- 结构化 Prompt **编译器替代** LLM 理解（阶段 B 才切分职责）；阶段 A 仅 **记录** LLM 输出为 artifact。
- 自动评估、重试、分数阈值（阶段 C）。
- **全屏流程编排 / 与阶段 D 同级的「运行态主流程图」**（阶段 A 不要求）；阶段 A 必须有 **第 8 节** 所列的轻量「生成记录」视图，**不等同于**仅开发者调试面板。
- 替换 `displayKey` 为用户心智中的「版本 id」（可并行存在，不强制改 UI 文案）。

---

## 3. 与现状的对照

| 概念 | 现状（`types.ts`） | 阶段 A 新增 |
|------|-------------------|-------------|
| 资产根实体 | `WorkflowAsset` | 保持不变；可选增加可选字段 `vgp?: VgpAssetExtension` |
| 每一步结果图 | `results[stepKey]`，`stepKey` 多为能力 id | 增加 `ImageVersion`，`stepKey` 可作为 `stepKey` 冗余字段便于对齐 |
| 顺序 | `resultOrder[]` | `ImageVersion` 链或同级列表与 `resultOrder` **同序写入** |
| 语义 | 无 | `SemanticState` 快照表（按 id 存储） |
| Prompt | 内存中 `understandImageEditIntent` 结果 | `PromptArtifact` 持久化引用 |

**关键文件（挂接点）**

- `services/capabilityExecutor.ts`：`resolveCapabilityPrompt`、`executeCapability`、`executeCapabilitySet` — 在「理解完成」与「生图调用」之间写入 artifact。
- `components/WorkflowSection.tsx`：`executePending` 及写入 `results` / `resultOrder` / `resultMeta` 的分支 — 创建 `ImageVersion` 并挂 `vgp`。
- `types.ts`：新增 VGP 相关类型（或 `types/vgp.ts` 再 export）。

---

## 4. 核心数据模型

### 4.1 标识与版本

- 所有 id 建议 **`nanoid` / `uuid`**，与 `WorkflowAsset.id` 风格一致。
- **`schema_version`**：顶层常量，例如 `vgp-1`，用于将来迁移。

### 4.2 `SemanticState`（语义快照）

**语义**：某一时刻「视觉目标」的**不可变快照**（更新目标 = 新 id，不原地改）。

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✓ | |
| `schema_version` | ✓ | 如 `vgp-1` |
| `createdAt` | ✓ | ms 时间戳 |
| `target` | ✓ | `{ summary?: string }` 或扩展；阶段 A 可用用户 `promptOverride` + 预设 label 拼出 summary |
| `dimensions` | ✓ | `Record<string, string \| undefined>`，如 `style`、`structure`、`color`、`lighting`；**允许空对象** |
| `locks` | ✓ | `Record<string, boolean>`，阶段 A 可全 `false` |
| `constraints` | ✓ | `Record<string, unknown>`，阶段 A 可 `{}` |
| `provenance` | ✓ | `{ kind: 'user' \| 'inherited' \| 'agent_derived'; parentSemanticId?: string; note?: string }` |

**阶段 A 默认策略**

- 第一步：从 **预设 `instruction` + 可选 `promptOverride`** 生成初始 `SemanticState`（可先不调用额外 LLM，把 `dimensions` 留空，仅填 `target.summary`）。
- 后续步：**继承**上一步 `SemanticState` 的深拷贝为新 id，`provenance.kind = 'inherited'`，`parentSemanticId` 指向前一快照；若用户改了微调文案，可写新 `target.summary`。

### 4.3 `PromptArtifact`（单步 Prompt 产物）

**语义**：该步实际参与生图的文本及可追溯信息（阶段 A **不强制**规则编译，但要能回答「用了什么」）。

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✓ | |
| `schema_version` | ✓ | |
| `createdAt` | ✓ | |
| `compiled_prompt` | ✓ | 发给生图模型的**最终**英文（或模型要求语言）指令 |
| `negative_prompt` | | 若模型支持；否则省略 |
| `applied_rules` | ✓ | `Array<{ ruleId: string; detail?: string }>`；阶段 A 至少写入 `{ ruleId: 'capability.preset_understand', detail: presetId }`，若有 `promptOverride` 再加 `{ ruleId: 'user.prompt_override' }` |
| `compiler_version` | ✓ | 阶段 A 固定如 `legacy-understand-1`（表示来自 `understandImageEditIntent`） |
| `raw_understood_instruction` | | 可选，与当前 `instruction` 字段一致时便于 diff |

**不变量**：每个成功的 `gen_image` 步对应 **恰好一个** `PromptArtifact`（同一 asset 多步则多个 artifact）。

### 4.4 `ImageVersion`（图像版本节点 = 版本链）

**语义**：一张可展示的输出（或 original）在 VGP 中的**一等节点**。

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✓ | |
| `assetId` | ✓ | 所属 `WorkflowAsset.id` |
| `parentVersionId` | | 首版可为 `null`；original 可用占位节点 `role: 'original'` |
| `lineageRootId` | ✓ | 一般为该资产第一条版本的 id 或 asset 级 root |
| `stepIndex` | ✓ | 从 0 递增，与 `resultOrder` 顺序一致 |
| `stepKey` | ✓ | 与 `results` 的 key 一致（能力 id 或复合 key） |
| `role` | ✓ | `'original' \| 'generated' \| 'cut' \| 'imported'` 等 |
| `imageRef` | ✓ | 阶段 A：`{ kind: 'inline_base64' }` 与现有一致；或 `{ kind: 'result_key', key: string }` **仅引用** `WorkflowAsset.results[key]`，避免重复存大图 |
| `semanticStateId` | ✓ | 该输出对应的语义快照 |
| `promptArtifactId` | | `gen_image` 必填；非生图步可省略 |
| `modelInvocation` | | 可选：`{ modelId: string; gear?: string; aspectRatio?: string; imageSize?: string }` |
| `createdAt` | ✓ | |

**不变量**

- `parentVersionId` 必须指向 **同一 `assetId`** 下已存在的版本（或 null）。
- `stepIndex` 与 `resultOrder` 追加顺序严格一致（便于调试）。
- **Original**：建议在资产创建时生成一条 `role: 'original'` 的 `ImageVersion`，`parentVersionId: null`，`semanticStateId` 可为「空语义」占位快照。

### 4.5 `VgpAssetExtension`（挂在 `WorkflowAsset` 上的扩展）

建议 **可选字段**，避免强制迁移历史 JSON。

```ts
// 伪代码 — 实际以 types 为准
type VgpAssetExtension = {
  schema_version: 'vgp-1';
  /** 按 id 扁平存储，便于 O(1) 查找；或分表存 localStorage 另一 key */
  versionsById: Record<string, ImageVersion>;
  /** 拓扑顺序 = 生成链主链，与 resultOrder 对齐 */
  versionOrder: string[];
  semanticsById: Record<string, SemanticState>;
  promptsById: Record<string, PromptArtifact>;
  /** 当前「链头」版本 id，默认同 displayKey 对应版本（若可解析） */
  headVersionId?: string;
};
```

**与 `displayKey` 的关系**

- `displayKey === 'original'` → 指向 `role==='original'` 的版本 id（建议在扩展里记 `originalVersionId`）。
- `displayKey === 某能力 id` → 找到 `stepKey` 匹配且**最后一步**同 key 的版本（若重复执行同能力，阶段 A 需定义：**每次执行新追加一条版本**，key 可仍为能力 id，用 `stepIndex` 区分）。

**同能力多次执行**：`results[capabilityId]` 仍只保留**最后一次**（现状）；`versionOrder` 则保留**每一次**的 `ImageVersion` id，历史图像若被覆盖，须在 `ImageVersion.imageRef` 中保留 `inline_base64` 快照 **或** 接受「链上可追溯但像素仅最新」— **阶段 A 推荐**：新版本节点使用 `imageRef: { kind: 'result_key', key }` 指向当前 `results[key]`，并在 `resultMeta` 中已有时间戳；若需严格历史像素，二期再引入 R2 每版本 object key。

### 4.6 `Evaluation`（仅预留）

阶段 A **不写业务逻辑**，仅在类型与存储中预留：

| 字段 | 说明 |
|------|------|
| `id`, `subjectVersionId`, `againstSemanticId`, `scores`, `pass`, `recommended_action` | 与路线图/VGP 一致 |

可在 `VgpAssetExtension` 中加 `evaluationsById?: Record<string, Evaluation>` 空对象。

---

## 5. 执行路径集成设计

### 5.1 单能力：`executeCapability`

**改造点**（保持对外签名兼容，扩展可选 context）：

1. 新增可选参数 `ctx.vgp?: { assetId, parentVersionId, semanticState, presetId, promptOverride? }`。
2. 在 `resolveCapabilityPrompt` 返回非空 `understood` 后：
   - 构建 `PromptArtifact`（`compiled_prompt = understood`，`applied_rules` 含 preset id）。
3. 生图成功后返回扩展结果（或 side channel）：
   - `newVersion: ImageVersion`、`newSemantic: SemanticState`（若与输入相同可复用 id）、`promptArtifact`。

若不便改返回类型，可采用 **回调**：`ctx.onVgpStepComplete?.(payload)`。

### 5.2 复合能力：`executeCapabilitySet`

对 DAG 中 **每一个 preset 节点**（及最终 output 合并点）：

- 输入版本 = 上游节点输出对应版本 id；
- 每步同样产生 `PromptArtifact` + `ImageVersion`（合并步可定义 `stepKey` 为 `set:${setId}:output`）。

需在 `CapabilitySetExecuteContext` 中传入 `presets` 同级：`vgpContext`。

### 5.3 工作流 UI：`WorkflowSection` 待处理执行

在成功写入 `asset.results[task.actionType]` 与 `resultOrder` 的同一事务式更新中：

1. 生成/继承 `SemanticState`。
2. 写入 `PromptArtifact`（从 executor 回调拿）。
3. 追加 `ImageVersion` 与 `versionOrder`。
4. 更新 `resultMeta[stepKey].executedAt`（已有则保留）。

**失败路径**：不写新版本；可选写 `failedRun` 调试记录（阶段 A 可选）。

### 5.4 切割等非生图步骤

- 仍创建 `ImageVersion`，`role: 'cut'`，`promptArtifactId` 省略，`semanticStateId` 继承或占位。
- `applied_rules` 可写在 artifact 省略；若统一要求每步有 artifact，可用 `compiler_version: 'builtin-cut-1'` + 空 `compiled_prompt`。

---

## 6. 持久化与同步

### 6.1 本地优先

- **方案 A**：`vgp` 整块挂在每个 `WorkflowAsset` 上，随现有工作流持久化一起保存（若体积过大需评估）。
- **方案 B**：全局 store `localStorage` key `ac_vgp_store_v1`：`Record<assetId, VgpAssetExtension>`，资产 JSON 只保留 `vgpRef`（轻引用）。阶段 A 可先用 **方案 A** 降低一致性风险。

### 6.2 云端（若资产已同步 R2）

- 扩展字段 `vgp` 写入同一 JSON；老客户端忽略。
- 注意 **体积**：`versionsById` 内避免重复存 base64（优先 `result_key` 引用）。

### 6.3 迁移：历史资产无 `vgp`

- **惰性迁移**：首次打开或首次再生成时，根据 `resultOrder` 与 `results` 生成**尽力而为**的链（父子的顺序按 `resultOrder`；语义用空 `dimensions` + `target.summary: 'legacy-migrated'`）。
- 不阻塞读写；迁移函数单测覆盖。

---

## 7. TypeScript 模块布局建议

| 路径 | 职责 |
|------|------|
| `types/vgp.ts` 或 `types.ts` 尾部 | `SemanticState`, `PromptArtifact`, `ImageVersion`, `VgpAssetExtension`, `Evaluation` |
| `services/vgp/vgpStore.ts` | 纯函数：`createOriginalVersion`, `appendGeneratedStep`, `inheritSemantic`, `buildPromptArtifactFromUnderstand` |
| `services/vgp/migrateLegacyAsset.ts` | 无 vgp → 生成最小合法扩展 |
| `services/capabilityExecutor.ts` | 挂接 vgp context / 回调 |
| `components/WorkflowSection.tsx` | 执行成功分支调用 vgpStore |

**禁止**：在 10+ 处散落拼接 id；统一走 `vgpStore`。

---

## 8. 面向非开发者的显式验收 UI（阶段 A 必填）

> **目的**：让**不懂代码**的产品/用户无需查看数据结构或开发者工具，也能判断 VGP 是否「链对、意对、说明对」。实现上**绑定**同一份 `vgp` 数据，与 §4 一一对应。

### 8.1 入口与命名

- 在工作流资产卡片或大图预览的明显位置提供入口，建议文案：**「生成记录」** 或 **「步骤与说明」**（二选一统一全站）。
- 无 `vgp` 的旧资产：入口可显示为灰色或点击后提示「执行新步骤后将显示记录」；惰性迁移成功后应可展示。

### 8.2 主面板：步骤列表（必读信息）

以**时间顺序**列出从原图起的每一步（与 `versionOrder` / `resultOrder` 一致）。每一步至少展示：

| 展示项 | 数据来源 | 用户理解 |
|--------|----------|----------|
| 步骤序号 + 能力名称 | `stepKey` → 预设 `label` 或 id | 「我做了哪一步」 |
| 上一步是什么 | `parentVersionId` 解析为「原图」或「第 N 步：某某能力」 | 「从哪张图来的」 |
| **当时目标（一句话）** | `SemanticState.target.summary`（或预设名 + 微调摘要） | 「我当时想达成什么」 |
| **生成说明（摘要）** | `PromptArtifact.compiled_prompt` 前约 120 字 + **「展开全文」** | 「模型实际收到的指令长什么样」 |

**交互**：长文默认折叠；支持一键 **复制** 本步完整 `compiled_prompt`（便于反馈给支持，无需懂代码）。

**非生图步**（如切割）：显示步骤名 +「上一步」；若无 prompt，显示固定说明如「图像处理步骤，无文本生成指令」。

### 8.3 缩略图时间线（强烈推荐）

在面板顶部或侧栏用 **横向小图**：原图 → 第 1 步结果 → 第 2 步结果 …（从 `ImageVersion` + `results` 解析缩略图）。

- 点击某一步：高亮列表中对应行。
- **可选**：箭头标注「从上一张到这一张」，强化父子关系（与 `parentVersionId` 一致）。

### 8.4 自检状态（可选但推荐）

面板底部一行非技术文案，例如：

- **已记录步骤数**：N（应与用户记忆的操作次数一致，允许与「同能力多次执行」的链长度一致）。
- **数据完整性**：若某步缺语义或缺 prompt（不应在成功路径出现），显示「部分信息缺失，请反馈」而非技术字段名。

### 8.5 导出（可选）

- 按钮 **「导出本资产生成记录」**，生成 `.txt`（UTF-8）：每步序号、能力名、目标摘要、完整 prompt、时间戳。**不要求**用户理解 JSON。

### 8.6 非开发者验收清单（阶段 A 签字用）

由测试或产品按下列勾选即可认为 **UI 侧验收通过**（与 §2.1 数据 DoD 同时满足）：

1. 执行 2 步不同能力后打开「生成记录」，能看到 **2 条**步骤，且第 2 条显示「上一步」为第 1 步（或等价文案）。
2. 每步「生成说明」展开后，内容与**当次生成**意图相符，无明显串步、串资产。
3. 刷新页面后（若已持久化 `vgp`），记录仍在；未实现持久化则至少在**同一会话内**仍可读。
4. **全程无需**打开浏览器开发者工具或阅读原始 JSON。

### 8.7 与开发者工具的关系

- **第 9 节** 中的 dev 日志/调试面板**不能替代**第 8 节；可作为研发排障补充。

---

## 9. 开发者调试与可观测性（补充）

- `onLog` 或 dev 开关：打印 `versionId`、`semanticStateId`、`promptArtifactId` 单行摘要。
- 可选：`VgpDebugPanel`（仅 `import.meta.env.DEV` 或 URL query）列出 `versionOrder` 原始 id，供与 §8 对照。

---

## 10. 测试计划

| 类型 | 内容 |
|------|------|
| 单元 | `appendGeneratedStep` 父子关系、`stepIndex` 单调、`inheritSemantic` 深拷贝新 id |
| 单元 | 惰性迁移：仅有 `resultOrder` 的旧 asset 生成链 |
| 集成 | 单能力拖图执行一次 → `vgp.versionOrder.length` 符合预期 |
| 集成 | 同一能力执行两次 → 两条 `ImageVersion`，`results[key]` 为最后一次 |
| 回归 | 无 `vgp` 时工作流与现网行为一致 |
| UI / E2E | 第 8.6 节四条非开发者清单（可手工或自动化点击） |

---

## 11. 任务拆解（建议工单粒度）

1. **VGP-01**：定义类型与 `vgpStore` 纯函数 + 单元测试。
2. **VGP-02**：`WorkflowAsset` 可选 `vgp` + 创建资产时写入 original 版本 + 占位语义。
3. **VGP-03**：改造 `executeCapability`（及 set）输出/回调 PromptArtifact。
4. **VGP-04**：`WorkflowSection` 成功分支写入 `vgp`。
5. **VGP-05**：惰性迁移 + 旧数据测试。
6. **VGP-06**（**必填**）：「生成记录」面板（第 8.1–8.4 节）+ 复制完整 prompt；缩略图时间线可与 VGP-06 同迭代或跟 VGP-06b。
7. **VGP-06b**（可选）：导出 `.txt`（第 8.5 节）。
8. **VGP-06c**（可选）：Dev 调试面板（第 9 节），与第 8 节对照用。
9. **VGP-07**：文档更新：`DOCS.md` 中增加「生成记录」用户说明 + 本 spec 修订号。

---

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| localStorage 体积膨胀 | `imageRef` 优先引用 `results` key；大资产走方案 B 外置 store |
| 与云端 hydrate 竞态 | 先本地写 vgp，R2 回写后合并 `resultsObjectKeys` 不改变版本 id |
| 复合能力中间图无对应 `results` key | 使用合成 `stepKey` 或仅内存版本链 + 最终一步写回 `results`（需在实现单中明确） |

---

## 13. 阶段 B/C 衔接说明

- **阶段 B** 将 `compiler_version` 从 `legacy-understand-*` 扩展到 `rule-compiler-*`，`applied_rules` 扩展为真实规则 id；**不改变** `ImageVersion` / `SemanticState` 主结构。详见 [`PHASE_B_PLANNER_AND_PROMPT_COMPILER.md`](./PHASE_B_PLANNER_AND_PROMPT_COMPILER.md)。
- **阶段 C** 写入 `Evaluation` 并引用 `subjectVersionId`；重试产生新 `ImageVersion` 分支（`parentVersionId` 指向被评版本）。

---

*文档版本：1.1 — 增加阶段 A 必填「生成记录」非开发者验收 UI（§8）及任务 VGP-06。*
