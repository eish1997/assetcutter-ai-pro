# modelRegistry

多模型注册表与运营合并（见 `docs/多模型可运营改造计划.md`）。**下一阶段（规划）**：模型中心 + 供应商 Binding → `docs/模型中心与供应商绑定改造清单.md`。工作流侧「门面→编排→闸门」键值与 **`WorkflowSection.runTask`** 分支判定见 **`services/workflowRunTaskBranch.ts`**（**`classifyWorkflowRunTaskBranch`**）；总索引见 **`services/workflowAiPickIndex.ts`**（及 **`docs/多模型可运营改造计划.md` §1.4**）。

| 模块 | 说明 |
|------|------|
| `constants.ts` | 默认 `modelText` / `modelImage` / `modelPro` |
| `imageModels.ts` | 对话生图注册表、`DIALOG_IMAGE_GEARS` 数据源 |
| `resolve.ts` | 渠道上游 model id 映射 |
| `systemConfigMigrate.ts` | 读 `ac_config` 时校验生图槽位 |
| `opsTypes.ts` / `opsConfig.ts` | 运营 JSON 类型与拉取（`VITE_MODEL_OPS_CONFIG_URL`） |
| `merge.ts` | 注册表 ∩ 运营允许列表 → 有效档位行 |
| `log.ts` | `[model-registry]` 前缀日志 |

**阶段 4（非 Gemini 适配器）**：未在本目录实现；新增厂商时在独立适配模块接入并保持调用仍走 `resolve` / 注册表 id。
