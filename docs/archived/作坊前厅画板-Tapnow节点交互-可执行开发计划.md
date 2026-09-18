# 作坊前厅画板 — 抄 basketikun/infinite-canvas（整文件）

**日期**：2026-09-18  
**状态**：已执行（当前进度：全部 done）  
**语言**：简体中文  

**抄谁**：https://github.com/basketikun/infinite-canvas  
**钉死**：commit `e856c878e0a34651bb828e28f0af20d71016a7d4`（tag `v0.19.0`，MIT）  
**演示站**：https://canvas.best  

口径：ADR v1.1。**货仍是磁盘文件**；他们的 IndexedDB / 导出 JSON **不是 L0**。连线是引用，不是 Comfy 执行。  
**手感必须接近成品**：默认 **整文件拷贝** 他们的画布 UI。禁止再抽一套「纯函数 + 140px 按钮」仿品。只在 adapter / shim 换数据源。

---

## Opening spell

```text
只读并执行 docs/archived/作坊前厅画板-Tapnow节点交互-可执行开发计划.md。
从「当前进度」的下一任务开始。禁止重开 ADR v1.1。
画布钉死 basketikun/infinite-canvas@e856c878。默认整文件拷贝 vendor 清单里的源码。
禁止把 InfiniteCanvas / CanvasNode / CanvasToolbar / connections / minimap / zoom / create-menus / hover+selection toolbar 改写成自研简版。
禁止装新画布 SDK 当引擎（xyflow/excalidraw/tldraw 不当 Board 主路径）。
禁止他们的 localforage/IndexedDB 当 L0。禁止接他们的 OpenAI/Agent 真调用。
每条任务以 Automatic verification 为准：命令绿 → Status=done → 立刻做下一条 pending。
同一会话连续推进，直到下一任务空、blocked、或 LIVE_GATE。
不要因为「最好让人看一眼」而停。
```

---

## 抄写政策（本计划最高优先级）

| 情况 | 动作 |
|------|------|
| 文件在下方 **Must-copy** 清单 | **原样拷进** `vendor/basketikun-infinite-canvas/`，文件头保留 MIT 来源（URL + SHA）。只改 import 前缀 `@/` → `@ic/`（脚本做）。 |
| 拷进来的文件 import 了我们不需要的模块 | **写 shim**（空实现 / 拒绝 Promise），不要删调用方 UI。 |
| 生成按钮、重试、插件管理、Agent 面板 | **UI 可在**；点击走 shim（no-op 或 toast「未接线」）。禁止接他们的 `services/api/image` 真网络。 |
| 文件夹框 | **抄他们的 Group 节点外观**；`metadata.folderRel` 绑定我们的夹。Ctrl+G / 工具栏 Group = 视觉组 extraNode，**不新建磁盘文件夹**。 |
| 删除 / 清空画布 | 只动 extraNode 与引用边。带本地标识的 L0 节点 **不删盘**（F3 才删槽）。 |
| 不确定能不能抄 | **先抄**。只有会违反 ADR（第二份货仓、Comfy 执行、改文件夹当拖放副作用）才停。 |

上一版计划「抽出 classifyCanvasPointer、自研节点卡」**作废**。那条路会做出不能用的仿品。

## Must-copy（缺一不可）

从该 commit 的 `web/src/` 拷贝：

| 路径 | 为什么 |
|------|--------|
| `components/canvas/infinite-canvas.tsx` | 视口、滚轮缩放、空格/Ctrl、中键、框选、网格 |
| `components/canvas/canvas-node.tsx` | 成品节点卡、handle、缩放角 |
| `components/canvas/nodes/builtin-nodes.tsx` | 内置种类 |
| `components/canvas/canvas-connections.tsx` | 贝塞尔边 |
| `components/canvas/canvas-toolbar.tsx` | 底栏工具 |
| `components/canvas/canvas-zoom-controls.tsx` | 缩放控件 |
| `components/canvas/canvas-mini-map.tsx` | 小地图 |
| `components/canvas/canvas-create-menus.tsx` | 双击 / 拉线 + 菜单 |
| `components/canvas/canvas-context-menu.tsx` | 右键 |
| `components/canvas/canvas-selection-toolbar.tsx` | 多选工具条 |
| `components/canvas/canvas-node-hover-toolbar.tsx` | 悬停条 |
| `components/canvas/canvas-node-reference-bar.tsx` | 参考条 |
| `components/canvas/canvas-node-prompt-panel.tsx` | 提示词面板（生成走 shim） |
| `pages/canvas/project.tsx` | 3281 行宿主：节点拖拽、连线、菜单、工具条接线。**不要重写这一页当自研 Board。** |
| `lib/canvas-theme.ts` | 亮/暗画布主题 |
| `lib/canvas/*.ts`（整目录） | 几何、工厂、尺寸、引用。`canvas-agent-ops.ts` 可拷，调用方 shim。 |
| `types/canvas.ts` | `ViewportTransform` / `CanvasNodeData` / `CanvasConnection` |
| `stores/canvas/use-canvas-store.ts` | 内存场景。persist 换成我们的 adapter |
| `stores/canvas/use-canvas-ui-store.ts` | UI 状态 |
| `constant/canvas.ts` | 默认尺寸 |
| `i18n/locales/zh-CN.ts` | 工具条文案 |

