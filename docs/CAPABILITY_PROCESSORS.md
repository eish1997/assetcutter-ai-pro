# 能力处理器（processor）设计指南（支持商店远程更新）

本项目的“商店（能力包）”推荐只下发 **数据/配置（JSON）**，而不是下发可执行代码。  
要实现“复杂网页图像处理能力”，建议在主站内置一套 **处理器注册表（processor registry）**，商店仅远程更新 **预设、参数、默认值、启用/排序**。

一句话：**商店发配方，主站提供炉子。**

---

## 1. 目标与约束

- **目标**
  - 通过能力包（`CustomAppModule[]`）远程安装/更新能力预设，并自动合并到“能力”。
  - 图像处理类能力支持扩展为多个“处理器”（例如抠图、超分、降噪、无缝、换色等）。
  - 同 `id` 覆盖，且可回滚到任意历史版本（本机快照）。

- **约束（强烈建议遵守）**
  - 商店下发的内容必须是 **纯 JSON 数据**。
  - 不从商店下发 JS/TS 代码并执行（供应链风险 + 兼容性风险）。

---

## 2. 推荐的数据模型（最小可用）

在 `CustomAppModule`（能力预设）上扩展以下字段（仅 `image_process` 使用）：

- `processor?: string`
  - 处理器 id（如 `remove_bg`、`upscale`、`tile_seamless`）
- `params?: Record<string, unknown>`
  - 处理器参数（需要在主站做 schema 校验和 normalize）

执行器侧做“注册表”：

- `processorRegistry[processorId] = handler`
- `handler(inputImageBase64, params, ctx) -> outputImageBase64`

这样商店能力包只需要下发：

- `id/label/category=image_process/processor/params/enabled/order`

---

## 3. 处理器设计建议（强烈推荐）

### 3.1 处理器应是“可纯函数化”的

尽量设计为：

- 输入：`imageBase64` + `params`
- 输出：`imageBase64`（或 `{ images: [] }` 支持多图）
- 不依赖全局状态、DOM、React state

便于：

- 单元测试
- 复用（工作流/能力测试/商店）
- 迁移到 WebWorker/WASM

### 3.2 参数必须有 schema + normalize

商店下发的 `params` 不可信。推荐：

- 为每个 `processorId` 定义 `paramsSchema`
- `normalizeParams(processorId, rawParams) -> safeParams`

最少也要做：

- 类型检查、范围 clamp（比如 0～1、整数上限）
- 默认值填充
- 白名单枚举（例如 `mode` 只能是 `fast|quality`）

### 3.3 处理器版本化（兼容远程更新）

建议每个 processor 支持 `processorVersion`：

- `processor: "remove_bg"`
- `processorVersion: 1`

当你升级算法参数或语义时：

- 新版本 handler 兼容旧版本参数（或提供迁移函数）

### 3.4 性能与稳定性：优先 WebWorker / OffscreenCanvas

复杂处理容易卡 UI，建议：

- 把 heavy compute 放进 WebWorker
- 使用 `OffscreenCanvas`（可用则用）
- 大图处理时做缩放、分块、节流

### 3.5 错误可观测

handler 输出应包含：

- `durationMs`
- `errorCode` / `errorMessage`

让工作流日志更可读，便于定位“参数不合法 / OOM / 超时 / 模型失败”等。

---

## 4. “复杂网页图像处理能力”可落地的处理器清单（建议优先级）

### P0（最快做、收益高）

- `crop_center`：按比例裁剪中心区域（常用于统一构图）
- `resize_limit`：限制最大边长，避免后续处理内存爆
- `cut_image`：切割图片（本项目已有，建议也抽成 processor）

### P1（常用）

- `remove_bg`：抠图（可走后端 API 或 wasm）
- `denoise`：降噪
- `sharpen`：锐化
- `upscale`：超分（可走后端/第三方 API）

### P2（资产生产相关）

- `tile_seamless`：无缝贴图（可结合 AI 或传统图像处理）
- `recolor`：换色/材质变体
- `normal_map` / `roughness_map`：从 basecolor 推导 PBR（你已有“生成贴图”方向，可做“图像处理版”或“模型版”）

---

## 5. 与“商店能力包”的关系（你要实现的远程更新）

商店只做这件事：

- 下载 `CustomAppModule[]`
- 按 `id` 合并覆盖写入本地能力预设存储
- 记录该包内容快照（历史版本）

处理器实现（代码）必须在主站内置：

- 商店更新后，只是改变“配置/参数/是否启用/默认排序”
- 不能凭空新增“主站没有实现的 processor”

---

## 6. 回滚（切换历史版本）的推荐行为

回滚建议按“覆盖式”：

- 选择历史版本 vX：用该版本包内容按 `id` 覆盖写回能力预设
- 不删除用户自建的其他能力（除非你显式做“整包替换”策略）

这样风险最低，也最符合用户预期。

