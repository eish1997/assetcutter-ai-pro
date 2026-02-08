# 生产管线模块归档

本文档归档已移除的「生产管线」模块的提示词、类型定义与流程说明，便于日后复用或参考。

---

## 一、Gemini 提示词（DEFAULT_PROMPTS）

### 1. 拓扑分析（analyze）

```
Analyze this scene image for 3D asset extraction. 
1. Count how many distinct objects are in the image.
2. Identify what types of objects they are.
3. Suggest an optimal N x M grid layout to rearrange these objects into a square canvas.
Return the result in JSON format.
```

### 2. 网格图物体检测（detect）

```
Detect all distinct isolated 3D assets in this grid image.
Return their bounding boxes in normalized coordinates [ymin, xmin, ymax, xmax] (0-1000).
Return as a JSON array of objects with 'id', 'label', and 'box_2d' keys.
```

### 3. 网格合成（grid）

```
[STRICT ARCHIVAL PROTOCOL]
Re-render objects into a perfectly spaced grid based on suggested rows and columns.
Background: Absolute solid #101010.
```

### 4. 多视角合成（synthesis）

```
GENERATE MULTI-VIEW SPRITE SHEET. STYLE: {style}. {viewCount} views rotating. Grey bg.
```

占位符：`{style}`（如写实、风格化、体素等）、`{viewCount}`（视角数）。

### 5. 多视角增强（enhance）

```
4K PRODUCTION ASSET ENHANCEMENT. STYLE: {style}. {viewCount} views rotating. Extreme detail.
```

### 6. 风格转换（transform）

```
STYLE TRANSFORMATION. SOURCE ASSET PROVIDED. TARGET STYLE: {style}. Maintain geometry but apply new aesthetic. {viewCount} views.
```

### 7. 智能编辑（edit）

```
[HIGH PRECISION EDITING PROTOCOL]
Modify this image according to the user instruction with surgical accuracy.
Maintain the core object's geometry, scale, and lighting consistency.
Ensure the output is high-definition, sharp, and free of artifacts.
Instruction: {instruction}
```

占位符：`{instruction}` 为用户输入的自然语言指令。

---

## 二、API 函数签名（geminiService）

| 函数 | 用途 | 主要参数 |
|------|------|----------|
| `analyzeScene(base64Image, model?, customPrompt?)` | 场景分析，返回 objectCount、objectTypes、suggestedGrid、description | 返回 JSON：suggestedGrid 含 rows/cols |
| `detectObjectsInAtlas(base64Image, model?, customPrompt?)` | 网格图物体检测，返回 BoundingBox[]（box_2d → ymin/xmin/ymax/xmax 0-1000） | 返回 JSON 数组，每项 id/label/box_2d |
| `synthesizeGrid(base64Image, grid, model?, customPrompt?)` | 按 rows/cols 生成网格图，背景 #101010 | grid: { rows, cols } |
| `synthesizeMultiView(base64Object, viewCount, style, model?, customPrompt?)` | 单物体多视角图，生成 strip | customPrompt 可含 {style} {viewCount} |
| `enhanceMultiView(base64Object, viewCount, style, model?, customPrompt?)` | 多视角 4K 增强 | 同上 |
| `editImage(base64Image, editPrompt, model?, customSystemPrompt?)` | 按自然语言指令编辑图像 | systemInstruction 用 edit 模板替换 {instruction} |

---

## 三、类型定义（types.ts）

### AppStep（管线步骤，已移除）

- `P_ANALYZE`：拓扑分析  
- `P_SYNTHESIS`：视图合成  
- `P_ENHANCE`：增强（UI 中未单独步骤）  
- `P_TRANSFORM`：风格转换  
- `P_EDIT`：智能编辑  

### AssetInfo（管线当前项目状态，已移除）

```ts
export type AssetInfo = {
  id: string;
  name: string;
  timestamp: number;
  p1InputImage: string;
  p1SynthesizedGrid?: string;
  p1DetectedObjects: BoundingBox[];
  p2InputSlices: string[];
  p2OutputStrips: string[];
  p3InputStrips: string[];
  p3OutputHighRes: string[];
  modelUrls: string[];
  viewCount: number;
  style: string;
};
```

### GenerationStyle（风格枚举，管线用）

- 写实、风格化、体素、低多边形、动漫、赛博朋克、素描  

### BoundingBox（仍保留于项目，用于对话生图单图检测）

- id, label, ymin, xmin, ymax, xmax（0-1000 归一化）

---

## 四、流程说明（原 DOCS 三）

### 4.1 拓扑分析（P_ANALYZE）

1. 输入：上传场景图或从资产库选图。  
2. 一键分析：`handleP1Analyze(base64)` 依次调用 `analyzeScene()` → `synthesizeGrid()` → `detectObjectsInAtlas()`。  
3. 结果：更新 `asset.p1InputImage`、`asset.p1SynthesizedGrid`、`asset.p1DetectedObjects`；展示 GridOverlay，可勾选框、提取选中项到 p2InputSlices 并加入资产库（SCENE_OBJECT），切到视图合成。

### 4.2 视图合成（P_SYNTHESIS）

1. 输入：`asset.p2InputSlices`（上步提取或从库/上传追加）。  
2. 开始多视图生成：`handleP2Synthesis()` 对每张切片调用 `synthesizeMultiView(slice, viewCount, style, ...)`，结果写入 `asset.p2OutputStrips` 并加入资产库（PREVIEW_STRIP）。  
3. 可调参数：viewCount、style（GenerationStyle）。

### 4.3 风格转换（P_TRANSFORM）

1. 输入：`transformInput`（LibraryItem），从库选或上传。  
2. 选择目标风格：GenerationStyle 任选。  
3. `handleStyleTransform(transformInput, transformStyle)` 调用 `synthesizeMultiView(..., newStyle, ..., config.prompts.transform)`，结果加入资产库（同 groupId）。

### 4.4 智能编辑（P_EDIT）

1. 输入：`editInput`（LibraryItem），载入后为 `currentEditImage`，初始化 `editHistory`。  
2. 对话式编辑：输入指令后 `handleImageEdit()` 调用 `editImage(currentEditImage, editPrompt, ...)`，结果更新 `currentEditImage` 并追加到对话历史。  
3. 多轮编辑：连续输入指令，每次基于当前图再编辑。

---

## 五、GridOverlay 组件

- 用途：在网格图（p1SynthesizedGrid）上叠加 `p1DetectedObjects` 边界框，可勾选/取消。  
- 操作：**提取选中项**（裁剪 → p2InputSlices，加入库，切到 P_SYNTHESIS）；批量精炼/存入仓库/深度扫描为占位（空函数）。  
- 组件文件已删除：`components/GridOverlay.tsx`。

---

## 六、资产仓库入口（已移除）

- **风格重塑**：将选中资产设为 `transformInput`，跳转生产管线 · 风格转换。  
- **智能编辑**：将选中资产设为 `editInput`，跳转生产管线 · 智能编辑。  

上述两个入口已随管线模块一并移除；资产仓库保留筛选、多选、批量下载、删除等能力。

---

*归档日期：按项目移除生产管线时整理。*
