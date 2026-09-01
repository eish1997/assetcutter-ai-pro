# 宿主中心 Copilot 添加宿主改造执行文档

状态：执行中  
目标：让任何用户都能通过对话添加一个真实可连通的宿主，并经过本地验收、管理员提交云端、团队同步使用、云端历史版本切换的完整闭环。

## 1. 最终目标

用户只需要对 Copilot 说：

> 添加 Spine 宿主

系统应自动完成：

1. 识别宿主名称、分类、可能的脚本能力、默认端口和目录规则。
2. 创建本地宿主草稿卡片。
3. 在宿主中心显示该宿主，并支持搜索、一级分类筛选、软件名标签筛选。
4. 用户选择本机版本目录后，一键安装真实桥接脚本或插件。
5. 用户可以从宿主中心或 Copilot 直接启动、关闭对应宿主软件；启动路径必须来自已知宿主可执行程序、已保存手动目录或用户明确提供的 exe 路径，关闭只能使用宿主白名单进程名。
6. 通过真实探测确认连通状态，不能用“卡片存在”或“文件存在”冒充连接成功。
7. 管理员验收后提交云端，云端保存历史版本。
8. 团队成员同步云端宿主后直接使用。
9. 管理员只能在云端已有版本之间切换，不能把本地开发草稿历史混进云端版本列表。

明确不做：

1. 不做 planned、placeholder、只展示不可连通的假宿主。
2. 不要求用户选择技术模板。
3. 不让 Copilot 绕过本地校验、路径安全和管理员权限。
4. 不把本地频繁试错自动变成云端历史版本。

## 2. 改造原则

1. 真实连通优先。  
   宿主连接状态必须来自 HTTP health、heartbeat、命令端口、宿主插件回调等真实信号。

2. 对话简单，内部复杂。  
   用户只说软件名；模板、目录规则、探测方式由系统内部推断。

3. 本地草稿和云端版本隔离。  
   本地可以反复开发；只有管理员主动提交后才形成云端版本。

4. 所有写入有边界。  
   桥接脚本、插件、配置只允许写入用户明确选择并通过校验的目录、宿主官方用户脚本目录、项目插件目录或 companion sandbox。

5. 每一步都可验证。  
   每个阶段必须有自动测试、运行时检查和人工验收标准。

## 3. 总体阶段

| 阶段 | 名称 | 目标 | 完成状态 |
| --- | --- | --- | --- |
| 1 | 统一现有宿主体验 | 60 多个宿主卡片、按钮、筛选、手动目录、错误提示一致 | 已落地，需持续回归 |
| 2 | 抽出宿主定义 | 用结构化 definition 驱动宿主能力 | 已建立基础层 |
| 3 | 建立桥接模板 | 复用 Python、Lua、ExtendScript 等真实桥接模板 | 已建立基础层 |
| 4 | Copilot 创建本地草稿 | 对话创建、校验、安装、探测、卸载本地宿主草稿 | 已打通基础闭环 |
| 5 | 云端提交与版本分发 | 管理员提交云端、历史版本、团队同步、云端版本切换 | 已打通基础闭环 |
| 6 | 扩展宿主真实连通率 | 把更多宿主迁入 definition + template，补专用探测 | 持续推进 |

## 4. 阶段一：统一现有宿主体验

### 4.1 目标

宿主中心里的所有宿主都应像 Maya 一样是真实可连通的入口，而不是展示卡片。

每张宿主卡片必须具备：

1. 中文名称、中文描述、中文按钮。
2. 状态标签：可安装、已安装、已连接、未连接、云端、本地草稿等。
3. 操作按钮：手动添加版本、一键安装、探测连接、卸载。
4. 进程按钮：启动宿主、关闭宿主；找不到可执行程序时提示用户补充安装目录或 exe 路径，关闭前必须提示未保存内容风险。
5. 错误提示：路径错误、权限错误、端口占用、探测超时等必须是用户能理解的中文。
6. 手动添加版本后刷新仍可见。

### 4.2 修改位置

1. `companion-desktop/shell/tools-bridges.js`
2. `companion-desktop/shell/index.html`
3. `local-companion/src/httpHandler.ts`
4. `local-companion/src/bridges/customHostTargets.ts`
5. `local-companion/src/bridges/*BridgeInstall.ts`
6. `tests/shellHostCenterUi.test.ts`
7. `tests/hostBridgeInstallers.test.ts`
8. `tests/hostBridgeCatalogConsistency.test.ts`

### 4.3 可执行任务

1. 统一宿主卡片按钮文案。
   - 执行：检查 `tools-bridges.js` 内所有按钮渲染分支。
   - 验证：运行 UI 静态测试，确认中文按钮存在。
   - 完成：所有卡片不再出现英文 `Install`、`Probe`、`Uninstall` 等主按钮。

2. 统一手动目录持久化。
   - 执行：通过 `customHostTargets.ts` 读写 `bridges/custom-host-targets.json`。
   - 验证：添加目录、刷新宿主中心、目录仍可被读取。
   - 完成：同一宿主可保存多个手动版本，不覆盖其他宿主。

3. 统一路径纠错。
   - 执行：安装目录、软件根目录、用户脚本目录、项目目录分别归一到可写目标。
   - 验证：选择 `C:\Program Files` 类目录时，不应直接暴露系统权限错误。
   - 完成：典型错误都有中文原因和下一步建议。

