# -*- coding: utf-8 -*-
"""
传递贴图核心：将高模上指定贴图按低模 UV 重采样输出（仅传递，不烘焙法线等新图）。
使用 Maya surfaceSampler 的 diffuseRGB 模式，逐张贴图临时赋给高模后采样到低模。
"""

import os
import re
import sys
import math

try:
    import maya.cmds as cmds
except ImportError:
    cmds = None

try:
    import maya.api.OpenMaya as om2
except ImportError:
    om2 = None

try:
    import maya.OpenMaya as om1
except ImportError:
    om1 = None

# 整批传递期间缓存 (shape_id, udim_tile) -> 面索引键；每批任务开始前清空
_UDIM_FACE_KEY_CACHE = {}


def _safe_file_token(name):
    """将 DAG 节点名转为安全的文件名片段。"""
    if not name:
        return u"mesh"
    token = name.split("|")[-1].split(":")[-1]
    token = re.sub(r'[<>:"/\\|?*\s]', u"_", token)
    return token or u"mesh"


def _is_udim_template(path):
    """判断贴图路径是否为 UDIM 模板（含 <UDIM> / <UVTILE0> / %04d）。"""
    if not path:
        return False
    up = path.upper()
    return "<UDIM>" in up or "<UVTILE0>" in up or "%04D" in up


def _file_node_uses_udim(file_node):
    """file 节点是否启用 UDIM 平铺模式。"""
    if not cmds or not file_node:
        return False
    try:
        if cmds.attributeQuery("uvTilingMode", node=file_node, exists=True):
            if cmds.getAttr(file_node + ".uvTilingMode") == 3:
                return True
    except Exception:
        pass
    try:
        path = cmds.getAttr(file_node + ".fileTextureName") or ""
        return _is_udim_template(path)
    except Exception:
        return False


def _shapes_from_node(node):
    """transform 或 mesh -> mesh shape 列表（long name）。"""
    if not cmds or not node:
        return []
    try:
        nt = cmds.nodeType(node)
    except Exception:
        return []
    if nt == "mesh":
        try:
            long_name = cmds.ls(node, long=True)
            return [long_name[0] if long_name else node]
        except Exception:
            return [node]
    if nt == "transform":
        shapes = cmds.listRelatives(node, shapes=True, noIntermediate=True, fullPath=True) or []
        return [s for s in shapes if cmds.nodeType(s) == "mesh"]
    return []


def _uv_to_udim(u, v):
    """UV 坐标 -> UDIM 编号（Maya 标准：1001 + floor(u) + 10*floor(v)）。"""
    try:
        tile_u = int(math.floor(float(u)))
        tile_v = int(math.floor(float(v)))
    except (TypeError, ValueError):
        return None
    return 1001 + tile_u + 10 * tile_v


def _is_valid_udim_number(n):
    """Maya UDIM 编号：1001 + u + 10*v，其中 u 为 0–9。"""
    try:
        n = int(n)
    except (TypeError, ValueError):
        return False
    if n < 1001:
        return False
    offset = n - 1001
    return offset >= 0 and (offset % 10) <= 9


def _resolve_texture_path_absolute(path):
    """将 file 节点路径转为绝对路径（含 Maya 工程目录）。"""
    if not path:
        return path
    if isinstance(path, type(u"")) and sys.version_info[0] == 2:
        path = path.strip()
    else:
        path = str(path).strip()
    if os.path.isabs(path):
        return os.path.normpath(path)
    try:
        if cmds:
            proj = cmds.workspace(query=True, rootDirectory=True) or ""
            if proj:
                return os.path.normpath(os.path.join(proj, path))
    except Exception:
        pass
    return os.path.normpath(os.path.abspath(path))


def _find_udim_paths_on_disk(template):
    """按贴图文件命名在同目录扫描全部 UDIM tile（最快、以磁盘为准）。"""
    if not template or not _is_udim_template(template):
        return []
    template = _resolve_texture_path_absolute(template)
    dir_name = os.path.dirname(template)
    if not dir_name or not os.path.isdir(dir_name):
        return []
    base = os.path.basename(template)
    glob_name = re.sub(r"<UDIM>", "*", base, flags=re.I)
    glob_name = re.sub(r"<UVTILE0>", "*", glob_name, flags=re.I)
    glob_name = glob_name.replace("%04d", "*").replace("%04D", "*")
    pattern = os.path.join(dir_name, glob_name)
    found = []
    try:
        import glob
        matches = glob.glob(pattern)
    except Exception:
        matches = []
    for f in matches:
        if not os.path.isfile(f):
            continue
        u = _udim_from_resolved_path(f)
        if u is not None:
            found.append((u, os.path.normpath(os.path.abspath(f))))
    found.sort(key=lambda x: x[0])
    return [p for _, p in found]


def _discover_udim_tiles_from_naming(template, fallback_path=None):
    """从磁盘文件名得到 UDIM 编号列表（供日志等使用）。"""
    paths = _find_udim_paths_on_disk(template)
    tiles = [_udim_from_resolved_path(p) for p in paths]
    tiles = sorted(set(t for t in tiles if t is not None))
    if tiles:
        return tiles
    if fallback_path:
        u = _udim_from_resolved_path(_resolve_texture_path_absolute(fallback_path))
        if u is not None:
            return [u]
    return []


def _is_udim_sequence_path(path, file_node=None):
    if _is_udim_template(path):
        return True
    if _udim_from_resolved_path(path) is not None:
        return True
    if file_node and _file_node_uses_udim(file_node):
        return True
    return False


def _expand_udim_sequence(path, shape=None, file_node=None):
    """展开 UDIM 序列：直接按磁盘贴图命名找齐同目录 tile，不重写编号。

    shape 仅保留参数兼容；tile 发现不再依赖 mesh UV 扫描。
    """
    del shape  # 发现 tile 仅用磁盘命名；烘焙象限隔离在 _run_single 内用 mesh UV
    path = _resolve_texture_path_absolute(path)
    if not _is_udim_sequence_path(path, file_node):
        return [path]
    if _is_udim_template(path):
        template = path
    else:
        template = _path_to_udim_template(path)
        if not _is_udim_template(template):
            return [path]
        template = _resolve_texture_path_absolute(template)
    disk_paths = _find_udim_paths_on_disk(template)
    if disk_paths:
        return _dedupe_texture_paths(disk_paths)
    if os.path.isfile(path):
        return [path]
    fallback = _resolve_texture_path_absolute(_resolve_udim_path(template, 1001))
    if os.path.isfile(fallback):
        return [fallback]
    return [path]


def _path_to_udim_template(path):
    """将已含合法 UDIM tile 编号的路径还原为模板；无法识别则原样返回。"""
    if not path:
        return path
    path = _resolve_texture_path_absolute(path)
    if _is_udim_template(path):
        return path
    udim = _udim_from_resolved_path(path)
    if udim is None:
        return path
    # 仅替换文件名中已识别的那一处 UDIM 编号
    base = os.path.basename(path)
    dir_part = path[:-len(base)] if path.endswith(base) else os.path.dirname(path) + os.sep
    new_base = re.sub(
        r"([\._])%d([\._])" % udim,
        r"\1<UDIM>\2",
        base,
        count=1,
    )
    if new_base == base:
        new_base = re.sub(
            r"([\._])%d(\.[^./\\]+)$" % udim,
            r"\1<UDIM>\2",
            base,
            count=1,
        )
    if new_base == base:
        return path
    return dir_part + new_base


def _collect_udim_tiles_for_shape(shape):
    """根据 mesh 全部 UV 集计算占用的 UDIM 象限（如 [1001, 1002]）。"""
    if not cmds or not shape:
        return []
    tiles = set()
    for sh in _shapes_from_node(shape):
        uv_sets = cmds.polyUVSet(sh, query=True, allUVSets=True) or []
        if not uv_sets:
            uv_sets = ["map1"]
        for uv_set in uv_sets:
            u_vals = None
            v_vals = None
            try:
                u_vals = cmds.polyEditUV("%s.map[*]" % sh, query=True, u=True, uvSet=uv_set)
                v_vals = cmds.polyEditUV("%s.map[*]" % sh, query=True, v=True, uvSet=uv_set)
            except TypeError:
                try:
                    cmds.polyUVSet(sh, currentUVSet=True, uvSet=uv_set)
                    u_vals = cmds.polyEditUV("%s.map[*]" % sh, query=True, u=True)
                    v_vals = cmds.polyEditUV("%s.map[*]" % sh, query=True, v=True)
                except Exception:
                    continue
            except Exception:
                continue
            if u_vals is None or v_vals is None:
                continue
            if not isinstance(u_vals, (list, tuple)):
                u_vals = [u_vals]
                v_vals = [v_vals]
            for u, v in zip(u_vals, v_vals):
                udim = _uv_to_udim(u, v)
                if udim is not None:
                    tiles.add(udim)
    return sorted(tiles)


def clear_udim_face_cache():
    """清空 UDIM 面查找缓存（每批传递开始前调用）。"""
    _UDIM_FACE_KEY_CACHE.clear()


def _shape_long_name(node):
    if not node:
        return None
    try:
        long_name = cmds.ls(node, long=True)
        return long_name[0] if long_name else node
    except Exception:
        return node


def _shape_short_name(long_name):
    if not long_name:
        return u""
    return long_name.split("|")[-1].split(":")[-1]


def _transform_udim_cache_id(transform):
    """用于缓存的稳定标识（transform 下各 shape 的 long path + uuid）。"""
    keys = []
    for sh in _shapes_from_node(transform):
        sh_long = _shape_long_name(sh)
        if not sh_long:
            continue
        uuid = None
        try:
            uuid_list = cmds.ls(sh_long, uuid=True)
            uuid = uuid_list[0] if uuid_list else None
        except Exception:
            pass
        keys.append((sh_long, uuid))
    return tuple(keys)


def _transform_has_uvs(transform):
    """transform 下是否存在 UV。"""
    if not cmds or not transform:
        return False
    for sh in _shapes_from_node(transform):
        sh_long = _shape_long_name(sh)
        if not sh_long:
            continue
        try:
            n = cmds.polyEvaluate(sh_long, uv=True)
            if n and int(n) > 0:
                return True
        except Exception:
            pass
        try:
            u_vals = cmds.polyEditUV("%s.map[*]" % sh_long, query=True, u=True)
            if u_vals:
                return True
        except Exception:
            pass
    return False


