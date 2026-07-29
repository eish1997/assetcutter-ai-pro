# -*- coding: utf-8 -*-
"""FBX export helpers for Maya."""

from __future__ import annotations

import os
import re

import maya.cmds as cmds
import maya.mel as mel


INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')


def _long_name(node):
    matches = cmds.ls(node, long=True) or []
    return matches[0] if matches else node


def _has_mesh_descendant(transform, include_hidden):
    shapes = cmds.listRelatives(transform, allDescendents=True, fullPath=True, type="mesh") or []
    if not shapes:
        return False
    if include_hidden:
        return True
    for shape in shapes:
        parents = cmds.listRelatives(shape, parent=True, fullPath=True) or []
        parent = parents[0] if parents else shape
        if cmds.getAttr(shape + ".intermediateObject"):
            continue
        if cmds.getAttr(shape + ".visibility") and cmds.getAttr(parent + ".visibility"):
            return True
    return False


def selected_model_roots(include_hidden=False):
    raw = cmds.ls(selection=True, long=True) or []
    roots = []
    for node in raw:
        node_type = cmds.nodeType(node)
        transform = node
        if node_type == "mesh":
            parents = cmds.listRelatives(node, parent=True, fullPath=True) or []
            if not parents:
                continue
            transform = parents[0]
        elif node_type != "transform":
            parents = cmds.listRelatives(node, parent=True, fullPath=True) or []
            if parents and cmds.nodeType(parents[0]) == "transform":
                transform = parents[0]
        transform = _long_name(transform)
        if transform not in roots and _has_mesh_descendant(transform, include_hidden):
            roots.append(transform)
    return roots


def scene_top_model_roots(include_hidden=False):
    candidates = cmds.ls(assemblies=True, long=True, type="transform") or []
    roots = []
    for node in candidates:
        if _has_mesh_descendant(node, include_hidden):
            roots.append(_long_name(node))
    return roots


def safe_export_name(node, index, mode="node"):
    short = node.split("|")[-1].split(":")[-1] or "model"
    if mode == "index":
        return "model_{0:03d}".format(index)
    clean = INVALID_FILENAME_CHARS.sub("_", short).strip("._ ")
    return clean or "model_{0:03d}".format(index)


def ensure_fbx_plugin():
    if cmds.pluginInfo("fbxmaya", query=True, loaded=True):
        return
    cmds.loadPlugin("fbxmaya")


def _set_fbx_defaults():
    # Keep this conservative: geometry, materials and smoothing groups, no animation.
    mel.eval("FBXResetExport;")
    mel.eval("FBXExportSmoothingGroups -v true;")
    mel.eval("FBXExportSmoothMesh -v true;")
    mel.eval("FBXExportTangents -v true;")
    mel.eval("FBXExportSkins -v true;")
    mel.eval("FBXExportShapes -v true;")
    mel.eval("FBXExportAnimationOnly -v false;")
    mel.eval("FBXExportBakeComplexAnimation -v false;")
    mel.eval("FBXExportInputConnections -v true;")


def _quote_mel_path(path):
    return path.replace("\\", "/").replace('"', '\\"')


def export_models(
    output_dir,
    source="selection",
    name_mode="node",
    prefix="",
    suffix="",
    include_hidden=False,
    overwrite=True,
):
    output_dir = os.path.abspath(os.path.expanduser(output_dir or ""))
    if not output_dir:
        raise RuntimeError("Output directory is required.")
    if not os.path.isdir(output_dir):
        os.makedirs(output_dir)

    roots = selected_model_roots(include_hidden) if source == "selection" else scene_top_model_roots(include_hidden)
    if not roots:
        raise RuntimeError("No exportable mesh models found.")

    ensure_fbx_plugin()
    original_selection = cmds.ls(selection=True, long=True) or []
    exported = []
    skipped = []

    try:
        _set_fbx_defaults()
        for index, root in enumerate(roots, 1):
            base = "{0}{1}{2}".format(prefix or "", safe_export_name(root, index, name_mode), suffix or "")
            filename = INVALID_FILENAME_CHARS.sub("_", base).strip("._ ") or "model_{0:03d}".format(index)
            path = os.path.join(output_dir, filename + ".fbx")
            if os.path.exists(path) and not overwrite:
                skipped.append(path)
                continue

            cmds.select(root, replace=True, hierarchy=False)
            mel.eval('FBXExport -f "{0}" -s;'.format(_quote_mel_path(path)))
            exported.append(path)
    finally:
        if original_selection:
            cmds.select(original_selection, replace=True)
        else:
            cmds.select(clear=True)

    return {
        "exported": exported,
        "skipped": skipped,
        "count": len(exported),
        "total": len(roots),
        "outputDir": output_dir,
    }

