# -*- coding: utf-8 -*-
"""
Script Hub Bridge — 类似「桥接插件」的一键开关：开启/关闭 Maya Command Port（Python），
供本机伴侣 / Script Hub（127.0.0.1:7001）下发脚本。

安装：将本文件复制到 Maya 用户脚本目录后，在脚本编辑器执行：
    import script_hub_bridge
    script_hub_bridge.show()

首次打开面板时可自动在当前工具架添加「SH Bridge」（仅一次，见 optionVar）；也可用窗口内「添加到当前工具架」手动添加。
若误删自动按钮想再触发自动：在脚本编辑器执行
    import maya.cmds as cmds; cmds.optionVar(remove="scriptHubBridgeShelfBtnInstalled")
然后再次 script_hub_bridge.show()。
"""
from __future__ import annotations

import maya.cmds as cmds

WINDOW_NAME = "scriptHubBridgeWindow"
CHECKBOX_NAME = "scriptHubBridgeCheck"
PORT_FIELD = "scriptHubBridgePort"
STATUS_TEXT = "scriptHubBridgeStatus"
SHELF_OPTIONVAR = "scriptHubBridgeShelfBtnInstalled"


def _current_shelf_layout():
    """当前选中的 shelfLayout 全名；批处理或无 UI 时为 None。"""
    if cmds.about(batch=True):
        return None
    try:
        import maya.mel as mel

        # 不能 mel.eval("$gShelfTopLevel") 单独求值（非法 MEL）；须放在 tabLayout 等命令里
        shelf = mel.eval("tabLayout -query -selectTab $gShelfTopLevel")
        if shelf and cmds.shelfLayout(shelf, exists=True):
            return shelf
    except Exception:
        pass
    return None


def _create_shelf_button(shelf: str):
    py_cmd = "import script_hub_bridge; script_hub_bridge.show()"
    cmds.shelfButton(
        parent=shelf,
        label="SH Bridge",
        annotation="Script Hub Bridge：打开 Command Port 面板",
        image="commandButton.png",
        style="iconAndTextHorizontal",
        command=py_cmd,
        sourceType="python",
    )


def _ensure_shelf_button():
    """首次在当前工具架添加一键打开面板的按钮（非批处理、有 Shelf UI 时）。"""
    if cmds.optionVar(exists=SHELF_OPTIONVAR) and cmds.optionVar(query=SHELF_OPTIONVAR):
        return
    shelf = _current_shelf_layout()
    if not shelf:
        return
    try:
        _create_shelf_button(shelf)
        cmds.optionVar(intValue=(SHELF_OPTIONVAR, 1))
    except Exception:
        pass


def _on_add_to_shelf(_=None):
    shelf = _current_shelf_layout()
    if not shelf:
        _set_status("未找到当前工具架，请先显示主窗口工具架。")
        return
    try:
        _create_shelf_button(shelf)
        _set_status("已添加到当前工具架。")
    except Exception as e:
        _set_status("添加到工具架失败：{0}".format(e))


def _port() -> int:
    raw = cmds.intField(PORT_FIELD, q=True, v=True)
    try:
        p = int(raw)
    except (TypeError, ValueError):
        p = 7001
    if p < 1 or p > 65535:
        p = 7001
    return p


def _port_name(port: int) -> str:
    return ":{0}".format(port)


def _command_port_open(port: int) -> bool:
    """若该端口已在监听则视为已开。"""
    name = _port_name(port)
    try:
        # Maya 2022：无 exists 标志；query 即返回该 name 的 commandPort 是否存在
        if cmds.commandPort(name, q=True):
            return True
    except Exception:
        pass
    return False


def _set_status(msg: str):
    if not cmds.control(STATUS_TEXT, exists=True):
        return
    cmds.text(STATUS_TEXT, e=True, label=msg, vis=True)
    try:
        cmds.text(STATUS_TEXT, e=True, fn="smallPlainLabelFont")
    except Exception:
        pass


