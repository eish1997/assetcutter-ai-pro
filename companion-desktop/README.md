# 本地伴侣 · Electron 壳（`companion-desktop`）

开发期 **M0**：系统托盘 + 子进程启动 `../local-companion`（`COMPANION_OPEN_BROWSER=0`）。**主窗口** 为内嵌 **`shell/index.html`** 的壳：**左侧图标栏**切换 **首页**（状态 + 打开网站 + 插件列表）、**工作台**（`BrowserView` 内嵌设置中的主站 `siteUrl`；**侧栏右键** 刷新 / 硬刷新 / 浏览器打开主站）、**设置**；**不再**把完整本机管理页作为默认首页；需要完整 HTML 管理页时用托盘 **「在浏览器打开本机管理页」**。协议 **`assetcutter-companion://open`** 可从网站唤起壳（需已安装并注册）。

数据目录为 **`%LOCALAPPDATA%\AssetCutterCompanion\sandbox\desktop-shell`**（Electron `userData`）；下载的运行时、模型与默认卷见 **`docs/本地伴侣-沙盒目录.md`**。进入 **工作台**（内嵌主站）时，壳会按当前主站地址 **自动写入** `pairing-config.json` 的允许 Origin 与通信密码（若尚无密码则生成），并重启由壳拉起的 `local-companion` 使 `COMPANION_SHARED_TOKEN` / `COMPANION_ALLOWED_ORIGINS` 生效，网站侧 **无需** 先到「设置 → 与网站配对」手工对齐；仍可在该页 **覆盖** 密码或增删允许的站点。落盘路径对应子进程环境变量 `COMPANION_SHARED_TOKEN` / `COMPANION_ALLOWED_ORIGINS`；拉起 **local-companion** 时，若 `pairing-config.json` 里已有非空通信密码 / 允许站点，会**覆盖**父进程（Electron / 终端）里同名的旧环境变量，避免与壳内「保存配对」不一致导致网站 `bearer_invalid`。

**托盘（Windows）**：**左键单击** → **打开桌面窗口**；**右键** → 菜单；菜单含 **状态行**、**「打开桌面窗口」**、**「在浏览器打开本机管理页」**、**「重新启动本地伴侣」**。  
壳会轮询 `GET /v1/runtime-status`：当检测到 **Relay 已配置但未运行**，或状态检查 **401（配对密码不一致）** / 超时失败时，会弹出气泡提醒并给出下一步动作（重启/打开本机管理页排查）。
若 Relay 异常状态包含 `lastError` / `lastExitCode` / `lastSignal`，托盘状态行与提醒会附带这些诊断信息，便于快速定位。

macOS / Linux 下配对同样走 **设置 → 与网站配对**（与 Windows 一致）；安装包与代码签名等仍为后续项。

## 前置

1. 在仓库根 **`local-companion/`** 已执行 **`npm ci`**（或 `npm install`），以便打包脚本 **esbuild** 能解析 `yauzl` 等依赖并生成 **`local-companion-bundle/`**（该目录已 `.gitignore`，由 `npm run bundle:local-companion` 生成）。
2. **开发** `npm start`：本机 **`node`** 在 PATH 中（≥20）；若 `local-companion/node_modules/tsx` 存在，壳会以 **`tsx watch src/main.ts`** 拉起伴侣（保存源码后**自动重启**进程）；否则回退为 `node --import tsx`。可设 **`COMPANION_NODE`** 指定自定义 Node。
3. **安装包**（`dist:win` / `dist:portable`）：最终用户**无需**单独安装 Node；壳用 **Electron 二进制 + `ELECTRON_RUN_AS_NODE`** 启动内置的 **`main.cjs`**（**CommonJS**）单文件伴侣进程（勿用 ESM `main.mjs`，否则 **yauzl** 会 **dynamic require** 崩）。

## 启动

```bash
cd companion-desktop
npm install
npm start
```

或从仓库根：

```bash
npm run companion-desktop:start
```

## 打包（Windows）

```bash
cd local-companion && npm ci && cd ../companion-desktop && npm install
```

`dist:*` 会先执行 **`npm run bundle:local-companion`**（esbuild 产出 `local-companion-bundle/`，再随 `extraResources` 打进安装包）。若报错缺少 `yauzl`，多半是 **`local-companion` 未 `npm ci`**。

然后在仓库根执行：

```bash
# 仅生成 unpacked 目录（快速验证）
npm run companion-desktop:pack

# 生成 NSIS 安装包
npm run companion-desktop:dist:win

# 生成 portable 单文件
npm run companion-desktop:dist:portable

# 失败自动重试（win + portable）
npm run companion-desktop:dist:retry
```

产物统一在 **`companion-desktop/dist/`**（不入库，见根 `.gitignore`）：

| 子目录 | 命令 | 内容 |
|--------|------|------|
| **`dist/pack/`** | `npm run companion-desktop:pack` | `electron-builder --dir`，含 **`win-unpacked/`**（快速验链路） |
| **`dist/portable/`** | `npm run companion-desktop:dist:portable` | 便携 **`AssetCutterCompanion-<version>-<buildTag>-x64.exe`** + 本目录下 **`win-unpacked/`** |
| **`dist/installer/`** | `npm run companion-desktop:dist:win` | NSIS **`AssetCutterCompanion-<version>-<buildTag>-x64.exe`**、**`.blockmap`** + **`win-unpacked/`** |

