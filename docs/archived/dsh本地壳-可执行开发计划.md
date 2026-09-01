# dsh 本地壳 · 可执行开发计划

状态：完成（P8 全部 done）  
真源：本文件。画布与聊天不作任务清单。  
读者：后续任意编码 Agent。

```text
开工咒语（新会话第一条就用）：
只读并执行 docs/dsh本地壳-可执行开发计划.md。
从「§12 当前进度」的下一任务开始。禁止重开已拍板争论。禁止改 dsh 上游源码。禁止用旧 Copilot 冒充完成。
每条任务以 Automatic verification 为准：命令绿 → Status=done → 立刻选下一条 pending。
同一会话连续推进，直到：§12 下一任务空（P8 全部 done）、或 Status=blocked、或遇到 §5 仅剩的 LIVE_GATE。
不要因为「最好让人看一眼壳」而停。能写成测试或 HTTP/源码断言的，必须写成自动检查。
```

关联：

- 产品形态宪章：`docs/架构宪章-本地壳大楼租户.md`（大楼 / 租户 / 管家；禁止用任务重开比喻）
- 过时计划与愿景稿：`docs/archived/`（禁止当开工真源）
- 产品收口画布（对照用）：`.cursor` 项目 canvases / `workspace-dsh-target-shape.canvas.tsx`
- 壳布局现状：`docs/本地伴侣-桌面壳工作台与WebView方案.md`
- 工作台桥：`services/agentWorkbenchBridge.ts`、`companion-desktop/agent-workbench-client.cjs`

---

## 1. 一句话目标

> 本地壳底层换成 dsh。左/中工作台画布，右边原版 dsh 网页。人和助手共用一份稿、一只手指。不再自造 Copilot 外壳。

## 1.1 两段水位

**第一段 P0–P4：** 真 dsh 并排、手指注入、一条文本写回（仍可走旧 bridge）、还能打开旧模块页。  
**第二段 P5–P8：** 通讯倒过来、导入/生成写回文档、dsh 只打文档命令、密钥与登录说清楚。

| 拍板目标 | 第一段 (P4) | 第二段结束 (P8) |
|---|---|---|
| 右边原版 dsh | 达到 | 达到；须在 dsh 里配过模型密钥（P8） |
| 左/中画布 | 达到 | 达到；窗口仍是 Electron |
| 点卡知道改哪 | 文字注入 | 手指是文档上的槽，注入是投影 |
| 改完格子马上有 | 仅追加文本 | 文本 + 导入一张图 + 一次现有出图写回 |
| 连着谁 | 名单 | 名单 + 一条 `send_to_current_host`（旧接头，不按软件写助手） |
| 模块是 dsh 上的房间 | 只打开旧页 | dsh 只暴露文档命令，不按 `ac.*` 逐个注册 |
| 内部不打电话按按钮 | 未做到 | P5 起写回只 `document.dispatch`；网页只订阅。P5-005 后新命令禁止只走 bridge |

Agent 在 P4 done 时只能报第一段。P8 全部 done 才允许说拍板目标已按本计划达成。仍不宣称：3D 全链路、Maya 内部选中物体、重写工作流引擎、dsh 全屏宽度。

## 1.2 执行完 P8 是否符合目标

**符合（拍板范围内）：** 底层助手是 dsh；左中画布右栏原版 dsh Web；不再自造 Copilot 当主入口；一份稿 + 四格手指；写回走文档事件；导入一张图、一次现有出图写回；发给当前已连接软件一条命令；连接/工具/画布用 open_surface 打开，不按 ac.* 堆工具。

**故意不算失败：** 480 右栏不是全屏 dsh；密钥留在 dsh 设置；工作台 cookie 与 dsh 分开；无壳浏览器仍自持文档。

**未完成 P8 就报「目标达成」= 违反本计划。**

---

## 2. 非目标

1. 不魔改 dsh 的 `agent-loop` / `session` 源码。
2. 不把工作台画布改写成 Cordis 内部零件。
3. 不在壳内用 MCP 当人和 dsh 的主通讯。P1 允许旧 workbench bridge 作过渡；P5-005 之后新写回禁止只走 bridge。
4. P0 不删旧 Copilot 代码。
5. 不重写连接驱动、工作流引擎、积分闸门；P6 只把现有生成/导入结果写入文档。
6. 不到「Maya 里当前选中了哪个物体」。
7. 纯浏览器无壳时仍自持文档；有壳时 P5 起以壳内文档为准。P0/P1 不得把无壳工作台改坏。

## 3. 已拍板（禁止任务里重开）

| 项 | 决定 |
|---|---|
| 底座 | 在 dsh 上长，不是再包一层助手 |
| 布局 | 左/中画布，右边 dsh |
| 体验 | 右边就是 dsh 自己的 Web UI |
| 同源 | 卡和版本一份 |
| 手指 | 选中卡、打开的大图、当前页、连着的软件 |
| 软件手指 | 只到「连着谁、这张卡能不能丢过去」 |
| MCP | 只给外部大脑 |

保守默认：

| 项 | 默认 |
|---|---|
| 嵌法 | 第二块 `BrowserView` `loadURL` 本机 dsh（`127.0.0.1`） |
| 右宽 | 默认 480，最小 420，最大 900，可拖；键名 `dshPaneWidth`，不要复用 `copilotWidth` 语义 |
| 版本 | P0-002 写入 §7，禁止 latest |
| 工作台 | 仍 `siteUrl` BrowserView |
| 单槽限制 | 现状 `embedded-browser-manager.cjs` **同一时刻只挂一个 BrowserView**。P0 必须改成工作台+dsh 两块同时挂。这是已知改造，不是可选项。 |

## 4. 完成定义

整条计划完成须同时：

1. 工作台视图：中间画布（或登录页），右边是 dsh 原版界面（能输入、能看到 dsh 自己的过程/模式）。
2. 点卡后再对 dsh 说话，回复能对上该 `assetId`（不必用户报 ID）。
3. 至少一条写回：当前卡出现新版本或新卡，格子不用手动刷新。
4. 手指第四格能反映已连接列表或空（没连就是空）。
5. 默认不再打开旧 Copilot 面板。
6. 无壳浏览器仍能进工作台项目。
7. **第二段：** 壳内有文档事件流；网页订阅后画出 `asset.upsert`；dsh 提交命令只打文档；至少导入一张图、一次现有出图能力写回当前卡；一条 `send_to_current_host`。dsh 密钥：有环境变量则自动探活；没有则记 residual 为 `live_model_unverified` 仍可结束计划（见 P8-001）。

第 1 条 = P0。第 2–3 条 = P1。第 4 条 = P2。第 5 条 = P3。第 6 条贯穿。第 7 条 = P5–P8。

禁止用「感觉像 dsh」当完成标准。禁止用 P4 done 覆盖第二段。

## 5. Agent 循环

1. Observe：§12 + 该任务 Inputs。
2. Select：第一条 `pending` 且 Depends 已 `done`。
3. Act：只改该任务 Modify。实现时 **必须抽出可单测函数**，禁止把完成标准只留在人眼看 Electron。
4. Verify：只跑该任务 Automatic verification。壳改动后 `npm run restart:local-companion`（后台），然后用 HTTP/单测断言，不要等用户点窗口。
5. Record：§14 追加证据；任务 Status=done；更新 §12 下一任务。
6. Continue：立刻做下一条。Stop 仅当：全部 done、blocked、或 LIVE_GATE（§5.1）。

### 5.1 LIVE_GATE（仅此两类可停等人）

默认 **没有 HAND_GATE**。下面两种才允许停：

