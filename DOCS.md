# AssetCutter AI Pro — 功能与开发文档

本文档描述当前网站的功能、架构与扩展方式，便于你了解与修改开发。

---

## 一、项目概述

**AssetCutter AI Pro** 是一个基于 **Google Gemini** 与 **腾讯混元生3D** 的智能资产生产 Web 应用，主要用途：

- **提取花纹**：图案提取、无缝平铺、PBR 贴图（法线/粗糙度等）
- **对话生图**：上传图片 + 描述需求 → AI 理解 → 生图模型按指令出图
- **生成3D资产**：腾讯混元生3D（文生/图生/智能拓扑/纹理/UV/组件/人物/格式转换）
- **资产仓库**：统一管理并下载所有生成的资产

原「生产管线」模块已移除，提示词与流程说明见 **ARCHIVE_PIPELINE.md**。

技术栈：**React 19** + **Vite 6** + **TypeScript** + **@google/genai**，样式为 Tailwind + 内联 CSS。

---

## 二、功能模块总览

| 模块       | 入口/模式   | 主要功能 |
|------------|-------------|----------|
| 提取花纹   | `AppMode.TEXTURE`  | 图案提取、无缝循环贴图 |
| **对话生图** | `AppMode.DIALOG` | 上传图片 + 描述需求 → AI 理解 → 生图模型按指令出图（可选模型/尺寸） |
| **生成3D资产** | `AppMode.GENERATE_3D` | 腾讯混元生3D：文生3D / 图生3D 等 8 个模块，结果保存到资产库 |
| 资产仓库   | `AppMode.LIBRARY`  | 按类型筛选、查看/下载、多选批量下载、删除 |

---

## 三、对话生图（Dialog）详解

侧栏点击「对话生图」进入。对话式基础模块：在对话框上传图片并描述修改需求，AI 先理解需求再交给生图模型出图。

### 3.1 流程

1. **上传/粘贴图片**：点击「上传图片」选择一张图，或在输入区 **Ctrl+V 粘贴**剪贴板中的图片（必填）。
2. **输入需求**：在输入框用自然语言描述如何修改，如「把背景改成星空」「去掉路人，只保留建筑」。
3. **选择生图模型**：下拉选择使用的 Gemini 生图模型（如 Gemini 2.5 Flash Image、Gemini 3 Pro Image 等）。
4. **输出尺寸**：
   - **比例自适应**：不传 `aspectRatio`/`imageSize`，由模型默认出图。
   - **手动选择**：选择**画面比例**（1:1、16:9、9:16、4:3、3:4、3:2、2:3、21:9）和**输出尺寸**（1K、2K、4K）。
5. **发送**：点击「发送」后：
   - 先调用**理解模型**（`config.modelText`）对「用户描述 + 可选图片」做理解，得到一条简洁的英文生图指令。
   - 再调用**生图模型**（所选 `dialogModel`），传入原图 + 理解后的指令 + 可选 `aspectRatio`/`imageSize`，得到结果图。
6. **对话区**：每条用户消息显示上传的图 + 文案；助手消息显示「理解指令」+ 生成图。右下角任务中心会显示「对话生图」任务进度。
7. **对生成结果的操作**（每条助手消息下方）：
   - **下载图片**：将当前生成图下载为 PNG 文件。
   - **复制图片**：将当前生成图复制到剪贴板，可粘贴到其他应用。
   - **以此图继续**：把该生成图设为当前输入图，可在输入框继续描述并发送，生成新图（多轮优化）。
   - **识别图中物体**：调用单图物体检测，在图上显示边界框与 **①②③** 数字标签；可多次收起/展开查看（结果会缓存），可「重新识别」再次调用检测。点击 **① ② ③** 下载对应物体（裁剪时带约 8% 边距溢出），或「下载全部」。下载文件名为 **会话标题 + 编号 + 本条消息时间**（如 `大门_①_2025-02-04_12-30-45.png`）。
   - **保存到库**：将当前生成的图片保存到资产仓库（类别 PREVIEW_STRIP），可在「资产仓库」中查看与下载。
   - **直接重新生成**：使用同一条用户消息的图片与文案，再次执行「理解 → 生图」，用新结果替换当前助手回复。
   - **编辑后重新生成**：点击后在该条消息内展开输入框（预填原用户文案），修改描述后点击「确认重新生成」，以修改后的文案重新理解并生图，替换当前回复。可点击「取消」收起编辑。