**文件名约定**：`<buildTag>` 默认 **`yyyyMMdd-HHmmss`**（本地时区），同 `package.json` 版本多次打包**不会互相覆盖**。可设环境变量 **`COMPANION_ARTIFACT_SUFFIX`**（仅字母数字 `._-`，≤48 字符）覆盖，例如 CI：`git-a1b2c3d` 或 `ci-42`。通过 **`scripts/companion-desktop-dist.ps1`** 打包且未预设该变量时，脚本开头会生成一条标签并写入环境变量，后续 `npm run companion-desktop:dist:*` 均沿用（**`Target both`** 时便携与 NSIS 为同一标签）。

便携与安装包使用**不同输出目录**，连续执行 **`companion-desktop:dist:retry`**（先 portable 再 nsis）时**不会**再互相抢占同一 `win-unpacked/resources/app.asar`。

> 说明：在网络受限环境下，`dist:win` / `dist:portable` 可能因下载 `electron-builder-binaries`（如 `nsis-resources`）失败而中断；`pack`（`--dir`）通常可先用于本地验证打包链路。
> 可用重试脚本：`scripts/companion-desktop-dist.ps1`，支持 `-UseMirror` 自动注入镜像变量（`ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`）。

## 环境变量

与 `local-companion` 共用：**`COMPANION_HTTP_PORT`**（默认 `18765`）等；壳会额外注入 **`COMPANION_OPEN_BROWSER=0`**。若系统或父进程误带 **`COMPANION_HTTP_PORT=0`**（Relay 子进程约定），壳在拉起本机伴侣时会**清除该值**，避免伴侣误以为要关闭 HTTP 而立即退出。安装包排障可查看 **`%LOCALAPPDATA%\AssetCutterCompanion\sandbox\desktop-shell\local-companion-spawn.log`**。**`COMPANION_DESKTOP_NO_AUTO_SHELL=1`**：启动时不自动弹出桌面小窗口（仅托盘）。**安装包** 首次未保存设置时，设置/「打开网站」默认主站为 **`https://assetcutter-ai-pro.vercel.app/`**；开发 `npm start` 默认为 **`http://localhost:3000`**。

发行包上架与「主站用户下载桌面壳」的元数据模型见仓库 **`docs/本地伴侣-插件与发行.md`**（与 `/v1/capabilities` 运行时插件区分）。

### 自动更新（安装包默认启用）

**打包时**建议设置 **`COMPANION_BUILD_AUTH_API_ORIGIN`**（auth-api 根地址，无尾斜杠），会写入 `build-constants.json`。安装包内 **electron-updater**（generic）默认请求  
`{origin}/api/companion-artifacts/electron-updater/{platform}/stable/latest.yml`（如 win32 → `…/electron-updater/win32/stable/latest.yml`）。服务端须配置 **`COMPANION_DIST_PUBLIC_HTTP_BASE`**（或 **`R2_PUBLIC_BASE_URL`**）与登记 **`sha512`**；部署后可在仓库根执行 **`npm run companion-desktop:verify-update-pipeline`** 校验。旧版查询参数路径 **`electron-app-update.yml?…`** 仍保留兼容。

也可覆盖：

| 变量 | 作用 |
|------|------|
| **`COMPANION_UPDATE_FEED_URL`** | 完整 generic feed URL（最高优先级） |
| **`COMPANION_AUTH_API_ORIGIN`** | 仅指定 auth 根，运行时按平台拼 feed 路径 |
| **`COMPANION_DISABLE_AUTO_UPDATE=1`** | 关闭自动更新 |
| **`COMPANION_ENABLE_UPDATE_IN_DEV=1`** | 开发 `npm start` 时也启用（需能访问 feed） |

**用户体验（安装包）**：

- 启动约 **20s** 后自动检查；之后每 **4h** 再查；
- 发现新版本 → **后台静默下载**（托盘提示进度）；
- 下载完成 → 托盘气泡 + 菜单 **「安装更新并重启」**；退出应用时也可自动安装；
- 管理后台登记 NSIS 时建议同时上传同名的 **`.blockmap`**，启用 **差分下载**（`differentialPackage: true`）。

未配置任何更新源时，仅保留「轮询主站 latest → 提示去网站下载」的弱提示（适合本地开发）。

### 工作台 `ERR_CONNECTION_RESET`（-101）

若 **系统浏览器能打开主站**，但壳内 **工作台** 报 `ERR_CONNECTION_RESET` 且加载 `https://…` 失败，常见原因包括：

1. **企业网 / 防火墙拦截 HTTP/3（QUIC）**：壳已默认追加 Chromium 开关 **`--disable-quic`**，强制走 TCP TLS；请更新到包含该改动的安装包版本。
2. **代理或安全软件改写 HTTPS**：可先在 **设置** 把主站指到可访问的镜像，或用侧栏右键 **「在浏览器打开主站」** 使用系统 Chrome 完成登录后再试壳内工作台。
3. **仍失败**：将 **`%LOCALAPPDATA%\AssetCutterCompanion\sandbox\desktop-shell\companion-shell-settings.json`** 中 **`siteUrl`** 改为当前可直连的站点根 URL（须带 `https://`），保存后重进工作台。

### 桌面快捷方式（NSIS）

安装版默认创建 **开始菜单** 与 **桌面** 快捷方式（`package.json` → `build.nsis`）。

## 二次启动

已启用 **单实例**：再次启动同一壳时优先聚焦已打开的主窗口；若无主窗口则打开主窗口，不重复拉起子进程。
