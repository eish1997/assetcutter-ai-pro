## 工作流模块第一性原理审查（组内 / 组外交互）

本审查基于第一性原理，聚焦 `WorkflowSection.tsx` 中「组内（切割组 / 手动分组）」与「组外（网格、待处理区、归档视图）」的交互逻辑，目标是做到：**数据正确、状态透明、行为可预期**。

---

## 一、心智模型与数据建模

- **核心实体**
  - **WorkflowAsset**
    - 根资产：`!parentAssetId`，出现在主网格中。
    - 组资产：
      - `cutImageGroup`：
        - `string`：直接存图（尚未“升级”为独立子资产）。
        - `{ assetId }`：引用其它 `WorkflowAsset`（子资产 / 嵌套组）。
      - `groupKind: 'cut' | 'manual'` 标记来源。
      - `parentAssetId` 指向上层组，支持多级嵌套。
    - 子资产：`parentAssetId` 指向所属组，通常 `hiddenInGrid: true`，不直接出现在主网格。
    - 展示与结果：
      - `displayKey: 'original' | 'cut_image' | <能力模块 id 或版本 key>`。
      - `results: Record<string, string>` + `resultOrder: string[]` + `resultMeta[stepId].executedAt`。
    - 归档与网格可见性：
      - `archived` 控制是否进入「已完成」视图。
      - `hiddenInGrid` 同时承担“执行中暂时隐藏”和“子资产不出现在根网格”两种语义。

  - **WorkflowPendingTask**
    - `assetId`：目标资产。
    - `actionType`：能力模块 id / 能力集合 id（`set:` 前缀）/ 特例 `cut_image`。
    - `inputImage`：执行用底图。
    - `sourceGroupAssetId` + `sourceItemIndex`：从组内拖出生成任务时记录来源，用于组结构更新（如“套娃替换”）。

- **视图状态**
  - `showArchived`：进行中 / 已完成视图开关。
  - `viewStack: { assetId }[]`：当前“进入”的组层级。
  - `selectedAssetIds` / `selectedGroupItemKeys`：组外 / 组内选择。
  - `draggingAssetIds` / `draggingGroupItems` / `dragOverAction` / `dragOverAssetId`：拖拽相关的瞬时状态。

---

## 二、关键交互链路（按场景）

### 场景 A：单图 → 切割组

- 从网格选中资产 → 拖到 `cut_image` 能力区 → `addToPending(assetId, 'cut_image')`。
- `executePending` 中 `actionType === 'cut_image'` 分支：
  - 先尝试调用 `detectObjectsInImage` 识别区域，失败 / 超时则退化为整图框。
  - 使用 `cropBoxes` 裁剪出多张图，失败时再次以整图尝试。
  - 最终生成 `WorkflowCutGroupItem[]`（当前实现为 `string` base64 数组）。
  - 更新目标资产：
    - `cutImageGroup: group`，`groupKind: 'cut'`。
    - `displayKey: 'cut_image'`。
    - `resultOrder` 追加 `'cut_image'`，`resultMeta['cut_image'].executedAt = now`。
    - 若资产有 `parentAssetId`，保持 `hiddenInGrid`；否则确保在网格可见。

> 结论：数据建模上，切割组被视为“同一资产的一个结果维度 + 组结构”，逻辑自洽。

### 场景 B：切割组 / 手动组 → 组外

- 进入组视图：
  - 点击带 `cutImageGroup` 的卡片，若子资产为组则通过 `viewStack` 深入，反之打开大图。
- 组内项两种形态：
  - **直接 base64**：
    - 首次从组内拖到能力区 → 通过 `addImageToPending`：
      - 创建新的 `WorkflowAsset` 作为子资产（`parentAssetId` 可选）。
      - 将 `cutImageGroup[sourceItemIndex]` 从 `string` 替换为 `{ assetId: newAsset.id }`。
  - **引用子资产 `{ assetId }`**：
    - 可继续进入其 `cutImageGroup`（嵌套组）或作为普通资产预览 / 执行。
    - 通过拖拽 + `moveGroupItemToUpperLevel`，可把子资产移到父组 / 网格。

> 结论：组内 / 组外之间的“资产升级 + 结构维护”在数据层逻辑完整，但对用户几乎是隐形的，需要 UI 补足心智提示。

### 场景 C：待处理区往返

- 加入待处理：
  - 根资产拖到能力区 → `addToPending`，立刻 `hiddenInGrid: true`。
  - 组内图片拖到能力区 → `addImageToPending` 创建子资产并入队。
- 执行：
  - `executePending` 并发消费队列：
    - `cut_image` 特例写入组结构。
    - 其它能力调用 `executeCapability` / `executeCapabilitySet` 写入 `results` / `resultOrder` / `resultMeta`，更新 `displayKey`。
  - 执行完成后：
    - 对根资产：`hiddenInGrid` 被恢复为 `false`，回到网格。
    - 对子资产：保留原有 `hiddenInGrid` 状态，不直接出现在网格。

> 结论：数据上允许多次入队、多版本结果，但队列本身对用户是“看不见的黑盒”，需要更好的可视化。

### 场景 D：归档与回顾

- 归档：
  - `markArchived(assetId)`：仅标记该资产，依赖 `showArchived` 过滤网格。