4. 去除 planned 宿主。
   - 执行：`/v1/bridges` 只返回可执行宿主。
   - 验证：运行运行时检查，`plannedCount` 必须为 0。
   - 完成：所有宿主 `status` 为 ready，`installMode` 为 one_click 或明确可执行模式。

5. 增加宿主启动和关闭能力。
   - 执行：新增 `/v1/bridges/:id/launch` 和 `/v1/bridges/:id/close`，启动只接受宿主白名单 exe，关闭只按宿主白名单进程名执行。
   - 验证：运行 host app process 测试，确认能解析已知 exe，未知宿主不能启动；宿主中心存在“启动宿主 / 关闭宿主”按钮；Copilot 工具目录存在 `launch_host` 和 `close_host`。
   - 完成：用户可以在宿主中心或通过 Copilot 请求启动/关闭已支持宿主；找不到软件时显示中文纠错提示，不执行任意命令或任意进程关闭。

### 4.4 自动验证

```powershell
npm run local-companion:typecheck
node --check companion-desktop/shell/tools-bridges.js
npx vitest run tests/hostBridgeInstallers.test.ts tests/shellHostCenterUi.test.ts tests/hostBridgeCatalogConsistency.test.ts
npx vitest run tests/hostAppProcess.test.ts tests/agentToolSchema.test.ts
```

### 4.5 人工验收

1. 打开宿主中心。
2. 搜索 Blender。
3. 点击手动添加版本。
4. 选择 Blender 安装根目录。
5. 预期系统归一到用户脚本目录，不直接失败。
6. 点击一键安装。
7. 重启 Blender。
8. 点击探测连接。
9. 预期连接成功，或显示明确中文失败原因。

### 4.6 完成判定

1. `/v1/bridges` 中宿主数量稳定。
2. `plannedCount = 0`。
3. 所有宿主主按钮为中文。
4. 宿主启动/关闭 API、Copilot 工具和宿主中心按钮均可验证。
5. 自动测试通过。
6. 至少人工验收 Blender、Adobe、Unity、Unreal、Nuke 五类宿主。

## 5. 阶段二：抽出宿主定义

### 5.1 目标

把宿主的名称、分类、目录规则、安装模板、探测方式、卸载规则抽成统一 definition，减少后续 60 多个宿主各写一套逻辑。

### 5.2 修改位置

1. `local-companion/src/bridges/definitions/hostBridgeDefinitions.ts`
2. `local-companion/src/bridges/mayaBridgeInstall.ts`
3. `tests/hostBridgeCatalogConsistency.test.ts`
4. `tests/hostBridgeInstallers.test.ts`

### 5.3 可执行任务

1. 定义 `HostBridgeDefinition`。
   - 必须包含：id、name、category、defaultPort、connectorLabel、detection、manualTarget、bridgeTemplate、probe、uninstall、ui。
   - 验证：typecheck 通过。
   - 完成：definition 可以表达一个宿主完整桥接能力。

2. 先迁移样板宿主。
   - Blender 使用 `python_http_startup`。
   - Cinema 4D、Houdini、Nuke、MotionBuilder、KeyShot、Modo、LightWave 使用 `python_http_startup`。
   - Fusion 360、FreeCAD 使用 `project_plugin`。
   - Photoshop、Illustrator、After Effects、Premiere Pro、InDesign、Audition、Media Encoder、Animate、Adobe Bridge 使用 `extendscript_heartbeat`。
   - darktable、Lightroom Classic、OBS Studio、REAPER 使用 `lua_heartbeat`。
   - Unity、Godot、Unreal 使用 `project_plugin`。
   - ZBrush、3DEqualizer、Katana、AutoCAD 使用 `manual_script_dir`。
   - 验证：样板宿主在宿主中心显示、安装、探测、卸载不回退。
   - 完成：catalog 数量不因迁移减少。

3. 将 definition 合并到 `/v1/bridges` 输出。
   - 执行：`listBridgesCatalog()` 读取 definition，并保留旧宿主行为。
   - 验证：catalog consistency 测试通过。
   - 完成：definition 只增强输出，不破坏已有宿主。

### 5.4 自动验证

```powershell
npm run local-companion:typecheck
npx vitest run tests/hostBridgeCatalogConsistency.test.ts tests/hostBridgeInstallers.test.ts
```

### 5.5 完成判定

1. definition id 唯一。
2. category 合法。
3. 每个 definition 都有 manualTarget、probe、uninstall。
4. Blender、Cinema 4D、Houdini、Nuke、MotionBuilder、KeyShot、Modo、LightWave、Fusion 360、FreeCAD、Photoshop、Illustrator、After Effects、Premiere Pro、InDesign、Audition、Media Encoder、Animate、Adobe Bridge、darktable、Lightroom Classic、OBS Studio、REAPER、Unity、Godot、Unreal、ZBrush、3DEqualizer、Katana、AutoCAD 行为无回退。
5. `/v1/bridges` 宿主数量稳定。

## 6. 阶段三：建立桥接模板

### 6.1 目标

Copilot 不直接手写每个宿主的安装器，而是根据宿主能力自动选择内部模板。

### 6.2 第一批模板

| 模板 | 适用宿主 |
| --- | --- |
| `python_http_startup` | Blender、Nuke、Houdini、Modo、KeyShot |
| `lua_heartbeat` | Aseprite、OBS、REAPER、darktable |
| `extendscript_heartbeat` | Photoshop、Illustrator、After Effects、Premiere、InDesign |
| `project_plugin` | Unity、Unreal、Godot |
| `manual_script_dir` | ZBrush、Fusion Studio、3DEqualizer |

