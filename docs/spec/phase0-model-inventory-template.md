# 阶段 0：规范与清单 — 填表模版

与 `**docs/多模型可运营改造计划.md**` 验收标准 **阶段 0**（锚点 `#accept-phase-0`）及 **§3.2 / §3.3** 对齐。  
本文件为**可复制到 PR / issue / 内部 Wiki** 的空白模版；填毕即视为阶段 0 书面材料可归档。

---

## 0.1 冻结 `registryId` 策略（§3.2 A 或 B）


| 项           | 填写                         |
| ----------- | -------------------------- |
| 选定策略        | A（过渡期沿用上游 id） / B（稳定内部 id） |
| 决策日期        | YYYY-MM-DD                 |
| 决策人 / 记录位置  | （PR、会议纪要或 ADR 链接）          |
| 若选 B：迁移计划摘要 | （无则写「不适用」）                 |


---

## 0.2 全站 model 引用盘点

**目标**：新同学能按表检索「哪里还在用上游字符串 / 旧槽位」，避免漏网。

在下方追加行；**不必**穷尽每一行业务代码，但必须覆盖计划文中列出的重点模块。


| #   | 文件或目录                            | 符号 / 区域（简述）                | 角色（text / image / 3D / video / 其它） | 是否已走 `modelRegistry` / `resolve` | 备注  |
| --- | -------------------------------- | -------------------------- | ---------------------------------- | -------------------------------- | --- |
| 1   | `services/geminiService.ts`      | `getAI`、`resolveUpstream*` | text + image + …                   | 是 / 否                            |     |
| 2   | `services/capabilityExecutor.ts` | 默认模型、能力分类                  | 多                                  |                                  |     |
| 3   | `services/unifiedAiGateway.ts`   | 对外导出与委托                    | 多                                  |                                  |     |
| 4   | `App.tsx`                        | `SystemConfig` 默认与合并       | 多                                  |                                  |     |
| 5   | `types.ts`                       | `DIALOG_IMAGE_*` 等         | image                              |                                  |     |
| 6   | `hooks/`                         | （列出实际用到的 hook 文件）          |                                    |                                  |     |
| 7   | `components/`                    | （仅列仍硬编码 model 的组件）         |                                    |                                  |     |
| 8   |                                  |                            |                                    |                                  |     |


**检索辅助**（本地执行后把结论贴到表末）：

- `rg "gemini-[0-9]|gpt-|modelText|modelImage|registryId" services App.tsx types.ts hooks components --glob '*.{ts,tsx}'`

---

## 0.3 能力矩阵（§3.3）

**主表**：在 `**docs/spec/model-capability-matrix.md`** 中维护；每个功能一行，**不留空白**：不适用则写「不适用」及原因。

本阶段完成标准：

- 矩阵表无空行，或与产品确认「不适用」并已标注  
- 与工作流能力预设大类（如 `gen_image`、`generate_video`、`generate_3d`）可对照，无矛盾

---

## 0.4 各 `AiProvider` 与注册表差异


| `AiProvider` | 无绑定的 `registryId`（示例或「无」） | 说明（注释或文档位置） |
| ------------ | ------------------------- | ----------- |
| （如 `gemini`） |                           |             |
| （如 `openai`） |                           |             |
| …            |                           |             |


---

## 与拣货路径索引的衔接

若盘点中发现**新的用户可达 AI 调用链**（例如新增 `WorkflowSection.runTask` 分支），须同步：

- `**services/workflowRunTaskBranch.ts`**（`classifyWorkflowRunTaskBranch` + `**WORKFLOW_SECTION_RUN_TASK_BRANCHES**`）  
- `**services/workflowAiPickIndex.ts**`（节点/边/货物表，按需）  
- 单测：`**tests/workflowRunTaskBranch.test.ts**`、`**tests/workflowAiPickIndex.test.ts**`

详见 `**docs/多模型可运营改造计划.md` §1.4.4**。