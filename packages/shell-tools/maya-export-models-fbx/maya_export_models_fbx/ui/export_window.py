# -*- coding: utf-8 -*-
"""Native Maya UI for exporting each model to an FBX file."""

from __future__ import annotations

import os

import maya.cmds as cmds

from maya_export_models_fbx.core.exporter import export_models


WINDOW = "assetCutterExportModelsFbxWindow"
OUTPUT_FIELD = WINDOW + "Output"
SOURCE_MENU = WINDOW + "Source"
NAME_MENU = WINDOW + "NameMode"
PREFIX_FIELD = WINDOW + "Prefix"
SUFFIX_FIELD = WINDOW + "Suffix"
INCLUDE_HIDDEN_CHECK = WINDOW + "IncludeHidden"
OVERWRITE_CHECK = WINDOW + "Overwrite"
STATUS = WINDOW + "Status"

OPT_OUTPUT = "assetCutterExportModelsFbxOutput"


def _scene_dir():
    scene = cmds.file(query=True, sceneName=True) or ""
    return os.path.dirname(scene) if scene else os.path.expanduser("~/Desktop")


def _default_output_dir():
    saved = cmds.optionVar(query=OPT_OUTPUT) if cmds.optionVar(exists=OPT_OUTPUT) else ""
    if saved and os.path.isdir(saved):
        return saved
    return os.path.join(_scene_dir(), "fbx_exports")


def _set_status(text):
    if cmds.control(STATUS, exists=True):
        cmds.scrollField(STATUS, edit=True, text=text)


def _browse_output(_=None):
    picked = cmds.fileDialog2(fileMode=3, caption="Choose FBX output folder")
    if not picked:
        return
    path = picked[0]
    cmds.textFieldButtonGrp(OUTPUT_FIELD, edit=True, text=path)
    cmds.optionVar(stringValue=(OPT_OUTPUT, path))


def _use_scene_folder(_=None):
    path = os.path.join(_scene_dir(), "fbx_exports")
    cmds.textFieldButtonGrp(OUTPUT_FIELD, edit=True, text=path)
    cmds.optionVar(stringValue=(OPT_OUTPUT, path))


def _read_menu(menu):
    return cmds.optionMenuGrp(menu, query=True, value=True)


def _export(_=None):
    output_dir = cmds.textFieldButtonGrp(OUTPUT_FIELD, query=True, text=True)
    source_label = _read_menu(SOURCE_MENU)
    name_label = _read_menu(NAME_MENU)
    source = "scene" if source_label.startswith("All") else "selection"
    name_mode = "index" if name_label.startswith("Index") else "node"
    prefix = cmds.textFieldGrp(PREFIX_FIELD, query=True, text=True)
    suffix = cmds.textFieldGrp(SUFFIX_FIELD, query=True, text=True)
    include_hidden = cmds.checkBoxGrp(INCLUDE_HIDDEN_CHECK, query=True, value1=True)
    overwrite = cmds.checkBoxGrp(OVERWRITE_CHECK, query=True, value1=True)

    try:
        result = export_models(
            output_dir=output_dir,
            source=source,
            name_mode=name_mode,
            prefix=prefix,
            suffix=suffix,
            include_hidden=include_hidden,
            overwrite=overwrite,
        )
        cmds.optionVar(stringValue=(OPT_OUTPUT, result["outputDir"]))
        lines = [
            "Done.",
            "Exported: {0}/{1}".format(result["count"], result["total"]),
            "Output: {0}".format(result["outputDir"]),
        ]
        if result["skipped"]:
            lines.append("Skipped existing files: {0}".format(len(result["skipped"])))
        for path in result["exported"]:
            lines.append(path)
        _set_status("\n".join(lines))
    except Exception as exc:
        _set_status("Export failed:\n{0}".format(exc))
        raise


def show():
    if cmds.window(WINDOW, exists=True):
        cmds.deleteUI(WINDOW)

    cmds.window(WINDOW, title="Export Models to FBX", sizeable=False, widthHeight=(460, 330))
    cmds.columnLayout(adjustableColumn=True, rowSpacing=8, columnAttach=("both", 10))

    cmds.text(label="Export each model as one FBX file.", align="left")
    cmds.textFieldButtonGrp(
        OUTPUT_FIELD,
        label="Output",
        text=_default_output_dir(),
        buttonLabel="Browse",
        columnWidth3=(70, 290, 80),
        buttonCommand=_browse_output,
    )
    cmds.button(label="Use Scene Folder / fbx_exports", command=_use_scene_folder, height=24)

    cmds.optionMenuGrp(SOURCE_MENU, label="Source", columnWidth2=(70, 360))
    cmds.menuItem(label="Selected models")
    cmds.menuItem(label="All top-level scene models")

    cmds.optionMenuGrp(NAME_MENU, label="Names", columnWidth2=(70, 360))
    cmds.menuItem(label="Node name")
    cmds.menuItem(label="Index")

    cmds.textFieldGrp(PREFIX_FIELD, label="Prefix", text="", columnWidth2=(70, 360))
    cmds.textFieldGrp(SUFFIX_FIELD, label="Suffix", text="", columnWidth2=(70, 360))
    cmds.checkBoxGrp(INCLUDE_HIDDEN_CHECK, label="", label1="Include hidden meshes", value1=False)
    cmds.checkBoxGrp(OVERWRITE_CHECK, label="", label1="Overwrite existing FBX files", value1=True)
    cmds.button(label="Export FBX Files", command=_export, height=34)
    cmds.scrollField(STATUS, editable=False, wordWrap=False, height=90, text="")

    cmds.showWindow(WINDOW)
    return WINDOW

