# 工作流「当前容器」统一设计（草稿）

## 目标

让组内 / 组外对「移出组、归档、删除、建组、拖入能力区」的语义完全一致：  
**先从当前容器拿走/隐藏，再对资产做操作。**

---

## 1. 容器抽象

- **viewMode**: `'root' | 'group'`
  - 来源：`viewStack.length === 0` → `'root'`，否则 `'group'`。
- **currentContainerId**: `null | string`
  - `'root'`: `null`（根网格无“组 id”）。
  - `'group'`: `viewStack[viewStack.length - 1].assetId`，即当前组资产 id。

**当前容器内的“项”**：

- **root**：每一项 = 一个根资产 id（`!parentAssetId` 且满足 visible 条件）。
- **group**：每一项 = 组内一格，用 `(groupAssetId, itemIndex)` 表示；对应内容为 `string`（base64）或 `{ assetId }`。

---

## 2. 拖拽来源统一表示

所有“可被拖到右侧区域”的选中项，统一用一种结构描述，便于后续分支一致：

```ts
type DragSource =
  | { kind: 'root'; assetIds: string[] }
  | { kind: 'group'; groupAssetId: string; itemIndexes: number[] };
```

- 根网格拖拽：`draggingAssetIds` → `{ kind: 'root', assetIds: draggingAssetIds }`。
- 组内拖拽：`draggingGroupItems` → `{ kind: 'group', groupAssetId, itemIndexes }`。

右侧所有 drop 目标只接收“已解析好的”`DragSource`（或等价参数），内部再根据 `kind` 分支。

---

## 3. 解析为“可操作的资产 id 列表”

无论来源是根还是组，最终要对资产做操作时，都需要一组 **assetId**：

- **kind === 'root'**：直接使用 `assetIds`（可先经 `getEffectiveAssetIdsForAction` 展开组为成员，若需与现有一致）。
- **kind === 'group'**：使用现有 `ensureGroupItemsAsAssets(assets, groupAssetId, itemIndexes)`，得到 `{ nextAssets, assetIds }`；base64 会先升级为子资产。

得到 `assetIds` 后，再根据操作类型执行归档/删除/建组；**且**需要从容器中移除这些项（见下）。

---

## 4. 从当前容器中移除项（核心统一逻辑）

### 4.1 根容器（root）

- “移除”语义：资产本身仍在列表中，但通过 `archived` / 删除 / 建组 后，会从“进行中”视图里消失或变成新组。
- 不需要额外维护“根列表”；`visibleAssets` 由 `assets` + `showArchived` + `hiddenInGrid` + `parentAssetId` 推导即可。

### 4.2 组容器（group）

- **移除**：从该组的 `cutImageGroup` 中删掉对应下标的一项或多项（按 `itemIndexes` 从大到小删，避免下标错位）。
- 若删除后 `cutImageGroup.length === 0`：删除该组资产本身，并清理其 `parentAssetId` 子资产的引用（若有父组则从父组移除该格）。
- **归档 / 删除 / 建组**：对解析出的 `assetIds` 执行完操作后，**同样**从当前组的 `cutImageGroup` 中移除这些项（组内项可能对应 base64 或 ref；ref 时按 `assetId` 反查是哪个 itemIndex，再按索引移除）。  
  - 即：先 `ensureGroupItemsAsAssets` 得到 `nextAssets` 和 `assetIds`，再在 `nextAssets` 上对当前组执行“按 itemIndexes 移除格”，得到 `nextAssets2`；然后 `setAssets(nextAssets2)`，再对 `assetIds` 执行 `markArchived` / `removeAsset` / `createGroupFromAssets`。

**函数签名建议**：

```ts
// 从组中移除指定下标的多格；若组变空则移除组本身并维护父组引用。返回新 assets。
function removeGroupItems(
  prev: WorkflowAsset[],
  groupAssetId: string,
  itemIndexes: number[]
): WorkflowAsset[]
```

（实现时注意：若组内项是 `{ assetId }`，删除资产时可能还需从其它组的 `cutImageGroup` 里移除该 ref，避免悬空引用；若当前仅有一处引用，可只删当前组即可。）

---

## 5. 各右侧区域统一流程（伪代码）

### 5.1 移出组

- 仅当 `source.kind === 'group'` 时有效。
- 对每个 `itemIndex` 调用现有 `moveGroupItemToUpperLevel(groupAssetId, itemIndex)`（或合并为批量一次更新），把该项从当前组提到上一级/根。

