# 图片生成评分与提示词优化 — 设计文档

> 记录者 D 根据判官 C 的判定及 A/B 讨论整理。  
> 目标：通过「生成记录 + 用户评分」闭环，用数据指导提示词优化。

---

## 1. 目标与范围

### 1.1 目标

- 每次图片生成（对话生图、贴图工坊）写入一条**生成记录**，包含：使用的提示词、输入/输出引用、可选用户评分。
- 基于记录做**只读统计与导出**，用于人工分析高分样本、优化 `DEFAULT_PROMPTS` 与 config。
- 一期不强制用户评分、不实现产品内 A/B、不实现模型评分；**结构与抽象为二期预留扩展**。

### 1.2 范围

| 阶段   | 包含                           | 不包含                         |
|--------|--------------------------------|--------------------------------|
| 一期   | 对话生图、贴图工坊的记录与评分 | 后端、A/B、模型评分、存缩略图  |
| 二期   | 后端存储、A/B、模型评分、存图  | （依「升级触发条件」推进）     |

### 1.3 存储与容量

- **一期**：前端 `localStorage`，key `ac_generation_records`，**仅通过 recordStore 抽象读写**；条数上限 **500**，写入时截断（如 `slice(0, 500)`）。
- **升级**：满足「升级触发条件」时迁至后端 API + DB；recordStore 仅换实现，调用方不变。

---

## 2. 数据结构

### 2.1 生成来源

```ts
type GenerationSource = 'dialog' | 'texture';
```

- `dialog`：对话生图（`dialogGenerateImage`）。
- `texture`：贴图工坊（`processTexture`：pattern / tileable / pbr）。

### 2.2 单条生成记录（GenerationRecord）

每条记录对应**一次生图调用**，须**自洽**：仅凭记录字段即可定位该次生成，不依赖「当前会话是否仍存在」。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一 id（如 nanoid/uuid） |
| `source` | GenerationSource | 是 | 来源 |
| `timestamp` | number | 是 | 生成时间戳 |
| `fullPrompt` | string | 是 | 实际发给模型的完整 prompt |
| `instruction` | string | 否 | 对话生图：理解后的英文指令 |
| `userPrompt` | string | 否 | 对话生图：用户原始输入 |
| `textureType` | 'pattern' \| 'tileable' \| 'pbr' | 否 | 贴图子类型 |
| `textureMapType` | string | 否 | PBR 时如 normal / roughness |
| `inputImageRef` | string | 否 | 输入图引用（建议短引用或 hash，控体积） |
| `outputImageRef` | OutputImageRef | 是 | 见下，**类型可扩展** |
| `libraryItemId` | string | 否 | 若已入资产库，便于反查 |
| `model` | string | 否 | 如 dialogModel、config.modelImage |
| `options` | Record<string, string> | 否 | 如 aspectRatio、imageSize |
| **定位字段（自洽必含）** | | | |
| `sessionId` | string | 对话必填 | 会话 id |
| `messageId` | string | 对话必填 | 消息 id |
| `versionIndex` | number | 对话必填 | 版本索引（0-based） |
| **评分** | | | |
| `userScore` | number | 否 | 用户评分 1–5 |
| `userScoreAt` | number | 否 | 用户评分时间 |
| `modelScore` | number | 否 | 预留，二期模型评分 |
| `modelScoreReason` | string | 否 | 预留，二期模型评分理由 |

**outputImageRef 可扩展设计（一期必遵守类型/文档）：**

- 一期：可约定为 `{ type: 'libraryId', value: string }` 或直接存 `libraryItemId` 字符串（文档注明「将来可扩展」）。
- 二期：可增加 `type: 'url'`、`type: 'thumbnail'` 等；**不在实现上焊死「仅 libraryId」**。

贴图工坊若无 `sessionId`/`messageId`/`versionIndex`，可用空字符串或 0，但**须在文档说明**「贴图记录用 source + timestamp + textureType 等定位」。

### 2.3 会话侧可选关联

- `DialogMessageVersion` 上**可选**增加 `generationRecordId?: string`，用于 UI 更新评分时 O(1) 查 record。
- 记录侧**不依赖** Version 存在；仅 Version 指向 Record。

### 2.4 持久化

- Key：`ac_generation_records`。
- 值：`GenerationRecord[]`，按 `timestamp` 降序，保留最近 500 条；**所有读写仅通过 recordStore**。

---

## 3. 抽象与接口（recordStore）

**判官 C 要求：业务代码不得直接访问 `localStorage.getItem('ac_generation_records')` 或直接写该 key；所有读写必须通过唯一抽象。**

