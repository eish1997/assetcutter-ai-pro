# 本地伴侣 · Electron 壳（`companion-desktop`）

开发期 **M0**：系统托盘 + 子进程启动 `../local-companion`（`COMPANION_OPEN_BROWSER=0`），并提供 **「打开主窗口」**（内嵌加载本机控制台 URL）与「打开本机控制台」（系统浏览器）双入口。

**Windows 首次运行向导（骨架）**：仅 **`win32`** 且未写过完成标记时弹出说明窗口；数据目录为 **`%LOCALAPPDATA%\AssetCutterCompanion\desktop-shell`**（与产品路径一致）。调试可用 **`COMPANION_DESKTOP_SKIP_WIZARD=1`** 跳过、**`COMPANION_DESKTOP_FORCE_WIZARD=1`** 强制每次显示。
向导支持最小可用配对：保存 **配对 Token** 与 **允许 Origin** 到 `userData/pairing-config.json`；壳在启动 `local-companion` 时会自动注入 `COMPANION_SHARED_TOKEN` / `COMPANION_ALLOWED_ORIGINS`（若你未在外部显式设置同名环境变量）。

**托盘（Windows）**：**左键单击** → 打开本机控制台；**右键** → 菜单；菜单含 **状态行**、**「打开主窗口」**、**「重新启动本地伴侣」**、**「欢迎向导」**。  
壳会轮询 `GET /v1/runtime-status`：当检测到 **Relay 已配置但未运行**，或状态检查 **401（Token 不一致）** / 超时失败时，会弹出气泡提醒并给出下一步动作（重启/打开控制台排查）。
若 Relay 异常状态包含 `lastError` / `lastExitCode` / `lastSignal`，托盘状态行与提醒会附带这些诊断信息，便于快速定位。

macOS / Linux 当前不弹向导（仅占位逻辑）；**配对 Token / Origin**、安装包与签名仍为后续项。

## 前置

1. 在仓库根 **`local-companion/`** 已执行 `npm install`（含 `tsx`）。
2. 本机 **`node`** 在 PATH 中（≥20）；若使用自定义 Node，可设环境变量 **`COMPANION_NODE`**。

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

先安装依赖（若安装慢可重试）：

```bash
cd companion-desktop
npm install
```

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

产物目录：`companion-desktop/release/`。

> 说明：在网络受限环境下，`dist:win` / `dist:portable` 可能因下载 `electron-builder-binaries`（如 `nsis-resources`）失败而中断；`pack`（`--dir`）通常可先用于本地验证打包链路。
> 可用重试脚本：`scripts/companion-desktop-dist.ps1`，支持 `-UseMirror` 自动注入镜像变量（`ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`）。

## 环境变量

与 `local-companion` 共用：**`COMPANION_HTTP_PORT`**（默认 `18765`）等；壳会额外注入 **`COMPANION_OPEN_BROWSER=0`**。

## 二次启动

已启用 **单实例**：再次启动同一壳时优先聚焦已打开的主窗口；若无主窗口则打开主窗口，不重复拉起子进程。