**连带拷贝（编译需要就整文件带上，不要手写替代组件）**：

- `components/canvas/` 下其余 tsx（settings popover、crop/mask/split/upscale dialog、config composer、asset-picker、side-panel、top-bar、refresh-shell、plugin-manager 等）
- `types/canvas-plugin.ts`
- `stores/use-theme-store.ts`
- `lib/image-utils.ts`、`lib/image-thumbnail.ts`、`lib/image-reference-prompt.ts`（若 import 存在）
- `components/ui/animated-theme-toggler.tsx`（工具栏用到）
- 上游 `LICENSE`

**禁止拷进运行路径（可留空 shim）**：

- `components/agent/**`（不挂 Agent 面板）
- `services/api/image|audio|video` 的真实现（只留 shim）
- 他们的 localforage 工程持久化当 L0
- `layout/` 整站壳、首页、独立生图/视频页

`project.tsx` 里的 `CanvasTopBar` / `CanvasSidePanel` / `CanvasPluginManagerModal` / Agent hooks：**文件留下，Board 宿主可以不挂侧栏/顶栏/插件窗**，以免盖住作坊左树。画布中央 + 底栏 + 缩放 + 小地图 + 节点 + 边 + 菜单 **必须挂**。

## Goal

`viewMode=board` 挂上的是 vendor 里那套 InfiniteCanvas 成品画布：网格、工具栏、节点卡、handle、贝塞尔边、框选、空格平移、滚轮缩放、小地图、创建菜单。节点数据由我们的挂根 listing + extraNode 灌进去。选中节点仍是手指。F3 / 本地标识仍走已有契约。L0 仍是磁盘文件。

## Non-goals

- 不把 Board 做成自研 CSS 探针升级版。
- 不 submodule 整仓（用 vendor 快照，SHA 钉死）。
- 不把他们的项目列表 / IndexedDB 当货仓。
- 不接他们的 OpenAI / chatgpt2api 生图真链（UI 可在，调用必须 shim）。
- 不把作坊改成他们的整站（路由、资源库页、Agent、提示词库产品）。
- 拖节点进框 **不改文件夹**（本计划）。视觉组 ≠ 新建夹。
- 不拆 `WorkflowSection.tsx` 整文件。
- 不宣称 C3 闭环。

## Already decided

1. 连线 = 引用；删边不删货。边组件用 vendor `canvas-connections.tsx`，不要重写公式。
2. 框 = 夹：listing 里的文件夹 → 他们的 `CanvasNodeType.Group` 外观 + `metadata.folderRel`。空夹仍有 Group 框。
3. 视口用他们的 `{x,y,k}`。已有 `workshopFrontHallCamera.ts` 可当 flyTo 适配（`zoom`↔`k`），**禁止**再拿旧 BoardView 当主渲染。
4. persist：`clientPersist` 键 `workshopFrontHallGraph:${root}`，形状 `{ v:1, viewport, nodes, edges, extraNodeIds }`。坏 JSON 丢布局不丢 listing。vendor store 的磁盘后端换成这个 adapter，禁止 localforage 写货。
5. `+` / 双击 / 拉线菜单新建 = extraNode，不写盘；F3 才写盘。
6. 工具栏 `antd` 控件属于 vendor 拷贝，允许。本仓库自己新写下拉仍走 `CustomDropdown`，禁止原生 `<select>`。
7. 现成 package.json 里的 `@xyflow/react` **不是**本 Board 引擎；Board 源码不得 `import '@xyflow/react'`。