8. **模式切换**：输入区顶部可切换 **生图模式** / **纯文字对话**。纯文字对话下无需上传图片，直接输入文字与 AI 对话，助手仅返回文字；生图模式下需上传图片并描述修改需求。
9. **版本历史与回滚**：每次「直接重新生成」或「编辑后重新生成」会在该条助手消息下追加一个新版本，不覆盖旧结果。当存在多版时显示 **历史版本**：**上一版** / **下一版** 与「x / 总数」，可切换查看任意一版；下载、以此图继续、识别物体、保存到库等操作均针对当前选中的版本。
10. **生成结果元数据**：每条生成图下方会显示该版本的 **分辨率**（宽 × 高）、**宽高比**（约分后，如 16:9）、以及 **生成时间**（该版本的时间戳）。
11. **界面收起**：侧边栏可点击 **‹ / ›** 收起/展开，收起后仅显示图标。对话区生图模式下 **上传图片**（含粘贴提示）始终在输入框内显示、不随「详细设置」收起；**「详细设置 ▼/▲」** 仅控制生图模型与输出尺寸的展开/收起。
12. **多会话与并行生成**：左侧为**竖向会话列表**（`DialogSession`），每行一个会话；可点击 **+** 新建会话、点击会话切换、点击 **×** 删除会话。每个会话行可显示该会话最后一张生成图的**缩略图**，便于区分。**发送状态按会话独立**：A 会话正在生图时，可切换到 B 会话并立即发送新任务，多个会话可同时进行生成，互不阻塞。
13. **会话栏防溢出与自动标题**：会话列表支持**竖向滚动**（`overflow-y-auto`），对话再多也不会挤破布局。会话标题**根据首条用户描述与图片自动生成**（2～4 个中文字），**优先以画面中的物体/主体命名**（如「大门」「人物」「建筑」），由 `generateSessionTitle(userText, model?, customPrompt?, imageBase64?)` 调用文本模型；未生成前显示「新对话」，有消息无标题时显示「对话 N」。
14. **临时库（右侧）**：对话界面右侧为**临时库**面板。以下内容会**自动加入**临时库（并保存图片及隐藏信息：用户描述、理解指令等）：**用户上传/粘贴的图片**（发送时）、**对话生图**结果、**识别图中物体**的裁剪（通过「+①」或「全部加临时库」）。可筛选**全部** / **当前对话**。删除某会话时，该会话在临时库内的图片会**同步删除**。临时库内**不可直接删除**单项。交互：**查看大图**（悬停缩略图点「查看大图」或点击缩略图，大图界面展示类型、用户描述、理解指令、时间等）；**定位消息**、**加入输入框**（图片+提示词）、**下载**。支持**多选**：每项可勾选，工具栏提供**全选**、**反选**、**批量下载**（按当前筛选列表）。

### 3.2 相关类型与配置

- **DialogSession**：`id`、`messages`、**title**（可选，根据首条用户描述自动生成的 2～4 字标题，如「大门」）、`createdAt`、`updatedAt`。
- **DialogTempItem**：临时库单项，`id`、`data`（base64）、`sourceSessionId`、`sourceMessageId?`、`sourceType`（`'generated'` | `'object_crop'` | `'user_input'`）、`label?`、`userPrompt?`、`understoodPrompt?`、`timestamp`。随会话删除而清理；不支持在临时库内直接删除。用户上传图发送时也会以 `user_input` 类型入库。
- **DialogMessage**：`id`、`role`（user/assistant）、`text`、`imageBase64`（用户上传）、`timestamp`；助手消息可有 **versions**（`DialogMessageVersion[]`）表示多版生成结果，每版含 `resultImageBase64`、`understoodPrompt`、`timestamp`、`width`、`height`。兼容旧数据仍使用顶层 `resultImageBase64` / `understoodPrompt`。
- **DialogImageSizeMode**：`'adaptive'` | `'manual'`。
- **SUPPORTED_ASPECT_RATIOS** / **SUPPORTED_IMAGE_SIZES**：见 `types.ts`。
- **DIALOG_IMAGE_MODELS**：可选生图模型列表（id + label）。
- **config.prompts.dialog_understand**：理解阶段的系统提示词（默认在 `DEFAULT_PROMPTS.dialog_understand`）。