1. **缺网络/缺 Node/dsh 包拉不下来**（P0-002）：blocked，写清缺什么。
2. **P8-001 要打真实模型** 且环境没有 `DEEPSEEK_API_KEY` / `DSH_API_KEY`：Status=done，Remaining risk=`live_model_unverified`，**继续后续任务**（不要卡住整条计划）。若用户以后要活测，再回头补。

Maya 真机：P7-003 用 mock 驱动自动绿即可；真实导出写入 Remaining risk=`live_host_unverified`，不停整条计划。

禁止：

- 未完成 P0-002 就改工作区对象模型。
- 重写 dsh UI 或再画输入框冒充 dsh。
- MCP 当壳内主路。
- 扩大 Modify 却不先改本计划。
- 把「请用户看一眼」写成完成条件（本修订后一律作废）。
- 同一会话做完 3 条就停（已取消该上限）。

同一失败 3 次：Status=blocked，停。

### 5.2 原「看一眼壳」→ Agent 怎么判（一律自动）

禁止把下表左列当完成条件。右列必须写进该任务 Automatic verification 并跑绿。

| 原意图 | Agent 判定 |
|---|---|
| 看见 dsh 网页 | `GET` 本机 URL，HTTP 200；HTML 非空 |
| 并排画布+dsh | bounds 单测不重叠 + 源码断言同时 `addBrowserView` 两块 + dsh `loadURL` 为本机 loopback |
| 拖宽持久化 | 抽出 clamp/persist 纯函数单测；设置 JSON 读写单测 |
| 切设置不挡 | 抽出 `viewsForShellView(view)`：workbench 返回两块，其它返回空 |
| 点卡读到 id | `formatWorkspaceFingerForDsh` + mock getContext 单测，禁止等人点窗口 |
| dsh 知道选中卡 | inject 模块：给定 finger → patch/插件文本含 assetId；不要求真人问模型 |
| 写回格子 | `applyWorkspaceCommand` / store.dispatch / merge upsert 单测 |
| 问连着什么 | format 字符串含「未连接」或 title 列表 |
| 无旧 Copilot | HTML/源码断言默认不挂 `copilot-panel`；设置开关默认 false |
| 打开连接/工具页 | 导航函数单测：view 名 → 期望壳 view；回到 workbench 再挂两块 |
| ingest/出图 | mock 伴侣/生成，断言 dispatch upsert；缺密钥/积分必须失败不得空白成功 |
| 发给当前软件 | mock host：未连接失败文案；已连接调用旧接头一次 |
| 真实模型一轮 | 有 `DEEPSEEK_API_KEY`/`DSH_API_KEY` 才可选探活；没有则 `live_model_unverified` 继续 |

实现约束：Electron 窗口行为必须抽到 `.cjs` 纯函数再接线。禁止完成标准只写 `node --check`。

## 6. 当前约束

- `companion-desktop/main.cjs`：工作台 BrowserView；Copilot 默认宽 360。
- `embedded-browser-manager.cjs`：单槽 bounds（`copilotEffectiveWidthPx` 只用来给工作台让宽）。
- 旧助手：`agent-session/`、`shell/copilot-panel.js`。
- 工作台对象在网页：`WorkflowSection`、`workspaceProjectStore`。
- 已有桥：`services/agentWorkbenchBridge.ts`（`getContext` 尚无手指）。
- dsh 是 Node 本机网页（默认 `127.0.0.1:3080`），不是 Electron 应用。官方要求 Node 22.19+ 或 24+（P0-002 核对）。
- 工作台 BrowserView 用 `persist:assetcutter-team`；dsh 是另一套本机源，**不共享**该登录态。dsh 要自己的模型密钥。
- 改壳运行时后须 `npm run restart:local-companion`。

## 7. 钉死版本

| 包 | 版本 | 日期 | 备注 |
|---|---|---|---|
| `@deepseek-ai/dsh` | `0.1.1-rc.2` | 2026-08-24 | Node `^22.19.0` 或 `>=24`；本机实测 Node v22.20.0 |

## 8. 阶段门

| 阶段 | 用户能看见 | 未完成禁止 |
|---|---|---|
| P0 | 并排：画布 + 真 dsh | 开始 P1（须 P0-007 done） |
| P1 | 点卡 dsh 知道；至少一次写回格子 | 软件手指 |
| P2 | 连着谁 / 空 | 拆旧 Copilot 默认入口 |
| P3 | 默认无旧 Copilot | 重写工作流引擎 |
| P4 | 还能打开旧模块页 | 宣称模块已长在 dsh 上 |
| P5 | 文档在壳、网页订阅 | 新写回只走旧 bridge |
| P6 | 导入一张图 + 一次出图写回 | 新造生成引擎 |
| P7 | 文档命令 + 打开表面 + 发给当前软件 | 按软件写助手 |
| P8 | partition + 密钥探活（无密钥则 residual） | 无默认人手门 |

## 9. 证据模板（每条任务复制）

```markdown
### TASK_ID
- Status:
- Files changed:
- Commands run:
- Result (pass/fail):
- LIVE_GATE: none | blocked-network | live_model_unverified | live_host_unverified
- Remaining risk:
- Next:
```

---

## 10. 任务 backlog

### P0-001: 冻结本计划为开工真源

Status: done  
Depends on: none  
HAND_GATE: none

（计划文件已落地。）

---

### P0-002: 踩点 dsh 进 Electron 右栏

Status: done  
Depends on: P0-001  
HAND_GATE: none

Objective:

- 本文件出现「踩点结论」：唯一嵌法、启动命令、`--no-open`、host/port、Node 版本要求。
- §7 填上钉死的包版本。
- 若不能 BrowserView 加载本机 URL：blocker，停止，禁止改画聊天框。
- 必须写明：如何把一段上下文交给 dsh（插件 / inject / 提示文件 / 无）。写「无」则 P1-004、P7-001 将 blocked。

Inputs:

- https://github.com/deepseek-ai/DeepSeek-Harness README
- 官方 Web UI 文档
- `companion-desktop/main.cjs` BrowserView 用法
- `companion-desktop/embedded-browser-manager.cjs`

Modify:

- 仅本文件（§7、踩点结论、本任务证据）

Do not modify:

- 任何运行时代码

Steps:

1. `npx --yes @deepseek-ai/dsh --help`（或官方等价命令）。
2. `npx --yes @deepseek-ai/dsh web --help`，确认 `--no-open` / `--host` / `--port`。
3. 用 `--no-open` 在本机起 Web，记录打印的 URL。
4. `GET` 该 URL，要求 HTTP 200 且 body 非空。禁止把「人打开浏览器」当完成条件。
5. 写清：第二 BrowserView `loadURL` 该 loopback URL 是否可行（Electron 能力；源码/文档结论即可）。
6. 写清官方注入手段（`--patch` 本地插件 / `ctx.systemPrompt.context` / tools）。写「无」则 P1-004、P7-001 blocked。
7. 把版本写入 §7。

Automatic verification:

```powershell
node -v
npx --yes @deepseek-ai/dsh --help
npx --yes @deepseek-ai/dsh web --help
# 起服务后对打印的 URL：
# Invoke-WebRequest -Uri http://127.0.0.1:<port> -UseBasicParsing | Select-Object StatusCode, @{n='Len';e={$_.Content.Length}}
```

Agent 判定：CLI 能打印用法；GET 200 且 Content.Length > 0；§7 有钉死版本；§13 注入手段不是空。

Blocked handling:

- 无网络/拉包失败：blocked。
- CLI 行、BrowserView 不可行：blocked，不要开始 P0-003。

---

### P0-003: 双栏 bounds 纯函数

Status: done  
Depends on: P0-002  
HAND_GATE: none

