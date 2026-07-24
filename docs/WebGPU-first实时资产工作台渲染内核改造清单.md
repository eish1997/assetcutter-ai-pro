# WebGPU-first 实时资产工作台渲染内核改造清单

## 1. 目标结论

当前改造不是简单把 `THREE.WebGLRenderer` 替换成 WebGPU，而是趁渲染功能还没有重度铺开时，提前建立面向未来资产编辑器的统一渲染底座。

最终方向：

- WebGPU 作为默认主链路。
- WebGL 作为兼容 fallback。
- fallback 对用户无感，但写入内部日志或调试状态。
- 建设 B 级“中内核”：统一 renderer、scene、camera、controls、材质、贴图、截图和生命周期。
- 首个试点迁移 `ImageModel3DViewer`，再逐步迁移高度场、全景、离屏截图。

一句话定义：

> AssetCutter 的渲染架构进入 WebGPU-first 双栈期：WebGPU 是默认方向，WebGL 是兼容兜底，中内核承接未来实时资产工作台。

## 2. 当前状态

当前主项目实际使用的是 Three.js + WebGL 链路：

```text
React UI -> Three.js -> WebGLRenderer -> 浏览器 WebGL -> GPU
```

已确认的 WebGL 使用点包括：

- `components/preview/viewers/ImageModel3DViewer.tsx`
- `components/preview/viewers/ImageHeightfieldViewer.tsx`
- `components/EquirectangularPanoramaCanvas.tsx`
- `components/ModelViewer3D.tsx`
- `components/SeamRepairSection.tsx`
- `services/workflowModelPreviewCapture.ts`

当前没有实际使用 WebGPU：

- 未发现 `navigator.gpu` 调用。
- 未发现 `WebGPURenderer` 使用。
- `package-lock.json` 中出现 `@webgpu/types` 更可能来自 Three.js 类型依赖，不代表运行时启用 WebGPU。

## 3. 最终形态

目标结构：

```text
Asset Workbench
  -> Render Core
      -> WebGPU Primary Renderer
      -> WebGL Compatibility Renderer
      -> Scene Controller
      -> Camera Controller
      -> Controls Controller
      -> Asset Loader
      -> Material Pipeline
      -> Texture Pipeline
      -> Capture Pipeline
      -> Device Capability Layer
```

React 组件未来不直接关心 WebGPU/WebGL，而只表达“要展示什么资产、使用什么模式、需要什么能力”：

```tsx
<AssetViewport
  asset={asset}
  mode="model"
  materialMode="original"
  rendererPreference="webgpu"
/>
```

## 4. 中内核边界

第一版 render core 应覆盖：

- renderer 创建、初始化、销毁。
- WebGPU/WebGL adapter 选择。
- WebGPU 初始化失败后的 WebGL fallback。
- scene 生命周期。
- camera 生命周期。
- OrbitControls 生命周期。
- resize。
- capture 截图。
- device lost / context lost 处理。
- fallback 原因记录。
- 基础灯光、环境、背景。
- 模型加载入口。
- 基础材质和贴图模式入口。

第一版不做：

- brush。
- mask。
- 图层。
- 对象选择和编辑。
- 历史栈。
- 节点材质编辑器。
- 完整编辑器命令系统。

这些能力属于未来编辑器层，不塞进第一版 render core。

## 5. 建议目录

建议新增目录：

```text
services/renderCore/
  capabilityDetector.ts
  types.ts
  rendererAdapter.ts
  webgpuRendererAdapter.ts
  webglRendererAdapter.ts
  renderHost.ts
  sceneController.ts
  cameraController.ts
  controlsController.ts
  assetLoader.ts
  materialPipeline.ts
  texturePipeline.ts
  capturePipeline.ts
  debugState.ts
```

如果后续 React 侧需要统一组件，可再新增：

```text
components/renderCore/
  AssetViewport.tsx
  useRenderHost.ts
```

## 6. 核心接口草案

### 6.1 RendererAdapter

```ts
export type RenderBackend = 'webgpu' | 'webgl';

export type RendererAdapterInitInput = {
  canvas?: HTMLCanvasElement;
  container: HTMLElement;
  alpha?: boolean;
  antialias?: boolean;
  preserveDrawingBuffer?: boolean;
};

export type RendererAdapter = {
  backend: RenderBackend;
  renderer: unknown;
  domElement: HTMLCanvasElement;
  init(input: RendererAdapterInitInput): Promise<void>;
  resize(width: number, height: number, pixelRatio: number): void;
  render(scene: unknown, camera: unknown): void;
  capture(type?: string): string | null;
  dispose(): void;
};
```

### 6.2 RenderHost

