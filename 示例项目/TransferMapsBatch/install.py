# -*- coding: utf-8 -*-
"""
批量传递贴图 安装脚本：写入 userSetup.py，创建 Shelf 按钮。
"""

import os
import sys


def get_tool_path():
    current_file = os.path.abspath(__file__)
    tool_path = os.path.dirname(current_file)
    if os.path.exists(os.path.join(tool_path, "launch.py")):
        return tool_path
    env_path = os.getenv("TRANSFER_MAPS_BATCH_PATH", "")
    if env_path and os.path.exists(os.path.join(env_path, "launch.py")):
        return env_path
    return None


def install_to_user_setup():
    tool_path = get_tool_path()
    if not tool_path:
        print("[TransferMapsBatch] 错误：无法找到工具路径！")
        return False

    maya_app_dir = os.getenv("MAYA_APP_DIR", "")
    if not maya_app_dir:
        print("[TransferMapsBatch] 错误：无法找到 MAYA_APP_DIR，请在 Maya 中运行此脚本")
        return False

    maya_version = os.getenv("MAYA_VERSION", "")
    if not maya_version:
        import re
        for item in os.listdir(maya_app_dir):
            if re.match(r"^\d{4}$", item):
                maya_version = item
                break
        if not maya_version:
            maya_version = "2022"

    user_setup_path = os.path.join(maya_app_dir, maya_version, "scripts", "userSetup.py")
    user_setup_dir = os.path.dirname(user_setup_path)
    if not os.path.exists(user_setup_dir):
        os.makedirs(user_setup_dir)

    install_code = """
# ========== TransferMapsBatch 批量传递贴图 自动加载 ==========
import sys
import os
_transfer_maps_batch_path = r"{0}"

def tmb_open_transfer_window():
    if _transfer_maps_batch_path in sys.path:
        sys.path.remove(_transfer_maps_batch_path)
    sys.path.insert(0, _transfer_maps_batch_path)
    try:
        import launch
        try:
            reload(launch)
        except NameError:
            import importlib
            importlib.reload(launch)
        launch._run()
    except Exception as e:
        import traceback
        print("[TransferMapsBatch] 启动失败: %s" % e)
        traceback.print_exc()
# ========== TransferMapsBatch 安装结束 ==========
""".format(tool_path)

    existing_content = ""
    if os.path.exists(user_setup_path):
        try:
            with open(user_setup_path, "r", encoding="utf-8") as f:
                existing_content = f.read()
        except Exception:
            try:
                with open(user_setup_path, "r") as f:
                    existing_content = f.read()
            except Exception:
                pass

    if "# ========== TransferMapsBatch 批量传递贴图 自动加载 ==========" in existing_content:
        print("[TransferMapsBatch] 已经安装过，路径: %s" % user_setup_path)
        return True

    try:
        with open(user_setup_path, "a", encoding="utf-8") as f:
            f.write("\n" + install_code)
    except Exception:
        with open(user_setup_path, "a") as f:
            f.write("\n" + install_code)
    print("[TransferMapsBatch] 已写入 userSetup.py: %s" % user_setup_path)
    return True


def create_shelf_button():
    try:
        import maya.cmds as cmds
    except ImportError:
        print("[TransferMapsBatch] 请在 Maya 中运行以创建 Shelf 按钮")
        return False

    tool_path = get_tool_path()
    if not tool_path:
        return False

    try:
        current_shelf = cmds.tabLayout("ShelfLayout", query=True, selectTab=True)
    except Exception:
        current_shelf = "Shelf1"

    cmd = """
import sys
_path = r"{0}"
if _path in sys.path:
    sys.path.remove(_path)
sys.path.insert(0, _path)
import launch
try:
    reload(launch)
except NameError:
    import importlib
    importlib.reload(launch)
launch._run()
""".format(tool_path)

    name = "TransferMapsBatch"
    if cmds.shelfButton(name, exists=True):
        cmds.deleteUI(name)
    icon_path = os.path.join(tool_path, "icons", "transfer_maps.png")
    cmds.shelfButton(
        name,
        parent=current_shelf,
        label=u"传递贴图",
        annotation=u"批量传递贴图（多组低模-高模-贴图）",
        command=cmd,
        image=icon_path if os.path.isfile(icon_path) else "commandButton.png",
        imageOverlayLabel=u"传递",
    )
    print("[TransferMapsBatch] Shelf 按钮已创建")
    return True


def onMayaDroppedPythonFile(filePath):
    print("=" * 50)
    print("TransferMapsBatch 安装")
    print("=" * 50)
    try:
        import maya.cmds as cmds
        install_to_user_setup()
        create_shelf_button()
        print("安装完成。")
    except ImportError:
        install_to_user_setup()
        print("已写入 userSetup.py，请在 Maya 中再次运行以创建 Shelf 按钮。")


if __name__ == "__main__":
    onMayaDroppedPythonFile(None)