### 3.3 服务层

- **understandImageEditIntent(imageBase64?, userPrompt, modelText, customPrompt?)**：返回 `{ instruction: string, summary?: string }`；理解阶段要求模型输出 JSON（含 `instruction` 必填、`summary` 可选），解析后把 `instruction` 传给生图模型。
- **dialogGenerateImage(imageBase64, instruction, model, options?, customSystemPrompt?)**：`options` 为 `{ aspectRatio?, imageSize? }`，可选；生图并返回 base64。
- **detectObjectsInImage(base64Image, model?, customPrompt?)**：单图物体检测，返回 BoundingBox[]（归一化 0–1000）。
- **getDialogTextResponse(contents, model?)**：纯文字对话；`contents` 为 `{ role: 'user'|'model', parts: [...] }[]`，返回助手文本。
- **generateSessionTitle(userText, model?, customPrompt?, imageBase64?)**：根据用户首条描述及可选图片生成 2～4 个中文字的会话标题，**优先以物体/主体命名**；有图时传 `imageBase64` 可结合画面内容命名。`config.prompts.dialog_title` 为默认提示词。

---

## 四、提取花纹（Texture）详解

侧栏在「贴图」组内点击「提取花纹」进入。贴图步骤有：**图案提取（T_PATTERN）**、**无缝循环贴图（T_TILE）**；PBR（T_PBR）在类型和配置中存在，当前 UI 未单独展示，可在 `TextureEngineSection` 中按需扩展。

### 5.1 源贴图输入

- 上传一张图，或从资产库选择，写入 `textureSource`。
- 可「移除」清空。

### 5.2 图案提取（T_PATTERN）

- 若已设置 `textureSource`，展示 **RegionSelector**：在图上拖拽框选区域。
- **确认提取**：将框选区域裁剪为 base64，调用 `processTexture(cropped, 'pattern', ...)`，得到线稿风、展平后的图案（黑底白/灰线）。
- 结果显示在右侧；成功后会加入资产库（类别 `TEXTURE_MAP`）。

**RegionSelector**：支持鼠标与触摸，拖拽画出矩形，点击「确认提取」做 Canvas 裁剪并回调 `onConfirm(croppedBase64)`。

### 5.3 无缝循环贴图（T_TILE）

- 使用当前 `textureSource`（或已生成的 `textureResult`）作为纹理。
- **预览密度**：`tilingScale` 滑块 1–8，控制平铺预览的密度（CSS `background-size` 百分比）。
- **生成循环贴图**：调用 `processTexture(textureSource, 'tileable')`，得到可无缝平铺的贴图并写入 `textureResult`；同样会加入资产库。

---

## 五、生成3D资产（Generate 3D）详解

侧栏点击「生成3D」进入。基于**腾讯云混元生3D**（ai3d）API，左侧为 8 个功能模块，中间为常驻 3D 预览，右侧为临时库与生成队列；所有任务入队后最多 2 个并发生成，结果统一进入临时库并可保存到资产库。

### 凭证与代理