def _open_port(_=None):
    port = _port()
    name = _port_name(port)
    try:
        if cmds.commandPort(name, q=True):
            _set_status("端口 {0} 已在监听。".format(port))
            return True
        # 本机联调：securityWarning=False 避免部分版本弹窗阻塞/异常；bufferSize 放宽长 mel/exec
        try:
            cmds.commandPort(
                name=name,
                sourceType="python",
                securityWarning=False,
                bufferSize=262144,
            )
        except TypeError:
            cmds.commandPort(name=name, sourceType="python")
        _set_status("已开启 Command Port：{0}（Python）".format(port))
        return True
    except RuntimeError as e:
        msg = str(e)
        hint = ""
        low = msg.lower()
        if "10048" in msg or "address already in use" in low or "已在使用" in msg:
            hint = "（端口被占用：换端口或关掉占用该端口的其它 Maya/程序）"
        elif "10013" in msg or "access" in low or "权限" in msg:
            hint = "（权限/防火墙：尝试管理员启动 Maya 或放行 Maya）"
        _set_status("开启失败：{0}{1}".format(msg, hint))
        return False


def _close_port(_=None):
    port = _port()
    name = _port_name(port)
    try:
        if cmds.commandPort(name, q=True):
            cmds.commandPort(name=name, close=True)
        _set_status("已关闭 Command Port：{0}".format(port))
        return True
    except RuntimeError as e:
        _set_status("关闭失败：{0}".format(e))
        return False


def _on_toggle(_=None):
    if not cmds.control(CHECKBOX_NAME, exists=True):
        return
    on = cmds.checkBox(CHECKBOX_NAME, q=True, v=True)
    if on:
        ok = _open_port()
        if not ok:
            cmds.checkBox(CHECKBOX_NAME, e=True, v=False)
    else:
        _close_port()


def _on_port_change(_=None):
    """改端口时先关再按复选框状态重开，避免旧端口残留。"""
    was_on = cmds.checkBox(CHECKBOX_NAME, q=True, v=True) if cmds.control(CHECKBOX_NAME, exists=True) else False
    _close_port()
    if was_on:
        _open_port()


def show():
    if cmds.window(WINDOW_NAME, exists=True):
        cmds.deleteUI(WINDOW_NAME)

    cmds.window(
        WINDOW_NAME,
        title="Script Hub Bridge",
        sizeable=False,
        minimizeButton=True,
        maximizeButton=False,
        widthHeight=(280, 152),
    )
    cmds.columnLayout(adjustableColumn=True, rowSpacing=8, columnAttach=("both", 12))
    cmds.text(
        label="本机 Command Port（与 Script Hub / 伴侣端口一致）",
        align="left",
        font="smallPlainLabelFont",
    )
    cmds.rowLayout(numberOfColumns=2, columnWidth2=(72, 160), adjustableColumn=2)
    cmds.text(label="端口", align="left", font="smallPlainLabelFont")
    cmds.intField(PORT_FIELD, v=7001, minValue=1, maxValue=65535, changeCommand=_on_port_change)
    cmds.setParent("..")

    cmds.checkBox(
        CHECKBOX_NAME,
        label="开启 Command Port",
        value=_command_port_open(7001),
        changeCommand=_on_toggle,
        annotation="勾选 = 监听 TCP，外部可向本机 Maya 发送 Python 命令（仅本机联调时建议开启）",
    )
    cmds.button(
        label="添加到当前工具架",
        command=_on_add_to_shelf,
        height=26,
        annotation="在当前选中的工具架标签页添加「SH Bridge」快捷按钮（可多次点击会添加多个）",
    )
    cmds.text(STATUS_TEXT, label="", align="left", height=22)
    cmds.showWindow(WINDOW_NAME)

    # 同步复选框与当前端口实际状态
    p = _port()
    cmds.checkBox(CHECKBOX_NAME, e=True, v=_command_port_open(p))
    if _command_port_open(p):
        _set_status("端口 {0} 已在监听。".format(p))
    else:
        _set_status("未开启。勾选上方开关以监听。")

    _ensure_shelf_button()


# 可选：Maya 启动时自动弹出（一般不建议；需要时取消下一行注释）
# cmds.scriptJob(event=("SceneOpened", show), runOnce=True)