- 归档详情：
  - 通过 `resolveGroupImages` / `flattenGroupImages` 展开 `cutImageGroup` 与嵌套组。
  - 使用 `resultOrder` + `resultMeta` 按时间拼接生成流程图，并生成 `cut` 组拼贴预览。

> 结论：归档视图在“可回顾性”上做得较好，流程图 + 时间戳能够帮助复盘，但对多层嵌套组的上下文仍不够显性。

---

## 三、高优先级问题（建议优先优化）

### 问题 1：组内 base64 项“隐性升级为子资产”，心智不透明

- **现状**
  - 切割生成的 `cutImageGroup` 初始只存 `string`。用户从组内拖到能力区时，会自动：
    - 创建新的 `WorkflowAsset`（子资产）。
    - 将该组项替换为 `{ assetId }`。
  - 整个升级过程没有任何显式提示，用户看不到“某张图已经变成独立资产节点”这一事实。

- **违反的第一性原则**
  - **状态透明性**：关键的结构性变化（从纯图到资产节点）是隐式的。
  - **行为可预期**：同一拖拽手势在“第一次拖出”和“已经是 `{ assetId }` 再拖出”时，副作用不同，但 UI 没有说明。

- **改进方向（本轮可实施）**
  - 在组内卡片提示文本中，明确说明“从组内拖出图片时，会创建可复用资产节点”。
  - 在 `addImageToPending` 中通过 `onLog` 输出一条 info 级日志，提示“已将组内图片升级为可复用资产（可在归档流程中追踪）”。
  - 后续可考虑在 `{ assetId }` 形式的组项上增加“已升级”小图标，进一步弱引导用户建立心智模型。

### 问题 2：`hiddenInGrid` 同时承担“执行中隐藏”和“子资产不在网格展示”的双重语义

- **现状**
  - 入队统一 `hiddenInGrid: true`，执行完成后根据是否根资产来决定是否恢复展示。
  - 对于子资产，`hiddenInGrid` 既表示“结构上只在组内可见”，又可能叠加“执行中暂时隐藏”的语义。

- **违反的第一性原则**
  - **单一事实来源**：一个字段承载两个维度的含义，后期调试和扩展成本高。
  - **行为可预期**：用户难以推断“我刚刚执行完的这张子资产图为什么没回到网格？”。

- **改进方向（规划为下一轮）**
  - 设计一个显式的 `status: 'idle' | 'pending' | 'running'` 字段，用于 UI 显示和行为控制。
  - 将 `hiddenInGrid` 限定为“布局 / 结构可见性”，不再混用为“执行状态”的承载。

### 问题 3：多层嵌套组的层级路径对用户不够显性

- **现状**
  - 通过 `parentAssetId` + `cutImageGroup` 支持嵌套组，`viewStack` 控制“进入子组”。
  - 但 UI 只在顶部显示“组内（N）”，缺少清晰的层级路径（类似 `组 A / 组 B / 当前组`）。

- **违反的第一性原则**
  - **状态透明性**：当前用户所处的组层级不够直观，容易迷失。

- **改进方向（规划为下一轮）**
  - 增加简单的“面包屑路径”显示当前 `viewStack`。
  - 在归档详情中对多层组资产增加简短的“所属路径”说明。

### 问题 4：待处理队列（pending）对用户几乎不可见

- **现状**
  - 资产一旦入队，就从网格隐藏；执行状态主要通过顶部执行进度条与日志输出呈现。
  - 用户很难回答“我当前到底排了多少张图在等执行、分别是什么动作？”。

- **违反的第一性原则**
  - **状态透明性**：队列状态对普通用户不可见，属于“黑盒”。
  - **行为可预期**：用户无法确认“刚刚这次拖拽是否真的入队了”，特别是在执行尚未开始时。

- **改进方向（本轮可实施）**
  - 在工作流头部增加「队列摘要」信息：
    - 正在执行时：展示当前批次进度（如 `执行中：3 / 8`）。
    - 有待处理但未执行时：展示 `待处理：N 项` 的小徽标。
  - 后续可以增加可展开的“待处理任务列表”，但当前轮先从轻量提示做起。

---

## 四、中 / 低优先级问题（后续迭代）

1. **选择 / 框选规则对新用户不够直观**
   - Alt+框选减选等高级操作，目前主要通过小号说明文字表达，建议后续统一设计「操作小贴士」或首次使用引导。

2. **归档模式下的交互关闭依赖多处条件分支**
   - 通过多处 `if (showArchived) return;` / `draggable={!showArchived}` 控制，建议后续抽象 `viewMode` 来集中管理。

3. **错误 / 空结果主要通过日志暴露**
   - 切割 / 执行失败后，更多是 `onLog('warn' | 'error', ...)`，缺少卡片级显式提示，后续可增加小红点 / toast 等。

---

## 五、本轮实施重点（已开始）

- **目标**：用尽量小的代码改动，提升以下两点的一致性与可观察性：
  1. 让“组内 base64 升级为子资产”的行为对用户更加可见（文案 + 日志层面）。
  2. 提升「待处理队列 / 执行中状态」的可见性，让用户明白当前队列大致情况。

- **后续轮次预留**
  - 进一步分离 `hiddenInGrid` 与执行状态。
  - 增强多层组的层级路径显示与归档说明。
  - 补充错误 / 空结果的 UI 级反馈。