def _collect_spatial_udim_tiles_on_shape(sh_long):
    """根据 UV 坐标计算 mesh 占用的 UDIM 象限编号。"""
    tiles = set()
    if not cmds or not sh_long:
        return tiles
    uv_sets = cmds.polyUVSet(sh_long, query=True, allUVSets=True) or []
    if not uv_sets:
        uv_sets = ["map1"]
    for uv_set in uv_sets:
        try:
            u_vals = cmds.polyEditUV(
                "%s.map[*]" % sh_long, query=True, u=True, uvSet=uv_set,
            )
            v_vals = cmds.polyEditUV(
                "%s.map[*]" % sh_long, query=True, v=True, uvSet=uv_set,
            )
        except TypeError:
            try:
                cmds.polyUVSet(sh_long, currentUVSet=True, uvSet=uv_set)
                u_vals = cmds.polyEditUV("%s.map[*]" % sh_long, query=True, u=True)
                v_vals = cmds.polyEditUV("%s.map[*]" % sh_long, query=True, v=True)
            except Exception:
                continue
        except Exception:
            continue
        if u_vals is None or v_vals is None:
            continue
        if not isinstance(u_vals, (list, tuple)):
            u_vals = [u_vals]
            v_vals = [v_vals]
        for u, v in zip(u_vals, v_vals):
            udim = _uv_to_udim(u, v)
            if udim is not None:
                tiles.add(udim)
    return tiles


def _all_face_keys_for_transform(transform):
    """transform 下全部面 -> (shape_index, face_id)。"""
    keys = set()
    for sh_idx, sh in enumerate(_shapes_from_node(transform)):
        sh_long = _shape_long_name(sh)
        if not sh_long:
            continue
        n_faces = int(cmds.polyEvaluate(sh_long, face=True) or 0)
        for fi in range(n_faces):
            keys.add((sh_idx, fi))
    return frozenset(keys)


def _face_indices_for_udim_tile_api2_polygon(sh_long, udim_tile):
    """API 2.0 getPolygonUV：按面逐角点读 UV，兼容性最好。"""
    if not om2:
        return None
    udim_tile = int(udim_tile)
    dag, mesh_fn = _dag_mesh_fn_api2(sh_long)
    if not mesh_fn:
        return None
    try:
        uv_sets = list(mesh_fn.getUVSetNames())
    except Exception:
        uv_sets = []
    if not uv_sets:
        uv_sets = ["map1"]
    keep = set()
    num_faces = mesh_fn.numPolygons
    any_ok = False
    for uv_set in uv_sets:
        for face_id in range(num_faces):
            if face_id in keep:
                continue
            try:
                vtx_count = mesh_fn.polygonVertexCount(face_id)
            except Exception:
                continue
            for vi in range(vtx_count):
                try:
                    u, v = mesh_fn.getPolygonUV(face_id, vi, uvSet=uv_set)
                except TypeError:
                    try:
                        u, v = mesh_fn.getPolygonUV(face_id, vi, uv_set)
                    except Exception:
                        u, v = None, None
                except Exception:
                    u, v = None, None
                if u is None:
                    continue
                any_ok = True
                if _uv_to_udim(u, v) == udim_tile:
                    keep.add(face_id)
                    break
    if not any_ok:
        return None
    return keep


def _face_indices_for_udim_tile_api1_polygon(sh_long, udim_tile):
    """API 1.0 getPolygonUV 回退。"""
    if not om1:
        return None
    udim_tile = int(udim_tile)
    try:
        sel = om1.MSelectionList()
        sel.add(sh_long)
        dag = om1.MDagPath()
        sel.getDagPath(0, dag)
        if dag.hasFn(om1.MFn.kTransform):
            dag.extendToShape()
        mesh_fn = om1.MFnMesh(dag)
    except Exception:
        return None
    uv_sets = []
    try:
        uv_sets = mesh_fn.getUVSetNames()
    except Exception:
        pass
    if not uv_sets:
        uv_sets = ["map1"]
    keep_set = set()
    num_faces = mesh_fn.numPolygons()
    any_ok = False
    u_util = om1.MScriptUtil()
    v_util = om1.MScriptUtil()
    for uv_set in uv_sets:
        for face_id in range(num_faces):
            if face_id in keep_set:
                continue
            try:
                vtx_count = mesh_fn.polygonVertexCount(face_id)
            except Exception:
                continue
            for vi in range(vtx_count):
                try:
                    u_ptr = u_util.asFloatPtr()
                    v_ptr = v_util.asFloatPtr()
                    mesh_fn.getPolygonUV(face_id, vi, u_ptr, v_ptr, uv_set)
                    u = om1.MScriptUtil.getFloat(u_ptr)
                    v = om1.MScriptUtil.getFloat(v_ptr)
                except Exception:
                    continue
                any_ok = True
                if _uv_to_udim(u, v) == udim_tile:
                    keep_set.add(face_id)
                    break
    if not any_ok:
        return None
    return keep_set


def _parse_polyinfo_face_line(line):
    """解析 polyInfo 行：FACE <id>: <tokens…>，支持 0:3 范围。"""
    if not line:
        return None, None
    m = re.match(r"^\s*FACE\s+(\d+)\s*:\s*(.+?)\s*$", line.strip())
    if not m:
        return None, None
    face_id = int(m.group(1))
    tokens = []
    for part in m.group(2).split():
        if ":" in part:
            try:
                a, b = part.split(":", 1)
                tokens.extend(range(int(a), int(b) + 1))
            except ValueError:
                continue
        else:
            try:
                tokens.append(int(part))
            except ValueError:
                continue
    return face_id, tokens


def _query_face_uv_for_set(face, uv_set=None):
    """查询单面在指定 UV 集上的 UV（legacy / 最终回退）。"""
    if not cmds:
        return None, None
    try:
        if uv_set:
            u_vals = cmds.polyEditUV(face, query=True, u=True, uvSet=uv_set)
            v_vals = cmds.polyEditUV(face, query=True, v=True, uvSet=uv_set)
        else:
            u_vals = cmds.polyEditUV(face, query=True, u=True)
            v_vals = cmds.polyEditUV(face, query=True, v=True)
    except TypeError:
        try:
            if uv_set:
                sh = face.split(".f[")[0]
                cmds.polyUVSet(sh, currentUVSet=True, uvSet=uv_set)
            u_vals = cmds.polyEditUV(face, query=True, u=True)
            v_vals = cmds.polyEditUV(face, query=True, v=True)
        except Exception:
            return None, None
    except Exception:
        return None, None
    if u_vals is None or v_vals is None:
        return None, None
    if not isinstance(u_vals, (list, tuple)):
        u_vals = [u_vals]
        v_vals = [v_vals]
    return u_vals, v_vals


def _mesh_has_uv_in_udim_tile(sh_long, udim_tile):
    """mesh 上是否存在落在该 UDIM 象限的 UV 点（用于判断空结果是真无面还是查找失败）。"""
    if not cmds:
        return False
    udim_tile = int(udim_tile)
    uv_sets = cmds.polyUVSet(sh_long, query=True, allUVSets=True) or []
    if not uv_sets:
        uv_sets = ["map1"]
    for uv_set in uv_sets:
        try:
            u_vals = cmds.polyEditUV(
                "%s.map[*]" % sh_long, query=True, u=True, uvSet=uv_set,
            )
            v_vals = cmds.polyEditUV(
                "%s.map[*]" % sh_long, query=True, v=True, uvSet=uv_set,
            )
        except TypeError:
            try:
                cmds.polyUVSet(sh_long, currentUVSet=True, uvSet=uv_set)
                u_vals = cmds.polyEditUV("%s.map[*]" % sh_long, query=True, u=True)
                v_vals = cmds.polyEditUV("%s.map[*]" % sh_long, query=True, v=True)
            except Exception:
                continue
        except Exception:
            continue
        if u_vals is None or v_vals is None:
            continue
        if not isinstance(u_vals, (list, tuple)):
            u_vals = [u_vals]
            v_vals = [v_vals]
        for u, v in zip(u_vals, v_vals):
            if _uv_to_udim(u, v) == udim_tile:
                return True
    return False


def _dag_mesh_fn_api2(sh_long):
    """获取 API 2.0 MFnMesh；失败返回 (None, None)。"""
    if not om2:
        return None, None
    try:
        sel = om2.MSelectionList()
        sel.add(sh_long)
        dag = sel.getDagPath(0)
        if dag.hasFn(om2.MFn.kTransform):
            dag.extendToShape()
        mesh_fn = om2.MFnMesh(dag)
        return dag, mesh_fn
    except Exception:
        return None, None


def _face_indices_for_udim_tile_api2_assigned(sh_long, udim_tile):
    """OpenMaya API 2.0：getAssignedUVs 批量面-UV。"""
    if not om2:
        return None
    udim_tile = int(udim_tile)
    dag, mesh_fn = _dag_mesh_fn_api2(sh_long)
    if not mesh_fn:
        return None
    try:
        uv_sets = list(mesh_fn.getUVSetNames())
    except Exception:
        uv_sets = []
    if not uv_sets:
        uv_sets = ["map1"]
    keep = set()
    num_faces = mesh_fn.numPolygons
    any_ok = False
    for uv_set in uv_sets:
        try:
            u_array, v_array, uv_counts, uv_ids = mesh_fn.getAssignedUVs(uvSet=uv_set)
        except TypeError:
            try:
                u_array, v_array, uv_counts, uv_ids = mesh_fn.getAssignedUVs(uv_set)
            except Exception:
                continue
        except Exception:
            continue
        any_ok = True
        offset = 0
        for face_id in range(num_faces):
            if face_id in keep:
                offset += uv_counts[face_id]
                continue
            cnt = uv_counts[face_id]
            for k in range(cnt):
                uv_idx = uv_ids[offset + k]
                if _uv_to_udim(u_array[uv_idx], v_array[uv_idx]) == udim_tile:
                    keep.add(face_id)
                    break
            offset += cnt
    if not any_ok:
        return None
    return keep