第一阶段必须实现前三个模板；后两个可以作为后续扩展，但不能被草稿创建静默使用，未实现时必须明确拒绝。

### 6.3 修改位置

1. `local-companion/src/bridges/templates/hostBridgeTemplates.ts`
2. `local-companion/src/bridges/definitions/hostBridgeDefinitions.ts`
3. `tests/hostBridgeTemplates.test.ts`
4. `tests/hostBridgeInstallers.test.ts`

### 6.4 可执行任务

1. 定义 `BridgeTemplate`。
   - 必须包含：generateInstallFiles、probe、uninstall。
   - 验证：模板单元测试通过。
   - 完成：模板能独立生成文件、探测、卸载。

2. 实现 `python_http_startup`。
   - 执行：生成宿主启动脚本，启动本地 HTTP health。
   - 验证：安装后探测 HTTP health。
   - 完成：成功探测必须来自真实 HTTP 响应。

3. 实现 `lua_heartbeat`。
   - 执行：生成 Lua 脚本，由宿主运行后写入 heartbeat。
   - 验证：heartbeat 必须新鲜，并包含宿主 id。
   - 完成：过期 heartbeat 不算连接成功。

4. 实现 `extendscript_heartbeat`。
   - 执行：生成 JSX 启动脚本或可被宿主加载的 ExtendScript。
   - 验证：heartbeat 内容与时间都通过。
   - 完成：只存在 JSX 文件不算连接成功。

5. 增加路径安全。
   - 执行：模板输出路径必须限制在目标目录内。
   - 验证：构造 `../` 路径时测试必须失败。
   - 完成：模板不能越界写文件或删除文件。

### 6.5 自动验证

```powershell
npm run local-companion:typecheck
npx vitest run tests/hostBridgeTemplates.test.ts tests/hostBridgeInstallers.test.ts
```

### 6.6 完成判定

1. 三个基础模板已注册。
2. heartbeat 探测必须校验新鲜度、内容和宿主 id。
3. 模板卸载只删除自己生成的文件。
4. 未实现模板会明确失败，不产生假宿主。

## 7. 阶段四：Copilot 创建本地宿主草稿

### 7.1 目标

用户通过对话创建宿主，不需要理解模板、端口、脚本目录。Copilot 只创建本地草稿，不直接提交云端。

### 7.2 修改位置

1. `local-companion/src/bridges/hostBridgeDrafts.ts`
2. `local-companion/src/httpHandler.ts`
3. `companion-desktop/agent-tool-schemas.cjs`
4. `companion-desktop/agent-body-host.cjs`
5. `companion-desktop/shell/tools-bridges.js`
6. `tests/hostBridgeDrafts.test.ts`
7. `tests/agentToolSchema.test.ts`
8. `tests/shellHostCenterUi.test.ts`

### 7.3 用户流程

1. 用户说：添加 Spine 宿主。
2. Copilot 调用创建草稿工具。
3. 宿主中心出现 Spine 卡片。
4. 卡片显示本地草稿、待验收。
5. 用户手动添加版本目录。
6. 用户一键安装。
7. 用户打开或重启宿主。
8. 用户点击探测连接。
9. 探测成功后，草稿变为已校验。
10. 管理员才可以提交云端。

### 7.4 本地 API

1. `GET /v1/bridges/drafts`
2. `POST /v1/bridges/drafts`
3. `POST /v1/bridges/drafts/:id/validate`
4. `DELETE /v1/bridges/drafts/:id`
5. `GET /v1/bridges/:id`
6. `POST /v1/bridges/:id/install`
7. `POST /v1/bridges/:id/probe`
8. `POST /v1/bridges/:id/uninstall`

### 7.5 Copilot 工具

1. `ac.companion.host_bridge.create_draft`
2. `ac.companion.host_bridge.validate_draft`
3. `ac.companion.host_bridge.install`
4. `ac.companion.host_bridge.probe`
5. `ac.companion.host_bridge.uninstall`
6. `ac.companion.host_bridge.delete_draft`

### 7.6 可执行任务

1. 创建草稿存储。
   - 执行：草稿写入 `bridges/host-drafts/*.json`。
   - 验证：创建后刷新仍存在。
   - 完成：删除草稿后不再出现在 `/v1/bridges`。

2. 实现自动推断。
   - 执行：用户只传 name 时，系统自动推断 id、category、defaultPort、templateId、manualTarget、probe、uninstall。
   - 验证：只传 `Spine` 能生成合法草稿。
   - 完成：用户不需要选择模板。

3. 实现草稿校验。
   - 执行：校验 id、category、port、template、entryFile、manualTarget、probe、uninstall。
   - 验证：重复内置 id、未知模板、危险路径会失败。
   - 完成：坏草稿不会进入可提交状态。

4. 合并草稿到宿主中心。
   - 执行：`/v1/bridges` 合并内置宿主、本地草稿、云端宿主。
   - 验证：草稿不覆盖同 id 内置宿主。
   - 完成：本地草稿可搜索、可筛选、可安装、可探测、可删除。

5. 补齐 Copilot 执行工具。
   - 执行：schema 与执行层都支持 create、validate、install、probe、uninstall、delete。
   - 验证：`tests/agentToolSchema.test.ts` 通过。
   - 完成：Copilot 可以从对话完成本地草稿闭环。

### 7.7 自动验证