## Waterlines

| 阶段 | 允许宣称 | 禁止宣称 |
|------|----------|----------|
| P0 | vendor 快照在盘上且 SHA 对 | 画板已换引擎 |
| P1 | shim 能 import；graph persist 绿 | 已挂上成品画布 |
| P2 | Board 渲染 vendor `InfiniteCanvas` + `CanvasNode` | F3/框/相机已全部对齐 |
| P3 | 框=夹、飞相机、F3/标识仍在 | 已接生图 |
| P4 | 预览进卡；生成按钮走 shim | 已是 canvas.best 整站 / C3 闭环 |
| **P4 全部 done** | **Goal 达成** | 已是他们的 AI 工作台 |

## Current constraints

- vendor 只允许来自钉死 SHA。禁止对照 `main` 浮动。
- 安装依赖必须钉版本（见 Pinned）。禁止 `@latest`。
- Vite alias：`@ic` → `vendor/basketikun-infinite-canvas`（不要占用本仓库其它 `@` 若已有冲突则只用 `@ic`）。
- WorkflowSection 只换 Board 挂载与 graph 回调。
- 不改 companion-desktop。
- Windows：vendor 脚本用 Node 拉 GitHub zip / 单文件，不要依赖 WSL。

## Definition of done

| 结果 | 任务 |
|------|------|
| vendor 含 InfiniteCanvas + CanvasNode + project.tsx + LICENSE | P0-001 |
| 钉死 antd/zustand/i18next 等 | P0-002 |
| `@ic` 能解析；缺的上游模块有 shim | P1-001 |
| graph persist 绿 | P1-002 |
| BoardView 挂 vendor 宿主，节点不再是 140px id 按钮 | P2-001 |
| listing→CanvasNodeData（含空夹 Group） | P3-001 |
| 左树飞他们的 viewport | P3-002 |
| F3 / 拖标识仍接线 | P3-003 |
| 生成 API shim；预览 src persistable | P4-001 |

```powershell
npx vitest run tests/workshopFrontHallArchitecture.test.ts tests/workshopFrontHallGraph.test.ts tests/workshopFrontHallBoardView.test.tsx tests/workshopFrontHallVendor.test.ts
node -e "const fs=require('fs'); const p='vendor/basketikun-infinite-canvas/SOURCE.txt'; if(!fs.readFileSync(p,'utf8').includes('e856c878')) process.exit(1)"
```

## Agent loop protocol

Observe → Select → Act → Verify → Record → Continue。HAND_GATE: none。LIVE_GATE: none。同失败 3 次 blocked。

## Pinned versions

- 上游：`basketikun/infinite-canvas` **`e856c878e0a34651bb828e28f0af20d71016a7d4`**
- `antd`: **6.4.2**
- `@ant-design/icons`: **6.1.1**
- `zustand`: **5.0.12**
- `i18next`: **26.3.6**
- `react-i18next`: **17.0.11**
- `nanoid`: **5.1.11**
- `file-saver`: **2.0.5**
- `clsx`: **2.1.1**（若 vendor 需要再装；不需要则不装）
- vitest：仓库 `^4.0.18`

已有 `lucide-react`、`react@19` 够用。禁止为 Board 再装 `@xyflow/react` 新主路径（仓库里已有 xyflow 也不许 import 进 BoardView）。

## Task backlog

### P0-001: vendor 快照

Status: done  
Depends on: none  

Objective:
- 新建 `scripts/vendor-basketikun-infinite-canvas.mjs`：下载该 SHA 的 zip（`https://github.com/basketikun/infinite-canvas/archive/e856c878e0a34651bb828e28f0af20d71016a7d4.zip`），按 Must-copy + 连带清单拷到 `vendor/basketikun-infinite-canvas/`，并把源文件里的 `from "@/` / `from '@/` 改成 `from "@ic/`。
- 写 `vendor/basketikun-infinite-canvas/SOURCE.txt`（URL、SHA、日期）和拷贝的 `LICENSE`。
- 写 `vendor/basketikun-infinite-canvas/NOTICE`：MIT、只作看法、不是 L0。
- **不要手改** `infinite-canvas.tsx` / `canvas-node.tsx` / `canvas-toolbar.tsx` / `canvas-connections.tsx` 的交互逻辑。