def _face_indices_for_udim_tile_api1_assigned(sh_long, udim_tile):
    """OpenMaya API 1.0 getAssignedUVs 回退。"""
    if not om1:
        return None
    udim_tile = int(udim_tile)
    try:
        sel = om1.MSelectionList()
        sel.add(sh_long)
        dag = om1.MDagPath()
        sel.getDagPath(0, dag)
        if dag.hasFn(om1.MFn.kTransform):
            dag.extendToShape()
        mesh_fn = om1.MFnMesh(dag)
    except Exception:
        return None
    uv_sets = []
    try:
        uv_sets = mesh_fn.getUVSetNames()
    except Exception:
        pass
    if not uv_sets:
        uv_sets = ["map1"]
    keep = set()
    num_faces = mesh_fn.numPolygons()
    any_ok = False
    for uv_set in uv_sets:
        u_array = om1.MFloatArray()
        v_array = om1.MFloatArray()
        uv_counts = om1.MIntArray()
        uv_ids = om1.MIntArray()
        try:
            mesh_fn.getAssignedUVs(u_array, v_array, uv_counts, uv_ids, uv_set)
        except Exception:
            continue
        any_ok = True
        offset = 0
        for face_id in range(num_faces):
            if face_id in keep:
                offset += uv_counts[face_id]
                continue
            cnt = uv_counts[face_id]
            for k in range(cnt):
                uv_idx = uv_ids[offset + k]
                if _uv_to_udim(u_array[uv_idx], v_array[uv_idx]) == udim_tile:
                    keep.add(face_id)
                    break
            offset += cnt
    if not any_ok:
        return None
    return keep


def _bulk_face_uvs_for_set(sh_long, uv_set):
    """当前 UV 集下全部面的 corner UV（与 polyInfo faceToVertex 顺序一致）。"""
    try:
        u_vals = cmds.polyEditUV(
            "%s.f[*]" % sh_long, query=True, u=True, uvSet=uv_set,
        )
        v_vals = cmds.polyEditUV(
            "%s.f[*]" % sh_long, query=True, v=True, uvSet=uv_set,
        )
    except TypeError:
        try:
            cmds.polyUVSet(sh_long, currentUVSet=True, uvSet=uv_set)
            u_vals = cmds.polyEditUV("%s.f[*]" % sh_long, query=True, u=True)
            v_vals = cmds.polyEditUV("%s.f[*]" % sh_long, query=True, v=True)
        except Exception:
            return None, None
    except Exception:
        return None, None
    if u_vals is None or v_vals is None:
        return None, None
    if not isinstance(u_vals, (list, tuple)):
        u_vals = [u_vals]
        v_vals = [v_vals]
    return u_vals, v_vals


def _face_indices_for_udim_tile_cmds(sh_long, udim_tile):
    """cmds 批量：f[*] UV + polyInfo faceToVertex 对齐面序号。"""
    if not cmds:
        return None
    udim_tile = int(udim_tile)
    keep = set()
    uv_sets = cmds.polyUVSet(sh_long, query=True, allUVSets=True) or []
    if not uv_sets:
        uv_sets = ["map1"]
    any_ok = False
    for uv_set in uv_sets:
        u_vals, v_vals = _bulk_face_uvs_for_set(sh_long, uv_set)
        if u_vals is None:
            continue
        try:
            fv_lines = cmds.polyInfo(sh_long, faceToVertex=True) or []
        except Exception:
            continue
        if isinstance(fv_lines, (str, type(u"") if sys.version_info[0] == 2 else str)):
            fv_lines = [fv_lines]
        any_ok = True
        offset = 0
        for line in fv_lines:
            face_id, vert_tokens = _parse_polyinfo_face_line(line)
            if face_id is None:
                continue
            n = len(vert_tokens)
            if n <= 0:
                continue
            for k in range(n):
                idx = offset + k
                if idx >= len(u_vals):
                    break
                if _uv_to_udim(u_vals[idx], v_vals[idx]) == udim_tile:
                    keep.add(face_id)
                    break
            offset += n
    if not any_ok:
        return None
    return keep


def _face_indices_for_udim_tile_legacy(sh_long, udim_tile):
    """逐面 polyEditUV（最慢，兼容旧版/异常 mesh）。"""
    if not cmds:
        return set()
    udim_tile = int(udim_tile)
    keep = set()
    uv_sets = cmds.polyUVSet(sh_long, query=True, allUVSets=True) or []
    if not uv_sets:
        uv_sets = ["map1"]
    n_faces = int(cmds.polyEvaluate(sh_long, face=True) or 0)
    for fi in range(n_faces):
        face = "%s.f[%d]" % (sh_long, fi)
        for uv_set in uv_sets:
            u_vals, v_vals = _query_face_uv_for_set(face, uv_set)
            if u_vals is None:
                continue
            for u, v in zip(u_vals, v_vals):
                if _uv_to_udim(u, v) == udim_tile:
                    keep.add(fi)
                    break
            if fi in keep:
                break
    return keep


def _face_indices_for_udim_tile(sh_long, udim_tile):
    """单 shape 上属于某 UDIM 象限的面序号集合。"""
    for fn in (
        _face_indices_for_udim_tile_api2_polygon,
        _face_indices_for_udim_tile_api1_polygon,
        _face_indices_for_udim_tile_api2_assigned,
        _face_indices_for_udim_tile_api1_assigned,
        _face_indices_for_udim_tile_cmds,
    ):
        result = fn(sh_long, udim_tile)
        if result:
            return result
    if _mesh_has_uv_in_udim_tile(sh_long, udim_tile):
        legacy = _face_indices_for_udim_tile_legacy(sh_long, udim_tile)
        if legacy:
            return legacy
    return set()


def _transform_uses_packed_uv(transform):
    """UV 是否全部落在 1001 象限（0-1 打包，无 UDIM 空间偏移）。"""
    if not cmds or not transform:
        return False
    all_tiles = set()
    for sh in _shapes_from_node(transform):
        sh_long = _shape_long_name(sh)
        if sh_long:
            all_tiles.update(_collect_spatial_udim_tiles_on_shape(sh_long))
    return bool(all_tiles) and all_tiles <= {1001}


def _get_udim_face_keys_for_transform(transform, udim_tile, log_fn=None):
    """返回 (shape_index, 面序号) 集合；带批内缓存。"""
    if not transform or not udim_tile:
        return frozenset()
    cache_id = _transform_udim_cache_id(transform)
    cache_key = (cache_id, int(udim_tile))
    if cache_key in _UDIM_FACE_KEY_CACHE:
        return _UDIM_FACE_KEY_CACHE[cache_key]
    keys = set()
    for sh_idx, sh in enumerate(_shapes_from_node(transform)):
        sh_long = _shape_long_name(sh)
        if not sh_long:
            continue
        for face_id in _face_indices_for_udim_tile(sh_long, udim_tile):
            keys.add((sh_idx, face_id))
    if not keys and _transform_has_uvs(transform):
        if _transform_uses_packed_uv(transform):
            if log_fn:
                log_fn(
                    u"UDIM %d：检测到 UV 打包在 0-1（非 UDIM 偏移布局），使用全模面"
                    % int(udim_tile)
                )
            keys = set(_all_face_keys_for_transform(transform))
        elif log_fn:
            log_fn(
                u"UDIM %d：未匹配到象限面，但 mesh 有 UV，使用全模面"
                % int(udim_tile)
            )
            keys = set(_all_face_keys_for_transform(transform))
    result = frozenset(keys)
    _UDIM_FACE_KEY_CACHE[cache_key] = result
    return result


def _get_udim_face_keys_for_shape(shape, udim_tile, log_fn=None):
    """兼容：shape 或 transform 均可传入。"""
    if not shape:
        return frozenset()
    try:
        nt = cmds.nodeType(shape)
    except Exception:
        nt = None
    if nt == "transform":
        return _get_udim_face_keys_for_transform(shape, udim_tile, log_fn=log_fn)
    for tr in (cmds.listRelatives(shape, parent=True, fullPath=True) or []):
        try:
            if cmds.nodeType(tr) == "transform":
                return _get_udim_face_keys_for_transform(tr, udim_tile, log_fn=log_fn)
        except Exception:
            continue
    keys = set()
    for sh_idx, sh in enumerate(_shapes_from_node(shape)):
        sh_long = _shape_long_name(sh)
        if not sh_long:
            continue
        for face_id in _face_indices_for_udim_tile(sh_long, udim_tile):
            keys.add((sh_idx, face_id))
    return frozenset(keys)


def _get_face_components_for_udim_tile(transform, udim_tile):
    """返回 UV 落在指定 UDIM 象限内的面组件列表（long name）。"""
    if not cmds or not transform or not udim_tile:
        return []
    keys = _get_udim_face_keys_for_transform(transform, udim_tile)
    if not keys:
        return []
    faces = []
    for sh_idx, sh in enumerate(_shapes_from_node(transform)):
        sh_long = _shape_long_name(sh)
        if not sh_long:
            continue
        for idx, face_id in keys:
            if idx == sh_idx:
                faces.append("%s.f[%d]" % (sh_long, face_id))
    return faces


def _make_mesh_isolated_for_udim_tile(transform, shape, udim_tile, dup_name="transferTempMesh#", role=u"", log_fn=None):
    """复制 mesh 并删除非指定 UDIM 象限的面，仅该象限参与采样。"""
    if not udim_tile or not transform or not shape:
        return transform, shape, None
    keep_keys = _get_udim_face_keys_for_transform(transform, udim_tile, log_fn=log_fn)
    if not keep_keys:
        if log_fn:
            label = role or u"模型"
            log_fn(u"UDIM %d：%s 无 UV 或未找到面，跳过" % (int(udim_tile), label))
        return None, None, None
    try:
        dup = cmds.duplicate(transform, name=dup_name)[0]
        dup_shape = _get_shape(dup)
        if not dup_shape:
            cmds.delete(dup)
            return None, None, None
        delete_faces = []
        for sh_idx, sh in enumerate(_shapes_from_node(dup)):
            sh_long = _shape_long_name(sh)
            if not sh_long:
                continue
            n_faces = int(cmds.polyEvaluate(sh_long, face=True) or 0)
            for fi in range(n_faces):
                if (sh_idx, fi) not in keep_keys:
                    delete_faces.append("%s.f[%d]" % (sh_long, fi))
        if delete_faces:
            cmds.delete(delete_faces)
        if log_fn:
            label = role or u"模型"
            log_fn(u"UDIM %d：%s 象限烘焙（保留 %d 面）" % (int(udim_tile), label, len(keep_keys)))
        dup_shape = _get_shape(dup)
        return dup, dup_shape, dup
    except Exception as e:
        if log_fn:
            log_fn(u"UDIM %s 象限隔离失败: %s" % (role or u"模型", str(e)))
        return None, None, None