- 浏览器直连腾讯 API 会因 CORS 报错，需通过**本地代理**转发。
- 在 `.env.local` 中设置 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`，以及 `VITE_TENCENT_PROXY=http://localhost:3001`。
- **先启动代理**：项目根目录执行 `npm run proxy`（需 Node 20+），再运行 `npm run dev`。
- 密钥在 [腾讯云 API 密钥](https://console.cloud.tencent.com/cam/capi) 创建，混元生3D 需在 [产品页](https://cloud.tencent.com/document/product/1804) 开通。代理实现见 `server/ai3d-proxy.js`。

### 8 个模块与流程

| 模块 | 输入 | 说明 |
|------|------|------|
| **混元生3D（专业版）** | 文生：文本描述；图生：单图或多视图（2–8 张）。可选模型 3.0/3.1、生成类型（Normal/LowPoly/Geometry/Sketch）、面数、PBR。 | `startTencent3DProJob`，轮询 `QueryHunyuanTo3DProJob`。 |
| **混元生3D（极速版）** | 文生或图生，可选输出格式、PBR。 | `startTencent3DRapidJob`。 |
| **智能拓扑** | 高模 3D 文件 URL（OBJ/GLB）。可选多边形类型（三角/四边）、减面档位（high/medium/low）。 | `startReduceFaceJob`，Polygon 1.5 模型，输出低面数规整布线。 |
| **纹理生成** | 几何模型 URL（OBJ/GLB）+ **文字描述** 或 **参考图** 二选一。可选 PBR。 | `startTextureTo3DJob`，单几何 + 参考图/文字 → 纹理贴图。 |
| **组件生成** | 3D 模型 URL（官方仅支持 FBX）。可选模型版本 1.0/1.5。 | `startPartJob`，自动识别结构生成组件。 |
| **UV 展开** | 3D 模型 URL（FBX/OBJ/GLB）。 | `startUVJob`，根据模型纹理输出 UV 贴图。 |
| **3D 人物生成** | 人物头像（Base64 或 URL）。可选模板（如 basketball、pingpong 等）。 | `startProfileTo3DJob`，按模板生成 3D 形象。 |
| **模型格式转换** | 模型文件 URL + 目标格式（STL/USDZ/FBX/MP4/GIF）。 | `convert3DFormat`，同步返回结果 URL。 |

提交后任务进入**生成队列**，最多 2 个并发；完成后结果写入**临时库**，可切换预览、下载、保存到资产库（`MESH_MODEL`，`modelUrls` 存下载链接）。

### 服务层（tencentService.ts）

- **通用**：`ai3d.tencentcloudapi.com`，Version `2025-05-13`，签名服务名 `ai3d`。`getTencentCredsFromEnv()` 从环境变量读凭证；若设 `VITE_TENCENT_PROXY` 则经代理请求。
- **专业版**：`submitHunyuanTo3DProJob` / `queryHunyuanTo3DProJob` / `startTencent3DProJob`（支持单图/多视图/文生）。
- **极速版**：`submitHunyuanTo3DRapidJob` / `queryHunyuanTo3DRapidJob` / `startTencent3DRapidJob`。
- **格式转换**：`convert3DFormat(input: { fileUrl, format }, creds)`，同步返回 `resultUrl`。
- **智能拓扑**：`submitReduceFaceJob(input: { fileUrl, polygonType?, faceLevel? }, creds)` / `describeReduceFaceJob` / `startReduceFaceJob`。
- **纹理生成**：`submitTextureTo3DJob(input: { modelUrl, prompt?, imageBase64?, enablePBR? }, creds)`，prompt 与 imageBase64 二选一 / `describeTextureTo3DJob` / `startTextureTo3DJob`。
- **UV 展开**：`submitHunyuanTo3DUVJob(fileUrl, creds)` / `describeHunyuanTo3DUVJob` / `startUVJob`。
- **组件生成**：`submitHunyuan3DPartJob(input: { fileUrl, model? }, creds)`，File 仅支持 FBX / `queryHunyuan3DPartJob` / `startPartJob`。
- **3D 人物**：`submitProfileTo3DJob(input: { imageBase64?, imageUrl?, template? }, creds)` / `describeProfileTo3DJob` / `startProfileTo3DJob`。

所有异步任务（专业版、极速版、智能拓扑、纹理、UV、组件、3D 人物）均采用相同轮询间隔与超时（约 10 分钟），成功返回 `File3D[]`。

---

## 六、资产仓库（Library）详解

- **筛选**：按 `libFilter` 切换，中文标签为「全部 / 场景物体 / 预览图集 / 生产成品 / 3D模型 / 贴图资产」；当前筛选下显示**共 N 组**。
- **多选与批量操作**（对齐对话生图临时库）：每组卡片支持勾选，工具栏提供**全选**、**反选**、**批量下载**（按选中组下载预览图，3D 组下载首项预览）；未选时批量下载按钮禁用。
- **分组展示**：按 `groupId` 分组，每组用 **LibraryCard** 展示：
  - 左上角勾选框参与多选；3D 模型组显示 **3D** 角标。
  - 主图可点击，打开 **AssetViewer** 大图 + 下载。
  - 同组内多张图（多风格）用小块按钮切换显示；仅单条时不再显示风格切换。
  - **发送到**（按格式限制）：**图片**（有预览图且非占位）可发送到「继续编辑」（→ 对话生图，预填输入图）、「贴图」（→ 提取花纹，预填源贴图）、「生成3D」（→ 生成3D 图生，预填参考图）；**3D 模型**（有 modelUrls）可发送到「生成3D 中使用」（→ 生成3D，预填智能拓扑/纹理/组件/UV/转换的模型 URL，默认切到智能拓扑）。
  - 操作：**删除**（二次确认后从库中移除此组并同步 localStorage）。
- **持久化**：`library` 会同步到 `localStorage` 的 `ac_library`（最多保留 500 条）；删除组后立即写回 localStorage。

**AssetViewer**：全屏弹层，显示大图、类别/风格/时间；下载预览图；若为 3D 模型（`modelUrls` 存在）则显示 **3D** 角标，且当预览图为占位图（SVG）时展示「3D 模型 · 请从下方下载模型文件」提示，模型下载按钮使用独立样式（如靛蓝）突出。

**LibraryPickerModal**：在需要「从资产库选一张图」的流程中弹出（如贴图选源图），可按 `filter` 限制类别，选中后执行 `onSelect(item)` 并关闭。

**空状态**：当当前筛选下无资产时，展示「暂无资产」及说明：可从对话生图或生成3D保存到库。

---

## 七、任务中心（TaskCenter）

- 全局右下角浮层，展示当前 **tasks** 列表（`AppTask[]`）。
- 每个任务显示：类型标签、进度条、状态（PENDING/RUNNING/SUCCESS/FAILED）；可点击 ✕ 从列表移除。
- 所有调用 Gemini 的流程都会通过 `addTask` / `updateTask` 写入任务，便于用户看到「分析中」「合成中」等状态。

---

## 八、目录与文件职责

```
assetcutter-ai-pro/
├── index.html          # 入口 HTML，importmap、Tailwind、全局样式、/index.css
├── index.tsx            # React 挂载点，渲染 <App />
├── App.tsx              # 主应用：模式/步骤状态、贴图/对话/生成3D/仓库 UI、所有业务逻辑
├── types.ts             # 全局类型：AppMode、AppStep、LibraryItem、AppTask、SystemConfig 等
├── index.css            # 入口样式（当前仅占位）
├── vite.config.ts       # Vite 配置：端口 3000、loadEnv 读 .env、define 注入 GEMINI_API_KEY → process.env.API_KEY
├── components/
│   ├── ProcessingFeedback.tsx  # 占位组件（return null）
│   └── StepIndicator.tsx    # 占位组件（return null）
├── services/
│   ├── geminiService.ts     # Gemini 调用：编辑、贴图处理、对话理解与生图、物体检测、会话标题等；DEFAULT_PROMPTS；重试逻辑
│   └── tencentService.ts    # 腾讯混元生3D（ai3d）API：Submit/Query 专业版任务、轮询、TC3 签名；生成3D 模块调用
├── server/
│   └── ai3d-proxy.js     # 混元生3D 本地代理（解决 CORS），npm run proxy 启动
└── .env.local           # 本地环境变量：GEMINI_API_KEY、TENCENT_SECRET_ID、TENCENT_SECRET_KEY、VITE_TENCENT_PROXY（Vite 会读并注入）
```

---

## 九、核心类型（types.ts）

| 类型 | 说明 |
|------|------|
| `AppMode` | `LAB` / `TEXTURE` / `LIBRARY` / `DIALOG` / `GENERATE_3D` / `ADMIN` |
| `AppStep` | 贴图步骤：`T_PATTERN` / `T_TILE` / `T_PBR` |
| `LibraryItem` | 库中一条：id、type、category、label、data(base64)、sourceId、timestamp、style、groupId；3D 模型另有 modelUrls（下载链接列表） |
| `AssetCategory` | `SCENE_OBJECT` / `PREVIEW_STRIP` / `PRODUCTION_ASSET` / `MESH_MODEL` / `TEXTURE_MAP` |
| `BoundingBox` | id、label、ymin/xmin/ymax/xmax（0–1000 归一化） |
| `AppTask` | 任务：type、label、status、progress、message、error、startTime |
| `SystemConfig` | modelText / modelImage / modelPro、customPromptSuffix、prompts 各环节提示词 |

---

## 十、AI 服务（geminiService.ts）

- **鉴权**：`getAI()` 使用 `process.env.API_KEY`（由 Vite 从 `GEMINI_API_KEY` 注入）。
- **重试**：`callWithRetry(apiFn, 3, 2000)` 对 503/429/overloaded/UNAVAILABLE 自动重试，间隔递增。
- **接口一览**：

| 函数 | 用途 | 主要参数 |
|------|------|----------|
| `editImage` | 按自然语言指令编辑图像（对话生图等） | base64Image, editPrompt, model, customSystemPrompt |
| `processTexture` | 贴图处理：pattern / tileable / pbr | base64Image, type, mapType, model, customPrompt |
| `understandImageEditIntent` | 理解用户修改意图，返回生图指令 | imageBase64?, userPrompt, modelText, customPrompt? |
| `dialogGenerateImage` | 对话生图：原图 + 指令 → 生成图 | imageBase64, instruction, model, options?, customSystemPrompt? |
| `detectObjectsInImage` | 单图物体检测，返回 BoundingBox[] | base64Image, model?, customPrompt? |
| `getDialogTextResponse` | 纯文字对话 | contents, model? |
| `generateSessionTitle` | 生成会话标题（2～4 字） | userText, model?, customPrompt?, imageBase64? |

- **提示词**：所有默认提示词在 `DEFAULT_PROMPTS` 中；App 从 `localStorage.ac_config` 读 `SystemConfig`，若存在则用 `config.prompts.*` 覆盖对应环节的 customPrompt。

---

## 十一、如何修改与扩展

### 11.1 增加/修改贴图步骤（如 T_PBR 完整流程）

- 在 `TextureEngineSection` 中增加 Tab 或步骤切换（例如 `step === AppStep.T_PBR`）。
- 提供源图 + 选择 mapType（Normal/Roughness/Height/Metalness），调用 `processTexture(source, 'pbr', mapType)`，将结果写入 `pbrMaps` 或单独状态并展示。

### 11.2 更换或增加模型

- 在 `SystemConfig` 中已有 `modelText`、`modelImage`、`modelPro`；若 UI 有「设置」页，可在此修改并写回 `localStorage.ac_config`。
- `geminiService` 各函数的 `model` 参数从调用处传入（多数来自 `config.modelText` / `config.modelImage` / `config.modelPro`），直接改传入的 model 即可换模型。

### 11.3 自定义提示词

- 方式一：改 `services/geminiService.ts` 里的 `DEFAULT_PROMPTS`。
- 方式二：在 App 中提供配置 UI，读写 `config.prompts` 并保存到 `localStorage.ac_config`，调用各 API 时把 `config.prompts.xxx` 作为 `customPrompt` 传入。

### 11.4 生成3D资产与腾讯混元生3D

- **生成3D资产**模块（`AppMode.GENERATE_3D`）已接入腾讯云混元生3D（ai3d）全部 8 个能力：专业版、极速版、智能拓扑、纹理生成、组件生成、UV 展开、3D 人物生成、模型格式转换。任务经队列（最多 2 个并发）执行，结果进入临时库后可保存到资产库（`MESH_MODEL`，`modelUrls` 存下载链接）。凭证通过 `.env.local` 的 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` 或页面内临时填写。
- 扩展：新增接口时在 `tencentService.ts` 中按现有模式实现 `submitXxx` / `queryXxx` 或 `describeXxx`，以及 `startXxxJob` 轮询封装，再在 `App.tsx` 的生成队列 `useEffect` 中为对应 `pending.type` 分支调用并写入临时库。

### 11.5 新增资产类别或类型

- 在 `types.ts` 的 `AssetCategory` 或 `LibraryItem.type` 中增加新枚举。
- 在资产仓库的 `libFilter` 按钮列表和 `LibraryCard` 展示逻辑中加上新类别；若需要「从库选择」时限定类别，在 `openPicker(filter)` 中传入新类别。

### 11.6 对话生图与生成3D 优化建议

**已做优化：**

- **生成3D 队列**：抽取 `complete3DJobWithFiles` 与 `onProgress3D`，统一异步任务完成后的临时库写入与进度回调，减少重复代码，便于新增任务类型。
- **纹理生成**：前端强制「模型 URL 必填」且「描述与参考图二选一」，与 API 一致；按钮禁用逻辑与文案已同步。
- **对话生图**：校验失败时用内联提示（`dialogValidationError` + 琥珀色条）替代 `alert`，可关闭；上传图片或切换模式时自动清除提示。

**可继续优化方向：**

- **对话生图**：`handleDialogSend` 与 `runDialogRegenerate` 中「理解 → 生图 → 写消息/临时库」可抽成共用函数，减少重复；对传入前端的 base64 做压缩或缩略再发 API 可减时延与成本；关键回调可用 `useCallback` 包裹以减轻子组件重渲染。
- **生成3D**：3D 人物模块可增加「人物模板」下拉（basketball、pingpong 等）并传入 `submitProfileTo3DJob` 的 `template`；智能拓扑可暴露「减面档位」「多边形类型」到表单；队列失败项支持「重试」按钮。
- **通用**：大表单、多状态可考虑拆成自定义 Hook（如 `useGenerate3DQueue`、`useDialogSession`）以简化 App 体积与可读性。

### 11.7 资产仓库（参考生图/生3D 的优化）

**已做优化（对齐对话生图临时库与生成3D 临时库）：**

- **多选与批量操作**：每组卡片支持勾选；工具栏提供**全选**、**反选**、**批量下载**（按选中组下载预览图），与对话临时库的「全选/反选/批量下载」一致。
- **筛选与统计**：筛选按钮使用中文标签（全部、场景物体、预览图集、生产成品、3D模型、贴图资产）；显示**共 N 组**。
- **删除**：删除前二次确认（`window.confirm`），删除后同步写回 `localStorage`。
- **3D 项**：LibraryCard 对 3D 模型组显示 **3D** 角标；AssetViewer 对 3D 模型显示角标，当预览图为占位 SVG 时展示「3D 模型 · 请从下方下载模型文件」并突出模型下载按钮。
- **空状态**：无资产时展示说明，引导从对话生图或生成3D保存到库。
- **单条组**：同组仅一条时不再显示风格切换按钮。

**可继续优化方向：**

- **LibraryPickerModal**：增加按类别筛选的 Tab（与仓库主界面一致），显示「共 N 项」；可选支持多选并「批量加入当前流程」。
- **批量下载 3D**：当前批量下载仅下载预览图；可增加「批量打开模型链接」或按组打包说明（浏览器无法直接打包，可生成含链接的文本）。
- **搜索/排序**：按标签或时间搜索、按时间/类别排序，与对话会话列表的「缩略图 + 标题」类似，便于大量资产时快速定位。

---


---

## 十二、环境与运行

- **环境变量**：项目根目录 `.env.local` 中设置 `GEMINI_API_KEY`，Vite 会在构建/开发时通过 `loadEnv` 读取并 `define` 为 `process.env.API_KEY`。
- **开发**：`npm run dev`，默认 http://localhost:3000。
- **构建**：`npm run build`；预览构建结果：`npm run preview`。

---

以上为当前网站功能的完整说明与修改扩展要点。若你后续增加新页面、新步骤或新服务，只需在对应模块中扩展状态与 UI，并在本文档中补充对应章节即可。