Modify:
- `scripts/vendor-basketikun-infinite-canvas.mjs`
- `vendor/basketikun-infinite-canvas/**`
- `tests/workshopFrontHallVendor.test.ts`（新建：关键文件存在且含 `export function InfiniteCanvas`、`export function CanvasNode`、`export function CanvasToolbar`）

Do not modify:
- BoardView 本任务不换引擎

Automatic verification:

```powershell
node scripts/vendor-basketikun-infinite-canvas.mjs
npx vitest run tests/workshopFrontHallVendor.test.ts
```

Agent 判定：`vendor/basketikun-infinite-canvas/components/canvas/infinite-canvas.tsx` 存在；`SOURCE.txt` 含 `e856c878`。

### P0-002: 安装 vendor 运行依赖

Status: done  
Depends on: P0-001  

Objective:
- 仓库根精确安装 Pinned versions（antd / icons / zustand / i18next / react-i18next / nanoid / file-saver）。
- 若 zip 解开后的 import 还需要 `@types/file-saver`，devDependency 钉 `2.0.7`。

Modify:
- `package.json` / lockfile

Automatic verification:

```powershell
node -e "const p=require('./package.json'); const d=p.dependencies; const want={antd:'6.4.2',zustand:'5.0.12',i18next:'26.3.6'}; for (const [k,v] of Object.entries(want)) { if(!String(d[k]||'').includes(v.split('.')[0])) process.exit(1) }"
```

### P1-001: Vite `@ic` + shim 补齐 import

Status: done  
Depends on: P0-002  

Objective:
- `vite.config.ts`（及 vitest 若分开）alias `@ic` → `vendor/basketikun-infinite-canvas`。
- 扫描 vendor 里所有 `@ic/` import，对 **磁盘上不存在** 的模块在 `vendor/basketikun-infinite-canvas/shims/` 建文件，并在 vite alias 里把那些原路径指到 shim。
- 必须有的 shim：
  - `services/api/image|audio|video`：export 的函数 `async () => { throw new Error('front-hall-generation-disabled') }`
  - `stores/use-agent-store`、`pages/canvas/hooks/use-agent-bridge`、`pages/canvas/hooks/use-plugin-host`：空实现
  - `stores/use-config-store`、`stores/use-asset-store`：最小能让 project.tsx 编译的假 store
  - `services/image-storage`、`services/file-storage`：不写他们的 IDB；读预览走我们稍后 P4 注入的 map
  - `react-router-dom` 的 `useNavigate` / `useParams` / `useSearchParams`：若 project 顶层用到，Board 包装用的 fork 文件可删这些 hook；**优先**在 `components/workshop/WorkshopFrontHallCanvasHost.tsx` 复制 `project.tsx` 为入口时去掉路由，而 **vendor 内 project.tsx 保持原样**。Host 文件允许删顶栏/侧栏/Agent 挂载，但必须渲染 InfiniteCanvas + 节点循环 + connections + toolbar + zoom + minimap + create menus + context menu + hover/selection toolbar。
- i18n：用 vendor `zh-CN.ts` 初始化一个局部 `i18next` 实例，包一层 `I18nextProvider`，不要污染整站文案。

说明：若直接 import 3281 行 `project.tsx` 因路由/Agent 打爆，允许 Host **以 project.tsx 为底复制一份**到 `components/workshop/WorkshopFrontHallCanvasHost.tsx` 再删壳。这 **不算自研画布**。仍必须 import vendor 的 `InfiniteCanvas`、`CanvasNode`、`CanvasToolbar` 等，禁止改写它们。

Modify:
- `vite.config.ts`（及 `vitest` 配置若独立）
- `vendor/basketikun-infinite-canvas/shims/**`
- `components/workshop/WorkshopFrontHallCanvasHost.tsx`（新建，可先空壳 re-export，P2 填满）
- `tests/workshopFrontHallVendor.test.ts`（断言 alias 文件能 `fs.existsSync` 关键 shim）

Automatic verification:

```powershell
npx vitest run tests/workshopFrontHallVendor.test.ts
```

### P1-002: 场景 persist（我们的键，不是 IDB 货）

Status: done  
Depends on: P1-001  

