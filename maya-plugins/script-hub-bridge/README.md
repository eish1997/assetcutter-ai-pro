# Script Hub Bridge（Maya）

一键开关 **Command Port（Python）**，默认端口 **7001**，与 Script Hub / 本机伴侣里的 **Maya Host / Port** 对齐。

## 安装

### 方式 A：拖入安装（推荐，Maya 2022 等）

1. 保持 `**ScriptHubBridge_DragInstall.mel`** 与 `**script_hub_bridge.py**` 在**同一文件夹**（仓库里 `maya-plugins/script-hub-bridge/` 已满足）。
2. 把 `**.mel` 拖进 Maya 视口**或脚本编辑器执行一次（或 `source "…/ScriptHubBridge_DragInstall.mel";`）。
3. 安装器会用 `whatIs` 解析本 `.mel` 的路径，将同目录下的 `**script_hub_bridge.py`** 复制到当前 Maya 的用户脚本目录（`Documents/maya/<版本>/scripts`），并自动弹出面板。

**工具架**：面板内有 **「添加到当前工具架」** 按钮，点击后会在**当前选中的工具架标签**上添加 **「SH Bridge」** 快捷项（可多次点击会添加多个，多余的可从工具架上删掉）。首次 `show()` 时也会尝试自动添加一次（记录在 `scriptHubBridgeShelfBtnInstalled`）。若只想用手动添加，可忽略自动；若需重新触发自动，执行：  
`import maya.cmds as cmds; cmds.optionVar(remove="scriptHubBridgeShelfBtnInstalled")`  
然后再次 `script_hub_bridge.show()`。

**说明**：旧版曾把整份插件 base64 塞进一行 `python('…')`，在 Maya 2022 下会触发 MEL 超长/引号解析错误；现改为「短 MEL + 同目录 `.py`」方式，更稳定。

更新插件时：改好 `**script_hub_bridge.py`** 后重新拖入 `**.mel**` 即可覆盖用户 `scripts` 里的副本。

### 方式 B：手动复制

1. 将 `**script_hub_bridge.py**` 复制到 Maya 用户脚本目录，例如：
  - Windows：`%USERPROFILE%\Documents\maya\scripts\`（或带版本号的 `maya\2024\scripts` 等）
2. 重启 Maya 或在脚本编辑器 **执行一次**：

```python
import script_hub_bridge
script_hub_bridge.show()
```

1. 将 **「开启 Command Port」** 勾上；Script Hub 里 **Port** 填同一数字（默认 7001）。

需要工具架快捷方式时，在面板中点击 **「添加到当前工具架」**（或依赖首次打开时的自动添加，见方式 A）。

## 安全说明

Command Port 允许本机其他进程向 Maya 执行代码，**仅建议在个人联调环境开启**，不用时在插件里取消勾选关闭。

## 开启失败 / 端口打不开

1. **端口被占用**：换面板里的端口号（如 7002），并在 Script Hub / 伴侣里填同一端口；或在 PowerShell / CMD 执行 `netstat -ano | findstr :7001` 看占用 PID，结束多余 Maya 或其它程序。
2. **Maya 首选项**：`Windows` → `Settings/Preferences` → `Preferences` → `Applications` → **External Communication**：若曾关闭「默认 Command Port」等选项，一般不影响自定义 `:端口`；若官方补丁后行为异常，可尝试勾选与 Command Port 相关的允许项后重启 Maya（以本机 Maya 版本文档为准）。
3. **防火墙 / 安全软件**：本机 `127.0.0.1` 通常不拦截；若仍报权限类错误，可尝试以管理员启动 Maya 或将 Maya 加入排除列表。
4. **插件版本**：请使用当前仓库的 `script_hub_bridge.py`（已带 `securityWarning=False` 与更大 `bufferSize`）；更新后重新拖入 `ScriptHubBridge_DragInstall.mel` 覆盖用户 `scripts` 目录中的旧文件。
5. **`ECONNREFUSED` 且 Maya 里曾能开**：多为本机伴侣旧逻辑对 Command Port **`destroy()` 发 RST** 把监听打掉；请更新仓库并**重启伴侣**，再在 Maya 里重新勾选「开启 Command Port」。