```powershell
npm run local-companion:typecheck
node --check companion-desktop/agent-tool-schemas.cjs
node --check companion-desktop/agent-body-host.cjs
node --check companion-desktop/shell/tools-bridges.js
npx vitest run tests/agentToolSchema.test.ts tests/hostBridgeDrafts.test.ts tests/hostBridgeCatalogConsistency.test.ts tests/shellHostCenterUi.test.ts
```

### 7.8 人工验收

1. 在 Copilot 输入：添加 Spine 宿主。
2. 宿主中心出现 Spine。
3. Spine 卡片显示本地草稿、待验收。
4. 点击手动添加版本。
5. 选择测试目录。
6. 点击一键安装。
7. 点击探测连接。
8. 未打开宿主时，应显示明确失败原因。
9. 打开宿主并产生真实信号后，探测成功。
10. 点击卸载，只删除本工具生成内容。
11. 点击删除草稿，刷新后卡片消失。

### 7.9 完成判定

1. 用户不需要选择模板。
2. Copilot 能创建本地草稿。
3. 草稿能安装、探测、卸载、删除。
4. 探测成功来自真实信号。
5. 草稿不能覆盖内置宿主。
6. 自动测试通过。

## 8. 阶段五：云端提交、版本与团队分发

### 8.1 目标

管理员把已验收的本地宿主提交云端，云端保存历史版本。团队成员同步后可使用云端正式版本。版本切换只在云端已有版本之间进行。

### 8.2 修改位置

1. `local-companion/src/bridges/hostBridgeCloud.ts`
2. `server/host-bridges-store.js`
3. `server/auth-api.js`
4. `server/admin-matrix.js`
5. `companion-desktop/main.cjs`
6. `companion-desktop/preload-shell.cjs`
7. `companion-desktop/shell/tools-bridges.js`
8. `tests/hostBridgeDrafts.test.ts`
9. `tests/hostBridgeServerStore.test.ts`
10. `tests/hostBridgeCloudSyncUi.test.ts`
11. `tests/shellHostCenterUi.test.ts`

### 8.3 云端 API

1. `GET /api/host-bridges`
2. `GET /api/host-bridges/:id/versions`
3. `POST /api/admin/host-bridges/:id/versions`
4. `POST /api/admin/host-bridges/:id/versions/:versionId/activate`

### 8.4 本地云端缓存

1. 云端版本同步到 `bridges/host-cloud-versions.json`。
2. 本地 catalog 合并顺序：
   - 内置宿主优先。
   - 本地草稿其次。
   - 云端版本最后补充。
3. 本地草稿优先于同 id 云端宿主，避免开发中的草稿被云端覆盖。
4. 云端宿主不能覆盖内置稳定宿主。

### 8.5 管理员提交门槛

提交云端前必须满足：

1. 当前登录用户是管理员。
2. 草稿 schema 校验通过。
3. 已安装目标存在。
4. 版本说明非空。
5. 最近一次真实探测成功。
6. 模板属于已注册模板。
7. 写入路径规则安全。

### 8.6 可执行任务

1. 实现云端版本存储。
   - 执行：服务端保存每个宿主的 versions 和 activeVersionId。
   - 验证：发布两个版本后都能列出。
   - 完成：激活版本不会删除历史版本。

2. 实现管理员提交。
   - 执行：管理员卡片显示提交云端。
   - 验证：普通用户不可提交，管理员可提交。
   - 完成：提交失败时显示中文原因。

3. 实现云端同步。
   - 执行：桌面壳刷新宿主中心前同步云端宿主。
   - 验证：清空本地草稿后，云端宿主仍可出现。
   - 完成：团队成员无需本地草稿即可使用云端宿主。

4. 实现版本选择。
   - 执行：管理员点击选择版本后，读取云端已有版本并激活目标版本。
   - 验证：点击按钮有响应，只能选择云端版本。
   - 完成：切换版本不新增本地草稿历史。

5. 实现审计。
   - 执行：发布和激活版本写入 admin audit。
   - 验证：后台审计列表出现 host bridge publish / activate。
   - 完成：每次云端变更可追溯到用户和时间。

### 8.7 自动验证

```powershell
npm run local-companion:typecheck
node --check companion-desktop/main.cjs
node --check companion-desktop/preload-shell.cjs
node --check companion-desktop/shell/tools-bridges.js
node --check server/auth-api.js
node --check server/host-bridges-store.js
npx vitest run tests/hostBridgeDrafts.test.ts tests/hostBridgeServerStore.test.ts tests/hostBridgeCloudSyncUi.test.ts tests/shellHostCenterUi.test.ts tests/shellToolCloudPublishUi.test.ts tests/adminMatrix.test.ts
```

### 8.8 人工验收

1. 管理员创建一个本地草稿宿主。
2. 手动添加版本目录。
3. 一键安装。
4. 打开宿主并探测成功。
5. 点击提交云端。
6. 输入版本说明。
7. 提交成功后卡片显示云端版本信息。
8. 创建第二个版本并提交。
9. 点击选择版本。
10. 切换回第一个云端版本。
11. 刷新宿主中心。
12. 预期当前云端版本变为第一个版本，本地草稿列表不增加多余历史。
13. 使用普通账号刷新宿主中心。
14. 预期能看到云端宿主，但不能看到提交按钮。

### 8.9 完成判定

1. 管理员可提交云端。
2. 普通用户不能提交云端。
3. 云端保存历史版本。
4. 版本选择按钮有响应。
5. 只能切换云端已有版本。
6. 团队成员同步后可使用云端宿主。
7. 提交和切换有审计记录。
8. 自动测试通过。