def _make_high_source_for_udim_tile(high_transform, high_shape, udim_tile, log_fn=None):
    """为指定 UDIM 象限复制高模并删除其它象限的面。"""
    return _make_mesh_isolated_for_udim_tile(
        high_transform, high_shape, udim_tile,
        dup_name="transferTempHigh#", role=u"高模", log_fn=log_fn,
    )


def _resolve_udim_path(template, udim):
    """将 UDIM 模板路径替换为指定 tile 的实际路径。"""
    if not template:
        return template
    s = str(int(udim))
    result = template
    result = re.sub(r"<UDIM>", s, result, flags=re.I)
    result = re.sub(r"<UVTILE0>", s, result, flags=re.I)
    if "%04d" in result:
        result = result.replace("%04d", s)
    if "%04D" in result:
        result = result.replace("%04D", s)
    return result


def _udim_from_resolved_path(path):
    """从文件名中提取 UDIM 编号（须为合法 Maya UDIM，避免误匹配版本号等）。"""
    if not path:
        return None
    base = os.path.basename(path)
    for m in re.finditer(r"[\._](\d{4})(?=[\._]|$)", base):
        try:
            n = int(m.group(1))
        except ValueError:
            continue
        if _is_valid_udim_number(n):
            return n
    return None


def _expand_texture_paths_for_shape(shape, template_path):
    """按磁盘贴图命名展开 UDIM 序列（shape 参数保留兼容）。"""
    del shape
    if not template_path:
        return []
    return _expand_udim_sequence(template_path)


def _dedupe_texture_paths(paths):
    """路径去重并保持顺序。"""
    seen = set()
    out = []
    for p in paths or []:
        if not p:
            continue
        key = _canonical_path_key(p)
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def _build_bake_items_for_high(high, textures, path_to_channel=None):
    """按 UDIM 序列展开烘焙项：每 tile 一条，路径来自模板+编号，不重写编号。"""
    path_to_channel = path_to_channel or {}
    shape = _get_shape(high)
    by_channel = {}
    for tex_path in textures or []:
        if not tex_path:
            continue
        key = _canonical_path_key(tex_path)
        ch = path_to_channel.get(key) or _guess_channel_from_path(tex_path)
        ch = ch or u"tex"
        if key not in {_canonical_path_key(p) for p in by_channel.get(ch, [])}:
            by_channel.setdefault(ch, []).append(tex_path)
    items = []
    for ch, paths in by_channel.items():
        template = None
        for p in paths:
            abs_p = _resolve_texture_path_absolute(p)
            if _is_udim_template(abs_p):
                template = abs_p
                break
            t = _path_to_udim_template(abs_p)
            if _is_udim_template(t):
                template = t
                break
        if template:
            disk_paths = _find_udim_paths_on_disk(template)
            if not disk_paths:
                for p in paths:
                    ap = _resolve_texture_path_absolute(p)
                    if os.path.isfile(ap):
                        disk_paths = [ap]
                        break
            for resolved in disk_paths:
                tile = _udim_from_resolved_path(resolved)
                items.append({
                    "tex_path": resolved,
                    "udim_tile": tile,
                    "channel": ch,
                    "index": 0,
                })
            continue
        for i, p in enumerate(paths):
            udim = _udim_from_resolved_path(_resolve_texture_path_absolute(p))
            items.append({
                "tex_path": _resolve_texture_path_absolute(p),
                "udim_tile": udim,
                "channel": ch,
                "index": i,
            })
    return items


def _canonical_path_key(path):
    """统一路径格式用于查找通道，避免大小写/斜杠不一致导致 Roughness 等查不到。"""
    if not path or not isinstance(path, (str, type(u""))):
        return ""
    p = os.path.normpath(os.path.abspath(path.strip()))
    if os.name == "nt":
        p = p.lower()
    return p


def _get_shape(transform_path):
    """取 transform 下的 mesh 形节点（第一个）"""
    if not cmds:
        return None
    if cmds.nodeType(transform_path) == "mesh":
        return transform_path
    shapes = cmds.listRelatives(transform_path, shapes=True, noIntermediate=True, fullPath=True) or []
    for s in shapes:
        if cmds.nodeType(s) == "mesh":
            return s
    return None


def _collect_file_nodes_upstream(nodes, visited=None):
    """从一组节点出发，递归收集所有上游的 file 节点"""
    if not cmds:
        return set()
    if visited is None:
        visited = set()
    file_nodes = set()
    for node in nodes:
        if node in visited:
            continue
        visited.add(node)
        try:
            if cmds.nodeType(node) == "file":
                file_nodes.add(node)
        except Exception:
            continue
        # 该节点的所有上游连接（source=True 表示连接到当前节点的源）
        try:
            conn = cmds.listConnections(node, source=True, destination=False, plugs=False) or []
        except Exception:
            conn = []
        upstream = _collect_file_nodes_upstream(conn, visited)
        file_nodes.update(upstream)
    return file_nodes


# 材质属性到贴图组（通道）名的映射，用于按通道分组传递
_CHANNEL_ATTR_MAP = [
    (["baseColor", "color", "diffuse", "outColor"], u"BaseColor"),
    (["specularRoughness", "diffuseRoughness", "roughness", "specularRoughnessX", "specularRoughnessY"], u"Roughness"),
    (["metalness", "metallic"], u"Metallic"),
    (["normalCamera", "normal", "bumpValue"], u"Normal"),
    (["emissionColor", "emission", "incandescence"], u"Emission"),
    (["opacity", "transparency"], u"Alpha"),
]


def _attr_to_channel(attr_plug):
    """根据连接的属性插头名判断通道（BaseColor / Roughness / Normal 等）"""
    if not attr_plug or "." not in attr_plug:
        return u"Misc"
    attr_lower = attr_plug.split(".")[-1].lower()
    for keywords, channel in _CHANNEL_ATTR_MAP:
        if any(kw in attr_lower for kw in keywords):
            return channel
    if "normal" in attr_lower or "bump" in attr_lower:
        return u"Normal"
    # 任意含 rough 的材质属性都视为粗糙度（兼容各渲染器命名）
    if "rough" in attr_lower:
        return u"Roughness"
    return u"Misc"


def _trace_channel_to_material(plug, visited=None):
    """从插头沿连接向下追踪到材质节点，用材质上的属性名判断通道（不依赖贴图文件名）。
    支持 file -> aiAdd -> aiStandardSurface.metalness 等中间节点。"""
    if not cmds or not plug or "." not in plug:
        return u"Misc"
    if visited is None:
        visited = set()
    if plug in visited:
        return u"Misc"
    visited.add(plug)
    node = plug.split(".")[0]
    try:
        nt = cmds.nodeType(node)
    except Exception:
        return u"Misc"
    # 已到材质：用当前插头判断通道
    if nt in ("aiStandardSurface", "standardSurface", "lambert", "phong", "blinn", "aiFlat"):
        return _attr_to_channel(plug)
    # 法线类中间节点：输出连到材质的 normalCamera
    if nt in ("aiNormalMap", "bump2d"):
        return u"Normal"
    # 其它中间节点（aiAdd、multiply 等）：继续追踪其输出
    out_plugs = []
    for attr in ("outColor", "outValue", "outAlpha", "output"):
        try:
            p = node + "." + attr
            if not cmds.attributeQuery(attr.split(".")[-1], node=node, exists=True):
                continue
            dest = cmds.listConnections(p, destination=True, source=False, plugs=True) or []
            out_plugs.extend(dest)
        except Exception:
            continue
    for dest_plug in out_plugs:
        ch = _trace_channel_to_material(dest_plug, visited)
        if ch != u"Misc":
            return ch
    return u"Misc"


def _guess_channel_from_path(texture_path):
    """根据贴图文件名猜测通道类型，作为属性分析失败时的兜底。"""
    name = os.path.basename(texture_path or "").lower()
    if not name:
        return u"Misc"
    if any(k in name for k in ["rough", "roughness", "rgh"]):
        return u"Roughness"
    if any(k in name for k in ["metal", "mtl"]):
        return u"Metallic"
    if any(k in name for k in ["normal", "nrm", "norm"]):
        return u"Normal"
    if any(k in name for k in ["basecolor", "base_color", "albedo", "diff", "diffuse", "_col", "color"]):
        return u"BaseColor"
    if "emit" in name or "emissive" in name:
        return u"Emission"
    if "opacity" in name or "alpha" in name or "transpare" in name:
        return u"Alpha"
    return u"Misc"


def get_texture_channel_for_file_node(file_node):
    """
    根据 file 节点的输出连接判断该贴图属于哪一通道（颜色/粗糙度/法线等）。
    沿连接链追踪到材质节点，按材质上的属性命名（不依赖贴图文件名）。
    若同一贴图连到多个通道（如既连 Metalness 又连 Specular Roughness），优先返回 Roughness，
    避免被误判为 Metallic 导致输出时缺少 Roughness。
    """
    if not cmds or not file_node:
        return u"Misc"
    try:
        # 有些粗糙度/金属度会连在 outAlpha 或 outColorR 等单通道输出上，
        # 所以需要综合考虑 file 的多种输出插头，而不仅仅是 outColor。
        out_attrs = [
            "outColor",
            "outColorR", "outColorG", "outColorB",
            "outAlpha",
            "outValue",
        ]
        channels_found = []
        for attr in out_attrs:
            try:
                if not cmds.attributeQuery(attr, node=file_node, exists=True):
                    continue
            except Exception:
                continue
            conns = cmds.listConnections(
                "%s.%s" % (file_node, attr),
                destination=True,
                source=False,
                plugs=True
            ) or []
            for plug in conns:
                ch = _trace_channel_to_material(plug)
                if ch != u"Misc" and ch not in channels_found:
                    channels_found.append(ch)
        if not channels_found:
            return u"Misc"
        # 同一贴图连到多通道时优先认 Roughness，避免只认到 Metallic
        if u"Roughness" in channels_found:
            return u"Roughness"
        return channels_found[0]
    except Exception:
        return u"Misc"


