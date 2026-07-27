# -*- coding: utf-8 -*-
"""Maya 入口：打开批量传递贴图窗口"""

import sys
import os

# 工具根目录 = TransferMapsBatch（launch.py 所在目录）
_repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _repo_root in sys.path:
    sys.path.remove(_repo_root)
sys.path.insert(0, _repo_root)

from transfermaps.ui.qt_imports import *
import maya.cmds as cmds
import maya.OpenMayaUI as apiUI

try:
    import shiboken2 as _shiboken
except Exception:
    try:
        import shiboken as _shiboken
    except Exception:
        _shiboken = None


def get_maya_window():
    if _shiboken is None:
        return None
    ptr = apiUI.MQtUtil.mainWindow()
    if ptr is None:
        return None
    try:
        wrap = _shiboken.wrapInstance(long(ptr), QWidget)
    except Exception:
        wrap = _shiboken.wrapInstance(int(ptr), QWidget)
    return wrap


def _reload_ui():
    import transfermaps.ui.transfer_window as transfer_window
    try:
        reload(transfer_window)
    except NameError:
        import importlib
        importlib.reload(transfer_window)
    return transfer_window


def show_transfer_window():
    """打开批量传递贴图窗口"""
    for wnd in QApplication.topLevelWidgets():
        if not hasattr(wnd, "isWindow") or not wnd.isWindow():
            continue
        if getattr(wnd, "windowTitle", lambda: "")() == u"批量传递贴图":
            wnd.setParent(None)
            wnd.deleteLater()
    mod = _reload_ui()
    maya_win = get_maya_window()
    win = mod.TransferMapsWindow(maya_win)
    win.show()
    return win


if __name__ == "__main__":
    app = QApplication(sys.argv)
    show_transfer_window()
    sys.exit(app.exec_())