## 9. 阶段六：扩展更多宿主真实连通率

### 9.1 目标

当前宿主中心已经有 60 多个宿主，最终应统一改成 definition + template + 真实 probe 的结构。不能为了数量牺牲连通真实性。

### 9.2 执行顺序

1. 优先迁移使用相同能力模型的宿主。
   - Python startup 类。
   - Lua heartbeat 类。
   - ExtendScript heartbeat 类。

2. 再迁移项目插件类宿主。
   - Unity。
   - Unreal。
   - Godot。

3. 最后处理特殊宿主。
   - ZBrush。
   - Fusion Studio。
   - 3DEqualizer。
   - 其他需要专用脚本或命令通道的软件。

### 9.3 每个宿主迁移步骤

1. 新增或补齐 definition。
2. 选择内部模板。
3. 补齐手动目录规则。
4. 补齐安装文件生成。
5. 补齐真实 probe。
6. 补齐卸载记录。
7. 增加至少一个自动测试。
8. 在宿主中心人工验收。

### 9.4 单宿主完成判定

1. 卡片可搜索、可筛选。
2. 能手动添加版本目录。
3. 能一键安装。
4. 能真实探测。
5. 能安全卸载。
6. 错误提示为中文。
7. 不依赖 placeholder 状态。

## 10. 全链路验收清单

全部完成时必须逐项满足：

1. 用户说“添加某宿主”，Copilot 能创建本地宿主草稿。
2. 用户不需要选择技术模板。
3. 宿主中心能显示、搜索、筛选该宿主。
4. 草稿卡片显示本地草稿和验收状态。
5. 手动添加版本能纠正常见错误目录。
6. 一键安装会真实写入桥接文件或插件。
7. 探测连接来自真实宿主运行结果。
8. 卸载只移除自己写入的内容。
9. 管理员可提交云端。
10. 云端保存历史版本。
11. 普通用户同步后可直接使用。
12. 选择版本只切换云端已有版本。
13. 内置宿主、云端宿主、本地草稿互不污染。
14. 自动测试覆盖关键路径。

## 11. 每次提交前验证命令

最小验证：

```powershell
npm run local-companion:typecheck
node --check companion-desktop/shell/tools-bridges.js
npx vitest run tests/hostBridgeCatalogConsistency.test.ts tests/shellHostCenterUi.test.ts
```

涉及 Copilot 工具时追加：

```powershell
node --check companion-desktop/agent-tool-schemas.cjs
node --check companion-desktop/agent-body-host.cjs
npx vitest run tests/agentToolSchema.test.ts tests/hostBridgeDrafts.test.ts
```

涉及模板或安装器时追加：

```powershell
npx vitest run tests/hostBridgeInstallers.test.ts tests/hostBridgeTemplates.test.ts
```

涉及云端提交时追加：

```powershell
node --check server/auth-api.js
node --check server/host-bridges-store.js
npx vitest run tests/hostBridgeServerStore.test.ts tests/hostBridgeCloudSyncUi.test.ts tests/shellToolCloudPublishUi.test.ts tests/adminMatrix.test.ts
```

完整回归：

```powershell
npm run local-companion:typecheck
node --check companion-desktop/main.cjs
node --check companion-desktop/preload-shell.cjs
node --check companion-desktop/shell/tools-bridges.js
node --check companion-desktop/agent-tool-schemas.cjs
node --check companion-desktop/agent-body-host.cjs
node --check server/auth-api.js
node --check server/host-bridges-store.js
npx vitest run tests/agentToolSchema.test.ts tests/hostBridgeDrafts.test.ts tests/hostBridgeCatalogConsistency.test.ts tests/hostBridgeInstallers.test.ts tests/hostBridgeTemplates.test.ts tests/hostBridgeServerStore.test.ts tests/hostBridgeCloudSyncUi.test.ts tests/shellHostCenterUi.test.ts tests/shellToolCloudPublishUi.test.ts tests/adminMatrix.test.ts
```

运行时检查：

```powershell
$pairPath = Join-Path $env:LOCALAPPDATA 'AssetCutterCompanion\sandbox\desktop-shell\pairing-config.json'
if (!(Test-Path $pairPath)) { $pairPath = Join-Path $env:LOCALAPPDATA 'AssetCutterCompanion\desktop-shell\pairing-config.json' }
$pair = Get-Content -Path $pairPath -Raw | ConvertFrom-Json
$headers = @{ Authorization = 'Bearer ' + $pair.sharedToken }
$r = Invoke-RestMethod -Uri 'http://127.0.0.1:18765/v1/bridges' -Headers $headers
[pscustomobject]@{
  bridgeCount = $r.bridges.Count
  readyCount = @($r.bridges | Where-Object { $_.status -eq 'ready' }).Count
  oneClickCount = @($r.bridges | Where-Object { $_.installMode -eq 'one_click' }).Count
  plannedCount = @($r.bridges | Where-Object { $_.status -eq 'planned' -or $_.installMode -eq 'planned' }).Count
  draftCount = @($r.bridges | Where-Object { $_.source -eq 'draft' }).Count
  cloudCount = @($r.bridges | Where-Object { $_.source -eq 'cloud' }).Count
  hasAcceptance = $null -ne $r.acceptance
} | Format-List
```

## 12. 当前已落地证据

