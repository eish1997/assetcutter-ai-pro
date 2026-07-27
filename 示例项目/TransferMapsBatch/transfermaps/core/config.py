# -*- coding: utf-8 -*-
"""
传递贴图工具配置：Maya 公用输出相关设置持久化
"""

import os
import sys
import json

CONFIG_FILENAME = "transfer_maps_batch_config.json"


def _get_config_dir():
    try:
        import maya.cmds as cmds
        user_dir = cmds.internalVar(userAppDir=True)
    except Exception:
        user_dir = os.path.expanduser("~")
    config_dir = os.path.join(user_dir, "TransferMapsBatch")
    try:
        if not os.path.isdir(config_dir):
            os.makedirs(config_dir)
    except Exception:
        config_dir = user_dir
    return config_dir


def get_config_path():
    return os.path.join(_get_config_dir(), CONFIG_FILENAME)


def default_config():
    """与 Maya 传递贴图「Maya 公用输出」默认一致。采样/滤波略提高以减少小点点/破面。"""
    return {
        "map_width": 256,
        "map_height": 256,
        "keep_aspect_ratio": True,
        "transfer_in": "world",           # world | object（对应 surfaceSampler ignoreTransforms）
        "sample_quality": "medium",       # low(2x2) | medium(3x3) | high(4x4)，medium 以上可减少斑点
        "filter_size": 5.0,               # 略大滤波核，减少小点点/破面（原 3.0）
        "filter_type": "gaussian",        # gaussian | box | triangle | quadratic
        "fill_texture_seams": 1,
        "ignore_mirrored_faces": False,
        "flip_u": False,
        "flip_v": False,
        "output_dir": "",
        # 最大搜索距离（包裹距离），对应 surfaceSampler maxSearchDistance；0 表示不限制
        "max_search_distance": 0.0,
        # 是否按贴图集将多低模的贴图按 UV 叠合为一套
        "merge_to_single": False,
    }


def load_config():
    path = get_config_path()
    if not path or not os.path.isfile(path):
        return default_config()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return default_config()
    out = default_config()
    for k, v in data.items():
        if k in out:
            out[k] = v
    return out


def save_config(cfg):
    path = get_config_path()
    if not path:
        return
    try:
        d = os.path.dirname(path)
        if d and not os.path.isdir(d):
            os.makedirs(d)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception:
        pass
