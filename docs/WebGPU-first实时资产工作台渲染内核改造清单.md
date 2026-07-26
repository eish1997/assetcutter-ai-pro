# WebGPU-first 渲染改造 — 最终计划（parity 优先）

## 1. 目标（定稿）

> **改完后：看起来、用起来和现在基本一样；底层默认走 WebGPU，失败无感回 WebGL。**  
> 更流畅或其他收益是加分项，不是硬指标。

不是：

- 单纯为换而换、牺牲现有预览稳定性
- 一次做出完整实时资产编辑器（brush / mask / 图层 / 历史栈 / 节点材质）
- 保证 WebGPU 一定更流畅

是：

- 统一渲染创建与生命周期，避免各入口各自 `new WebGLRenderer`
- WebGPU 优先 + WebGL 兜底
- **按入口保留现有视觉与交互契约**（参数、色调、灯光、截图、PBR 编辑）

## 2. 现状

当前链路：

```text
React UI -> Three.js -> WebGLRenderer -> 浏览器 WebGL -> GPU
```

尚未启用业务侧 WebGPU（无 `navigator.gpu` / `WebGPURenderer` 调用）。

### 2.1 主站直接创建 Renderer 的入口

| 入口 | 现状要点（须保留） |
|------|-------------------|
| `ImageModel3DViewer.tsx` | `antialias + alpha + preserveDrawingBuffer`；透明清屏；ACES `1.02`；`pixelRatio≤1.5`；软阴影；OrbitControls（可 pan）；**PBR 槽位/贴图编辑** |
| `ImageHeightfieldViewer.tsx` | 同上透明截图向；ACES `0.92`；`pixelRatio` 受 `imageHeightfieldQuality` 上限；软阴影；OrbitControls（不可 pan） |
| `EquirectangularPanoramaCanvas.tsx` | **`antialias: false`**、`alpha: false`、`preserveDrawingBuffer: true`（截图/裁切依赖）；`pixelRatio≤1.5`；FOV 滚轮；无 ACES |
| `workflowModelPreviewCapture.ts` | 离屏；**`alpha: false`** + `preserveDrawingBuffer`；ACES `1.02`；`pixelRatio=1`；灯光与主预览一致（HDR→PMREM，失败 Room） |
| `ModelViewer3D.tsx` | `alpha: false`；深色背景 `0x0f0f1a`；ACES `1`；`pixelRatio≤2`；PCF 软阴影；仅 GLTF/GLB |
| `SeamRepairSection.tsx`（内嵌 `ObjTextureViewer`） | `alpha: true` 但场景有深色背景；`pixelRatio≤2`；无 ACES；网格辅助；OBJ+贴图预览 |

### 2.2 视觉一致性依赖的共享层（不可绕开）

换 backend 时必须继续走这些逻辑，不能只换 renderer：

| 模块 | 作用 |
|------|------|
| `services/workflowModelThreeShared.ts` | 模型格式推断、相机 framing、层级 dispose 等 |
| `services/workflowModelViewerStage.ts` | 影棚灯光、HDR/PMREM、软阴影配置、地面、材质增强 |
| `services/imageHeightfield*.ts` | 高度场质量、灰度 matcap、柱面 wrap、亮度等 |

### 2.3 范围外（本次明确暂不动）

| 路径 | 说明 |
|------|------|
| `WebSeamRepair/frontend/` | 独立前端里的 WebGL/`getContext('webgl')`；**不纳入本次主站改造**。若日后统一，另立项。 |

## 3. 最终形态

```text
现有 Viewer / Capture
  -> RenderHost（选 backend、生命周期、fallback、debug）
      -> WebGPU adapter（默认）
      -> WebGL adapter（兜底）
  -> 继续调用现有 shared / stage / heightfield 逻辑
```

原则：

- React 组件尽量少碰 backend；创建 renderer 只走 RenderHost。
- **不强制**立刻做成统一 `<AssetViewport>`；可先让各 viewer 内部改用 RenderHost，对外 props 不变。
- 灰模/线框/matcap 等工作台增强：**非本次必达**；有则加分，无则不影响验收。

建议目录（可按实现微调，不必一次建满）：

```text
services/renderCore/
  types.ts
  capabilityDetector.ts
  rendererAdapter.ts
  webgpuRendererAdapter.ts
  webglRendererAdapter.ts
  renderHost.ts
  capturePipeline.ts
  debugState.ts
```

scene/camera/controls/材质若仍适合留在各 viewer，可暂不抽；**硬要求是 renderer 创建、resize、capture、dispose、fallback 统一。**

## 4. 最终交付清单

### 4.1 RenderHost / Adapter

- WebGPU 优先初始化；失败或 device lost 可重建时回退 WebGL。
- 每个入口通过 **options 传入** 现有契约（勿全局一套参数盖死）：
  - `antialias` / `alpha` / `preserveDrawingBuffer`
  - `outputColorSpace` / `toneMapping` / `toneMappingExposure`
  - `pixelRatio`（含上限与离屏固定 1）
  - clear / background 策略
- `capture` 封装：主预览与离屏均可用；WebGPU 截图异常时有兜底（含必要时临时 WebGL capture）。
- 统一 `dispose`；debug 暴露 `preferredBackend` / `activeBackend` / `fallbackReason` / lost 标记。

### 4.2 入口接入（行为不变）

全部主站自建 Renderer 路径改走 RenderHost，并对照 §2.1 做视觉/交互核对：

