# 本地伴侣 · Maya 工具页注入（Command Port）

本文说明如何把 **纯 Python Maya 插件（含 UI）** 做成 `shell_tool_bundle`，在桌面壳「工具」页一点后，注入 **已打开的 Maya** 并弹出插件窗口。

**不使用** `mayapy`，**不自动启动** `maya.exe`。

---

## 1. 链路

```
工具页卡片 → Electron 工具窗 → POST /v1/shell-tools/:id/open-in-host
  → 伴侣 probe Maya Command Port
  → 写临时 bootstrap.py + exec(open(...))
  → Maya 内 import 入口函数 → show UI
```

执行与 Script Hub 的 `script.maya` **共用** Command Port 串行队列，避免抢端口。

---

## 2. Maya 本机前提

1. 打开交互式 Maya（带 UI）。
2. 启用 **Python 模式** Command Port（默认伴侣探测 `127.0.0.1:7001`）。

### 推荐：工具页「桥接管理」一键安装

桌面壳 **工具 → 桥接管理 → Maya → 一键安装**：

1. 自动发现 `%USERPROFILE%\Documents\maya\<版本>\scripts`（及共享 `maya\scripts`）。
2. 复制 [`maya-plugins/script-hub-bridge/script_hub_bridge.py`](../maya-plugins/script-hub-bridge/script_hub_bridge.py) 到所选 scripts。
3. 幂等写入 `userSetup.py` 标记块（启动时 `commandPort(127.0.0.1:<port>)`）。
4. **不会**自动启动 Maya；装完请重启或打开 Maya，再点「探测连接」。

API：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/bridges` | 桥列表（maya / unreal 占位） |
| GET | `/v1/bridges/maya` | 发现版本 + 安装状态 |
| POST | `/v1/bridges/maya/install` | body: `{ versions?, scriptsDirs?, port? }` |
| POST | `/v1/bridges/maya/uninstall` | 移除 userSetup 标记块（默认保留 `.py`） |
| GET | `/v1/script-connectors` | 探测 Command Port（UI「探测连接」） |

可选环境变量：`COMPANION_MAYA_BRIDGE_SOURCE`（覆盖 bridge 源 `.py` 路径）。

### 手动开端口（备选）

Script Editor 示例（Python）：

```python
import maya.cmds as cmds
if not cmds.commandPort("127.0.0.1:7001", q=True):
    cmds.commandPort(name="127.0.0.1:7001", sourceType="python", echoOutput=False)
```

可用环境变量覆盖：

| 变量 | 默认 |
|------|------|
| `COMPANION_MAYA_HOST` | `127.0.0.1` |
| `COMPANION_MAYA_PORT` | `7001` |

工具窗面板也可临时填写 Host / Port。

执行 `script.maya` / 打开工具期间，Command Port 探针可能短暂失败，属正常。

---

## 3. 包契约（`tool.json`）

```json
{
  "schemaVersion": 1,
  "id": "transfer-maps-batch",
  "name": "批量传递贴图",
  "description": "...",
  "semver": "1.0.0",
  "launch": { "kind": "shell_module", "module": "module/panel.json" },
  "maya": {
    "entryModule": "transfermaps.main.maya_entry",
    "entryFunc": "show_transfer_window",
    "pythonPath": ["."]
  },
  "permissions": ["host.open"]
}
```

面板动作：

```json
{
  "id": "openMaya",
  "label": "在 Maya 中打开",
  "kind": "open_in_host",
  "host": "maya",
  "style": "primary"
}
```

| 字段 | 说明 |
|------|------|
| `maya.entryModule` | 可 import 的模块名 |
| `maya.entryFunc` | 无参可调用入口（打开 UI） |
| `maya.pythonPath` | 相对包根的 `sys.path` 目录，默认 `["."]` |
| `permissions` | 须含 `host.open`（此类工具不必配置 `run`） |

API：

- `POST /v1/shell-tools/:id/open-in-host` body: `{ "host": "maya", "mayaHost?", "mayaPort?" }`
- 别名：`POST /v1/shell-tools/:id/open-in-maya`

---

## 4. 内置示例：批量传递贴图

源码包：[`packages/shell-tools/transfer-maps-batch`](../packages/shell-tools/transfer-maps-batch)  
（源自 [`示例项目/TransferMapsBatch`](../示例项目/TransferMapsBatch)，业务入口未改。）

开发机安装示例：

```http
POST /v1/shell-tools/install-example
{ "exampleId": "transfer-maps-batch" }
```

然后在工具页打开该工具 →「在 Maya 中打开」。

---

## 5. 持续添加同类插件

1. 拷贝 `transfer-maps-batch` 包骨架，换 `id` / `name` / 插件代码。  
2. 保持入口函数可独立调用（不依赖 Shelf）。  
3. 填好 `maya.entry*`，打 ZIP 走 catalog 安装，或本地 `install-from-url` / `install-example`。  
4. **一般无需改伴侣源码**；新 DCC 宿主再加 adapter。

---

## 6. 相关代码

- [`local-companion/src/bridges/mayaBridgeInstall.ts`](../local-companion/src/bridges/mayaBridgeInstall.ts)
- [`companion-desktop/shell/tools-bridges.js`](../companion-desktop/shell/tools-bridges.js)
- [`local-companion/src/shellToolOpenInHost.ts`](../local-companion/src/shellToolOpenInHost.ts)
- [`local-companion/src/scriptRun/mayaScriptAdapter.ts`](../local-companion/src/scriptRun/mayaScriptAdapter.ts)
- [`local-companion/schemas/tool.schema.json`](../local-companion/schemas/tool.schema.json)
- 小工具架总规格：[本地伴侣-小工具架开发规格.md](./本地伴侣-小工具架开发规格.md)
