# 模型能力矩阵（阶段 0 清单）

与 `docs/多模型可运营改造计划.md` §3.3 对齐：每个场景声明「配置槽位」与「建议能力标签」，实施注册表后用于过滤可选模型。

**阶段 0 书面模版**（registryId 策略、全站盘点表、矩阵勾选）：见 **`docs/spec/phase0-model-inventory-template.md`**。填矩阵时请保证下表**无空白行**；不适用请显式写「不适用」及原因。


| 功能 / 场景                        | 配置槽位（示例）                                                                                         | 建议必填能力                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 对话理解 / 标题                      | `modelText`                                                                                      | `text`；带图时 +`vision`                                                             |
| 对话生图                           | `modelImage`、挡位（`DIALOG_IMAGE_GEARS`）                                                            | `image_out`；多参考图时校验 `max_refs`（见 `maxReferenceImagesForImageGear`）               |
| 工作流生图 / 能力预设 `gen_image`       | 同对话：理解用 `modelText`，生图用挡位对应模型                                                                    | `text` + `image_out`；参考图上限同上                                                     |
| 工作流生视频 / 能力预设 `generate_video` | 理解等走 `modelText`；**成片**走 `VITE_WORKFLOW_VIDEO_API_URL` HTTP 桥（`workflowGenerateVideo`），不经生图注册表挡位 | 桥可用即视为该场景可用；未配置 URL 则任务失败                                                        |
| 工作流贴图 / 标签等辅助调用                | `modelText` / `modelImage`（依节点）                                                                  | 与同场景对话一致                                                                         |
| 高质量生图（产品口径）                    | `modelPro` + 挡位中 Pro 档                                                                           | `image_out`；运营可通过 `imageRegistryAllowlist` 控档（见 **`docs/model-ops-runbook.md`**） |
| 纹理 / PBR                       | `config.modelImage`                                                                              | `image_out` + `vision`（依实现）                                                      |
| 擂台提示词                          | `modelText`                                                                                      | `text` + `json_mode`（若强依赖 JSON）                                                  |
| 站点助手                           | `modelText`                                                                                      | `text`；多模态时 +`vision`                                                            |
| 物体检测 / 理解类单图分析                 | `modelText`                                                                                      | `text` + `vision`                                                                |
| 生成 3D（腾讯混元等）                   | 独立 `tencentService` / 队列，不走生图注册表挡位                                                               | 不适用本矩阵；可单独做「运营开关」文档                                                              |


**对话生图注册表（当前单一数据源）**：`services/modelRegistry/imageModels.ts`（`DIALOG_IMAGE_REGISTRY`）。**运营 JSON**：`VITE_MODEL_OPS_CONFIG_URL`，操作说明见 **`docs/model-ops-runbook.md`**。