建议接口（命名可调整，语义不变）：

| 方法 | 说明 |
|------|------|
| `loadRecords(): GenerationRecord[]` | 读取当前列表（如 JSON.parse），保证返回数组 |
| `saveRecords(records: GenerationRecord[]): void` | 写入前可排序、slice(0,500)，再 setItem |
| `addRecord(record: Omit<GenerationRecord, 'id'>): GenerationRecord` | 生成 id、写入、返回带 id 的完整记录 |
| `updateScore(id: string, userScore: number): void` | 按 id 更新 userScore、userScoreAt |

实现细节（如排序、去重、500 条截断）**全部封装在 recordStore 实现内**。

---

## 4. 记录写入时机

### 4.1 对话生图

- 在 **`dialogGenerateImage` 成功** 且已得到 `newVersion` 后，**同一步骤内**：
  - 构造一条 GenerationRecord（source: `'dialog'`，fullPrompt 用当前 `config.prompts.edit` 填 instruction，instruction/userPrompt 从上下文取，sessionId/messageId/versionIndex 必填，outputImageRef 按约定）。
  - 调用 `recordStore.addRecord()`，将返回的 `record.id` 写入 `newVersion.generationRecordId`（可选但推荐）。

### 4.2 贴图工坊

- 在 **`processTexture` 成功** 且 **`addToLibrary` 已拿到新项** 后：
  - 构造一条 GenerationRecord（source: `'texture'`，fullPrompt 为本次实际使用的 prompt，textureType/textureMapType、model、outputImageRef 用新 libraryItemId；sessionId/messageId/versionIndex 按约定填空或占位）。
  - 调用 `recordStore.addRecord()`。

### 4.3 fullPrompt 来源（收口要求）

**判官 C 要求：prompt 来源收口，业务代码不直接拼字符串。**

- 对话生图：建议 `getEditPrompt(instruction: string): string`，内部使用 `config.prompts.edit` 或 `DEFAULT_PROMPTS.edit`，replace `{instruction}`。
- 贴图工坊：建议 `getTexturePrompt(type: 'pattern'|'tileable'|'pbr', mapType?: string): string`，内部使用 config 或 `DEFAULT_PROMPTS.texture_*`。
- 写入记录时，`fullPrompt` 一律来自上述收口函数的返回值，保证可追溯、二期可替换为实验/配置服务。

---

## 5. 评分

### 5.1 原则

- **可选**：用户可不评；未评分记录仍保留，用于统计与导出。
- **轻量入口**：在生成结果展示区域（对话的当前版本图、贴图结果图旁）提供 1–5 星或 👍/👎，**不弹模态、不阻塞流程**。

### 5.2 对话生图

- 对**当前展示的 version** 评分；若该 version 有 `generationRecordId`，则用该 id 调用 `recordStore.updateScore(id, score)`；若无，可用 sessionId + messageId + versionIndex 在 loadRecords() 中查找对应 record 再更新（不推荐散落查找逻辑，可封装在 recordStore 或 helper 内）。

### 5.3 贴图工坊

- 本次生成完成后，在结果区域提供「本次结果评分」；将本次 `addRecord` 返回的 `record.id` 存于 state（如 `lastTextureRecordId`），评分时用该 id 更新。

---

## 6. 只读分析页（一期）

- 入口：管理/设置类（如 ADMIN 或独立 Tab）—「提示词效果」或「生成记录」。
- 功能：列表展示 `recordStore.loadRecords()`，支持按 source、时间、是否已评分筛选；按 source（及贴图 textureType）聚合展示平均分、评分数、高分样本的 fullPrompt/instruction 片段；支持导出 JSON/CSV。
- **不改动** prompt 或配置；仅提供数据支撑人工决策与代码侧修改。

### 6.1 结构化复现（主体/场景/风格/修饰）

- **实现方式**：
  - **默认**：前端**启发式**（正则 + 逗号分段），从 `fullPrompt`/`instruction` 拆出四类，用于展示与导出。
  - **可选 LLM**：在「结构化复现模板」视图中，每条记录可点「用 LLM 解析」调用 `parsePromptStructured(prompt)`（见 `geminiService`），由大模型返回四类；结果缓存在前端，复制/导出本条或「导出结构化 JSON」时优先使用已缓存的 LLM 结果。