### 5.2 归档

- 解析 source → assetIds（root 直接；group 用 `ensureGroupItemsAsAssets`，得到 nextAssets）。
- 若 source.kind === 'group'：在 nextAssets 上执行 `removeGroupItems(nextAssets, groupAssetId, itemIndexes)` → nextAssets2；`setAssets(nextAssets2)`。
- 若 source.kind === 'root'：无需改组结构。
- 对每个 assetId 执行 `markArchived(assetId)`。
- 清空拖拽与选中状态。

### 5.3 删除

- 同归档，但最后对每个 assetId 执行 `removeAsset(assetId)`。
- 若 source.kind === 'group'：同样先 `removeGroupItems` 再 `setAssets`，再 `removeAsset`，避免组内仍留悬空引用。

### 5.4 建组

- 解析 source → assetIds（同上）。
- 若 source.kind === 'group'：先 `removeGroupItems` 并 `setAssets`，再 `createGroupFromAssets(assetIds)`。
- 若 source.kind === 'root'：直接 `createGroupFromAssets(assetIds)`。
- 清空拖拽与选中状态。

### 5.5 拖入能力区（生图等）

- **执行中隐藏**：
  - root：现有逻辑，对选中资产设 `hiddenInGrid: true`。
  - group：当前组内对应格在执行中应“暂时不显示”。实现方式二选一：
    - **方案甲**：组内项入队时，在组资产上记 `executingSlots: number[]`（itemIndex 列表），渲染组内列表时若 `(groupAssetId, idx)` 在某个 pending/executing 任务的 sourceGroupAssetId+sourceItemIndex 中，则该格不渲染（或渲染占位）。
    - **方案乙**：不新增字段，仅依赖现有 pending 的 `sourceGroupAssetId` + `sourceItemIndex`；组内渲染时 `isPendingItem` 已为 true 时 return null，**但要保证**从组内拖入能力区时，pending 任务一定带有 `sourceGroupAssetId` 与 `sourceItemIndex`（当前 base64 路径已有；ref 路径若存在也需带上），这样该格会自然不显示。
- 采用方案乙即可：确保所有“从组内拖到能力区”产生的任务都带 `sourceGroupAssetId` + `sourceItemIndex`，则现有 `isPendingItem` 逻辑会让该格不渲染，与“根资产 hiddenInGrid”效果一致。

---

## 6. 数据流小结

1. **DragStart**（根或组内）  
   → 设置 `draggingAssetIds` 或 `draggingGroupItems`（保持不变）。

2. **Drop 到任意右侧区域**  
   → 统一转为 `DragSource`（root 用 assetIds，group 用 groupAssetId + itemIndexes）。  
   → 根据区域类型：
   - 移出组：仅 group，调用 `moveGroupItemToUpperLevel`（批量或循环）。
   - 归档/删除/组：解析出 assetIds；若 group 先 `removeGroupItems` 并 `setAssets`，再对 assetIds 执行对应操作。
   - 能力区：root 用现有 addToPending + hiddenInGrid；group 用 addImageToPending，且保证带上 sourceGroupAssetId + sourceItemIndex，依赖现有 isPendingItem 隐藏该格。

3. **组内渲染**  
   - `isPendingItem(groupAssetId, itemIndex)`：存在 pending 或 executingQueue 中某任务满足 `sourceGroupAssetId === groupAssetId && sourceItemIndex === itemIndex` 且未完成 → 该格不渲染（或占位）。  
   - 无需新增 `executingSlots` 字段。

---

## 7. 实现检查清单

- [x] 新增或复用 `removeGroupItems(prev, groupAssetId, itemIndexes): WorkflowAsset[]`，并在归档/删除/建组（group 来源）时调用。
- [x] 归档/删除/建组三个 onDrop 中，对 group 来源先执行 `removeGroupItems` 再 `setAssets`，再对 assetIds 执行操作。
- [x] 组内拖到能力区：所有路径（base64 与 ref）生成的 pending 任务都带 `sourceGroupAssetId`、`sourceItemIndex`，确保 `isPendingItem` 为 true 时该格不渲染。
- [x] 移出组：保持现有 `moveGroupItemToUpperLevel`，可考虑多选时批量调用或合并为一次 setAssets。
- [x] 清空选中与拖拽状态在每类 onDrop 末尾统一执行。

已按上述清单在 `WorkflowSection.tsx` 中实现。
