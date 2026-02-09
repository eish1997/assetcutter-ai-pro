from __future__ import annotations

import io

import numpy as np
from PIL import Image

from seam_repair import repair_texture_seams


def main() -> None:
    # A minimal OBJ with a single internal shared edge (1-3) and UV discontinuity (seam)
    # Two triangles share the edge (v1, v3) but use different vt indices for these vertices.
    obj = """
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0

vt 0.10 0.90
vt 0.90 0.90
vt 0.90 0.10
vt 0.10 0.10

vt 0.10 0.45
vt 0.90 0.55

f 1/1 2/2 3/3
f 1/5 3/6 4/4
""".strip().encode("utf-8")

    # Make a texture where top area is green-ish, bottom area is magenta-ish
    w, h = 128, 128
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    arr[: h // 2, :, :] = np.array([20, 220, 120, 255], dtype=np.uint8)   # top
    arr[h // 2 :, :, :] = np.array([220, 20, 160, 255], dtype=np.uint8)   # bottom
    tex = Image.fromarray(arr, mode="RGBA")

    out = repair_texture_seams(
        obj_file=io.BytesIO(obj),
        texture_img=tex,
        seam_mask_img=None,
        band_px=6,
        sample_step_px=2.0,
        mode="average",
        only_masked_seams=False,
        v_flip=True,
    )

    assert out.size == tex.size
    out_path = "smoke_out.png"
    out.save(out_path)
    print(f"[ok] wrote {out_path}")


if __name__ == "__main__":
    main()