def get_mesh_textures_with_channels(transform_path):
    """
    扫描高模材质网络中所有 file 贴图，并返回 (绝对路径, 通道名) 列表。
    通道名用于按「颜色/粗糙度/法线」等分组传递，避免混在一张图上。
    """
    if not cmds:
        return []
    shape = _get_shape(transform_path)
    if not shape:
        return []
    try:
        shape_long = cmds.ls(shape, long=True)
        shape_long = shape_long[0] if shape_long else shape
    except Exception:
        shape_long = shape
    result = []
    seen_paths = set()
    try:
        all_sgs = cmds.ls(type="shadingEngine", long=True) or []
        for sg in all_sgs:
            if "initialShadingGroup" in sg or "initialParticleSE" in sg:
                continue
            if not _shape_in_sg(shape_long, sg):
                continue
            shaders = cmds.listConnections(
                sg + ".surfaceShader",
                source=True,
                destination=False,
                plugs=False
            ) or []
            for shader in shaders:
                file_nodes = _collect_file_nodes_upstream([shader])
                for fn in file_nodes:
                    try:
                        path = cmds.getAttr(fn + ".fileTextureName")
                    except Exception:
                        continue
                    if not path or not isinstance(path, (str, type(u""))):
                        continue
                    path = path.strip()
                    if not path:
                        continue
                    path = _resolve_texture_path_absolute(path.strip())
                    channel = get_texture_channel_for_file_node(fn)
                    expanded_paths = _expand_file_node_texture_paths(fn, shape_long, path)
                    for exp_path in expanded_paths:
                        key = _canonical_path_key(exp_path)
                        if key in seen_paths:
                            continue
                        seen_paths.add(key)
                        result.append((exp_path, channel))
            break
    except Exception:
        pass
    return result


def _expand_file_node_texture_paths(file_node, shape, path):
    """展开 file 节点的 UDIM 序列（mesh UV + 磁盘同序列文件）。"""
    return _expand_udim_sequence(path, shape, file_node)


def get_expanded_texture_paths_for_high(high_transform, texture_paths=None):
    """返回高模贴图路径列表（UI 显示用，含全部 UDIM tile）。"""
    shape = _get_shape(high_transform) or high_transform
    try:
        scanned = get_mesh_textures_with_channels(high_transform)
    except Exception:
        scanned = []
    if not texture_paths:
        return _dedupe_texture_paths([p for p, _ in scanned])

    out = []
    for p in texture_paths:
        if not p:
            continue
        out.extend(_expand_udim_sequence(p, shape))
    seen = {_canonical_path_key(p) for p in out}
    for p, _ in scanned:
        key = _canonical_path_key(p)
        if key not in seen:
            out.append(p)
            seen.add(key)
    return _dedupe_texture_paths(out)


def texture_display_label(path):
    """贴图列表显示名：含 UDIM 象限编号时追加标记。"""
    if not path:
        return u""
    base = os.path.basename(path)
    if _is_udim_template(path):
        return u"%s  [UDIM]" % base
    udim = _udim_from_resolved_path(path)
    if udim:
        return u"%s  [%d]" % (base, udim)
    return base


def _extract_paths_from_file_nodes(file_nodes, seen_paths, resolve_relative=True):
    """从 file 节点列表取出路径，去重后加入列表，返回新路径列表"""
    paths = []
    for fn in file_nodes:
        try:
            path = cmds.getAttr(fn + ".fileTextureName")
        except Exception:
            continue
        if not path or not isinstance(path, (str, type(u""))):
            continue
        path = path.strip()
        if not path:
            continue
        if resolve_relative and not os.path.isabs(path):
            try:
                proj = cmds.workspace(query=True, rootDirectory=True) or ""
                if proj:
                    path = os.path.normpath(os.path.join(proj, path))
            except Exception:
                pass
        if path not in seen_paths:
            seen_paths.add(path)
            paths.append(path)
    return paths


def _shape_in_sg(shape_long, sg):
    """判断 shape 是否属于该着色组：先查 sets 成员，再查 dagSetMembers 连接"""
    def node_long(n):
        if not n or "." in n:
            n = n.split(".")[0] if n else n
        try:
            out = cmds.ls(n, long=True)
            return out[0] if out else n
        except Exception:
            return n

    def same_shape(a, b):
        return node_long(a) == node_long(b)

    # 方式1：sets(sg, query=True) 返回的成员列表（可能是 shape/transform/组件）
    try:
        members = cmds.sets(sg, query=True) or []
        for m in members:
            try:
                if same_shape(m, shape_long):
                    return True
                node_part = m.split(".")[0] if isinstance(m, (str, type(u""))) and "." in m else m
                nt = cmds.nodeType(node_long(node_part))
                if nt == "transform":
                    shapes = cmds.listRelatives(node_part, shapes=True, noIntermediate=True, fullPath=True) or []
                    for s in shapes:
                        if cmds.nodeType(s) == "mesh" and same_shape(s, shape_long):
                            return True
            except Exception:
                continue
    except Exception:
        pass

    # 方式2：SG.dagSetMembers 连接到的目标
    try:
        dest = cmds.listConnections(sg + ".dagSetMembers", destination=True, source=False, plugs=False) or []
        for d in dest:
            node = d.split(".")[0] if "." in d else d
            if same_shape(node, shape_long):
                return True
    except Exception:
        pass
    return False


def get_mesh_connected_texture_paths(transform_path):
    """
    扫描高模材质上链接的所有 file 贴图路径。先遍历场景里所有 ShadingEngine，
    找到「包含该高模 shape」的 SG，再从其材质递归收集全部 file 节点。
    """
    if not cmds:
        return []
    shape = _get_shape(transform_path)
    if not shape:
        return []
    try:
        shape_long = cmds.ls(shape, long=True)
        shape_long = shape_long[0] if shape_long else shape
    except Exception:
        shape_long = shape
    paths = []
    seen_paths = set()

    try:
        # 遍历场景中所有着色组，找出「包含当前高模 shape」的 SG
        all_sgs = cmds.ls(type="shadingEngine", long=True) or []
        for sg in all_sgs:
            if sg in ("initialShadingGroup", "initialParticleSE"):
                continue
            if not _shape_in_sg(shape_long, sg):
                continue
            # 该 SG 的材质（surfaceShader 的 source）
            shaders = cmds.listConnections(
                sg + ".surfaceShader",
                source=True,
                destination=False,
                plugs=False
            ) or []
            for shader in shaders:
                file_nodes = _collect_file_nodes_upstream([shader])
                paths.extend(_extract_paths_from_file_nodes(file_nodes, seen_paths))
            break  # 已找到该高模所在的 SG 并收集完贴图
    except Exception:
        pass
    return paths


def _output_path_for(config, low_name, high_name, texture_path, index, channel_suffix=None, set_name=None, udim_tile=None):
    """生成单张传递结果的输出路径。

    命名格式：贴图集_低模_from_高模_通道[_UDIM].ext
    含高模名与 UDIM 编号，避免多组件共用材质时过程文件互相覆盖。
    """
    out_dir = (config.get("output_dir") or "").strip()
    if not out_dir:
        try:
            scene_dir = cmds.file(query=True, sceneName=True)
            if scene_dir:
                out_dir = os.path.dirname(scene_dir)
        except Exception:
            pass
    if not out_dir:
        out_dir = os.path.expanduser("~")
    low_short = _safe_file_token(low_name)
    high_short = _safe_file_token(high_name) if high_name else u""
    ext = os.path.splitext(texture_path)[1].lower() or ".png"
    if ext not in (".png", ".jpg", ".jpeg", ".tga", ".tif", ".tiff", ".exr", ".bmp"):
        ext = ".png"
    chan = (channel_suffix or "").strip() or _guess_channel_from_path(texture_path)
    if udim_tile is None:
        udim_tile = _udim_from_resolved_path(texture_path)
    set_prefix = (set_name or "").strip()
    if set_prefix:
        set_prefix = set_prefix + "_"
    body = u"%s_from_%s" % (low_short, high_short) if high_short else low_short
    udim_part = u"_%d" % udim_tile if udim_tile else u""
    if index > 0 and udim_part:
        name = u"%s%s_%s%s_seq%d%s" % (set_prefix, body, chan, udim_part, index, ext)
    elif index > 0:
        name = u"%s%s_%s_%d%s" % (set_prefix, body, chan, index, ext)
    else:
        name = u"%s%s_%s%s%s" % (set_prefix, body, chan, udim_part, ext)
    return os.path.join(out_dir, name)


def _filter_type_to_int(ft):
    """config filter_type -> surfaceSampler filterType: 0=gaussian, 1=triangle, 2=box"""
    m = {"gaussian": 0, "triangle": 1, "box": 2, "quadratic": 1}
    return m.get((ft or "gaussian").lower(), 0)


def _super_sampling_int(quality):
    """采样质量: low=0, medium=1, high=2 (2^n^2 采样点)"""
    m = {"low": 0, "medium": 1, "high": 2}
    return m.get((quality or "low").lower(), 0)