1. 宿主中心已有一级分类筛选、软件名标签筛选、搜索框。
2. 宿主卡片主操作已中文化。
3. 已建立手动宿主版本目录持久化。
4. 已建立 definition 基础层，当前 62 个宿主已全部进入结构化 definition。
5. 已建立 Python、Lua、ExtendScript、项目插件、手动脚本目录五类模板基础层。
6. 已建立本地草稿存储、校验、安装、探测、卸载 API。
7. 已建立 Copilot 创建、校验、安装、探测、卸载、删除草稿工具。
8. 已建立云端版本缓存、发布、同步、激活基础链路。
9. 已建立服务端宿主版本 API 和管理员审计动作。
10. 已有测试覆盖草稿、模板、云端同步、服务端存储、宿主中心 UI、Copilot 工具 schema。
11. 已建立宿主真实软件验收记录和七类门禁摘要：`/v1/bridges` 返回 `acceptanceSummary`，覆盖 Maya、Adobe、Python DCC、Lua/heartbeat、项目插件、手动脚本目录、成对软件。

## 13. 剩余风险

1. 真实宿主人工验收仍需覆盖更多软件。自动测试能保证协议和文件逻辑，但不能替代真实软件启动验证。
2. `project_plugin` 和 `manual_script_dir` 已具备基础模板能力，但 Unity、Unreal、Godot、ZBrush、Fusion Studio、3DEqualizer 等真实宿主仍应继续补专用目录纠错和宿主内启动方式说明。
3. 云端版本选择当前优先保证功能正确，后续可替换为更符合产品风格的弹窗。
4. 服务端宿主版本存储当前是本地 JSON 基础实现；生产环境如需更强持久性，应接入正式数据库或现有云存储。

## 14. 推荐推进顺序

1. 先锁定当前 62 个宿主全部 ready、one_click、无 planned。
2. 完成 Copilot 本地草稿全链路验收。
3. 完成管理员云端提交和版本切换验收。
4. 分批把剩余宿主迁入 definition。
5. 针对项目插件类和手动脚本目录类宿主补专用启动提示、目录纠错和真实软件验收。
6. 每迁移 5 到 10 个宿主跑一次完整回归。
7. 真实软件验收通过后再进入打包和线上验证。

## 15. 剩余宿主分批执行清单

### 15.1 当前覆盖口径

当前宿主中心 catalog 共 62 个宿主。

已进入 definition 的宿主共 62 个：

Maya、Blender、3ds Max、Cinema 4D、Houdini、ZBrush、Substance Painter、Substance Designer、Mari、Krita、GIMP、Aseprite、Moho、Toon Boom Harmony、OpenToonz、Cavalry、TVPaint、Rhino、SketchUp、Marvelous Designer、CLO、RizomUV、DAZ Studio、Poser、iClone、Character Creator、Metashape、3DEqualizer、Katana、Unreal、MotionBuilder、Godot、Fusion 360、KeyShot、Marmoset Toolbag、Unity、Modo、LightWave、FreeCAD、AutoCAD、Photoshop、Illustrator、Inkscape、After Effects、Premiere Pro、InDesign、Audition、Media Encoder、Animate、Adobe Bridge、Lightroom Classic、darktable、DaVinci Resolve、Fusion Studio、Nuke、Nuke Studio、Hiero、Natron、OBS Studio、REAPER、VEGAS Pro、Synfig。

剩余待迁移宿主共 0 个：

无。

完成判定：

1. `HOST_BRIDGE_DEFINITIONS.length = 62`，并且不包含模板 id。
2. `listBridgesCatalog()` 输出仍为 62 个宿主。
3. `/v1/bridges` 中 `plannedCount = 0`、`readyCount = 62`、`oneClickCount = 62`。
4. 每个宿主都有 definition、模板、手动目标规则、真实 probe、卸载规则。
5. 每个宿主至少有一条自动测试覆盖迁移后的关键行为。

### 15.2 批次 A：补齐既有核心宿主

范围：

1. Maya。

目标：

Maya 是现有标杆宿主，应该从特殊逻辑逐步收敛到 definition 表达，同时保留当前已经验证过的真实连通能力。

执行：

1. 阅读 `local-companion/src/bridges/mayaBridgeInstall.ts` 中 Maya 当前安装、探测、卸载逻辑。
2. 在 `local-companion/src/bridges/definitions/hostBridgeDefinitions.ts` 新增 `maya` definition。
3. 如果 Maya 需要专用模板，不强行套用通用模板；先抽 `maya_python_command_port` 或保持专用 installer，但 definition 必须能表达入口能力。
4. 更新 `tests/hostBridgeCatalogConsistency.test.ts`，把 `maya` 纳入 definition id 顺序约束。
5. 更新 `tests/hostBridgeInstallers.test.ts`，确保 Maya 安装、探测、卸载不回退。

验证：

```powershell
npm run local-companion:typecheck
npx vitest run tests/hostBridgeCatalogConsistency.test.ts tests/hostBridgeInstallers.test.ts
```

人工验收：

1. 打开宿主中心搜索 Maya。
2. 手动添加 Maya 版本目录。
3. 一键安装。
4. 启动或重启 Maya。
5. 探测连接。
6. 卸载。

完成：

Maya 仍然可真实连接，且已进入 definition，不因为抽象迁移损失原有能力。

### 15.3 批次 B：Python 或脚本启动类 DCC

范围：

1. 3ds Max。
2. Substance Painter。
3. Substance Designer。
4. Mari。
5. Krita。
6. GIMP。
7. Rhino。
8. SketchUp。
9. Marmoset Toolbag。
10. Natron。

目标：

优先复用 `python_http_startup` 或新增轻量脚本 heartbeat 模板，让这批 DCC 类宿主具备真实启动信号。