Objective:
- `WorkshopFrontHallEdge`、`connectFrontHallNodes`、`disconnectFrontHallEdge`
- `services/workshopFrontHallGraph.ts`：`clientPersist` `workshopFrontHallGraph:${root}`
- `boardStateToCanvasNodes(state, layout, extra)` → `CanvasNodeData[]`（文件→image/video/text/audio 按 kind；文件夹→`type:'group'` + `metadata.folderRel`；空夹仍有 group）
- `canvasNodesToLayout` 写回 pose
- 坏 JSON → 空边，listing 仍由 `buildBoardStateFromTree` 出
- 禁止 `localforage` / 他们的 export JSON 当 L0

Modify:
- `services/workshopFrontHall.ts`
- `services/workshopFrontHallGraph.ts`（新建）
- `tests/workshopFrontHallGraph.test.ts`（新建）

Automatic verification:

```powershell
npx vitest run tests/workshopFrontHallGraph.test.ts tests/workshopFrontHallArchitecture.test.ts
```

### P2-001: Board 换 vendor 宿主

Status: done  
Depends on: P1-002  

Objective:
- `WorkshopFrontHallBoardView` 只作外壳：`data-front-hall-board`，内挂 `WorkshopFrontHallCanvasHost`。
- Host 必须出现（源码字面量 import）：`InfiniteCanvas`、`CanvasNode`、`ConnectionPath`、`CanvasToolbar`、`Minimap` 或 `canvas-mini-map`、`CanvasZoomControls`、`ConnectionCreateMenu` 或 `NodeCreateMenu`。
- 节点根沿用 vendor 的 `data-node-id`。
- **删除**旧 140px id 按钮主路径。
- 旧 `applyPan` 左键空白平移逻辑从 BoardView 移除（改由 InfiniteCanvas 处理）。
- jsdom：渲染夹具后存在 `data-node-id`；**不存在**仅显示 `root::file` 当按钮标题的旧探针（断言 title 不含 `::` 或按钮 count 为 0）。
- F3 / token 回调 props 保留，可先挂到 Host 选中态。

Modify:
- `components/workshop/WorkshopFrontHallBoardView.tsx`
- `components/workshop/WorkshopFrontHallCanvasHost.tsx`
- `tests/workshopFrontHallBoardView.test.tsx`
- 如需：`WorkflowSection.tsx` 只改传入 graph/viewport

Do not modify:
- vendor 内 InfiniteCanvas / CanvasNode 交互

Automatic verification:

```powershell
npx vitest run tests/workshopFrontHallBoardView.test.tsx tests/workshopFrontHallVendor.test.ts
node -e "const fs=require('fs'); const s=fs.readFileSync('components/workshop/WorkshopFrontHallBoardView.tsx','utf8')+fs.readFileSync('components/workshop/WorkshopFrontHallCanvasHost.tsx','utf8'); if(!/InfiniteCanvas/.test(s)||!/CanvasNode/.test(s)||!/CanvasToolbar/.test(s)) process.exit(1); if(/@xyflow\\/react/.test(s)) process.exit(1)"
```

### P3-001: 框 = 夹（Group 外观）

Status: done  
Depends on: P2-001  

Objective:
- 每个 frame 都有 vendor Group 节点；`data-front-hall-frame={folderRel}` 可打在 group 根或 Host 包装上。
- 单测：空 `notes` 夹 → 仍有一条 `type==='group'` 且 `metadata.folderRel==='notes'`。
- 工具栏 Group / 几何 `applyGroupSelection` 可抄用：结果写入 extraNode，**不** `createWorkshopCheckoutFile`、不 mkdir。

Modify:
- `services/workshopFrontHallGraph.ts`
- Host（只接线，不改 vendor 几何库）
- 测试

Automatic verification:

```powershell
npx vitest run tests/workshopFrontHallGraph.test.ts tests/workshopFrontHallBoardView.test.tsx
```

### P3-002: 左树 = 飞他们的相机

Status: done  
Depends on: P3-001  

Objective:
- `cameraFrameRel` 变化 → 把 viewport `{x,y,k}` 设到该 group 框（可用现有 `flyToFrame` 换算到 `{x,y,k}`，或直接算 group rect）。
- 单测纯函数：`frontHallCameraToViewport` / `viewportToFrontHallCamera` 往返；`flyToGroupViewport(groupRect, viewSize)` 有限数字。

Modify:
- `services/workshopFrontHallCamera.ts` 或小文件 `workshopFrontHallViewport.ts`
- Host / BoardView
- `tests/workshopFrontHallCamera.test.ts`