Objective:

- `computeEmbeddedBrowserBounds` 保留或委托；新增 `computeWorkbenchAndDshBounds(contentBounds, insets)`，一次返回 `{ workbench, dsh }`。
- `insets.dshPaneWidthPx` 为右侧宽；工作台 width = 总宽 - sidebar - dshPane。
- dsh rect：贴右边，y 与工作台相同。
- 文件头注释改为允许两块同时挂载。

Inputs:

- `companion-desktop/embedded-browser-manager.cjs`

Modify:

- `companion-desktop/embedded-browser-manager.cjs`
- `tests/embeddedBrowserBounds.test.ts`（新建）

Do not modify:

- `main.cjs`（本任务不接线）

Steps:

1. 实现双 rect。
2. 测试：800×600、sidebar 56、titlebar 30、dsh 480 → 工作台与 dsh 不重叠、拼满可用宽。
3. dshPane=0 时工作台占满（设置页将用这个）。

Automatic verification:

```powershell
npx vitest run tests/embeddedBrowserBounds.test.ts
node --check companion-desktop/embedded-browser-manager.cjs
```

---

### P0-004: dsh 本机进程托管

Status: done  
Depends on: P0-002  
HAND_GATE: none

Objective:

- 模块能 start/stop：在 `127.0.0.1` 指定端口拉起钉死版本的 dsh web（`--no-open`），返回 url。
- stop 能杀掉子进程。
- 端口占用时返回明确错误，不静默改用 Copilot。

Inputs:

- §7 版本与 P0-002 启动命令

Modify:

- `companion-desktop/dsh-host.cjs`（新建）
- `tests/dshHost.test.ts`（新建：至少测命令拼装/拒绝非 loopback；不要在单测里真的长时间挂起 dsh，除非用 mock spawn）

Do not modify:

- `main.cjs`（本任务不接线）
- 工作台网页

Automatic verification:

```powershell
npx vitest run tests/dshHost.test.ts
node --check companion-desktop/dsh-host.cjs
```

Blocked handling:

- 官方命令与假设不符：先改本计划启动命令再写代码，不要猜。

---

### P0-005: 工作台视图挂上第二块 dsh BrowserView

Status: done  
Depends on: P0-003, P0-004  
HAND_GATE: none

Objective:

- `view === workbench`：同时挂工作台 view + dsh view；dsh `loadURL` 为 dsh-host 的 url。
- 工作台页不再显示 `copilot-panel`（隐藏即可，不删文件）。
- 默认 `dshPaneWidth` 480。

Inputs:

- P0-003 bounds、P0-004 host
- `companion-desktop/main.cjs` 现有 workbench BrowserView / Copilot 布局
- `companion-desktop/shell/index.html`、`companion-desktop/shell/copilot-panel.js`

Modify:

- `companion-desktop/main.cjs`
- `companion-desktop/shell/index.html`（仅隐藏工作台页 Copilot 所需最小改动）

Do not modify:

- `components/WorkflowSection.tsx` 等网页业务
- 删除 `agent-session`

Automatic verification:

```powershell
node --check companion-desktop/main.cjs
node --check companion-desktop/dsh-host.cjs
npx vitest run tests/embeddedBrowserBounds.test.ts tests/dshHost.test.ts tests/dshWorkbenchViews.test.ts
```

（`tests/dshWorkbenchViews.test.ts` 本任务新建：断言 workbench 同时挂两块 view、dsh `loadURL` 为 loopback、默认 `dshPaneWidth===480`、工作台页不挂 copilot-panel。逻辑抽到可 require 的函数，禁止只靠人眼看 Electron。）

Blocked handling:

- dsh 起不来：blocked，不要回退输入框。

---

### P0-006: 右栏宽度可拖且持久化

Status: done  
Depends on: P0-005  
HAND_GATE: none

Objective:

- 拖动改变 `dshPaneWidth`，两块 BrowserView bounds 立刻更新。
- 写入 `companion-shell-settings.json` 键 `dshPaneWidth`（或并列的明确新键），重启后恢复。
- 不要覆盖/混用 `copilotWidth` 的含义。

Modify:

- `companion-desktop/main.cjs`
- 读写 `companion-shell-settings.json` 的现有函数所在处（仍在 `main.cjs`）
- 若拖条在壳 HTML：`companion-desktop/shell/index.html` 最小改动

Do not modify:

- 网页工作台

Automatic verification:

```powershell
node --check companion-desktop/main.cjs
npx vitest run tests/dshPaneWidth.test.ts tests/embeddedBrowserBounds.test.ts
```

（`tests/dshPaneWidth.test.ts` 本任务新建：clamp 420–900；persist `dshPaneWidth` 读写；不要混用 `copilotWidth`。）

---

### P0-007: 非工作台页隐藏 dsh，不挡首页/设置

Status: done  
Depends on: P0-005  
HAND_GATE: none

Objective:

- 切到 home/settings：dsh view 与工作台 view 都摘掉或移出可视区域。
- 再回 workbench：两块都回来，dsh 不必重新登录（能复用 webContents 则复用）。

Modify:

- `companion-desktop/main.cjs`
- `companion-desktop/embedded-browser-manager.cjs`（仅当 detach API 需要）

Automatic verification:

```powershell
node --check companion-desktop/main.cjs
npx vitest run tests/dshWorkbenchViews.test.ts
```

（断言：`viewsForShellView('settings'|'home')` 不含 dsh/workbench BrowserView；`viewsForShellView('workbench')` 含两块。）

---

### P1-001: Workspace Document 最小协议

Status: done  
Depends on: P0-007  
HAND_GATE: none

Objective:

- 固定文件 `services/workspaceDocumentProtocol.ts` 导出：
  - `WorkspaceFinger`：`selectedAssetId`, `selectedDisplayKey`, `previewOpen`, `previewAssetId`, `surface`（`'canvas' | 'presets' | 'other'`）, `connectedHosts: WorkspaceConnectedHost[]`
  - `WorkspaceConnectedHost`：`id`, `title`, `ready`, `canAcceptCurrentCard`
  - `WorkspaceSnapshot`：`projectId`, `finger`, `assetIds: string[]`（P1 最小：只 id 列表，不搬整卡二进制）
  - `WorkspaceCommand`：至少 `'noop' | 'append_text_result'`
  - `applyWorkspaceCommand(snapshot, command)` 纯函数
- fixture round-trip + append_text_result 只改目标 id。

Modify:

- `services/workspaceDocumentProtocol.ts`（新建）
- `tests/workspaceDocumentProtocol.test.ts`（新建）

Do not modify:

- UI、main.cjs

Automatic verification:

```powershell
npx vitest run tests/workspaceDocumentProtocol.test.ts
```

---

### P1-002: 工作台 getContext 带上手指三格（画布）

Status: done  
Depends on: P1-001  
HAND_GATE: none

Objective:

- `AgentWorkbenchBridgeContext` 增加 `finger`（选中卡、displayKey、previewOpen、previewAssetId、surface）。
- `connectedHosts` 本任务固定 `[]`。
- App 注册的 getContext 必须填真实选中/灯箱/当前工作区页，不要假数据。

Inputs:

- `services/agentWorkbenchBridge.ts`
- `App.tsx` 中 createTextAsset / getContext 注册处
- `tests/agentWorkbenchBridge.test.ts`

Modify:

- `services/agentWorkbenchBridge.ts`
- `services/workspaceDocumentProtocol.ts`（仅类型 import 若需要）
- `App.tsx`（仅 getContext 填 finger）
- `tests/agentWorkbenchBridge.test.ts`

Do not modify:

- 生成/积分
- dsh-host