def _run_single(low_transform, high_transform, texture_path, output_path, config, log_fn, udim_tile=None):
    """
    对单张贴图：临时将贴图赋给高模，用 surfaceSampler 将高模的 diffuse 采样到低模 UV，写出到 output_path。
    udim_tile: 若指定，高模与低模均仅保留该 UDIM 象限的面参与采样。
    """
    low_shape = _get_shape(low_transform)
    high_shape = _get_shape(high_transform)
    if not low_shape or not high_shape:
        if log_fn:
            log_fn(u"无法获取低模或高模的 mesh 形节点: %s / %s" % (low_transform, high_transform))
        return False
    if _is_udim_template(texture_path):
        if log_fn:
            log_fn(u"UDIM 模板路径未展开，请重新扫描高模: %s" % texture_path)
        return False
    if not os.path.isfile(texture_path):
        if log_fn:
            log_fn(u"贴图不存在: %s" % texture_path)
        return False

    source_transform, source_shape, temp_dup_high = _make_high_source_for_udim_tile(
        high_transform, high_shape, udim_tile, log_fn,
    )
    if udim_tile and source_transform is None:
        return False

    if udim_tile:
        target_transform, target_shape, temp_dup_low = _make_mesh_isolated_for_udim_tile(
            low_transform, low_shape, udim_tile,
            dup_name="transferTempLow#", role=u"低模", log_fn=log_fn,
        )
        if target_transform is None:
            if temp_dup_high and cmds.objExists(temp_dup_high):
                try:
                    cmds.delete(temp_dup_high)
                except Exception:
                    pass
            return False
    else:
        target_transform, target_shape, temp_dup_low = low_transform, low_shape, None

    # 高模当前材质与着色引擎，用于恢复（用 long 名保证引用稳定；始终恢复原始 high_shape）
    try:
        high_sgs = cmds.listConnections(high_shape, type="shadingEngine") or []
    except Exception:
        high_sgs = []
    # 创建临时 lambert + file，赋给采样用高模（可能是 UDIM 隔离副本）
    temp_shader = cmds.shadingNode("lambert", asShader=True, name="transferTempLambert#")
    temp_sg = cmds.sets(renderable=True, noSurfaceShader=True, empty=True, name="transferTempSG#")
    cmds.connectAttr(temp_shader + ".outColor", temp_sg + ".surfaceShader", force=True)
    file_node = cmds.shadingNode("file", asTexture=True, name="transferTempFile#")
    place2d = cmds.shadingNode("place2dTexture", asUtility=True, name="transferTempPlace2d#")
    for attr_in, attr_out in [
        ("coverage", "coverage"), ("translateFrame", "translateFrame"), ("rotateFrame", "rotateFrame"),
        ("mirrorU", "mirrorU"), ("mirrorV", "mirrorV"), ("stagger", "stagger"),
        ("wrapU", "wrapU"), ("wrapV", "wrapV"), ("repeatUV", "repeatUV"),
        ("offset", "offset"), ("rotateUV", "rotateUV"), ("noiseUV", "noiseUV"),
        ("vertexUvOne", "vertexUvOne"), ("vertexUvTwo", "vertexUvTwo"), ("vertexUvThree", "vertexUvThree"),
        ("vertexCameraOne", "vertexCameraOne"), ("outUV", "uv"), ("outUvFilterSize", "uvFilterSize"),
    ]:
        if cmds.attributeQuery(attr_in, node=place2d, exists=True) and cmds.attributeQuery(attr_out, node=file_node, exists=True):
            try:
                cmds.connectAttr(place2d + "." + attr_in, file_node + "." + attr_out, force=True)
            except Exception:
                pass
    cmds.setAttr(file_node + ".fileTextureName", texture_path, type="string")
    cmds.connectAttr(file_node + ".outColor", temp_shader + ".color", force=True)
    cmds.sets(source_shape, edit=True, forceElement=temp_sg)

    try:
        width = int(config.get("map_width", 256))
        height = int(config.get("map_height", 256))
        ext = os.path.splitext(output_path)[1].lower().lstrip(".")
        if not ext:
            ext = "png"
        file_format = ext if ext in ("png", "jpg", "jpeg", "tga", "tif", "tiff", "exr", "bmp") else "png"
        filename_no_ext = output_path
        if output_path.lower().endswith((".png", ".jpg", ".jpeg", ".tga", ".tif", ".tiff", ".exr", ".bmp")):
            filename_no_ext = os.path.splitext(output_path)[0]

        # 输出目录不存在则自动创建
        out_dir = os.path.dirname(output_path)
        if out_dir:
            try:
                os.makedirs(out_dir, exist_ok=True)
            except Exception:
                pass

        # surfaceSampler: source/target 指定源与目标 mesh。
        # transfer_in 对应 ignoreTransforms：world=使用变换(世界空间)，object=忽略变换(对象空间)。
        transfer_in = (config.get("transfer_in") or "world").lower()
        ignore_transforms = (transfer_in == "object")
        max_search = float(config.get("max_search_distance", 0.0) or 0.0)
        sampler_kwargs = dict(
            source=source_shape,
            target=target_shape,
            mapOutput="diffuseRGB",
            mapWidth=width,
            mapHeight=height,
            filename=filename_no_ext,
            fileFormat=file_format,
            filterSize=float(config.get("filter_size", 3.0)),
            filterType=_filter_type_to_int(config.get("filter_type")),
            superSampling=_super_sampling_int(config.get("sample_quality")),
            ignoreMirroredFaces=bool(config.get("ignore_mirrored_faces", False)),
            flipU=bool(config.get("flip_u", False)),
            flipV=bool(config.get("flip_v", False)),
            overscan=int(config.get("fill_texture_seams", 1)),
            ignoreTransforms=ignore_transforms,
        )
        # 包裹距离：仅当 >0 时才显式设置，0 表示不限制（采用 Maya 默认）
        if max_search > 0.0:
            sampler_kwargs["maxSearchDistance"] = max_search
        cmds.surfaceSampler(**sampler_kwargs)
        if log_fn and os.path.isfile(output_path):
            log_fn(u"已写出: %s" % output_path)
    except Exception as e:
        if log_fn:
            log_fn(u"surfaceSampler 失败: %s" % str(e))
        raise
    finally:
        # 先恢复原始高模到原着色组，再删除临时节点与 UDIM 隔离副本
        if high_sgs:
            sg = high_sgs[0]
            try:
                cmds.sets(high_shape, edit=True, forceElement=sg)
            except Exception:
                try:
                    cmds.sets(high_shape, edit=True, addElement=sg)
                except Exception:
                    pass
        if temp_dup_high and cmds.objExists(temp_dup_high):
            try:
                cmds.delete(temp_dup_high)
            except Exception:
                pass
        if temp_dup_low and cmds.objExists(temp_dup_low):
            try:
                cmds.delete(temp_dup_low)
            except Exception:
                pass
        try:
            cmds.delete(temp_sg, temp_shader, file_node, place2d)
        except Exception:
            pass
    return True


def _get_output_dir_from_config(config):
    """根据配置计算输出目录（与 _output_path_for 一致，供合并模式复用）"""
    out_dir = (config.get("output_dir") or "").strip()
    if not out_dir:
        try:
            scene_dir = cmds.file(query=True, sceneName=True)
            if scene_dir:
                out_dir = os.path.dirname(scene_dir)
        except Exception:
            pass
    if not out_dir:
        out_dir = os.path.expanduser("~")
    return out_dir


def _parse_channel_from_output_name(filename):
    """从输出文件名中解析通道名（BaseColor/Roughness/Metallic/Normal/Emission/Alpha/Misc）。

    支持新命名 Set_low_from_high_BaseColor_1001.png 及旧命名 Set_Low_BaseColor.png。
    """
    _KNOWN = (u"BaseColor", u"Roughness", u"Metallic", u"Normal", u"Emission", u"Alpha")
    if not filename:
        return u"Misc"
    name = os.path.splitext(os.path.basename(filename))[0]
    if not name:
        return u"Misc"
    parts = name.split("_")
    if not parts:
        return u"Misc"
    for part in reversed(parts):
        token = (part or "").strip()
        if not token:
            continue
        if token.isdigit():
            continue
        if token.lower() in ("from", "seq"):
            continue
        chan_norm = token[0].upper() + token[1:] if token else token
        if chan_norm in _KNOWN:
            return chan_norm
    # 兼容旧规则：最后一段或倒数第二段（数字序号）
    last = parts[-1]
    if last.isdigit() and len(parts) >= 2:
        chan = parts[-2]
    else:
        chan = last
    chan = chan.strip()
    if not chan:
        return u"Misc"
    chan_norm = chan[0].upper() + chan[1:]
    if chan_norm in _KNOWN:
        return chan_norm
    return u"Misc"


