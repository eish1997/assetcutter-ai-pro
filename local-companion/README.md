# 本地伴侣（`@assetcutter/local-companion`）

本仓库内的 **可运行本地宿主**：Node 进程监听 `127.0.0.1`，提供 **浏览器本机管理页** 与 **`/v1/*` HTTP API**（与主站「设置 → 本地伴侣」探测兼容）。**产品目标（已决）**：**Electron** 安装包 + **托盘必选 + 主窗口可选**；详见 `docs/本地伴侣-待决策清单与建议.md`。本目录为开发期 Node 宿主。

## 功能（当前）

| 模块 | 说明 |
|------|------|
| **插件** | 本地计算、本机仓库；Relay 可通过 **`COMPANION_RELAY_CMD`** 子进程拉起（`capabilities.relay.supervisor`）。计算含 **`stub.ping`**、**`seam_repair`**、**`host_bundle.probe`** / **`host_bundle.exec`**（读 **`host-bundles/<dir>/extracted/run.json`** 后 `spawn`）。 |
| **宿主插件包** | **`GET /v1/host-plugins/bundles`**、**`POST /v1/host-plugins/install-from-url`**；ZIP 解压至 **`extracted/`**；列表与安装响应含 **`runSpec`**。主站 **`services/companionClient/hostPlugins.ts`**。 |
| **仓库** | 本机 Volume 根路径（默认 `~/.assetcutter-companion/volume`）、浅层统计；与规范中的 Storage / `AssetHandle` 路线对齐。 |
| **运行状态** | `GET /v1/runtime-status` 含 `relay` 与 `siteAuth` 摘要：用于托盘识别 Relay 未运行、Token 不一致、站点登录态异常并给出动作提示。 |
| **存储读取** | `GET /v1/projects/:projectId/assets/:key` 可拉回已 PUT 的二进制（与 `meta` / `PUT` / `DELETE` 同源路径）；主站 `fetchCompanionAssetBlob` 用于修缝闭环加载输出贴图。 |
| **manifest 扫盘补登记** | `POST /v1/projects/:projectId/manifest/reconcile`：磁盘上已有 `object` 但 `manifest.json` 缺条时补写；主站 `reconcileCompanionManifestFromDisk`，打开项目时若缺键先 reconcile 再重拉 manifest（见 `docs/本地伴侣-本地程序开发.md` **§3.1**）。 |
| **项目文件 I/O（兼容保留，已弃用）** | `POST /v1/projects/save-as` 与 `POST /v1/projects/open`：仅为历史兼容保留；主路径已切换到 `workspace root` 目录项目 API（`/v1/workspace/projects*`）。 |

详细约定见仓库根目录 [`docs/本地伴侣-本地程序开发.md`](../docs/本地伴侣-本地程序开发.md)。

## 启动

```bash
cd local-companion
npm install
npm run dev
```

浏览器访问 **`http://127.0.0.1:18765/`**（默认端口；启动后约 500ms 会自动打开，可用 `COMPANION_OPEN_BROWSER=0` 关闭）。**联调** Tab 内可 **提交 seam_repair**（需先 PUT 资产且 WebSeamRepair 已启动），以及 **host_bundle.probe / exec**（需已安装含 **`run.json`** 的宿主包并填写 **dirName**）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `COMPANION_HTTP_PORT` | HTTP 端口，默认 `18765`。与 **A-Driver `local-bridge`** 默认同端口，**请勿同时启动两个进程**。 |
| `COMPANION_VOLUME_ROOT` | 仓库卷绝对路径；不设则使用用户目录下 `~/.assetcutter-companion/volume`。 |
| `COMPANION_OPEN_BROWSER` | **`1` / `true` / `yes`**：启动后约 500ms 自动用系统浏览器打开本机管理页。**默认不开启**（桌面壳 `companion-desktop` 自带窗口为主界面）。不设或 `0` / `false` / `no` 则不自动打开。 |
| `COMPANION_MAX_UPLOAD_BYTES` | 单文件 PUT 上限（默认 100MB，硬顶 512MB）。 |
| `COMPANION_RELAY_CMD` | 可选。整行 shell 命令，启动后拉起 Relay（如 `local-bridge`）。 |
| `COMPANION_RELAY_CHILD_HTTP_PORT` | 子进程 `COMPANION_HTTP_PORT`：`0`（默认）、端口数字、或 **`keep`**。 |
| `COMPANION_ALLOWED_ORIGINS` | 可选。逗号分隔 **Origin** 白名单；未设则 CORS 仍宽松。支持 **`http://localhost:*`**、**`http://127.0.0.1:*`**。 |
| `COMPANION_SHARED_TOKEN` | 可选。非空时除健康检查与管理页静态资源外需 **`Authorization: Bearer …`**；与主站设置「本机通信密码」一致。 |
| `COMPANION_SEAM_REPAIR_URL` | 可选。WebSeamRepair 修缝 API，默认 **`http://127.0.0.1:8008/api/repair`**。 |
| `COMPANION_SEAM_REPAIR_TIMEOUT_MS` | 可选。修缝 HTTP 超时（毫秒），默认 **`120000`**，范围约 `5000`～`600000`。 |
| `COMPANION_HOST_BUNDLE_TRUST_HOSTS` | 可选。非 R2 的 https 下载主机白名单（逗号分隔），见 **`docs/本地伴侣-插件与发行.md`**。 |
| `COMPANION_HOST_BUNDLE_MAX_BYTES` | 可选。宿主插件包下载体积上限（默认约 512MB）。 |
| `COMPANION_HOST_BUNDLE_EXEC_TIMEOUT_MS` | 可选。**`host_bundle.*`** 子进程超时（毫秒），默认 **`300000`**，范围约 **`1000`～`3600000`**。 |

## 从网站根目录一键启动

```bash
npm run local-companion:dev
```

## Electron 托盘壳（模拟安装体验）

仓库 **`companion-desktop/`** 会以托盘启动本宿主（`COMPANION_OPEN_BROWSER=0`）。须先在 `local-companion` 与 `companion-desktop` 各自 `npm install`，再在仓库根执行：

```bash
npm run companion-desktop:start
```

详见 [`docs/本地伴侣-本地程序开发.md`](../docs/本地伴侣-本地程序开发.md) **§6.1**（含 **Windows** 首次向导与 `userData` 路径）。