Automatic verification:

```powershell
npx vitest run tests/agentWorkbenchBridge.test.ts tests/workspaceDocumentProtocol.test.ts
```

---

### P1-003: 壳能读到当前手指

Status: done  
Depends on: P1-002  
HAND_GATE: none

Objective:

- 主进程可通过现有 `agent-workbench-context`（或同等 IPC）读到 `finger.selectedAssetId`。
- 增加 `formatWorkspaceFingerForDsh(finger)`：纯字符串，含 assetId，供后续注入。

Modify:

- `services/workspaceDocumentProtocol.ts`（加上 format 函数）
- `tests/workspaceDocumentProtocol.test.ts`
- `companion-desktop/main.cjs` 仅当现有 handler 不够返回 finger 时做最小透传
- `tests/agentWorkbenchClient.test.ts` 若客户端类型需要跟上

Do not modify:

- dsh 网页、自造聊天 UI

Automatic verification:

```powershell
npx vitest run tests/workspaceDocumentProtocol.test.ts tests/agentWorkbenchBridge.test.ts
node --check companion-desktop/main.cjs
```

Agent 判定：`formatWorkspaceFingerForDsh` 单测给定 selectedAssetId 输出含该 id。禁止「用户确认过了」。

---

### P1-004: 手指文本注入 dsh（仍不自造 UI）

Status: done  
Depends on: P1-003 且 P0-002 踩点结论允许某种注入  
HAND_GATE: none

Objective:

- 每轮用户在 dsh 发消息前，当前 `formatWorkspaceFingerForDsh` 结果进入 dsh 能看见的上下文。
- 注入方式只能用 P0-002 写明的官方手段（插件 / inject / 启动参数）。禁止再包 Copilot `streamTurn`。
- 若踩点结论是「只能系统提示文件」：写文件并在 dsh-host 启动参数里带上，仍算本任务。

Modify:

- `companion-desktop/dsh-context-inject.cjs`（新建）
- `companion-desktop/dsh-host.cjs` 或 `main.cjs`（只接线注入）
- `tests/dshContextInject.test.ts`（新建：给定 finger → 输出含 assetId 的文本）

Do not modify:

- 自造右侧聊天框
- 工作流引擎

Automatic verification:

```powershell
npx vitest run tests/dshContextInject.test.ts tests/workspaceDocumentProtocol.test.ts
node --check companion-desktop/dsh-context-inject.cjs
```

Agent 判定：`tests/dshContextInject.test.ts` 给定 finger → 注入文本/patch 含 assetId。禁止真人向模型提问当完成条件。

Blocked handling:

- P0-002 写明无法注入：本任务 blocked，停；禁止改回 Copilot 循环。

---

### P1-005: 一条写回：当前卡追加文本结果

Status: done  
Depends on: P1-004  
HAND_GATE: none

Objective:

- 实现 `append_text_result`：对 `finger.selectedAssetId` 追加一段可见文本结果（或新建文本卡若无选中）。
- 走工作台已有 bridge 写资产（扩展 `agentWorkbenchBridge` / App 已有 `createTextAsset` 同类路径），格子立即出现，不用刷新。
- dsh 侧用 P0-002 允许的方式暴露 **一个** 动作（官方 tool 或约定斜杠命令）。禁止实现全部 `ac.*`。

Modify:

- `services/agentWorkbenchBridge.ts`
- `App.tsx`（注册执行函数，最小）
- `companion-desktop/agent-workbench-client.cjs`（若主进程要调）
- `tests/agentWorkbenchBridge.test.ts`
- dsh 接线仅限 `companion-desktop/dsh-context-inject.cjs` 或新建 `companion-desktop/dsh-workspace-tool.cjs`

Do not modify:

- 积分闸门、即梦/视频默认路径
- 删除旧 Copilot 模块

Automatic verification:

```powershell
npx vitest run tests/agentWorkbenchBridge.test.ts tests/workspaceDocumentProtocol.test.ts
```

Agent 判定：bridge/protocol 单测：选中 id 或空画布 → append_text_result 后 snapshot 含新文本。禁止等人看格子。

Blocked handling:

- 必须先做总线：在本计划插入 `P1-005a`，本任务改 depends，不要一条任务做完所有命令。

---

### P2-001: 从已连通列表填 connectedHosts

Status: done  
Depends on: P1-003  
HAND_GATE: none

Objective:

- `finger.connectedHosts` 来自现有软件连接「已连通」草稿，不是写死 Maya。
- 每项：`id, title, ready: true, canAcceptCurrentCard`（P2 可先恒 true 或按是否有选中卡：无选中则 false）。
- 无连通 → `[]`。

Inputs:

- 连接草稿/connectionState 现有读取处（capability drafts API 或壳已有状态）
- `services/workspaceDocumentProtocol.ts`

Modify:

- 填 finger 的同一路径：`App.tsx` getContext 和/或 companion 侧聚合模块 `companion-desktop/workspace-finger-hosts.cjs`（若必须在主进程读草稿则新建这个文件）
- `tests/workspaceFingerHosts.test.ts`（新建：fixture 草稿 → hosts 数组）

Do not modify:

- `local-companion/src/capabilities/capabilityLifecycle.ts` 加软件分支

Automatic verification:

```powershell
npx vitest run tests/workspaceFingerHosts.test.ts tests/workspaceDocumentProtocol.test.ts
```

---

### P2-002: 注入文本含连接名单

Status: done  
Depends on: P2-001, P1-004  
HAND_GATE: none

Objective:

- `formatWorkspaceFingerForDsh` 含「未连接」或已连接 title 列表。
- dsh 问「现在连着什么软件」能对上第四格。

Modify:

- `services/workspaceDocumentProtocol.ts`
- `tests/workspaceDocumentProtocol.test.ts`
- `companion-desktop/dsh-context-inject.cjs`（若格式化只在协议文件则可不改）

Automatic verification:

```powershell
npx vitest run tests/workspaceDocumentProtocol.test.ts tests/dshContextInject.test.ts
```

Agent 判定：format 单测覆盖空 hosts（含「未连接」）与非空 title 列表。禁止真人问 dsh。

---

### P3-001: 默认关闭旧 Copilot 面板入口

Status: done  
Depends on: P1-005  
HAND_GATE: none

Objective:

- 工作台默认只有 dsh 右栏。旧 Copilot 无侧栏按钮；允许设置里「调试旧 Copilot」开关，默认关。

Modify:

- `companion-desktop/shell/index.html`
- `companion-desktop/main.cjs`（仅入口/开关）
- 若有 `tests/copilotSettingsUi.test.ts`：改断言为默认不展示面板，并更新测试

Do not modify:

- 删除 `agent-session` 目录（本任务只藏入口）

Automatic verification:

```powershell
npx vitest run tests/copilotSettingsUi.test.ts
node --check companion-desktop/main.cjs
```

Agent 判定：`tests/copilotSettingsUi.test.ts` 断言默认不展示旧面板；工作台 HTML 默认不挂 copilot-panel。

---

### P4-001: 模块入口接线（不重写引擎）

Status: done  
Depends on: P3-001  
HAND_GATE: none

Objective:

- 壳或 dsh 能打开现有：连接页、工具页、工作流所在工作台表面（用已有 `ac.shell.navigate` 或壳导航，不新写运行时）。
- 本任务只加「怎么打开」的最小入口 + 本计划一小节「模块入口表」。
- 不重写 Workflow 执行器。

Modify:

- `docs/dsh本地壳-可执行开发计划.md`（模块入口表）
- `companion-desktop/main.cjs` 或 shell 导航最小挂钩（若已能切页则只写文档）

Automatic verification:

