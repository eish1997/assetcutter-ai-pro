from __future__ import annotations

from dataclasses import dataclass
from typing import BinaryIO

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class Tri:
    v: tuple[int, int, int]  # position indices (0-based)
    vt: tuple[int, int, int]  # texcoord indices (0-based, -1 if missing)


@dataclass(frozen=True)
class SeamSide:
    # UV coordinates of seam edge endpoints in this triangle
    uv0: np.ndarray  # shape (2,)
    uv1: np.ndarray  # shape (2,)
    uv2: np.ndarray  # third vertex UV in this triangle, shape (2,)


@dataclass(frozen=True)
class SeamPair:
    a: SeamSide
    b: SeamSide


def _srgb_to_linear(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0).astype(np.float32)
    a = 0.055
    return np.where(x <= 0.04045, x / 12.92, ((x + a) / (1.0 + a)) ** 2.4).astype(np.float32)


def _linear_to_srgb(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0).astype(np.float32)
    a = 0.055
    return np.where(x <= 0.0031308, x * 12.92, (1.0 + a) * (x ** (1.0 / 2.4)) - a).astype(np.float32)


def _normal_rgb_to_vec(rgb: np.ndarray) -> np.ndarray:
    v = (rgb.astype(np.float32) * 2.0 - 1.0).astype(np.float32)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    n = np.maximum(n, 1e-8)
    return (v / n).astype(np.float32)