- **启发式规则（简要）**：场景（studio、… background 等）、风格（concept art、game asset、PBR 等短段）、修饰（4k、HDR、sharp 等）；其余归主体。长段（如整句含 three-view）仍归主体避免误判。
- **LLM 解析**：`parsePromptStructured` 使用 JSON 模式，要求模型输出 `subject`、`scene`、`style`、`modifiers` 四个字段；空部分用空字符串，前端展示时以「—」显示。解析失败时保留启发式结果并展示错误信息。
- **局限**：启发式无语义理解；LLM 依赖接口可用性与延迟，适合单条按需解析，批量导出时仅对已解析过的记录使用 LLM 结果。

---

## 7. 升级触发条件（须书面化）

**判官 C 要求：在 README / ARCHITECTURE / 或代码注释中写明「升级触发条件」**，避免 500 条成为长期默认。

建议表述（可放入本文档或 README）：

- 当出现以下任一情况时，应启动**后端存储与 recordStore 实现迁移**：
  - 记录数接近 500 且需要保留更久；
  - 需要多设备/多用户共享记录；
  - 需要产品内 A/B、模型评分等依赖服务端的能力。
- 迁移时：仅替换 recordStore 的实现（如改为调用后端 API），记录结构与调用方保持不变。

---

## 8. 一期实施清单（判官 C 准入门槛）

| # | 类别 | 必做项 |
|---|------|--------|
| 1 | 存储与抽象 | 所有生成记录读写仅通过 recordStore；业务代码不直接访问 `ac_generation_records`。 |
| 2 | 记录结构 | 每条记录写入时即含 sessionId、messageId、versionIndex（或等价）、source、timestamp、fullPrompt、instruction（若有）等，保证自洽。 |
| 3 | 关联 | Version 上可选 generationRecordId；记录内包含足够定位字段。 |
| 4 | 容量与演进 | 500 条上限；在文档/注释中写明升级触发条件。 |
| 5 | 输出图 | outputImageRef 在类型与文档上支持扩展；一期实现可仅为引用。 |
| 6 | 评分 | 所有生成均写记录；在结果展示处提供轻量、可选评分入口；不强制、不弹模态。 |
| 7 | prompt 来源 | 对话生图与贴图所用 prompt 由收口函数提供（如 getEditPrompt、getTexturePrompt），业务代码不直接拼字符串。 |
| 8 | 预留 | 记录结构预留 modelScore、modelScoreReason；一期不实现模型评分。 |

---

## 9. 记录者 D 的疑问与建议

### 9.1 疑问

1. **贴图记录的定位字段**：贴图无 sessionId/messageId/versionIndex，文档建议「空字符串或 0」。是否统一约定为 `sessionId: ''`、`messageId: ''`、`versionIndex: 0`，并在分析页筛选时排除或单独分类，避免与对话记录混淆？
2. **outputImageRef 一期类型**：一期若用「字符串 = libraryItemId」，是否在类型上定义为 `string | { type: string; value: string }` 并在注释中写明「一期仅使用 string（libraryId），二期扩展 type」？这样类型检查与扩展语义都清晰。
3. **对话多版本**：同一 message 多次「重新生成」会产多条 version、多条 record。是否需要在记录中增加 `versionId` 或类似字段，与 `DialogMessageVersion` 的某一唯一标识一一对应，便于将来「按版本回放」或去重？
4. **导出与隐私**：导出 JSON/CSV 可能包含 userPrompt、fullPrompt 及 libraryItemId（可反查图）。是否需要在导出前增加「脱敏选项」或说明文档，提醒使用方注意数据用途与权限？

### 9.2 建议

1. **recordStore 文件位置**：建议将 recordStore 实现与类型放在同一模块内，如 `services/recordStore.ts` 或 `utils/promptRecords.ts`，并在该文件顶部注释「ac_generation_records 的唯一读写入口」，便于 Code Review 与后续替换实现。
2. **升级触发条件落地**：建议在 README 或本文档「升级触发条件」小节增加一句：「当前实现见 `recordStore` 与 `ac_generation_records`；迁移时仅替换 recordStore 实现。」并在 recordStore 实现文件内注释「满足 docs/PROMPT_SCORING_DESIGN.md 所述条件时迁至 API」。
3. **分析页与现有 ADMIN**：若现有 ADMIN 已有入口，建议「提示词效果」作为其子页或 Tab，避免顶层入口过多；若暂无 ADMIN，可先单页，后续再合并。

以上疑问与建议供 A/B/C 及实现方确认；确认后可将本节结论补入文档正文或作为附录。

---

**文档版本**：初稿（基于判官 C 二次判定）  
**维护**：记录者 D；设计争议以判官 C 判定为准。