```powershell
node --check companion-desktop/main.cjs
```

Agent 判定：导航映射单测（connections / tools / workbench）+ `viewsForShellView('workbench')` 仍为两块。本文件「模块入口表」三行与源码字面量一致。

---

### P5-001: 文档事件类型

Status: done  
Depends on: P1-001  
HAND_GATE: none

Objective:

- `services/workspaceDocumentProtocol.ts` 增加仅追加事件：至少 `finger.changed`、`asset.upsert`（payload：`id` + 可 JSON 的卡片补丁，不含巨大二进制；图用 companionKey/objectKey）。
- `reduceWorkspaceEvents(events) => snapshot` 纯函数。
- 测试：finger 事件后选中 id 变；upsert 后 assetIds 含该 id。

Modify:

- `services/workspaceDocumentProtocol.ts`
- `tests/workspaceDocumentProtocol.test.ts`

Do not modify:

- UI、main.cjs

Automatic verification:

```powershell
npx vitest run tests/workspaceDocumentProtocol.test.ts
```

---

### P5-002: 壳内文档 store（内存 + 追加）

Status: done  
Depends on: P5-001  
HAND_GATE: none

Objective:

- `companion-desktop/workspace-document-store.cjs`：`dispatch(command)` → 追加事件 → 当前 snapshot；`subscribe(fn)`。
- 不写盘（P5 内存即可；项目持久化仍走现有工作台保存）。
- 单测用纯 JS 或把 reduce 从 protocol 再导出一层 require。

Modify:

- `companion-desktop/workspace-document-store.cjs`（新建）
- `tests/workspaceDocumentStore.test.ts`（新建）

Do not modify:

- WorkflowSection 布局

Automatic verification:

```powershell
npx vitest run tests/workspaceDocumentStore.test.ts tests/workspaceDocumentProtocol.test.ts
node --check companion-desktop/workspace-document-store.cjs
```

---

### P5-003: 双写过渡：append_text_result 先 dispatch 再旧 bridge

Status: done  
Depends on: P5-002, P1-005  
HAND_GATE: none

Objective:

- 文本写回：先 `store.dispatch`，再调用现有 bridge（格子仍立刻有）。
- 测试或注释标明：这是过渡，P5-005 要拆掉「只靠 bridge」。

Modify:

- `companion-desktop/dsh-workspace-tool.cjs` 或 P1-005 接线文件
- `companion-desktop/main.cjs`（仅把 store 挂上）
- `tests/workspaceDocumentStore.test.ts`

Do not modify:

- 生成引擎

Automatic verification:

```powershell
npx vitest run tests/workspaceDocumentStore.test.ts tests/agentWorkbenchBridge.test.ts
```

---

### P5-004: 网页订阅 asset.upsert 画格子

Status: done  
Depends on: P5-002  
HAND_GATE: none

Objective:

- 工作台有壳时：preload/IPC 订阅 store 事件；收到 `asset.upsert` 后只更新对应 `WorkflowAsset`（`App.tsx` 最小 `setWorkflowAssets`），用户不用刷新。
- 无壳：不订阅，行为与现在一致。
- 禁止把整个 WorkflowSection 重写成新框架。

Modify:

- `companion-desktop/preload` 现有 shell/workbench preload（只加 subscribe）
- `App.tsx`（仅订阅 + 合并一张卡）
- `tests/` 下新增或扩展纯函数「把 upsert 补丁 merge 进 assets 数组」的测试文件，例如 `tests/workspaceAssetUpsertMerge.test.ts`

Do not modify:

- dsh UI
- 积分

Automatic verification:

```powershell
npx vitest run tests/workspaceAssetUpsertMerge.test.ts tests/workspaceDocumentProtocol.test.ts
```

Agent 判定：upsert merge 单测格子数组更新。无壳路径：不订阅时现有加载测试仍绿（不要新开浏览器）。

---

### P5-005: 新写回只 dispatch，网页只订阅

Status: done  
Depends on: P5-003, P5-004  
HAND_GATE: none

Objective:

- `append_text_result` 成功路径：只 `store.dispatch`。网页只靠订阅更新。禁止该命令再 executeJavaScript 当唯一写入口。
- 旧 bridge 可留作无壳或调试，默认有壳走文档。

Modify:

- P1-005 / P5-003 写回接线文件
- `tests/workspaceDocumentStore.test.ts`
- 本文件 §14 证据写明「append_text_result 已脱离必经 bridge」

Do not modify:

- 删除 bridge 文件

Automatic verification:

```powershell
npx vitest run tests/workspaceDocumentStore.test.ts tests/workspaceAssetUpsertMerge.test.ts
```

Agent 判定：源码/单测禁止 `executeJavaScript` 作为 append_text 唯一写入；dispatch 后 merge 测试绿。

---

### P6-001: 命令 ingest_image（一张图写入文档）

Status: done  
Depends on: P5-005  
HAND_GATE: none

Objective:

- 新命令 `ingest_image`：一张图（data URL 或本机路径经伴侣落盘后的 companionKey）变成画布上一张卡。
- 复用现有导入/建图资产逻辑，结果只经 `asset.upsert`。
- 不一次做批量 50 张。

Modify:

- `services/workspaceDocumentProtocol.ts`（命令联合类型）
- `services/agentWorkbenchBridge.ts` 或现有 `buildAgentCreatedImageAsset` 路径
- `App.tsx` 仅 merge
- `tests/workspaceDocumentProtocol.test.ts`
- `tests/agentWorkbenchBridge.test.ts`

Do not modify:

- 即梦默认路径

Automatic verification:

```powershell
npx vitest run tests/workspaceDocumentProtocol.test.ts tests/agentWorkbenchBridge.test.ts tests/workspaceAssetUpsertMerge.test.ts
```

Agent 判定：ingest 单测 fixture 图 → store 出现 assetId。禁止等人看格子。

---

### P6-002: 命令 generate_on_current（一次现有出图写回当前卡）

Status: done  
Depends on: P6-001, P1-002  
HAND_GATE: none

Objective:

- 新命令 `generate_on_current`：对 `finger.selectedAssetId` 跑 **一条已经存在的工作台出图能力**（优先已有 smoke/直跑 preset，见 `agentWorkbenchBridge` 的 smoke preset 或现成 `run_capability` 语义）。
- 积分/密钥走现有闸门，失败要有文档事件或可见错误，禁止假成功。
- 成功：当前卡多一个版本，`displayKey` 指到新结果，格子马上换图。
- 不新造模型供应商。无选中卡则明确失败。

Modify:

- `services/workspaceDocumentProtocol.ts`
- `services/agentWorkbenchBridge.ts`（跑现有能力，输出接到 upsert）
- 壳 store dispatch 接线
- `tests/agentWorkbenchBridge.test.ts`

Do not modify:

- 新供应商、视频默认路径、3D 全链路

Automatic verification:

```powershell
npx vitest run tests/agentWorkbenchBridge.test.ts tests/workspaceDocumentProtocol.test.ts
```

Agent 判定：mock 生成成功 → upsert 含新图指针；mock 缺密钥/积分 → 失败且无空白成功。禁止等人出图。

---

### P7-001: dsh 只注册文档级工具（动态，不写死 ac.*）

Status: done  
Depends on: P5-005, P0-002 注入/插件结论  
HAND_GATE: none

Objective:

- 模型侧可见工具最多这类：`workspace_read_finger`、`workspace_dispatch`（参数为 WorkspaceCommand）、`workspace_open_surface`。
- 禁止再为每个 `ac.workbench.*` 做 defineTool。
- 实现放 `companion-desktop/dsh-workspace-tool.cjs`；单测：dispatch 非法命令被拒。