def _normal_vec_to_rgb(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    n = np.maximum(n, 1e-8)
    v = (v / n).astype(np.float32)
    return np.clip(v * 0.5 + 0.5, 0.0, 1.0).astype(np.float32)


class _RunningStatsVec3:
    def __init__(self) -> None:
        self.n = 0
        self.mean = np.zeros((3,), dtype=np.float64)
        self.M2 = np.zeros((3,), dtype=np.float64)

    def add(self, x: np.ndarray) -> None:
        # x: (3,)
        x64 = x.astype(np.float64)
        self.n += 1
        delta = x64 - self.mean
        self.mean += delta / float(self.n)
        delta2 = x64 - self.mean
        self.M2 += delta * delta2

    def finalize(self) -> tuple[np.ndarray, np.ndarray]:
        if self.n <= 1:
            var = np.zeros((3,), dtype=np.float64)
        else:
            var = self.M2 / float(self.n - 1)
        std = np.sqrt(np.maximum(var, 0.0))
        return self.mean.astype(np.float32), std.astype(np.float32)


def _canonicalize_positions(verts: list[np.ndarray], eps: float = 1e-5) -> list[int]:
    """
    OBJ 有时会在 UV seam 处复制顶点（不同 index 但位置相同）。
    这里把“位置几乎相同”的顶点归并成同一个 canonical id，用于建立 3D 邻接边。
    """
    scale = 1.0 / float(eps)
    table: dict[tuple[int, int, int], int] = {}
    canon: list[int] = [0] * len(verts)
    next_id = 0
    for i, p in enumerate(verts):
        key = (int(round(float(p[0]) * scale)), int(round(float(p[1]) * scale)), int(round(float(p[2]) * scale)))
        cid = table.get(key)
        if cid is None:
            cid = next_id
            table[key] = cid
            next_id += 1
        canon[i] = cid
    return canon


def _parse_obj(file: BinaryIO) -> tuple[list[np.ndarray], list[np.ndarray], list[Tri]]:
    """
    Minimal OBJ parser.
    Supports: v, vt, f (tri or polygon; polygon is fan-triangulated).
    Face elements can be: v, v/vt, v//vn, v/vt/vn.
    """
    verts: list[np.ndarray] = []
    uvs: list[np.ndarray] = []
    tris: list[Tri] = []

    def parse_face_token(tok: str) -> tuple[int, int]:
        parts = tok.split("/")
        v_i = int(parts[0])
        vt_i = int(parts[1]) if len(parts) >= 2 and parts[1] != "" else 0

        # OBJ is 1-based, negative means relative to end
        if v_i < 0:
            v_i = len(verts) + 1 + v_i
        if vt_i < 0:
            vt_i = len(uvs) + 1 + vt_i

        v_idx0 = v_i - 1
        vt_idx0 = vt_i - 1 if vt_i != 0 else -1
        return v_idx0, vt_idx0

    for raw in file.read().decode("utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("v "):
            _, x, y, z, *rest = line.split()
            verts.append(np.array([float(x), float(y), float(z)], dtype=np.float32))
        elif line.startswith("vt "):
            parts = line.split()
            # vt u v [w]
            u = float(parts[1])
            v = float(parts[2]) if len(parts) > 2 else 0.0
            uvs.append(np.array([u, v], dtype=np.float32))
        elif line.startswith("f "):
            tokens = line.split()[1:]
            if len(tokens) < 3:
                continue
            vv: list[tuple[int, int]] = [parse_face_token(t) for t in tokens]
            # fan triangulation: (0,i,i+1)
            for i in range(1, len(vv) - 1):
                v0, vt0 = vv[0]
                v1, vt1 = vv[i]
                v2, vt2 = vv[i + 1]
                tris.append(Tri(v=(v0, v1, v2), vt=(vt0, vt1, vt2)))

    if not uvs:
        raise ValueError("OBJ 缺少 vt（UV）数据，无法进行 seam-aware 修复。")
    if not tris:
        raise ValueError("OBJ 未解析到任何面（f）。")
    return verts, uvs, tris


def _uv_equal(a: np.ndarray, b: np.ndarray, eps: float = 1e-6) -> bool:
    return float(np.max(np.abs(a - b))) <= eps


def _compute_inward_dir(uv0: np.ndarray, uv1: np.ndarray, uv2: np.ndarray) -> np.ndarray:
    """
    Compute a 2D unit vector roughly perpendicular to the edge (uv0->uv1),
    pointing into the triangle interior (towards uv2).
    """
    e = uv1 - uv0
    n = np.array([-e[1], e[0]], dtype=np.float32)
    mid = (uv0 + uv1) * 0.5
    if float(np.dot(n, uv2 - mid)) < 0.0:
        n = -n
    ln = float(np.linalg.norm(n))
    if ln < 1e-12:
        # Degenerate UVs; fallback to direction to uv2
        n = uv2 - mid
        ln = float(np.linalg.norm(n))
        if ln < 1e-12:
            return np.array([0.0, 0.0], dtype=np.float32)
    return (n / ln).astype(np.float32)


def _build_seam_pairs(verts: list[np.ndarray], uvs: list[np.ndarray], tris: list[Tri]) -> list[SeamPair]:
    """
    Detect UV seams by shared 3D edges whose endpoint UVs differ across the adjacent triangles.
    """
    canon = _canonicalize_positions(verts)

    # edge key by canonical position indices (unordered)
    edge_map: dict[tuple[int, int], list[tuple[int, int, int, int]]] = {}
    # store occurrences: (tri_idx, local_i0, local_i1, local_i2)
    for ti, tri in enumerate(tris):
        for (i0, i1, i2) in [(0, 1, 2), (1, 2, 0), (2, 0, 1)]:
            a = canon[tri.v[i0]]
            b = canon[tri.v[i1]]
            key = (a, b) if a < b else (b, a)
            edge_map.setdefault(key, []).append((ti, i0, i1, i2))

    seam_pairs: list[SeamPair] = []

    for _, occ in edge_map.items():
        if len(occ) != 2:
            continue  # boundary or non-manifold; skip
        (t0, i00, i01, i02) = occ[0]
        (t1, i10, i11, i12) = occ[1]
        tri0 = tris[t0]
        tri1 = tris[t1]

        # Build canonical orientation by sorting shared canonical ids
        a_pos0 = canon[tri0.v[i00]]
        a_pos1 = canon[tri0.v[i01]]
        key_a0, key_a1 = (a_pos0, a_pos1) if a_pos0 < a_pos1 else (a_pos1, a_pos0)

        def get_uv_for_pos(tri: Tri, local_i: int) -> np.ndarray:
            vt_idx = tri.vt[local_i]
            if vt_idx < 0:
                raise ValueError("OBJ 面缺少 vt 索引，无法 seam-aware 修复。")
            return uvs[vt_idx]

        def side_for(tri: Tri, i0: int, i1: int, i2: int, key0: int, key1: int) -> SeamSide:
            pos0 = canon[tri.v[i0]]
            pos1 = canon[tri.v[i1]]
            uv0 = get_uv_for_pos(tri, i0)
            uv1 = get_uv_for_pos(tri, i1)
            # reorder to canonical endpoint order (key0 -> key1)
            if pos0 == key0 and pos1 == key1:
                u0, u1 = uv0, uv1
            elif pos0 == key1 and pos1 == key0:
                u0, u1 = uv1, uv0
            else:
                # Should not happen for shared edge
                u0, u1 = uv0, uv1
            uv2 = get_uv_for_pos(tri, i2)
            return SeamSide(uv0=u0.astype(np.float32), uv1=u1.astype(np.float32), uv2=uv2.astype(np.float32))

        side0 = side_for(tri0, i00, i01, i02, key_a0, key_a1)
        side1 = side_for(tri1, i10, i11, i12, key_a0, key_a1)

        # If UV endpoints match (either same orientation due to canonical reorder), not a seam
        if _uv_equal(side0.uv0, side1.uv0) and _uv_equal(side0.uv1, side1.uv1):
            continue

        seam_pairs.append(SeamPair(a=side0, b=side1))

    return seam_pairs


def _mask_from_image(mask_img: Image.Image, w: int, h: int, threshold: int = 16) -> np.ndarray:
    m = mask_img.convert("L").resize((w, h), Image.NEAREST)
    arr = np.asarray(m, dtype=np.uint8)
    return arr >= np.uint8(threshold)


def _binary_dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """
    Fast-ish binary dilation using repeated 3x3 max filters.
    radius: number of iterations (approx pixels).
    """
    if radius <= 0:
        return mask
    m = mask.copy()
    for _ in range(radius):
        p = np.pad(m, ((1, 1), (1, 1)), mode="constant", constant_values=False)
        m = (
            p[1:-1, 1:-1]
            | p[:-2, 1:-1]
            | p[2:, 1:-1]
            | p[1:-1, :-2]
            | p[1:-1, 2:]
            | p[:-2, :-2]
            | p[:-2, 2:]
            | p[2:, :-2]
            | p[2:, 2:]
        )
    return m


def _binary_erode(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask
    m = mask.copy()
    for _ in range(radius):
        p = np.pad(m, ((1, 1), (1, 1)), mode="constant", constant_values=False)
        m = (
            p[1:-1, 1:-1]
            & p[:-2, 1:-1]
            & p[2:, 1:-1]
            & p[1:-1, :-2]
            & p[1:-1, 2:]
            & p[:-2, :-2]
            & p[:-2, 2:]
            & p[2:, :-2]
            & p[2:, 2:]
        )
    return m


def _compute_alpha_distance(hit: np.ndarray, feather_px: int) -> np.ndarray:
    """
    Compute alpha inside hit region based on (approx) distance to boundary.
    alpha=0 at boundary, alpha=1 deeper than feather_px.
    Uses iterative erosion up to feather_px, clipped for speed.
    """
    if feather_px <= 0 or not np.any(hit):
        return hit.astype(np.float32)

    # ROI crop for performance
    ys, xs = np.where(hit)
    y0 = max(int(ys.min()) - feather_px - 2, 0)
    y1 = min(int(ys.max()) + feather_px + 3, hit.shape[0])
    x0 = max(int(xs.min()) - feather_px - 2, 0)
    x1 = min(int(xs.max()) + feather_px + 3, hit.shape[1])

    roi = hit[y0:y1, x0:x1]
    dist = np.full(roi.shape, feather_px, dtype=np.int16)

    curr = roi.copy()
    for k in range(feather_px):
        if not np.any(curr):
            break
        er = _binary_erode(curr, 1)
        shell = curr & (~er)
        dist[shell] = k
        curr = er
    if np.any(curr):
        dist[curr] = feather_px

    alpha_roi = (dist.astype(np.float32) / float(feather_px)).astype(np.float32)
    alpha = np.zeros_like(hit, dtype=np.float32)
    alpha[y0:y1, x0:x1] = np.clip(alpha_roi, 0.0, 1.0)
    return alpha


def _box_filter_2d(a: np.ndarray, r: int) -> np.ndarray:
    if r <= 0:
        return a
    # horizontal
    pad = np.pad(a, ((0, 0), (r, r)), mode="edge")
    c = np.cumsum(pad, axis=1, dtype=np.float32)
    c = np.concatenate([np.zeros((c.shape[0], 1), dtype=np.float32), c], axis=1)
    wsize = 2 * r + 1
    h = (c[:, wsize:] - c[:, :-wsize]) / float(wsize)
    # vertical
    pad2 = np.pad(h, ((r, r), (0, 0)), mode="edge")
    c2 = np.cumsum(pad2, axis=0, dtype=np.float32)
    c2 = np.concatenate([np.zeros((1, c2.shape[1]), dtype=np.float32), c2], axis=0)
    v = (c2[wsize:, :] - c2[:-wsize, :]) / float(wsize)
    return v.astype(np.float32)


def _guided_filter_gray(I: np.ndarray, p: np.ndarray, r: int, eps: float) -> np.ndarray:
    """
    Guided filter for grayscale guide I and input p.
    I,p: HxW float32 in [0,1]
    """
    I = I.astype(np.float32)
    p = p.astype(np.float32)
    mean_I = _box_filter_2d(I, r)
    mean_p = _box_filter_2d(p, r)
    mean_Ip = _box_filter_2d(I * p, r)
    cov_Ip = mean_Ip - mean_I * mean_p
    mean_II = _box_filter_2d(I * I, r)
    var_I = mean_II - mean_I * mean_I
    a = cov_Ip / (var_I + float(eps))
    b = mean_p - a * mean_I
    mean_a = _box_filter_2d(a, r)
    mean_b = _box_filter_2d(b, r)
    q = mean_a * I + mean_b
    return q.astype(np.float32)


def _laplacian_noroll(img: np.ndarray) -> np.ndarray:
    """4-neighbor Laplacian without wrap-around artifacts."""
    # img: HxWxC
    p = np.pad(img, ((1, 1), (1, 1), (0, 0)), mode="edge")
    c = p[1:-1, 1:-1]
    up = p[:-2, 1:-1]
    dn = p[2:, 1:-1]
    lf = p[1:-1, :-2]
    rt = p[1:-1, 2:]
    return (-4.0 * c + up + dn + lf + rt).astype(np.float32)


def _poisson_blend_roi(
    src_roi: np.ndarray,
    guide_roi: np.ndarray,
    mask_roi: np.ndarray,
    iters: int,
) -> np.ndarray:
    """
    Jacobi Poisson blend without np.roll wrap-around.
    src_roi: HxWxC (boundary / outside mask)
    guide_roi: HxWxC (initial / guidance)
    mask_roi: HxW bool (True=solve region)
    """
    if iters <= 0 or not np.any(mask_roi):
        return guide_roi

    # enforce ROI edges as boundary to avoid edge conditions exploding
    m = mask_roi.copy()
    m[0, :] = False
    m[-1, :] = False
    m[:, 0] = False
    m[:, -1] = False

    u = guide_roi.copy()
    lap = _laplacian_noroll(guide_roi)

    for _ in range(int(iters)):
        p = np.pad(u, ((1, 1), (1, 1), (0, 0)), mode="edge")
        up = p[:-2, 1:-1]
        dn = p[2:, 1:-1]
        lf = p[1:-1, :-2]
        rt = p[1:-1, 2:]
        u_new = (up + dn + lf + rt - lap) * 0.25
        u = np.where(m[..., None], u_new, src_roi)

    return u


def _uv_to_xyf(uv: np.ndarray, w: int, h: int, *, v_flip: bool) -> tuple[float, float]:
    # Most DCC/OBJ convention: UV v=0 is bottom, image y=0 is top => flip.
    u = float(uv[0])
    v = float(uv[1])
    x = u * float(w - 1)
    y = (((1.0 - v) if v_flip else v) * float(h - 1))
    return x, y


def _sample_bilinear(img: np.ndarray, x: float, y: float) -> np.ndarray:
    """
    img: HxWxC float32
    return: C float32
    """
    h, w, _c = img.shape
    if w <= 1 or h <= 1:
        return img[int(round(y)) % h, int(round(x)) % w]

    x = float(np.clip(x, 0.0, float(w - 1)))
    y = float(np.clip(y, 0.0, float(h - 1)))
    x0 = int(np.floor(x))
    y0 = int(np.floor(y))
    x1 = min(x0 + 1, w - 1)
    y1 = min(y0 + 1, h - 1)
    tx = x - float(x0)
    ty = y - float(y0)

    c00 = img[y0, x0]
    c10 = img[y0, x1]
    c01 = img[y1, x0]
    c11 = img[y1, x1]
    c0 = c00 * (1.0 - tx) + c10 * tx
    c1 = c01 * (1.0 - tx) + c11 * tx
    return c0 * (1.0 - ty) + c1 * ty


def _splat_bilinear(
    acc: np.ndarray,
    wacc: np.ndarray,
    mask: np.ndarray,
    x: float,
    y: float,
    col: np.ndarray,
    w: float,
) -> None:
    """
    Distribute a sample to 4 neighbor pixels using bilinear weights.
    This avoids dotted/aliased writeback along seams.
    """
    h, wimg = wacc.shape
    x = float(np.clip(x, 0.0, float(wimg - 1)))
    y = float(np.clip(y, 0.0, float(h - 1)))
    x0 = int(np.floor(x))
    y0 = int(np.floor(y))
    x1 = min(x0 + 1, wimg - 1)
    y1 = min(y0 + 1, h - 1)
    tx = x - float(x0)
    ty = y - float(y0)

    w00 = (1.0 - tx) * (1.0 - ty) * w
    w10 = tx * (1.0 - ty) * w
    w01 = (1.0 - tx) * ty * w
    w11 = tx * ty * w

    if w00 > 0.0 and mask[y0, x0]:
        acc[y0, x0] += col * w00
        wacc[y0, x0] += w00
    if w10 > 0.0 and mask[y0, x1]:
        acc[y0, x1] += col * w10
        wacc[y0, x1] += w10
    if w01 > 0.0 and mask[y1, x0]:
        acc[y1, x0] += col * w01
        wacc[y1, x0] += w01
    if w11 > 0.0 and mask[y1, x1]:
        acc[y1, x1] += col * w11
        wacc[y1, x1] += w11


def repair_texture_seams(
    obj_file: BinaryIO,
    texture_img: Image.Image,
    seam_mask_img: Image.Image | None = None,
    *,
    texture_kind: str = "basecolor",  # basecolor | data | normal
    band_px: int = 8,
    sample_step_px: float = 2.0,
    mode: str = "average",  # average | a_to_b | b_to_a
    mask_threshold: int = 16,
    only_masked_seams: bool = True,
    v_flip: bool = True,
    feather_px: int = 12,
    alpha_method: str = "distance",  # distance | wacc
    alpha_edge_aware: bool = True,
    guided_eps: float = 1e-4,
    color_match: str = "meanvar",  # none | meanvar | meanvar_edge
    poisson_iters: int = 0,
) -> Image.Image:
    """
    Seam-aware texture repair:
    - Detect UV seam edges from OBJ (shared 3D edges with discontinuous UVs).
    - For selected seams, synchronize a narrow band of pixels across the seam by 3D adjacency mapping.
    """
    if band_px <= 0:
        return texture_img.copy()

    verts, uvs, tris = _parse_obj(obj_file)
    seams = _build_seam_pairs(verts, uvs, tris)

    tex = texture_img.convert("RGBA")
    w, h = tex.size
    tex_arr = np.asarray(tex, dtype=np.uint8)
    src_rgba = tex_arr.astype(np.float32) / 255.0
    src_rgb = src_rgba[..., :3].astype(np.float32)
    src_a = src_rgba[..., 3:4].astype(np.float32)

    if texture_kind == "basecolor":
        work_rgb = _srgb_to_linear(src_rgb)
    elif texture_kind == "data":
        work_rgb = src_rgb
    elif texture_kind == "normal":
        work_rgb = _normal_rgb_to_vec(src_rgb)
    else:
        raise ValueError("texture_kind 必须是 basecolor | data | normal")

    if seam_mask_img is not None:
        base_mask = _mask_from_image(seam_mask_img, w, h, threshold=mask_threshold)
        mask = _binary_dilate(base_mask, radius=band_px)
    else:
        mask = np.ones((h, w), dtype=bool)

    acc = np.zeros_like(work_rgb, dtype=np.float32)
    wacc = np.zeros((h, w), dtype=np.float32)

    def seam_is_selected(pair: SeamPair) -> bool:
        if seam_mask_img is None or not only_masked_seams:
            return True
        # Probe a few points on both sides along the edge at d=0 to decide.
        for t in (0.1, 0.3, 0.5, 0.7, 0.9):
            uv_a = pair.a.uv0 * (1.0 - t) + pair.a.uv1 * t
            uv_b = pair.b.uv0 * (1.0 - t) + pair.b.uv1 * t
            xa, ya = _uv_to_xyf(uv_a, w, h, v_flip=v_flip)
            xb, yb = _uv_to_xyf(uv_b, w, h, v_flip=v_flip)
            iax, iay = int(round(xa)), int(round(ya))
            ibx, iby = int(round(xb)), int(round(yb))
            if 0 <= iax < w and 0 <= iay < h and mask[iay, iax]:
                return True
            if 0 <= ibx < w and 0 <= iby < h and mask[iby, ibx]:
                return True
        return False

    def compute_match_for_pair(pair: SeamPair) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Return (mean_a, mean_b, scale) to map B -> A."""
        if color_match not in ("meanvar_edge",):
            return np.zeros((3,), dtype=np.float32), np.zeros((3,), dtype=np.float32), np.ones((3,), dtype=np.float32)
        # sample a few points close to seam for robust stats
        dir_a = _compute_inward_dir(pair.a.uv0, pair.a.uv1, pair.a.uv2)
        dir_b = _compute_inward_dir(pair.b.uv0, pair.b.uv1, pair.b.uv2)
        scale_px = np.array([w - 1, h - 1], dtype=np.float32)
        dir_a_px = dir_a * scale_px
        dir_b_px = dir_b * scale_px
        la = float(np.linalg.norm(dir_a_px))
        lb = float(np.linalg.norm(dir_b_px))
        if la > 1e-9:
            dir_a_px = dir_a_px / la
        if lb > 1e-9:
            dir_b_px = dir_b_px / lb

        stats_a = _RunningStatsVec3()
        stats_b = _RunningStatsVec3()
        ns = 24
        max_d = min(3, max(0, band_px - 1))
        for si in range(ns):
            t = (si + 0.5) / float(ns)
            uv_a_edge = pair.a.uv0 * (1.0 - t) + pair.a.uv1 * t
            uv_b_edge = pair.b.uv0 * (1.0 - t) + pair.b.uv1 * t
            for d in range(max_d + 1):
                uv_a = uv_a_edge + (dir_a_px * float(d)) / scale_px
                uv_b = uv_b_edge + (dir_b_px * float(d)) / scale_px
                xa, ya = _uv_to_xyf(uv_a, w, h, v_flip=v_flip)
                xb, yb = _uv_to_xyf(uv_b, w, h, v_flip=v_flip)
                stats_a.add(_sample_bilinear(work_rgb, xa, ya))
                stats_b.add(_sample_bilinear(work_rgb, xb, yb))
        mean_a, std_a = stats_a.finalize()
        mean_b, std_b = stats_b.finalize()
        scale = std_a / (std_b + 1e-6)
        return mean_a.astype(np.float32), mean_b.astype(np.float32), scale.astype(np.float32)

    # Global color match (stable): compute ONE mapping for all selected seams
    global_mean_a = np.zeros((3,), dtype=np.float32)
    global_mean_b = np.zeros((3,), dtype=np.float32)
    global_scale = np.ones((3,), dtype=np.float32)
    do_match_global = (color_match in ("meanvar",)) and (texture_kind != "normal")
    if do_match_global:
        stats_a = _RunningStatsVec3()
        stats_b = _RunningStatsVec3()
        for pair in seams:
            if not seam_is_selected(pair):
                continue
            dir_a = _compute_inward_dir(pair.a.uv0, pair.a.uv1, pair.a.uv2)
            dir_b = _compute_inward_dir(pair.b.uv0, pair.b.uv1, pair.b.uv2)
            scale_px = np.array([w - 1, h - 1], dtype=np.float32)
            dir_a_px = dir_a * scale_px
            dir_b_px = dir_b * scale_px
            la = float(np.linalg.norm(dir_a_px))
            lb = float(np.linalg.norm(dir_b_px))
            if la > 1e-9:
                dir_a_px = dir_a_px / la
            if lb > 1e-9:
                dir_b_px = dir_b_px / lb

            ns = 18
            max_d = min(2, max(0, band_px - 1))
            for si in range(ns):
                t = (si + 0.5) / float(ns)
                uv_a_edge = pair.a.uv0 * (1.0 - t) + pair.a.uv1 * t
                uv_b_edge = pair.b.uv0 * (1.0 - t) + pair.b.uv1 * t
                for d in range(max_d + 1):
                    uv_a = uv_a_edge + (dir_a_px * float(d)) / scale_px
                    uv_b = uv_b_edge + (dir_b_px * float(d)) / scale_px
                    xa, ya = _uv_to_xyf(uv_a, w, h, v_flip=v_flip)
                    xb, yb = _uv_to_xyf(uv_b, w, h, v_flip=v_flip)
                    stats_a.add(_sample_bilinear(work_rgb, xa, ya))
                    stats_b.add(_sample_bilinear(work_rgb, xb, yb))

        global_mean_a, global_std_a = stats_a.finalize()
        global_mean_b, global_std_b = stats_b.finalize()
        global_scale = global_std_a / (global_std_b + 1e-6)

    for pair in seams:
        if not seam_is_selected(pair):
            continue

        dir_a = _compute_inward_dir(pair.a.uv0, pair.a.uv1, pair.a.uv2)
        dir_b = _compute_inward_dir(pair.b.uv0, pair.b.uv1, pair.b.uv2)

        # Convert UV-space dir to pixel-space dir to keep band width stable in pixels
        scale_px = np.array([w - 1, h - 1], dtype=np.float32)
        dir_a_px = dir_a * scale_px
        dir_b_px = dir_b * scale_px
        la = float(np.linalg.norm(dir_a_px))
        lb = float(np.linalg.norm(dir_b_px))
        if la > 1e-9:
            dir_a_px = dir_a_px / la
        if lb > 1e-9:
            dir_b_px = dir_b_px / lb

        # Estimate edge length in pixels (use max of both sides)
        e_a = (pair.a.uv1 - pair.a.uv0) * scale_px
        e_b = (pair.b.uv1 - pair.b.uv0) * scale_px
        edge_len_px = float(max(np.linalg.norm(e_a), np.linalg.norm(e_b)))
        n_samples = max(8, int(edge_len_px / max(0.5, float(sample_step_px))))

        # optional color match: map B -> A stats
        if color_match == "meanvar_edge" and texture_kind != "normal":
            mean_a, mean_b, scale = compute_match_for_pair(pair)
        else:
            mean_a, mean_b, scale = global_mean_a, global_mean_b, global_scale

        for si in range(n_samples + 1):
            t = si / float(n_samples)
            uv_a_edge = pair.a.uv0 * (1.0 - t) + pair.a.uv1 * t
            uv_b_edge = pair.b.uv0 * (1.0 - t) + pair.b.uv1 * t

            for d in range(band_px):
                # distance weight: closer to seam = stronger
                ww = (band_px - d) / float(band_px)

                # d is in pixels => convert back to UV
                uv_a = uv_a_edge + (dir_a_px * float(d)) / scale_px
                uv_b = uv_b_edge + (dir_b_px * float(d)) / scale_px

                xa, ya = _uv_to_xyf(uv_a, w, h, v_flip=v_flip)
                xb, yb = _uv_to_xyf(uv_b, w, h, v_flip=v_flip)

                # quick reject (still allow splat to clamp inside image)
                a_in = 0.0 <= xa <= float(w - 1) and 0.0 <= ya <= float(h - 1)
                b_in = 0.0 <= xb <= float(w - 1) and 0.0 <= yb <= float(h - 1)
                if not a_in and not b_in:
                    continue

                col_a = _sample_bilinear(work_rgb, xa, ya)
                col_b = _sample_bilinear(work_rgb, xb, yb)
                if color_match in ("meanvar", "meanvar_edge") and texture_kind != "normal":
                    # Map B into A's color distribution before blending
                    col_b = (col_b - mean_b) * scale + mean_a

                if mode == "average":
                    col = (col_a + col_b) * 0.5
                    if a_in:
                        _splat_bilinear(acc, wacc, mask, xa, ya, col, ww)
                    if b_in:
                        _splat_bilinear(acc, wacc, mask, xb, yb, col, ww)
                elif mode == "a_to_b":
                    if b_in:
                        _splat_bilinear(acc, wacc, mask, xb, yb, col_a, ww)
                elif mode == "b_to_a":
                    if a_in:
                        _splat_bilinear(acc, wacc, mask, xa, ya, col_b, ww)
                else:
                    raise ValueError("mode 必须是 average | a_to_b | b_to_a")

    repaired = work_rgb.copy()
    hit = wacc > 0.0
    repaired[hit] = acc[hit] / wacc[hit, None]

    if feather_px and feather_px > 0 and np.any(hit):
        if alpha_method == "distance":
            alpha = _compute_alpha_distance(hit, int(feather_px))
        elif alpha_method == "wacc":
            alpha = np.clip((wacc / (wacc + 0.25)).astype(np.float32), 0.0, 1.0)
        else:
            raise ValueError("alpha_method 必须是 distance | wacc")

        if alpha_edge_aware and texture_kind != "normal":
            # Guide by luminance in working space (linear), keep alpha peak
            guide = np.clip(work_rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32), 0.0, 1.0)
            q = _guided_filter_gray(guide, alpha, r=max(1, int(feather_px)), eps=float(guided_eps))
            alpha = np.maximum(alpha, np.clip(q, 0.0, 1.0))

        out_work = work_rgb * (1.0 - alpha[..., None]) + repaired * alpha[..., None]
    else:
        out_work = repaired

    if poisson_iters and poisson_iters > 0 and np.any(hit) and texture_kind != "normal":
        # Simple Jacobi Poisson blending on a small ROI (no wrap-around).
        ys, xs = np.where(hit)
        pad = int(max(2, feather_px + 2))
        y0 = max(int(ys.min()) - pad, 0)
        y1 = min(int(ys.max()) + pad + 1, h)
        x0 = max(int(xs.min()) - pad, 0)
        x1 = min(int(xs.max()) + pad + 1, w)
        m = hit[y0:y1, x0:x1]
        if np.any(m):
            src_roi = work_rgb[y0:y1, x0:x1]
            guide_roi = out_work[y0:y1, x0:x1]
            out_work[y0:y1, x0:x1] = _poisson_blend_roi(src_roi, guide_roi, m, int(poisson_iters))

    if texture_kind == "basecolor":
        out_rgb = _linear_to_srgb(out_work)
    elif texture_kind == "data":
        out_rgb = out_work
    else:  # normal
        out_rgb = _normal_vec_to_rgb(out_work)

    out_rgba = np.concatenate([out_rgb, src_a], axis=-1)
    out_u8 = np.clip(out_rgba * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(out_u8, mode="RGBA")

