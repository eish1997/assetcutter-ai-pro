# -*- coding: utf-8 -*-
"""
批量传递贴图 启动入口：将工具根目录加入 path，打开主窗口。
"""

import sys
import os


def _reload_all():
    try:
        reload_mod = reload
    except NameError:
        import importlib
        reload_mod = importlib.reload
    for name in list(sys.modules.keys()):
        if name.startswith("transfermaps."):
            try:
                reload_mod(sys.modules[name])
            except Exception:
                pass


def _run():
    """打开批量传递贴图窗口"""
    try:
        _root = os.path.dirname(os.path.abspath(__file__))
        if _root in sys.path:
            sys.path.remove(_root)
        sys.path.insert(0, _root)
        _reload_all()
        from transfermaps.main.maya_entry import show_transfer_window
        show_transfer_window()
    except Exception as e:
        import traceback
        try:
            import maya.OpenMaya as om
            om.MGlobal.displayError("[TransferMapsBatch] 启动失败: %s" % str(e))
        except Exception:
            pass
        traceback.print_exc()


def onMayaDroppedPythonFile(filePath):
    _run()


if __name__ == "__main__":
    _run()