1. `ImageModel3DViewer` — **含现有 PBR 编辑全流程**（槽位、贴图更新、材质转换）；仅替换 renderer 生命周期。
2. `ImageHeightfieldViewer` — 质量档位、透明底、截图、交互不变。
3. `EquirectangularPanoramaCanvas` — 保持 `antialias: false` 与 `preserveDrawingBuffer`；截图/裁切可用。
4. `workflowModelPreviewCapture` — 与主预览灯光/材质默认一致；缩略图观感不漂移。
5. `ModelViewer3D` — 背景、阴影、曝光、交互不变。
6. `SeamRepairSection` 内嵌预览 — 网格/贴图/交互不变。

### 4.3 Fallback

```text
preferredBackend = webgpu
fallbackBackend = webgl
```

触发：无 `navigator.gpu`、adapter/device 失败、Three.js WebGPU 初始化失败、device lost 且允许重建。

表现：用户无感；内部日志 + debug；仅双栈皆不可用才阻断。

### 4.4 核心接口（边界固定，名称可微调）

```ts
export type RenderBackend = 'webgpu' | 'webgl';

export type RendererAdapterInitInput = {
  canvas?: HTMLCanvasElement;
  container?: HTMLElement;
  antialias?: boolean;
  alpha?: boolean;
  preserveDrawingBuffer?: boolean;
  // 以及各入口现有的色调/像素比等，由 RenderHost options 传入后应用到 renderer
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

export type RenderHost = {
  backend: RenderBackend;
  fallbackUsed: boolean;
  fallbackReason?: string;
  init(): Promise<void>;
  resize(): void;
  capture(): string | null;
  dispose(): void;
  getDebugState(): RenderCoreDebugState;
};
```

调用链：入口组件 → RenderHost → adapter；shared/stage/PBR 逻辑仍由原模块驱动。

实现备注（three r182）：

- `PMREMGenerator` / `createWorkflowModelViewerStageAsync` 仍要求经典 `THREE.WebGLRenderer`。
- 依赖 HDR/PMREM 的入口（如 `ImageModel3DViewer`）经 RenderHost 时设 `requireClassicWebGl: true`：WebGPU 若未产出 WebGLRenderer，则无感回退 WebGL（`classic-webgl-required`），保证 parity。
- 已迁移（主站全部自建 Renderer 入口）：`ImageModel3DViewer`、`ImageHeightfieldViewer`、`EquirectangularPanoramaCanvas`、`workflowModelPreviewCapture`、`ModelViewer3D`、`SeamRepairSection`（`ObjTextureViewer`）。
- `ModelViewer3D` / 修缝预览无 PMREM，未强制 `requireClassicWebGl`，可真实走 WebGPU（失败回 WebGL）。
- 主站业务代码中仅 `services/renderCore/webglRendererAdapter.ts` 允许 `new THREE.WebGLRenderer`。

## 5. 验收标准（parity）

硬指标：

- [ ] WebGPU 可用时默认 WebGPU；不可用时无感 WebGL。
- [ ] 模型预览：加载格式、Orbit 交互、透明底、截图、软阴影/ACES、**PBR 编辑**与现状一致。
- [ ] 高度场：交互、质量档、透明底、截图一致。
- [ ] 全景：查看、滚轮 FOV、截图/裁切一致（含 `antialias: false`）。
- [ ] 离屏缩略图与主预览灯光观感一致；批量后无泄漏。
- [ ] `ModelViewer3D`、修缝内嵌预览行为不退。
- [ ] 多次打开/关闭预览，资源正常释放。
- [ ] debug 可见真实 backend 与 fallback 原因。

加分（不阻塞）：

- 同场景帧时更稳、切换更顺
- 后续再抽 `AssetViewport` / 材质显示模式

验证：

```powershell
npm run typecheck
npm run build
```

手动：各入口开预览 → 旋转缩放 → 截图 → 关开；无 WebGPU 环境确认 fallback；模型入口再验一轮 PBR 贴图编辑。

## 6. 明确不做

- 删除 WebGL
- 自研 WebGPU renderer（用 Three.js WebGPU）
- 本次改 `WebSeamRepair/frontend`
- 把完整编辑器塞进 render core
- 用「统一默认参数」抹平各入口现有差异
- 把「更流畅」写成验收失败条件

## 7. 风险与对策

| 风险 | 对策 |
|------|------|
| WebGPU/WebGL 色调、透明、阴影不一致 | **按入口锁参数**；差异不可接受时该入口或该能力回退 WebGL |
| `toDataURL` / 截图在 WebGPU 异常 | CapturePipeline；失败则兜底截图 |
| 只换 renderer、丢了 stage/HDR | 强制继续走 `workflowModelViewerStage` 等共享层 |
| PBR 编辑回归 | `ImageModel3DViewer` 专项手测；不把 PBR 逻辑重写成新工作台 |
| 双栈泄漏 | RenderHost 统一 dispose；反复开关压测 |
| 期望「一定更流畅」 | 文档与验收均定为观测项 |

## 8. 决策记录

- **Parity 优先**：效果/交互 ≈ 现状；WebGPU 是底层默认路径。
- WebGL 长期保留作兜底。
- 主站全部自建 Renderer 入口收束；`WebSeamRepair/frontend` 暂不动。
- 共享灯光/舞台/高度场逻辑保留并复用。
- 各入口 renderer 参数差异必须保留，禁止一刀切。
- 工作台大能力与「更流畅」均为后续/加分，不进本次硬验收。