执行：

1. 逐个阅读对应安装器文件：
   - `maxBridgeInstall.ts`
   - `substancePainterBridgeInstall.ts`
   - `substanceDesignerBridgeInstall.ts`
   - `mariBridgeInstall.ts`
   - `kritaBridgeInstall.ts`
   - `gimpBridgeInstall.ts`
   - `rhinoBridgeInstall.ts`
   - `sketchupBridgeInstall.ts`
   - `marmosetToolbagBridgeInstall.ts`
   - `natronBridgeInstall.ts`
2. 判断宿主真实脚本能力：
   - 支持 Python 启动脚本的，优先使用 `python_http_startup`。
   - 只支持用户脚本目录的，使用 `manual_script_dir`，但 probe 必须来自宿主运行后写入的 heartbeat 或命令响应。
3. 为每个宿主新增 definition。
4. 保持 catalog 中原有 `priority` 顺序不变。
5. 为每个宿主补一条测试，至少验证 definition 字段、模板选择、手动目标、probe 类型、卸载规则。

验证：

```powershell
npm run local-companion:typecheck
npx vitest run tests/hostBridgeCatalogConsistency.test.ts tests/hostBridgeTemplates.test.ts tests/hostBridgeInstallers.test.ts
```

人工验收：

1. 每批至少真实打开 2 个宿主验证。
2. 每个未安装软件也要验证错误提示，不允许静默成功。
3. 误选安装根目录时必须能给出中文纠错建议。

完成：

这 10 个宿主全部进入 definition；自动测试通过；至少 2 个真实软件探测成功，其余软件未安装时失败原因清楚。

当前状态：

已完成结构化迁移，等待聚焦自动验证和真实软件抽样验收。

### 15.4 批次 C：2D、动画、脚本目录类

范围：

1. Aseprite。
2. Moho。
3. Toon Boom Harmony。
4. OpenToonz。
5. Cavalry。
6. TVPaint。
7. Inkscape。
8. VEGAS Pro。
9. Synfig。

目标：

用 Lua、脚本目录、扩展脚本或宿主可加载插件产生真实 heartbeat，不用“文件存在”作为连接成功。

执行：

1. 阅读对应安装器文件：
   - `asepriteBridgeInstall.ts`
   - `mohoBridgeInstall.ts`
   - `toonBoomHarmonyBridgeInstall.ts`
   - `openToonzBridgeInstall.ts`
   - `cavalryBridgeInstall.ts`
   - `tvPaintBridgeInstall.ts`
   - `inkscapeBridgeInstall.ts`
   - `vegasProBridgeInstall.ts`
   - `synfigBridgeInstall.ts`
2. 对能周期写入 heartbeat 的宿主使用 `lua_heartbeat` 或新增专用 heartbeat 模板。
3. 对只能放脚本目录的宿主使用 `manual_script_dir`，并明确 probe 条件。
4. 增加 heartbeat 新鲜度、host id 匹配、JSON 合法性测试。
5. UI 错误提示必须说明“需要打开宿主并加载脚本后再探测”。

验证：

```powershell
npm run local-companion:typecheck
npx vitest run tests/hostBridgeCatalogConsistency.test.ts tests/hostBridgeTemplates.test.ts tests/hostBridgeInstallers.test.ts tests/shellHostCenterUi.test.ts
```

人工验收：

1. 选择一个 Lua/脚本类宿主真实安装。
2. 不打开宿主时探测必须失败。
3. 打开宿主并加载脚本后探测才成功。
4. 过期 heartbeat 必须失败。

完成：

这 9 个宿主全部进入 definition；探测条件来自真实 heartbeat 或宿主响应；过期或伪造信号不能通过。

当前状态：

已完成结构化迁移，等待聚焦自动验证和真实软件抽样验收。

### 15.5 批次 D：项目插件、成对软件和专用软件

范围：

1. Marvelous Designer。
2. CLO。
3. RizomUV。
4. DAZ Studio。
5. Poser。
6. iClone。
7. Character Creator。
8. Metashape。
9. DaVinci Resolve。
10. Fusion Studio。
11. Nuke Studio。
12. Hiero。

目标：

这批软件不要为了统一而强行套模板。能走项目插件的走 `project_plugin`，能走脚本目录的走 `manual_script_dir`，Nuke Studio/Hiero 要尽量复用 Foundry 类已有能力。

执行：

1. 阅读对应安装器文件：
   - `cloMarvelousBridgeInstall.ts`
   - `rizomUvBridgeInstall.ts`
   - `dazStudioBridgeInstall.ts`
   - `poserBridgeInstall.ts`
   - `reallusionBridgeInstall.ts`
   - `metashapeBridgeInstall.ts`
   - `davinciResolveBridgeInstall.ts`
   - `fusionStudioBridgeInstall.ts`
   - `foundryTimelineBridgeInstall.ts`
2. 按软件能力拆 definition，不把 Marvelous Designer 和 CLO、iClone 和 Character Creator 硬合并成同一个 id。
3. Nuke Studio、Hiero 复用 Foundry 时间线类安装器时，probe 必须区分 host id。
4. DaVinci Resolve 和 Fusion Studio 如果依赖脚本目录，必须校验目录可写、脚本入口、heartbeat。
5. 为成对软件补充“不互相覆盖、不互相卸载”的测试。

验证：

```powershell
npm run local-companion:typecheck
npx vitest run tests/hostBridgeCatalogConsistency.test.ts tests/hostBridgeTemplates.test.ts tests/hostBridgeInstallers.test.ts
```

