"""分镜拼图网格切分：适用于 Kumiko 无法识别的弱边框 / 白底分隔布局。"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np


def _smooth_1d(arr: np.ndarray, k: int) -> np.ndarray:
    k = max(3, k | 1)
    kernel = np.ones(k, dtype=np.float32) / k
    return np.convolve(arr.astype(np.float32), kernel, mode="same")


def _find_gutter_splits(proj: np.ndarray, length: int, *, min_gap: int, min_depth_ratio: float) -> list[int]:
    """在投影曲线中找「谷值」作为分隔线位置。返回内部切线坐标（不含 0 与 length）。"""
    if length <= 0:
        return []
    smoothed = _smooth_1d(proj, max(5, length // 80))
    peak = float(smoothed.max()) if smoothed.size else 0.0
    if peak <= 1:
        return []

    threshold = peak * min_depth_ratio
    splits: list[int] = []
    i = min_gap
    while i < length - min_gap:
        window = smoothed[max(0, i - min_gap // 2) : min(length, i + min_gap // 2 + 1)]
        if window.size == 0:
            i += 1
            continue
        center_val = float(smoothed[i])
        if center_val <= threshold:
            # 扩展到谷中心
            lo = hi = i
            while lo > min_gap and smoothed[lo - 1] <= threshold:
                lo -= 1
            while hi < length - min_gap and smoothed[hi + 1] <= threshold:
                hi += 1
            split_at = (lo + hi) // 2
            if not splits or split_at - splits[-1] >= min_gap:
                splits.append(split_at)
            i = hi + min_gap
        else:
            i += 1
    return splits


def _boxes_from_splits(width: int, height: int, xs: list[int], ys: list[int], *, margin: int) -> list[list[int]]:
    x_bounds = [0] + xs + [width]
    y_bounds = [0] + ys + [height]
    boxes: list[list[int]] = []
    for ri in range(len(y_bounds) - 1):
        for ci in range(len(x_bounds) - 1):
            x0 = x_bounds[ci] + margin
            y0 = y_bounds[ri] + margin
            x1 = x_bounds[ci + 1] - margin
            y1 = y_bounds[ri + 1] - margin
            w = x1 - x0
            h = y1 - y0
            if w >= 24 and h >= 24:
                boxes.append([x0, y0, w, h])
    return boxes


def detect_uniform_grid(
    image_path: str,
    *,
    cols: int,
    rows: int,
    margin: int = 4,
) -> dict[str, Any]:
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError("无法读取图片")
    h, w = img.shape[:2]
    cols = max(1, min(12, int(cols)))
    rows = max(1, min(12, int(rows)))
    cell_w = w / cols
    cell_h = h / rows
    boxes: list[list[int]] = []
    for r in range(rows):
        for c in range(cols):
            x0 = int(round(c * cell_w)) + margin
            y0 = int(round(r * cell_h)) + margin
            x1 = int(round((c + 1) * cell_w)) - margin
            y1 = int(round((r + 1) * cell_h)) - margin
            bw = x1 - x0
            bh = y1 - y0
            if bw >= 24 and bh >= 24:
                boxes.append([x0, y0, bw, bh])
    return {
        "engine": "uniform_grid",
        "size": [w, h],
        "panels": boxes,
        "grid": {"cols": cols, "rows": rows},
        "splits": {"x": [], "y": []},
    }


def detect_projection_grid(
    image_path: str,
    *,
    min_gap_ratio: float = 0.04,
    min_depth_ratio: float = 0.35,
    margin: int = 4,
    max_cols: int = 8,
    max_rows: int = 8,
) -> dict[str, Any]:
    """根据边缘/墨迹投影找横向、纵向分隔谷值，推断网格。"""
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError("无法读取图片")
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blur, 40, 120)

    # 形态学提取长横线/竖线（分镜表常见细线分隔）
    hk = max(8, w // 12)
    vk = max(8, h // 12)
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (hk, 1))
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, vk))
    _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    h_lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, h_kernel)
    v_lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, v_kernel)
    line_map = cv2.max(h_lines, v_lines)

    h_proj = (edges.astype(np.float32) * 0.6 + line_map.astype(np.float32) * 0.4).sum(axis=1)
    v_proj = (edges.astype(np.float32) * 0.6 + line_map.astype(np.float32) * 0.4).sum(axis=0)

    min_gap_y = max(8, int(h * min_gap_ratio))
    min_gap_x = max(8, int(w * min_gap_ratio))
    ys = _find_gutter_splits(h_proj, h, min_gap=min_gap_y, min_depth_ratio=min_depth_ratio)
    xs = _find_gutter_splits(v_proj, w, min_gap=min_gap_x, min_depth_ratio=min_depth_ratio)

    # 限制最大行列，去掉过密切线
    while len(ys) > max_rows - 1:
        ys.pop(len(ys) // 2)
    while len(xs) > max_cols - 1:
        xs.pop(len(xs) // 2)

    boxes = _boxes_from_splits(w, h, xs, ys, margin=margin)
    return {
        "engine": "projection_grid",
        "size": [w, h],
        "panels": boxes,
        "grid": {"cols": len(xs) + 1, "rows": len(ys) + 1},
        "splits": {"x": xs, "y": ys},
    }


def _quality_ok(panels: list[list[int]], width: int, height: int, *, max_panels: int = 16) -> bool:
    if len(panels) <= 1:
        return False
    if len(panels) > max_panels:
        return False
    img_area = max(1, width * height)
    areas = sorted(p[2] * p[3] for p in panels if len(p) == 4)
    if not areas:
        return False
    median_area = areas[len(areas) // 2]
    if median_area < img_area * 0.045:
        return False
    return True


def detect_panels_auto(
    image_path: str,
    *,
    kumiko_detect,
    cols: int | None = None,
    rows: int | None = None,
    prefer: str = "auto",
) -> dict[str, Any]:
    """
    auto: 先 Kumiko，若仅 1 格则试 projection_grid，仍 1 格且给了行列则用 uniform_grid
    kumiko / grid / uniform 强制指定引擎
    """
    if prefer == "uniform" and cols and rows:
        out = detect_uniform_grid(image_path, cols=cols, rows=rows)
        out["fallback"] = None
        return out

    if prefer == "grid":
        out = detect_projection_grid(image_path)
        w, h = out["size"]
        if not _quality_ok(out["panels"], w, h) and cols and rows:
            out = detect_uniform_grid(image_path, cols=cols, rows=rows)
            out["fallback"] = "uniform_after_grid"
        elif not _quality_ok(out["panels"], w, h):
            out["warn"] = "分隔线检测不稳定，请填写列×行后重试（均匀网格）。"
        else:
            out["fallback"] = None
        return out

    k_info = kumiko_detect()
    k_panels = k_info.get("panels") or []
    if prefer == "kumiko" or len(k_panels) > 1:
        return {
            "engine": "kumiko",
            "size": k_info.get("size"),
            "panels": k_panels,
            "gutters": k_info.get("gutters"),
            "numbering": k_info.get("numbering"),
            "processing_time": k_info.get("processing_time"),
            "fallback": None,
        }

    # 分镜表：用户已知列×行时，均匀网格比 Kumiko/投影更可靠
    if cols and rows:
        uni = detect_uniform_grid(image_path, cols=cols, rows=rows)
        uni["fallback"] = "uniform_after_kumiko_whole"
        uni["kumikoPanelCount"] = len(k_panels)
        return uni

    proj = detect_projection_grid(image_path)
    w, h = proj["size"]
    if _quality_ok(proj["panels"], w, h, max_panels=12):
        proj["fallback"] = "projection_after_kumiko_whole"
        proj["kumikoPanelCount"] = len(k_panels)
        return proj

    return {
        "engine": "kumiko",
        "size": k_info.get("size"),
        "panels": k_panels,
        "gutters": k_info.get("gutters"),
        "numbering": k_info.get("numbering"),
        "processing_time": k_info.get("processing_time"),
        "fallback": None,
        "warn": "仅识别到整图 1 格：影视分镜表通常无漫画黑框，Kumiko 不适用。请填写与实际拼图一致的列×行（如 3×2），模式选「均匀网格」。",
    }
