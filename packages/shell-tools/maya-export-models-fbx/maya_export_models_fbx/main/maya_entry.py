# -*- coding: utf-8 -*-
"""Maya entry point for the per-model FBX exporter."""

from __future__ import annotations

import importlib
import os
import sys

_repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _repo_root in sys.path:
    sys.path.remove(_repo_root)
sys.path.insert(0, _repo_root)


def show_export_window():
    import maya_export_models_fbx.ui.export_window as export_window

    try:
        importlib.reload(export_window)
    except Exception:
        pass
    return export_window.show()


if __name__ == "__main__":
    show_export_window()

