# 模型能力矩阵（阶段 0 清单）

与 `docs/多模型可运营改造计划.md` §3.3 对齐：每个场景声明「配置槽位」与「建议能力标签」，实施注册表后用于过滤可选模型。

**阶段 0 书面模版**（registryId 策略、全站盘点表、矩阵勾选）：见 **`docs/spec/phase0-model-inventory-template.md`**。填矩阵时请保证下表**无空白行**；不适用请显式写「不适用」及原因。

**Binding 架构（2026-05-27）**：用户可见的是 **`registryId`（SKU）**；运行时经 **`pickBinding(registryId, role)`** 选 channel，再 **`resolveUpstream`**。详见 **`docs/adr/模型中心与供应商绑定.md`**。

---

## 场景矩阵

| 功能 / 场景 | 配置槽位（registryId） | `role` | 建议必填能力 | 运行时闸门 |
|-------------|------------------------|--------|--------------|------------|
| 对话理解 / 标题 | `SystemConfig.modelText` → 默认 `gemini-3-flash-preview`（`DEFAULT_MODEL_TEXT`） | `text` | `text`；带图时 +`vision` | `unifiedAiGateway` → `getClientForTask(id, "text")` |
| 对话生图 | `modelImage` / 挡位 → `DIALOG_IMAGE_REGISTRY[].registryId` | `image` | `image_out`；多参考图校验 `maxReferenceImagesForImageGear` | 同上，`role: "image"` |
| 工作流生图 / 能力预设 `gen_image` | 理解：`modelText`；生图：挡位 `registryId` | `text` + `image` | `text` + `image_out` | `capabilityExecutor` → `resolveUpstreamImageModelId` |
| 工作流生视频 / `generate_video` | 理解等走 `modelText`；成片走 `VITE_WORKFLOW_VIDEO_API_URL` | — | 桥可用即场景可用 | **不经**生图注册表挡位 |
| 工作流贴图 / 标签等辅助 | `modelText` / `modelImage`（依节点） | 依调用 | 与同场景对话一致 | `unifiedAiGateway` |
| 高质量生图（产品口径） | `modelPro` + Pro 档 `registryId`（如 `gemini-3-pro-image-preview`） | `image` | `image_out` | 运营 `imageRegistryAllowlist`（**`docs/model-ops-runbook.md`**） |
| 纹理 / PBR | `config.modelImage` | `image` | `image_out` + `vision`（依实现） | 同对话生图 |
| 擂台提示词 | `modelText` | `text` | `text` + `json_mode`（若强依赖 JSON） | `getClientForTask` |
| 站点助手 | `modelText` | `text` | `text`；多模态 +`vision` | `getClientForTask` |
| 物体检测 / 理解类单图分析 | `modelText`（`CapabilityExecuteContext.textModelRegistryId`） | `text` | `text` + `vision` | `getClientForTask` |
| 生成 3D（腾讯混元 / Tripo） | 独立 `tencentService` / `tripoService` | — | **不适用本矩阵** | `generate3d` / 网关 re-export |

---

## 注册表真相源

| 类型 | 模块 | 默认 id 常量 |
|------|------|--------------|
| 生图 SKU | `services/modelRegistry/imageModels.ts`（`DIALOG_IMAGE_REGISTRY`） | `DEFAULT_IMAGE_MODEL_REGISTRY_ID` |
| 文本 SKU | `services/modelRegistry/textModels.ts`（`TEXT_MODEL_REGISTRY`） | `DEFAULT_MODEL_TEXT`（`constants.ts`） |
| Binding | `services/modelRegistry/providerBindings.ts` | family 级默认链 |
| 有效档位（UI） | `merge.ts`：注册表 ∩ ready binding ∩ 运营 allowlist | — |

**运营 JSON**：`VITE_MODEL_OPS_CONFIG_URL`；字段含 `imageRegistryAllowlist`、`imageModelPreference`、**`bindingOverrides`**。操作说明见 **`docs/model-ops-runbook.md`**。

---

## 与 legacy 槽位名的对应

| 旧槽位 / 配置键 | 新口径 |
|-----------------|--------|
| `modelText` | 文本 `registryId`（`textModels.ts`） |
| `modelImage` / 挡位 id | 生图 `registryId`（`imageModels.ts`） |
| `modelPro` | Pro 文本 `gemini-3-pro-preview` 或 Pro 生图 `registryId`（依场景） |
| 全局 `getAiProvider()` | **deprecated**；运行时用 channel + binding |