Modify:

- `companion-desktop/dsh-workspace-tool.cjs`
- `tests/dshWorkspaceTool.test.ts`（新建）
- 按 P0-002 挂到 dsh 的最小接线

Do not modify:

- 自造聊天 UI

Automatic verification:

```powershell
npx vitest run tests/dshWorkspaceTool.test.ts tests/workspaceDocumentProtocol.test.ts
```

Blocked handling:

- 官方不能挂 tool：blocked 并停，不要用 Copilot streamTurn 冒充。

---

### P7-002: open_surface 打开连接/工具/画布

Status: done  
Depends on: P7-001, P4-001  
HAND_GATE: none

Objective:

- `workspace_open_surface` 的 surface 枚举：`canvas | connections | tools`（名称与壳现有导航对齐，以代码为准写进本文件模块入口表）。
- 只切壳页面或工作台表面，不重写那些页。

Modify:

- `companion-desktop/main.cjs` 或已有 `ac.shell.navigate`
- `docs/dsh本地壳-可执行开发计划.md` 模块入口表
- `tests/dshWorkspaceTool.test.ts`

Automatic verification:

```powershell
npx vitest run tests/dshWorkspaceTool.test.ts
node --check companion-desktop/main.cjs
```

Agent 判定：`open_surface` 单测三表面 + workbench 仍挂 dsh view。禁止等人点壳。

---

### P7-003: send_to_current_host（一条命令，不按软件分支）

Status: done  
Depends on: P7-001, P2-001  
HAND_GATE: none

Objective:

- 命令 `send_to_current_host`：把当前卡交给 `finger.connectedHosts` 里 `ready && canAcceptCurrentCard` 的第一个（或多个时取用户已指的当前宿主；没有「当前」则失败并说明）。
- 执行走 **现有** 导出/桥接，不在助手里写 Maya if。
- 无连接：失败信息「还没连软件」。

Modify:

- `services/workspaceDocumentProtocol.ts`
- 现有导出路径的调用点（Script Hub / Maya workflow 已有能力，只接线）
- `tests/workspaceDocumentProtocol.test.ts`
- `tests/dshWorkspaceTool.test.ts`

Do not modify:

- `capabilityLifecycle.ts` 加软件分支

Automatic verification:

```powershell
npx vitest run tests/workspaceDocumentProtocol.test.ts tests/dshWorkspaceTool.test.ts
```

Agent 判定：未连接 mock 失败文案含没连；已连接 mock 调用旧接头一次。真实 Maya 记 `live_host_unverified`，不停计划。

---

### P8-001: Node 版本与密钥探活（可 residual）

Status: done  
Depends on: P0-005  
HAND_GATE: none

Objective:

- 本文件 §13 增加「本机验收清单」：Node 版本、dsh 能对话（密钥已配）、工作台已登录（若测写回）。
- 不在本任务做密钥托管到 AssetCutter 账号（默认：密钥留在 dsh 自己的设置里）。

Modify:

- 仅本文件 §13

Automatic verification:

```powershell
node -v
```

Agent 判定：`node -v` 满足官方引擎。若环境有 `DEEPSEEK_API_KEY` 或 `DSH_API_KEY`，可用官方 headless/探活命令打一轮（失败记 residual 不 blocked）。无密钥：Status=done，Remaining risk=`live_model_unverified`，继续 P8-002。禁止等人确认「右边能对话」。

---

### P8-002: 写清两套登录、禁止混 cookie

Status: done  
Depends on: P0-005  
HAND_GATE: none

Objective:

- 在本文件 §6 或 §13 写死：工作台 `persist:assetcutter-team` 与 dsh `127.0.0.1` 不合并 Session。
- 代码里若有人把 dsh URL 开进 team partition：禁止。加一条测试或 main.cjs 断言注释 + 回归测试「dsh BrowserView 的 partition 不是 team」。

Modify:

- `companion-desktop/main.cjs`（dsh view 的 partition 明确独立或 default，**不是** `persist:assetcutter-team`）
- `tests/` 能静态读 main.cjs 的测试可放 `tests/dshPartitionGuard.test.ts`（新建：读源码或抽小函数）

Do not modify:

- 工作台 partition

Automatic verification:

```powershell
npx vitest run tests/dshPartitionGuard.test.ts
```

---

### P8-003: 模块入口表定稿

Status: done  
Depends on: P7-002  
HAND_GATE: none

Objective:

- 本文件增加「§16 模块入口表」：canvas / connections / tools 各对应壳 view 或 URL，与代码一致。

Modify:

- 仅本文件

Automatic verification:

```powershell
# 无代码。证据里贴入口表三行与 main.cjs 导航字面量一致。
```

---

## 11. 验证矩阵

| 阶段 | 自动 | 仅 LIVE_GATE / residual |
|---|---|---|
| P0 | vitest bounds/host/views/width + GET dsh URL 200 | 拉不下包 → blocked |
| P1 | protocol + bridge + inject 测试 | 无 |
| P2 | hosts + format 测试 | 无 |
| P3 | copilotSettingsUi + HTML 断言 | 无 |
| P4 | 导航映射单测 + 入口表对源码 | 无 |
| P5 | store + upsert merge；禁止 executeJavaScript 唯一写入 | 无 |
| P6 | ingest/generate mock（失败不得空白成功） | 无 |
| P7 | dshWorkspaceTool + mock host | Maya 真机 → `live_host_unverified` |
| P8 | partition guard + node -v | 无密钥 → `live_model_unverified` |
| 回归 | 不把全仓红当门禁 | — |

## 12. 当前进度

- 下一任务：
- 已完成：`P0-001` `P0-002` `P0-003` `P0-004` `P0-005` `P0-006` `P0-007` `P1-001` `P1-002` `P1-003` `P1-004` `P1-005` `P2-001` `P2-002` `P3-001` `P4-001` `P5-001` `P5-002` `P5-003` `P5-004` `P5-005` `P6-001` `P6-002` `P7-001` `P7-002` `P7-003` `P8-001` `P8-002` `P8-003`
- 阻塞：无
- 本会话已完成无门任务数：29
- Remaining risk：`live_model_unverified`（无 DEEPSEEK_API_KEY / DSH_API_KEY）；`live_host_unverified`（未真机 Maya 导出）

## 13. 踩点结论（P0-002 填写）

- 启动命令：`npx --yes --package @deepseek-ai/dsh@0.1.1-rc.2 dsh web --no-open --host 127.0.0.1 --port 3080`
- URL：`http://127.0.0.1:3080`
- 钉死版本：`0.1.1-rc.2`
- BrowserView 可行：yes（第二块 `BrowserView.loadURL` 本机 loopback；partition=`persist:assetcutter-dsh`，不是 team）
- 注入上下文官方手段：`dsh web --patch <cordis.yml>` 加载本地插件；插件用 `ctx.systemPrompt.context()` 注入手指文本，用 `ctx.tools.register(defineTool(...))` 暴露文档命令。禁止再包 Copilot `streamTurn`。无官方「往已开网页 DOM 里塞 prompt」API。
- Node 版本实测：v22.20.0（满足 `^22.19.0 || >=24.0.0`）
- 失败日志：首次 `npx` 解析依赖树极慢（约 26 分钟）；CLI `--help` 与 GET `/` HTTP 200 Len=14523 已通过。
- 本机验收清单（P8-001）：
  - Node：v22.20.0（pass）
  - dsh 能对话：本环境无 `DEEPSEEK_API_KEY` / `DSH_API_KEY` → `live_model_unverified`
  - 工作台已登录：写回走文档 store + 网页订阅，不作为本任务人工门
  - 密钥托管：留在 dsh 自己的设置里，不迁到 AssetCutter 账号