人工验收：

1. 至少验证一组成对软件不会互相覆盖。
2. 至少验证一个 Foundry 时间线类宿主。
3. 至少验证一个脚本目录类宿主。

完成：

这 12 个宿主全部进入 definition；同类软件互不污染；安装和卸载只影响当前宿主自己的文件。

当前状态：

已完成结构化迁移，等待聚焦自动验证和真实软件抽样验收。

### 15.6 Copilot 添加宿主验收脚本

每次完成一个批次后，都要用一个“新宿主草稿”跑通 Copilot 闭环，避免只迁移内置宿主而忘了对话创建能力。

执行：

1. 通过 Copilot 输入：`添加 Spine 宿主`。
2. 确认 Copilot 调用 `ac.companion.host_bridge.create_draft`。
3. 宿主中心出现 Spine 本地草稿。
4. 手动添加版本目录。
5. 一键安装。
6. 不启动宿主时探测失败。
7. 启动宿主并产生真实信号后探测成功。
8. 管理员提交云端。
9. 切换云端已有版本。
10. 删除本地草稿后，云端版本仍可同步显示。

自动验证：

```powershell
node --check companion-desktop/agent-tool-schemas.cjs
node --check companion-desktop/agent-body-host.cjs
npx vitest run tests/agentToolSchema.test.ts tests/hostBridgeDrafts.test.ts tests/hostBridgeCloudSyncUi.test.ts tests/shellToolCloudPublishUi.test.ts
```

完成：

用户不需要选择模板；本地草稿、真实探测、管理员提交、云端版本切换、团队同步全部可用。

### 15.7 最终出包前门禁

出包前必须同时满足：

1. 62 个宿主全部进入 definition，或明确记录未进入 definition 的原因和替代真实连通机制。
2. `/v1/bridges` 返回 62 个宿主，且 `plannedCount = 0`。
3. Copilot 可以通过一句话创建新宿主草稿。
4. 本地草稿不能覆盖内置宿主。
5. 云端宿主不能覆盖内置宿主。
6. 本地草稿优先于同 id 云端宿主，便于本机开发。
7. 管理员提交必须要求最近一次真实 probe 成功。
8. 普通用户不能提交云端或切换云端版本。
9. 版本切换只切换云端已有版本。
10. 所有新增 UI 文案为中文。
11. 自动回归全部通过。
12. 宿主启动/关闭能力完成代码回归，并至少在一款真实已安装宿主上验证启动、关闭、重新探测流程。
13. 至少完成 Maya、Adobe、Python DCC、Lua/heartbeat、项目插件、手动脚本目录、成对软件七类人工验收；`/v1/bridges.acceptanceSummary.ok` 必须为 `true`。

完整验证命令：

```powershell
npm run local-companion:typecheck
node --check companion-desktop/main.cjs
node --check companion-desktop/preload-shell.cjs
node --check companion-desktop/shell/tools-bridges.js
node --check companion-desktop/agent-tool-schemas.cjs
node --check companion-desktop/agent-body-host.cjs
node --check server/auth-api.js
node --check server/host-bridges-store.js
npx vitest run tests/agentToolSchema.test.ts tests/hostBridgeDrafts.test.ts tests/hostBridgeCatalogConsistency.test.ts tests/hostBridgeInstallers.test.ts tests/hostBridgeTemplates.test.ts tests/hostBridgeServerStore.test.ts tests/hostBridgeCloudSyncUi.test.ts tests/shellHostCenterUi.test.ts tests/shellToolCloudPublishUi.test.ts tests/adminMatrix.test.ts
npx vitest run tests/hostAppProcess.test.ts
```

真实软件验收门禁：

```powershell
npm run host-bridges:acceptance:check
```

该命令必须在七类真实软件验收均记录成功后通过；如果 `acceptanceSummary.ok = false`，即使完整回归全绿，也不能进入出包和线上验证。

验收记录模板和记录命令见：`docs/宿主中心-真实软件验收记录.md`。

运行时验证命令：

```powershell
$pairPath = Join-Path $env:LOCALAPPDATA 'AssetCutterCompanion\sandbox\desktop-shell\pairing-config.json'
if (!(Test-Path $pairPath)) { $pairPath = Join-Path $env:LOCALAPPDATA 'AssetCutterCompanion\desktop-shell\pairing-config.json' }
$pair = Get-Content -Path $pairPath -Raw | ConvertFrom-Json
$headers = @{ Authorization = 'Bearer ' + $pair.sharedToken }
$r = Invoke-RestMethod -Uri 'http://127.0.0.1:18765/v1/bridges' -Headers $headers
[pscustomobject]@{
  bridgeCount = $r.bridges.Count
  readyCount = @($r.bridges | Where-Object { $_.status -eq 'ready' }).Count
  oneClickCount = @($r.bridges | Where-Object { $_.installMode -eq 'one_click' }).Count
  plannedCount = @($r.bridges | Where-Object { $_.status -eq 'planned' -or $_.installMode -eq 'planned' }).Count
  draftCount = @($r.bridges | Where-Object { $_.source -eq 'draft' }).Count
  cloudCount = @($r.bridges | Where-Object { $_.source -eq 'cloud' }).Count
  hasAcceptance = $null -ne $r.acceptance
} | Format-List
```

完成：

完整回归通过，运行时检查符合预期，真实软件验收记录齐全，才允许进入打包、线上环境验证和发布。