Automatic verification:

```powershell
npx vitest run tests/workshopFrontHallCamera.test.ts tests/workshopFrontHallBoardView.test.tsx
```

### P3-003: F3 / 拖标识

Status: done  
Depends on: P3-002  

Objective:
- 选中 vendor 节点 id → `onSelectNode`（手指）。
- F3 增删仍走已有 props；热键不与 InfiniteCanvas 输入框抢（沿用 hotkeys 可输入判断）。
- 拖 token 到 `data-node-id` 仍触发 `onDragTokenToNode`。
- 架构测试保持绿。

Modify:
- Host / BoardView / Section 接线
- `tests/workshopFrontHallBoardView.test.tsx`
- `tests/workshopFrontHallArchitecture.test.ts`（不应被破坏）

Automatic verification:

```powershell
npx vitest run tests/workshopFrontHallBoardView.test.tsx tests/workshopFrontHallArchitecture.test.ts tests/workshopFrontHallHotkeys.test.ts
```

### P4-001: 预览进卡；生成走 shim

Status: done  
Depends on: P3-003  

Objective:
- `frontHallPreviewMap`：只 persistable url；灌进 `CanvasNodeData.metadata.images[].content` 或 vendor 预览订阅 shim。
- 禁止写死 localhost。
- 点生成 / 重试：shim reject 或 no-op，**源码不得出现**他们的 API 基址硬编码调用（Host/shim 里 `front-hall-generation-disabled` 字符串必须存在）。
- `npx vitest run` 本计划相关测试全绿。

Modify:
- shims / graph / Host / Section / 测试

Automatic verification:

```powershell
npx vitest run tests/workshopFrontHallGraph.test.ts tests/workshopFrontHallBoardView.test.tsx tests/workshopFrontHallArchitecture.test.ts tests/workshopFrontHallVendor.test.ts tests/workshopFrontHallCamera.test.ts
node -e "const fs=require('fs'); const path=require('path'); function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)])}; const files=walk('vendor/basketikun-infinite-canvas/shims'); const t=files.map(f=>fs.readFileSync(f,'utf8')).join('\n'); if(!/front-hall-generation-disabled/.test(t)) process.exit(1)"
```

全绿 = Goal。禁止写「已是 canvas.best」。

## Verification matrix

| 项 | 方式 |
|----|------|
| vendor SHA / 关键组件文件 | vitest + SOURCE.txt |
| 无 Board 走 xyflow | 源码断言 |
| persist / 空夹 Group | vitest |
| Board 挂 InfiniteCanvas/CanvasNode/Toolbar | 源码 + jsdom `data-node-id` |
| 生成未接真 API | shim 字符串 |
| 真机手感 | 非验收 |
| Agent / 他们的工程页 | 不挂载 |

## 当前进度

- Next: **无（计划完成）**
- 已完成：P0-001 … P4-001
- 阻塞：无

## Progress + evidence log

- P0-001 done：`node scripts/vendor-basketikun-infinite-canvas.mjs` 拷快照；`tests/workshopFrontHallVendor.test.ts` 绿。CanvasNode 实际是 `export const CanvasNode = React.memo(...)`。
- P0-002 done：antd@6.4.2 zustand@5.0.12 i18next@26.3.6 等已进 package.json。
- P1-001 done：`@ic` alias + shims（含 `front-hall-generation-disabled`）；Host 空壳后由 P2 填满。
- P1-002 done：`tests/workshopFrontHallGraph.test.ts` 绿（连/断/坏 JSON/空夹 Group）。
- P2-001 done：Board 挂 InfiniteCanvas/CanvasNode/CanvasToolbar；jsdom `data-node-id`；无 `@xyflow/react`。
- P3-001/002/003 done：Group 框=夹；viewport 往返 + flyToGroupViewport；F3/token 测试绿。
- P4-001 done：`frontHallPreviewMap` 丢 localhost；生成 shim 字符串在 `vendor/.../shims/generation.ts`。
- 回归：`npx vitest run tests/workshopFrontHallArchitecture.test.ts tests/workshopFrontHallGraph.test.ts tests/workshopFrontHallBoardView.test.tsx tests/workshopFrontHallVendor.test.ts tests/workshopFrontHallCamera.test.ts tests/workshopFrontHallHotkeys.test.ts` → 36 绿。