- 两套登录（P8-002）：工作台 `persist:assetcutter-team` 与 dsh `persist:assetcutter-dsh` 禁止合并 Session；`isDshPartitionAllowed` 拒绝 team partition。

## 14. 执行证据

### P0-001

- Status: done
- Files changed: `docs/dsh本地壳-可执行开发计划.md`，`docs/交接文档.md`
- Commands run: 写文件
- Result: pass
- LIVE_GATE: none
- Remaining risk: 嵌 dsh 未踩点
- Next: P0-002

### P0-002

- Status: done
- Files changed: `docs/dsh本地壳-可执行开发计划.md`
- Commands run: `node -v`；`npm view @deepseek-ai/dsh version`；`npx --yes --package @deepseek-ai/dsh@0.1.1-rc.2 dsh --help`；`dsh web --help`；`dsh web --no-open --host 127.0.0.1 --port 3080`；`Invoke-WebRequest http://127.0.0.1:3080`
- Result: pass（StatusCode=200 Len=14523）
- LIVE_GATE: none
- Remaining risk: dsh 是开发者预览，CLI 可能破；首次安装很慢
- Next: P0-003

### P0-003

- Status: done
- Files changed: `companion-desktop/embedded-browser-manager.cjs`，`tests/embeddedBrowserBounds.test.ts`
- Commands run: `npx vitest run tests/embeddedBrowserBounds.test.ts`
- Result: pass
- LIVE_GATE: none
- Remaining risk: none
- Next: P0-004

### P0-004

- Status: done
- Files changed: `companion-desktop/dsh-host.cjs`，`tests/dshHost.test.ts`
- Commands run: `npx vitest run tests/dshHost.test.ts`
- Result: pass
- LIVE_GATE: none
- Remaining risk: 本机已有 :3080 时 start 会 reuse HTTP 200
- Next: P0-005

### P0-005

- Status: done
- Files changed: `companion-desktop/main.cjs`，`companion-desktop/shell/index.html`，`companion-desktop/dsh-workbench-views.cjs`，`companion-desktop/dsh-pane-width.cjs`，`tests/dshWorkbenchViews.test.ts`
- Commands run: `npx vitest run tests/dshWorkbenchViews.test.ts tests/copilotSettingsUi.test.ts`；`node --check companion-desktop/main.cjs`
- Result: pass
- LIVE_GATE: none
- Remaining risk: none
- Next: P0-007 then P0-006

### P0-006

- Status: done
- Files changed: `companion-desktop/main.cjs`，`companion-desktop/preload-shell.cjs`，`companion-desktop/shell/index.html`，`companion-desktop/dsh-pane-width.cjs`，`tests/dshPaneWidth.test.ts`
- Commands run: `npx vitest run tests/dshPaneWidth.test.ts tests/copilotSettingsUi.test.ts`
- Result: pass
- LIVE_GATE: none
- Remaining risk: 拖条在 BrowserView 叠层上，极窄时可能难瞄
- Next: P1-001

### P0-007

- Status: done
- Files changed: `companion-desktop/dsh-workbench-views.cjs`，`companion-desktop/main.cjs`（非 workbench 走 detachAll）
- Commands run: `npx vitest run tests/dshWorkbenchViews.test.ts`
- Result: pass
- LIVE_GATE: none
- Remaining risk: 壳窗口未在本任务做人眼确认
- Next: P0-006

### P1-001

- Status: done
- Files changed: `services/workspaceDocumentProtocol.ts`，`tests/workspaceDocumentProtocol.test.ts`
- Commands run: `npx vitest run tests/workspaceDocumentProtocol.test.ts`
- Result: pass
- LIVE_GATE: none
- Remaining risk: none
- Next: P1-002

### P1-002

- Status: done
- Files changed: `services/agentWorkbenchBridge.ts`，`App.tsx`，`components/WorkflowSection.tsx`，`tests/agentWorkbenchBridge.test.ts`
- Commands run: `npx vitest run tests/agentWorkbenchBridge.test.ts tests/workspaceDocumentProtocol.test.ts`
- Result: pass
- LIVE_GATE: none
- Remaining risk: none
- Next: P1-003

### P1-003

- Status: done
- Files changed: `services/workspaceDocumentProtocol.ts`，`companion-desktop/agent-workbench-client.cjs`，`tests/agentWorkbenchClient.test.ts`
- Commands run: `npx vitest run tests/workspaceDocumentProtocol.test.ts tests/agentWorkbenchBridge.test.ts`；`node --check companion-desktop/main.cjs`
- Result: pass（format 含 selectedAssetId）
- LIVE_GATE: none
- Remaining risk: none
- Next: P1-004

### P1-004

- Status: done
- Files changed: `companion-desktop/dsh-context-inject.cjs`，`companion-desktop/main.cjs`，`tests/dshContextInject.test.ts`
- Commands run: `npx vitest run tests/dshContextInject.test.ts tests/workspaceDocumentProtocol.test.ts`；`node --check companion-desktop/dsh-context-inject.cjs`
- Result: pass（patch/plugin 含 assetId）
- LIVE_GATE: none
- Remaining risk: 已在跑的 dsh reuse 进程不会立刻吃到新 `--patch`，需重启壳
- Next: P1-005

### P1-005

- Status: done
- Files changed: `services/agentWorkbenchBridge.ts`，`App.tsx`，`companion-desktop/dsh-workspace-tool.cjs`，`tests/agentWorkbenchBridge.test.ts`
- Commands run: `npx vitest run tests/agentWorkbenchBridge.test.ts tests/workspaceDocumentProtocol.test.ts`
- Result: pass（空画布新建文本卡；选中卡追加 textResults）
- LIVE_GATE: none
- Remaining risk: none
- Next: P2-001

### P2-001

- Status: done
- Files changed: `services/workspaceFingerHosts.ts`，`companion-desktop/workspace-finger-hosts.cjs`，`App.tsx`，`tests/workspaceFingerHosts.test.ts`
- Commands run: `npx vitest run tests/workspaceFingerHosts.test.ts tests/workspaceDocumentProtocol.test.ts`
- Result: pass
- LIVE_GATE: none
- Remaining risk: 工作台须有人把连接草稿 publish 进来，否则 hosts 仍为 []
- Next: P2-002

### P2-002

- Status: done
- Files changed: `services/workspaceDocumentProtocol.ts`，`tests/workspaceDocumentProtocol.test.ts`
- Commands run: `npx vitest run tests/workspaceDocumentProtocol.test.ts tests/dshContextInject.test.ts`
- Result: pass（空=未连接；非空含 title）
- LIVE_GATE: none
- Remaining risk: none
- Next: P3-001

### P3-001

- Status: done
- Files changed: `companion-desktop/shell/index.html`，`companion-desktop/agent-store.cjs`，`tests/copilotSettingsUi.test.ts`
- Commands run: `npx vitest run tests/copilotSettingsUi.test.ts`；`node --check companion-desktop/main.cjs`
- Result: pass（默认不挂 `copilot-panel.js`；设置「调试旧 Copilot」默认关）
- LIVE_GATE: none
- Remaining risk: none
- Next: P4-001

### P4-001

- Status: done
- Files changed: `companion-desktop/dsh-module-entries.cjs`，`docs/dsh本地壳-可执行开发计划.md` §16，`tests/dshWorkspaceTool.test.ts`
- Commands run: `node --check companion-desktop/main.cjs`；`npx vitest run tests/dshWorkspaceTool.test.ts`
- Result: pass（canvas/connections/tools 与 `data-view` 字面量一致；workbench 仍两块 view）
- LIVE_GATE: none
- Remaining risk: none
- Next: P5-001