```ts
export type RenderHostOptions = {
  preferredBackend: 'webgpu' | 'webgl' | 'auto';
  fallbackBackend: 'webgl' | 'none';
  onDebugEvent?: (event: RenderCoreDebugEvent) => void;
};

export type RenderHost = {
  backend: RenderBackend;
  fallbackUsed: boolean;
  fallbackReason?: string;
  init(): Promise<void>;
  loadAsset(input: AssetViewportInput): Promise<void>;
  resize(): void;
  capture(): string | null;
  dispose(): void;
};
```

接口名和类型可在实现时微调，但边界要保持：组件调用 RenderHost，RenderHost 调用 adapter，adapter 隐藏 WebGPU/WebGL 差异。

## 7. 迁移阶段

### Phase 1：建立 render core 骨架

目标：先抽象，不改变现有视觉行为。

清单：

- 新增 `services/renderCore/types.ts`。
- 新增 `capabilityDetector.ts`，封装 WebGPU 支持检测。
- 新增 `rendererAdapter.ts`，定义统一接口。
- 新增 `webglRendererAdapter.ts`，先用现有 `THREE.WebGLRenderer` 实现。
- 新增 `webgpuRendererAdapter.ts`，提供 WebGPU 初始化路径。
- 新增 `renderHost.ts`，负责选择 WebGPU 或 fallback WebGL。
- 新增 `debugState.ts`，记录当前 backend、fallback 原因、device/context lost 信息。

验收：

- WebGL adapter 能独立初始化、resize、render、capture、dispose。
- WebGPU 不支持时能返回明确 fallback 原因。
- 不影响现有 viewer。

### Phase 2：迁移 `ImageModel3DViewer`

目标：首个核心 viewer 接入 render core。

清单：

- 保留 `ImageModel3DViewer` 对外 props 和现有产品行为。
- 将 renderer 创建逻辑迁入 RenderHost。
- 将 resize、capture、dispose 接入统一接口。
- 将 `webglcontextlost` 逻辑迁入 WebGL adapter 或 RenderHost。
- 加 WebGPU 优先初始化。
- WebGPU 初始化失败时自动回退 WebGL。
- fallback 原因写入内部日志或调试状态。
- 保持现有模型加载、OrbitControls、透明背景、截图能力。

验收：

- 原有 GLB/GLTF/FBX/OBJ 预览不回退功能。
- OrbitControls 行为一致。
- 透明背景表现一致。
- 截图可用。
- 关闭预览时资源释放正常。
- WebGPU 不可用时用户仍可正常预览。
- 调试状态可看到实际使用 `webgpu` 或 `webgl`。

### Phase 3：完善材质和贴图管线

目标：让 WebGPU-first 不只是能打开模型，而是能承接未来贴图材质工作台。

清单：

- 抽出基础环境光、主光、辅助光配置。
- 抽出背景模式：透明、纯色、环境。
- 抽出材质模式：原始材质、灰模、线框、法线、matcap。
- 抽出贴图入口：base color、normal、roughness、metalness、height。
- 明确 WebGPU 不支持或表现不一致的材质能力 fallback 策略。

验收：

- WebGL 与 WebGPU 同一模型视觉差异可接受。
- 材质模式切换不造成资源泄漏。
- 贴图更新不需要重建整个 viewer。

### Phase 4：迁移高度场 viewer

目标：把未来编辑器常用的高度/浮雕预览纳入统一内核。

目标文件：

- `components/preview/viewers/ImageHeightfieldViewer.tsx`

清单：

- 高度场 scene/camera/controls 接入 RenderHost。
- 灰度高度贴图生成逻辑与 TexturePipeline 对齐。
- 保持现有截图和透明背景能力。
- 记录 WebGPU/WebGL backend 状态。

验收：

- 高度场预览视觉一致。
- 交互一致。
- 截图一致。
- fallback 无感。

### Phase 5：迁移全景和环境能力

目标：把全景从独立 WebGL viewer 收束为 render core 可管理能力。

目标文件：

- `components/EquirectangularPanoramaCanvas.tsx`

清单：

- 全景球/环境贴图加载接入 AssetLoader/TexturePipeline。
- 相机和 controls 接入统一控制层。
- 保持当前全景查看、截图、尺寸自适应行为。

验收：

- 全景预览行为一致。
- 环境贴图能力可复用到模型材质预览。

### Phase 6：迁移离屏截图/缩略图生成

目标：让主预览和导出缩略图共用同一套渲染管线，避免“看到一套、导出一套”。

目标文件：

- `services/workflowModelPreviewCapture.ts`

清单：

- 离屏 renderer 通过 RenderHost 创建。
- capture 使用 CapturePipeline。
- 和 `ImageModel3DViewer` 保持材质、灯光、相机默认一致。
- WebGPU 不可用时 fallback WebGL。

验收：

- 缩略图与主预览视觉一致。
- 批量生成后资源释放正常。
- 不引入明显内存上涨。

## 8. Fallback 策略

默认策略：

```text
preferredBackend = webgpu
fallbackBackend = webgl
```