def _ensure_material_for_low(low_transform, set_name, channel_to_paths, log_fn=None):
    """根据通道->贴图路径，为指定低模创建/更新一个材质并赋予该低模。"""
    if not cmds or not low_transform or not cmds.objExists(low_transform):
        return
    # 没有任何有效通道则不创建材质
    valid_channels = [ch for ch, p in channel_to_paths.items() if ch != u"Misc" and p]
    if not valid_channels:
        return
    low_short = low_transform.split("|")[-1].split(":")[-1]
    set_prefix = (set_name or u"").strip()
    if set_prefix:
        base_name = u"%s_%s" % (set_prefix, low_short)
    else:
        base_name = low_short
    mat_name = (base_name + u"_Mat").replace(" ", "_")
    # 创建 aiStandardSurface，若失败则退回 standardSurface，再失败退回 lambert
    shader = None
    for sh_type in ("aiStandardSurface", "standardSurface", "lambert"):
        try:
            shader = cmds.shadingNode(sh_type, asShader=True, name=mat_name)
            break
        except Exception:
            shader = None
            continue
    if not shader:
        if log_fn:
            log_fn(u"无法创建材质球: %s" % mat_name)
        return
    # 创建/连接 SG
    try:
        sg = cmds.sets(renderable=True, noSurfaceShader=True, empty=True, name=mat_name + "SG")
        cmds.connectAttr(shader + ".outColor", sg + ".surfaceShader", force=True)
    except Exception:
        try:
            sg = cmds.sets(renderable=True, noSurfaceShader=True, empty=True)
            cmds.connectAttr(shader + ".outColor", sg + ".surfaceShader", force=True)
        except Exception:
            sg = None
    # 公用的 place2dTexture
    place2d = None
    try:
        place2d = cmds.shadingNode("place2dTexture", asUtility=True, name=mat_name + "_place2d")
    except Exception:
        place2d = None

    def create_file_node(tex_path, is_color):
        fn = cmds.shadingNode("file", asTexture=True, name=mat_name + "_file")
        # 连接 place2d
        if place2d:
            for attr_in, attr_out in [
                ("coverage", "coverage"), ("translateFrame", "translateFrame"), ("rotateFrame", "rotateFrame"),
                ("mirrorU", "mirrorU"), ("mirrorV", "mirrorV"), ("stagger", "stagger"),
                ("wrapU", "wrapU"), ("wrapV", "wrapV"), ("repeatUV", "repeatUV"),
                ("offset", "offset"), ("rotateUV", "rotateUV"), ("noiseUV", "noiseUV"),
                ("vertexUvOne", "vertexUvOne"), ("vertexUvTwo", "vertexUvTwo"), ("vertexUvThree", "vertexUvThree"),
                ("vertexCameraOne", "vertexCameraOne"), ("outUV", "uv"), ("outUvFilterSize", "uvFilterSize"),
            ]:
                try:
                    if cmds.attributeQuery(attr_in, node=place2d, exists=True) and cmds.attributeQuery(attr_out, node=fn, exists=True):
                        cmds.connectAttr(place2d + "." + attr_in, fn + "." + attr_out, force=True)
                except Exception:
                    continue
        try:
            cmds.setAttr(fn + ".fileTextureName", tex_path, type="string")
        except Exception:
            pass
        # 尝试设置颜色空间：颜色贴图 sRGB，其它 Raw
        try:
            if cmds.attributeQuery("colorSpace", node=fn, exists=True):
                cmds.setAttr(fn + ".colorSpace", "sRGB" if is_color else "Raw", type="string")
        except Exception:
            pass
        # 非颜色数据用 Alpha 为亮度
        if not is_color:
            try:
                if cmds.attributeQuery("alphaIsLuminance", node=fn, exists=True):
                    cmds.setAttr(fn + ".alphaIsLuminance", 1)
            except Exception:
                pass
        return fn

    def connect_channel(ch, tex_path):
        if not tex_path or not os.path.isfile(tex_path):
            return
        # BaseColor: 直接连到 baseColor/color
        if ch == u"BaseColor":
            fn = create_file_node(tex_path, is_color=True)
            if cmds.attributeQuery("baseColor", node=shader, exists=True):
                cmds.connectAttr(fn + ".outColor", shader + ".baseColor", force=True)
            elif cmds.attributeQuery("color", node=shader, exists=True):
                cmds.connectAttr(fn + ".outColor", shader + ".color", force=True)
        # Roughness: 连到 specularRoughness
        elif ch == u"Roughness":
            fn = create_file_node(tex_path, is_color=False)
            if cmds.attributeQuery("specularRoughness", node=shader, exists=True):
                cmds.connectAttr(fn + ".outAlpha", shader + ".specularRoughness", force=True)
            elif cmds.attributeQuery("roughness", node=shader, exists=True):
                cmds.connectAttr(fn + ".outAlpha", shader + ".roughness", force=True)
        # Metallic: 连到 metalness/metallic
        elif ch == u"Metallic":
            fn = create_file_node(tex_path, is_color=False)
            if cmds.attributeQuery("metalness", node=shader, exists=True):
                cmds.connectAttr(fn + ".outAlpha", shader + ".metalness", force=True)
            elif cmds.attributeQuery("metallic", node=shader, exists=True):
                cmds.connectAttr(fn + ".outAlpha", shader + ".metallic", force=True)
        # Normal: 使用 aiNormalMap 或 bump2d
        elif ch == u"Normal":
            fn = create_file_node(tex_path, is_color=False)
            normal_node = None
            for nt in ("aiNormalMap", "bump2d"):
                try:
                    normal_node = cmds.shadingNode(nt, asUtility=True, name=mat_name + "_" + nt)
                    break
                except Exception:
                    normal_node = None
                    continue
            if normal_node:
                try:
                    if cmds.nodeType(normal_node) == "aiNormalMap":
                        if cmds.attributeQuery("input", node=normal_node, exists=True):
                            cmds.connectAttr(fn + ".outColor", normal_node + ".input", force=True)
                    else:
                        # bump2d：用 outAlpha 作为高度
                        if cmds.attributeQuery("bumpInterp", node=normal_node, exists=True):
                            cmds.setAttr(normal_node + ".bumpInterp", 1)  # Tangent space normals
                        if cmds.attributeQuery("bumpValue", node=normal_node, exists=True):
                            cmds.connectAttr(fn + ".outAlpha", normal_node + ".bumpValue", force=True)
                    if cmds.attributeQuery("normalCamera", node=shader, exists=True):
                        out_attr = "outValue" if cmds.attributeQuery("outValue", node=normal_node, exists=True) else "outNormal"
                        cmds.connectAttr(normal_node + "." + out_attr, shader + ".normalCamera", force=True)
                except Exception:
                    pass
        # Emission: 连到 emissionColor/emission
        elif ch == u"Emission":
            fn = create_file_node(tex_path, is_color=True)
            if cmds.attributeQuery("emissionColor", node=shader, exists=True):
                cmds.connectAttr(fn + ".outColor", shader + ".emissionColor", force=True)
            elif cmds.attributeQuery("emission", node=shader, exists=True):
                cmds.connectAttr(fn + ".outColor", shader + ".emission", force=True)
        # Alpha: 连到 opacity/transparency
        elif ch == u"Alpha":
            fn = create_file_node(tex_path, is_color=False)
            if cmds.attributeQuery("opacity", node=shader, exists=True):
                cmds.connectAttr(fn + ".outAlpha", shader + ".opacity", force=True)
            elif cmds.attributeQuery("transparency", node=shader, exists=True):
                cmds.connectAttr(fn + ".outColor", shader + ".transparency", force=True)

    # 按固定顺序连接各通道
    for ch in (u"BaseColor", u"Roughness", u"Metallic", u"Normal", u"Emission", u"Alpha"):
        path = channel_to_paths.get(ch)
        if path:
            connect_channel(ch, path)

    # 将材质赋给低模
    if sg:
        try:
            cmds.sets(low_transform, edit=True, forceElement=sg)
        except Exception:
            try:
                cmds.sets(low_transform, edit=True, addElement=sg)
            except Exception:
                pass
    if log_fn:
        log_fn(u"已为低模 %s 组装材质 %s" % (low_short, mat_name))


def assemble_materials_for_transfer(groups, config, set_name=None, log_fn=None):
    """根据当前配置与输出结果，为低模自动组装材质并赋予。

    - 普通模式：每个低模根据自己的一套贴图组装一个材质（Set_低模_BaseColor/Roughness/...）。
    - 合并模式：整套贴图集共用一套合并后的贴图（Set_BaseColor/Roughness/...），组装一个材质赋给该集内所有低模。
    """
    if not cmds:
        return
    out_dir = _get_output_dir_from_config(config)
    merge_to_single = bool(config.get("merge_to_single", False))
    set_prefix = (set_name or u"").strip()
    if set_prefix:
        set_prefix = set_prefix + u"_"

    # 收集输出文件（仅当次运行的命名规则会覆盖旧文件，因此根据前缀筛选即可）
    try:
        files = [f for f in os.listdir(out_dir) if os.path.isfile(os.path.join(out_dir, f))]
    except Exception:
        files = []
    exts = (".png", ".jpg", ".jpeg", ".tga", ".tif", ".tiff", ".exr", ".bmp")

    if merge_to_single:
        # 合并模式：按通道收集整套贴图
        channel_to_paths = {}
        for fname in files:
            if not fname.lower().endswith(exts):
                continue
            if set_prefix and not fname.startswith(set_prefix):
                continue
            ch = _parse_channel_from_output_name(fname)
            full = os.path.join(out_dir, fname)
            if ch != u"Misc" and os.path.isfile(full):
                # 每个通道只取一张（若有多张，取第一张）
                if ch not in channel_to_paths:
                    channel_to_paths[ch] = full
        # 为该贴图集内所有低模创建同一材质
        if channel_to_paths:
            # 先选一个代表低模来创建材质
            rep_low = None
            for g in groups:
                low = g.get("low")
                if low and cmds.objExists(low):
                    rep_low = low
                    break
            if rep_low:
                _ensure_material_for_low(rep_low, set_name or u"", channel_to_paths, log_fn)
                # 找到刚创建的 SG，并赋给其他低模
                low_short = rep_low.split("|")[-1].split(":")[-1]
                base_name = ((set_name or u"").strip() + u"_" + low_short) if (set_name or u"").strip() else low_short
                mat_name = (base_name + u"_Mat").replace(" ", "_")
                sg_name = mat_name + "SG"
                if cmds.objExists(sg_name):
                    for g in groups:
                        low = g.get("low")
                        if not low or not cmds.objExists(low) or low == rep_low:
                            continue
                        try:
                            cmds.sets(low, edit=True, forceElement=sg_name)
                        except Exception:
                            try:
                                cmds.sets(low, edit=True, addElement=sg_name)
                            except Exception:
                                continue
                    if log_fn:
                        log_fn(u"已将材质 %s 赋予贴图集内所有低模" % mat_name)
        return

    # 普通模式：为每个低模单独组装一套材质
    for g in groups:
        low = g.get("low")
        if not low or not cmds.objExists(low):
            continue
        low_short = low.split("|")[-1].split(":")[-1]
        low_prefix = (set_prefix or u"") + low_short + u"_"
        # 该低模相关的输出贴图
        per_channel = {}
        for fname in files:
            if not fname.lower().endswith(exts):
                continue
            if not fname.startswith(low_prefix):
                continue
            ch = _parse_channel_from_output_name(fname)
            if ch == u"Misc":
                continue
            full = os.path.join(out_dir, fname)
            if not os.path.isfile(full):
                continue
            # 解析序号，优先使用无序号或序号最小的贴图
            name_no_ext = os.path.splitext(fname)[0]
            parts = name_no_ext.split("_")
            idx = 0
            if parts and parts[-1].isdigit():
                idx = int(parts[-1])
            best = per_channel.get(ch)
            if best is None or idx < best[0]:
                per_channel[ch] = (idx, full)
        if not per_channel:
            continue
        channel_to_paths = {ch: path for ch, (idx, path) in per_channel.items()}
        _ensure_material_for_low(low, set_name or u"", channel_to_paths, log_fn)