### P5-001

- Status: done
- Files changed: `services/workspaceDocumentProtocol.ts`，`tests/workspaceDocumentProtocol.test.ts`
- Commands run: `npx vitest run tests/workspaceDocumentProtocol.test.ts`
- Result: pass
- LIVE_GATE: none
- Remaining risk: none
- Next: P5-002

### P5-002

- Status: done
- Files changed: `companion-desktop/workspace-document-store.cjs`，`tests/workspaceDocumentStore.test.ts`
- Commands run: `npx vitest run tests/workspaceDocumentStore.test.ts tests/workspaceDocumentProtocol.test.ts`；`node --check companion-desktop/workspace-document-store.cjs`
- Result: pass
- LIVE_GATE: none
- Remaining risk: none
- Next: P5-003

### P5-003

- Status: done
- Files changed: `companion-desktop/dsh-workspace-tool.cjs`，`tests/workspaceDocumentStore.test.ts`
- Commands run: `npx vitest run tests/workspaceDocumentStore.test.ts tests/agentWorkbenchBridge.test.ts`
- Result: pass（`writeMode=dual` 可桥接；默认 document）
- LIVE_GATE: none
- Remaining risk: none
- Next: P5-004

### P5-004

- Status: done
- Files changed: `companion-desktop/preload-workbench.cjs`，`App.tsx`，`services/workspaceAssetUpsertMerge.ts`，`tests/workspaceAssetUpsertMerge.test.ts`
- Commands run: `npx vitest run tests/workspaceAssetUpsertMerge.test.ts tests/workspaceDocumentProtocol.test.ts`
- Result: pass
- LIVE_GATE: none
- Remaining risk: none
- Next: P5-005

### P5-005

- Status: done
- Files changed: `companion-desktop/dsh-workspace-tool.cjs`，`companion-desktop/main.cjs`
- Commands run: `npx vitest run tests/workspaceDocumentStore.test.ts tests/workspaceAssetUpsertMerge.test.ts`
- Result: pass
- Evidence: `append_text_result` 成功路径默认 `store.dispatch`，源码无 `executeJavaScript` 作为该命令唯一写入
- LIVE_GATE: none
- Remaining risk: 无壳时 App 仍保留 bridge `appendTextResult`
- Next: P6-001

### P6-001

- Status: done
- Files changed: `services/workspaceDocumentProtocol.ts`，`tests/workspaceDocumentProtocol.test.ts`
- Commands run: `npx vitest run tests/workspaceDocumentProtocol.test.ts tests/agentWorkbenchBridge.test.ts tests/workspaceAssetUpsertMerge.test.ts`
- Result: pass（ingest fixture → assetId；事件不含 data URL）
- LIVE_GATE: none
- Remaining risk: none
- Next: P6-002

### P6-002

- Status: done
- Files changed: `services/agentWorkbenchBridge.ts`，`tests/agentWorkbenchBridge.test.ts`
- Commands run: `npx vitest run tests/agentWorkbenchBridge.test.ts tests/workspaceDocumentProtocol.test.ts`
- Result: pass（mock 成功换 displayKey；缺密钥失败且不空白成功）
- LIVE_GATE: none
- Remaining risk: none
- Next: P7-001

### P7-001

- Status: done
- Files changed: `companion-desktop/dsh-workspace-tool.cjs`，`companion-desktop/dsh-context-inject.cjs`，`tests/dshWorkspaceTool.test.ts`
- Commands run: `npx vitest run tests/dshWorkspaceTool.test.ts tests/workspaceDocumentProtocol.test.ts`
- Result: pass（非法命令被拒；仅三个文档级工具）
- LIVE_GATE: none
- Remaining risk: 插件经 `127.0.0.1:3081` 打文档 HTTP；dsh 官方 defineTool 参数形状若与 execute(args) 不一致需再对齐
- Next: P7-002

### P7-002

- Status: done
- Files changed: `companion-desktop/dsh-module-entries.cjs`，`companion-desktop/main.cjs`，`tests/dshWorkspaceTool.test.ts`
- Commands run: `npx vitest run tests/dshWorkspaceTool.test.ts`；`node --check companion-desktop/main.cjs`
- Result: pass
- LIVE_GATE: none
- Remaining risk: none
- Next: P7-003

### P7-003

- Status: done
- Files changed: `services/workspaceDocumentProtocol.ts`，`companion-desktop/dsh-workspace-tool.cjs`，`tests/dshWorkspaceTool.test.ts`
- Commands run: `npx vitest run tests/workspaceDocumentProtocol.test.ts tests/dshWorkspaceTool.test.ts`
- Result: pass（未连接文案含没连；已连接 mock 旧接头一次）
- LIVE_GATE: none
- Remaining risk: `live_host_unverified`
- Next: P8-001

### P8-001

- Status: done
- Files changed: 本文件 §13
- Commands run: `node -v` → v22.20.0
- Result: pass
- LIVE_GATE: none
- Remaining risk: `live_model_unverified`（无 DEEPSEEK_API_KEY / DSH_API_KEY）
- Next: P8-002

### P8-002

- Status: done
- Files changed: `companion-desktop/main.cjs`，`companion-desktop/dsh-workbench-views.cjs`，`tests/dshPartitionGuard.test.ts`
- Commands run: `npx vitest run tests/dshPartitionGuard.test.ts`
- Result: pass
- LIVE_GATE: none
- Remaining risk: none
- Next: P8-003

### P8-003

- Status: done
- Files changed: 本文件 §16
- Commands run: 入口表三行与 `companion-desktop/dsh-module-entries.cjs` / `index.html` `data-view` 字面量一致
- Result: pass
- LIVE_GATE: none
- Remaining risk: none
- Next:

## 16. 模块入口表

| surface | shellView | 源码字面量 |
|---|---|---|
| canvas | workbench | `DSH_MODULE_ENTRIES.canvas.shellView = 'workbench'`；HTML `data-view="workbench"` |
| connections | connections | `DSH_MODULE_ENTRIES.connections.shellView = 'connections'`；HTML `data-view="connections"` |
| tools | tools | `DSH_MODULE_ENTRIES.tools.shellView = 'tools'`；HTML `data-view="tools"` |

## 15. 计划修订记录

- 2026-08-24：计划修订 — 增加 §1.1 完成后水位。P4 只等于第一段（真 dsh 并排 + 手指注入 + 一条文本写回 + 打开旧模块页），不宣称同源终局或工作流已长在 dsh 上。
- 2026-08-24：补全第二段 P5–P8：壳内文档 store、网页订阅、脱离必经 bridge、ingest 一图、generate_on_current、文档级 dsh 工具、send_to_current_host、密钥/partition。下一执行任务仍是 P0-002。
- 2026-08-24：去人手门 — 默认无 HAND_GATE；原「看一眼壳」全部改成 HTTP/单测/源码断言（§5.2）。同一会话连续推进到 P8 done / blocked / LIVE_GATE。取消每会话 3 条上限。P8-001 无密钥记 `live_model_unverified` 继续。
- 2026-08-24：执行推进 — P0 全部完成 + P1-001。钉死 `@deepseek-ai/dsh@0.1.1-rc.2`；工作台+dsh 双 BrowserView；下一任务 P1-002（getContext 手指）。注入：`--patch` 本地插件 + `systemPrompt.context` / `tools.register`。
- 2026-08-24：执行完成 — P1-002 至 P8-003 全部 done。文档 store + 网页订阅；dsh 三个文档级工具；默认藏旧 Copilot；无密钥 `live_model_unverified`；Maya 真机 `live_host_unverified`。