fallback 触发条件：

- 浏览器无 `navigator.gpu`。
- `requestAdapter()` 失败。
- `requestDevice()` 失败。
- Three.js WebGPU renderer 初始化失败。
- WebGPU 渲染过程中发生 device lost，且当前场景允许重建。

fallback 表现：

- 普通用户无感继续预览。
- 内部日志记录 fallback 原因。
- 调试状态显示当前实际 backend。
- 不弹阻断性错误，除非 WebGPU 和 WebGL 都不可用。

## 9. 调试状态建议

建议 RenderHost 暴露：

```ts
export type RenderCoreDebugState = {
  preferredBackend: 'webgpu' | 'webgl' | 'auto';
  activeBackend: 'webgpu' | 'webgl' | null;
  fallbackUsed: boolean;
  fallbackReason?: string;
  deviceLost?: boolean;
  contextLost?: boolean;
  lastInitAt?: number;
  lastError?: string;
};
```

用途：

- 开发排查。
- 后续接入内部调试面板。
- 统计真实 WebGPU 覆盖率。

## 10. 风险清单

### 10.1 Three.js WebGPU 支持差异

风险：Three.js 的 WebGPU renderer 与 WebGL renderer 在材质、阴影、后处理、loader 行为上可能存在差异。

处理：

- 第一版不追求所有高级材质完全一致。
- 先锁定核心模型预览能力。
- 对不一致能力建立 fallback 或降级表。

### 10.2 浏览器兼容

风险：不同浏览器 WebGPU 支持程度不同。

处理：

- WebGPU 默认优先，但必须保留 WebGL fallback。
- 调试状态记录真实 backend。
- 不把 WebGPU 不支持作为普通用户阻断。

### 10.3 截图能力差异

风险：当前依赖 canvas `toDataURL`，WebGPU 路径下截图行为需要验证。

处理：

- CapturePipeline 单独封装。
- WebGPU 截图不可用时尝试 fallback 截图或临时 WebGL capture。
- 截图能力作为 `ImageModel3DViewer` 试点验收项。

### 10.4 资源释放

风险：双栈 renderer、贴图、loader、controls 生命周期复杂，容易泄漏。

处理：

- RenderHost 统一 dispose。
- adapter 必须实现 dispose 合约。
- 迁移试点时重点验证打开/关闭预览多次后的内存和 WebGL/WebGPU 资源释放。

### 10.5 过早做重编辑器

风险：一开始把 brush、mask、历史栈、节点材质都塞进 render core，会拖慢主线。

处理：

- 第一版只做中内核。
- 编辑器能力作为上层模块，后续基于 render core 扩展。

## 11. 不做项

短期明确不做：

- 全量删除 WebGL。
- 所有 viewer 一次性迁移。
- 重写所有 Three.js 场景。
- 自研完整 WebGPU renderer。
- 一开始引入完整编辑器命令系统。
- 为 WebGPU 牺牲现有模型预览稳定性。

## 12. 建议验证命令

每个阶段至少运行：

```powershell
npm run typecheck
npm run build
```

涉及 viewer 行为时，还应做手动验证：

- 打开模型预览。
- 切换材质/显示模式。
- 拖拽旋转/缩放/平移。
- 截图。
- 关闭再打开。
- 在不支持 WebGPU 的环境确认 WebGL fallback。

后续如果增加自动化测试，可补：

- RenderHost fallback 单元测试。
- WebGL adapter 生命周期测试。
- debug state 测试。
- capture pipeline 测试。

## 13. 第一批任务拆分

建议第一批 PR 拆成：

### PR 1：render core 类型和 WebGL adapter

- 新增 `services/renderCore/` 基础类型。
- 实现 WebGL adapter。
- 加基础单元测试。
- 不改现有 viewer。

### PR 2：WebGPU adapter 和 fallback host

- 实现 WebGPU 支持检测。
- 实现 WebGPU adapter 初始化。
- 实现 RenderHost 选择和 fallback。
- 加 debug state。

### PR 3：`ImageModel3DViewer` 接入 RenderHost

- 迁移 renderer 生命周期。
- 保持模型加载和交互行为。
- 接入 capture。
- 接入 fallback debug。

### PR 4：材质/贴图管线收束

- 抽出基础灯光、背景、材质模式。
- 为高度场迁移做准备。

### PR 5：高度场迁移

- 迁移 `ImageHeightfieldViewer`。
- 验证截图、透明背景、fallback。

## 14. 决策记录

本次产品和技术决策：

- WebGPU 默认主链路。
- 未来目标看重资产编辑器实时工作台，而不是单纯模型预览。
- 选择 B 中内核，不做轻封装，也不提前做重编辑器。
- WebGPU 失败时自动回退 WebGL，并记录内部日志/调试状态。
- 首个试点选择 `ImageModel3DViewer`。