def _merge_channel_images(image_paths, output_path, log_fn=None):
    """将同一通道的多张贴图按 UV 叠合成一张。

    假设各低模 UV 不重叠，则简单按「非纯黑覆盖」即可：
    - 背景为纯黑 (0,0,0)；
    - 逐张遍历像素，当结果像素仍为纯黑而当前图像像素非纯黑时，写入该像素。
    """
    if not image_paths:
        return
    try:
        from transfermaps.ui.qt_imports import QImage
    except Exception:
        if log_fn:
            log_fn(u"无法导入 Qt 图像模块，跳过合并贴图")
        return
    first = QImage(image_paths[0])
    if first.isNull():
        return
    base = first.convertToFormat(QImage.Format_RGBA8888)
    w, h = base.width(), base.height()
    for path in image_paths[1:]:
        img = QImage(path)
        if img.isNull():
            continue
        if img.width() != w or img.height() != h:
            img = img.scaled(w, h)
        img = img.convertToFormat(QImage.Format_RGBA8888)
        for y in range(h):
            for x in range(w):
                dst = base.pixelColor(x, y)
                # 仅当当前结果是纯黑时，才考虑写入
                if dst.red() == 0 and dst.green() == 0 and dst.blue() == 0:
                    src = img.pixelColor(x, y)
                    if src.red() != 0 or src.green() != 0 or src.blue() != 0:
                        base.setPixelColor(x, y, src)
    # 保存合并结果
    out_dir = os.path.dirname(output_path)
    if out_dir:
        try:
            os.makedirs(out_dir, exist_ok=True)
        except Exception:
            pass
    base.save(output_path)
    if log_fn:
        log_fn(u"已写出合并贴图: %s" % output_path)


def _collect_single_transfer_tasks(groups, config, set_name, temp_dir=None, log_fn=None, event_pump=None):
    """收集传递任务；UDIM 材质按高模每个 UV 象限各生成一项。"""
    tasks = []
    for g in groups:
        if event_pump:
            try:
                event_pump()
            except Exception:
                pass
        low = g.get("low")
        if not low or not cmds.objExists(low):
            continue
        for pair in g.get("pairs", []):
            if event_pump:
                try:
                    event_pump()
                except Exception:
                    pass
            high = pair.get("high")
            if not high or not cmds.objExists(high):
                continue
            textures = list(pair.get("textures") or [])
            path_to_channel = {}
            try:
                for p, ch in get_mesh_textures_with_channels(high):
                    path_to_channel[_canonical_path_key(p)] = ch
            except Exception:
                pass
            if not textures and path_to_channel:
                textures = list(path_to_channel.keys())
            bake_items = _build_bake_items_for_high(high, textures, path_to_channel)
            if log_fn and bake_items:
                udim_nums = sorted(set(
                    item.get("udim_tile") for item in bake_items
                    if item.get("udim_tile") is not None
                ))
                if udim_nums:
                    high_name = high.split("|")[-1].split(":")[-1]
                    log_fn(
                        u"高模「%s」贴图 UDIM: %s（按磁盘文件命名）"
                        % (high_name, ", ".join(str(t) for t in udim_nums))
                    )
            for item in bake_items:
                tex_path = item["tex_path"]
                udim_tile = item.get("udim_tile")
                ch = item.get("channel") or u"tex"
                idx = item.get("index", 0)
                out_path = _output_path_for(
                    config, low, high, tex_path, idx,
                    channel_suffix=ch, set_name=set_name, udim_tile=udim_tile,
                )
                if temp_dir:
                    out_path = os.path.join(temp_dir, os.path.basename(out_path))
                tasks.append({
                    "low": low,
                    "high": high,
                    "tex_path": tex_path,
                    "out_path": out_path,
                    "channel": ch,
                    "udim_tile": udim_tile,
                })
    return tasks


def build_transfer_jobs(groups, config, set_name=None, log_fn=None, event_pump=None):
    """构建可逐步执行的传递任务队列（每项为 dict，含 type 字段）。"""
    if not cmds:
        return []
    jobs = [{"type": "log", "message": u"开始批量传递..."}]
    merge_to_single = bool(config.get("merge_to_single", False))
    if merge_to_single:
        jobs.append({"type": "log", "message": u"合并模式：同一贴图集内多低模按通道叠合为一套贴图"})
        out_dir = _get_output_dir_from_config(config)
        temp_dir = os.path.join(out_dir, "_TransferMapsBatch_MergedTemp")
        jobs.append({"type": "ensure_dir", "path": temp_dir})
        channel_to_paths = {}
        for task in _collect_single_transfer_tasks(
            groups, config, set_name, temp_dir=temp_dir, log_fn=log_fn, event_pump=event_pump,
        ):
            chan_safe = task["channel"]
            channel_to_paths.setdefault(chan_safe, []).append(task["out_path"])
            jobs.append({
                "type": "single",
                "low": task["low"],
                "high": task["high"],
                "tex_path": task["tex_path"],
                "out_path": task["out_path"],
                "udim_tile": task.get("udim_tile"),
                "config": config,
            })
        set_prefix = (set_name or u"").strip()
        if set_prefix:
            set_prefix = set_prefix + u"_"
        for ch, paths in channel_to_paths.items():
            merged_name = u"%s%s.png" % (set_prefix, ch or u"tex")
            merged_path = os.path.join(out_dir, merged_name)
            jobs.append({"type": "merge", "paths": list(paths), "output_path": merged_path})
    else:
        for task in _collect_single_transfer_tasks(
            groups, config, set_name, log_fn=log_fn, event_pump=event_pump,
        ):
            jobs.append({
                "type": "single",
                "low": task["low"],
                "high": task["high"],
                "tex_path": task["tex_path"],
                "out_path": task["out_path"],
                "udim_tile": task.get("udim_tile"),
                "config": config,
            })
    return jobs


def build_all_transfer_jobs(texture_sets, config, log_fn=None, event_pump=None):
    """为多个贴图集构建完整任务队列（含组装材质）。event_pump 用于构建过程中刷新 UI。"""
    clear_udim_face_cache()

    def _pump():
        if event_pump:
            try:
                event_pump()
            except Exception:
                pass

    all_jobs = []
    for ts in texture_sets or []:
        _pump()
        set_name = ts.get("name") or u""
        groups = ts.get("groups") or []
        if not groups:
            continue
        all_jobs.append({"type": "log", "message": u"传递贴图集: %s" % set_name})
        all_jobs.extend(build_transfer_jobs(
            groups, config, set_name=set_name, log_fn=log_fn, event_pump=event_pump,
        ))
        _pump()
        all_jobs.append({
            "type": "assemble",
            "groups": groups,
            "config": config,
            "set_name": set_name,
        })
    return all_jobs


def execute_transfer_job(job, log_fn=None, cancel_check=None):
    """执行单步传递任务。返回 ok / error / cancelled。"""
    if cancel_check and cancel_check():
        return "cancelled"
    if not job:
        return "ok"
    jtype = job.get("type")
    if jtype == "log":
        if log_fn:
            log_fn(job.get("message", u""))
        return "ok"
    if jtype == "ensure_dir":
        path = job.get("path")
        if path:
            try:
                os.makedirs(path, exist_ok=True)
            except Exception:
                pass
        return "ok"
    if jtype == "single":
        if cancel_check and cancel_check():
            return "cancelled"
        try:
            _run_single(
                job["low"], job["high"], job["tex_path"], job["out_path"],
                job.get("config") or {}, log_fn,
                udim_tile=job.get("udim_tile"),
            )
        except Exception as e:
            if log_fn:
                log_fn(u"传递失败 %s -> %s: %s" % (
                    job.get("tex_path"), job.get("out_path"), str(e),
                ))
            return "error"
        if cancel_check and cancel_check():
            return "cancelled"
        return "ok"
    if jtype == "merge":
        if cancel_check and cancel_check():
            return "cancelled"
        try:
            _merge_channel_images(job.get("paths") or [], job.get("output_path"), log_fn)
            return "ok"
        except Exception as e:
            if log_fn:
                log_fn(u"合并失败 %s: %s" % (job.get("output_path"), str(e)))
            return "error"
    if jtype == "assemble":
        if cancel_check and cancel_check():
            return "cancelled"
        try:
            assemble_materials_for_transfer(
                job.get("groups") or [],
                job.get("config") or {},
                set_name=job.get("set_name"),
                log_fn=log_fn,
            )
            return "ok"
        except Exception as e:
            if log_fn:
                log_fn(u"自动组装材质失败（不影响贴图传递结果）: %s" % str(e))
            return "error"
    return "ok"


def _run_transfer_normal(groups, config, log_fn, set_name, cancel_check=None):
    """原有逐 pair 传递逻辑：每个 (低模, 高模) 单独输出自己的贴图。"""
    total = 0
    for job in build_transfer_jobs(groups, config, set_name):
        if cancel_check and cancel_check():
            break
        result = execute_transfer_job(job, log_fn, cancel_check)
        if result == "cancelled":
            break
        if job.get("type") == "single" and result == "ok":
            total += 1
    return total


def _run_transfer_merged(groups, config, log_fn, set_name, cancel_check=None):
    """合并模式：同一贴图集内多低模，按通道叠合为一套贴图。"""
    total = 0
    for job in build_transfer_jobs(groups, config, set_name):
        if cancel_check and cancel_check():
            break
        result = execute_transfer_job(job, log_fn, cancel_check)
        if result == "cancelled":
            break
        if job.get("type") == "single" and result == "ok":
            total += 1
    return total


def run_transfer(groups, config, log_fn=None, set_name=None, cancel_check=None):
    """
    执行多组传递。groups 格式见 transfer_window。
    set_name: 贴图集名称，用于输出文件名前缀（如 GunSet_低模_from_高模_BaseColor_贴图.png）；
              每张贴图按材质连接通道（颜色/粗糙度/法线等）自动带通道后缀，避免混图。
    merge_to_single: 若为 True，则同一贴图集内多低模按通道叠合为一套贴图。
    """
    if not cmds:
        if log_fn:
            log_fn(u"非 Maya 环境，无法执行传递")
        return
    if log_fn:
        log_fn(u"开始批量传递...")
    merge_to_single = bool(config.get("merge_to_single", False))
    if merge_to_single:
        total = _run_transfer_merged(groups, config, log_fn, set_name, cancel_check=cancel_check)
    else:
        total = _run_transfer_normal(groups, config, log_fn, set_name, cancel_check=cancel_check)
    if cancel_check and cancel_check():
        if log_fn:
            log_fn(u"已取消，共完成 %d 张贴图（含合并前的中间图）。" % total)
        return total
    if log_fn:
        log_fn(u"完成，共传递 %d 张贴图（含合并前的中间图）。" % total)
    return total
