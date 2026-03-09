from __future__ import annotations

import io
import logging
import os
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image

from seam_repair import repair_texture_seams
from vendor import ensure_three_vendor


APP_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = (APP_DIR.parent / "frontend").resolve()
STATIC_DIR = FRONTEND_DIR / "static"
DEFAULT_ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"]
MAX_OBJ_BYTES = 24 * 1024 * 1024
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_MASK_BYTES = 20 * 1024 * 1024
MAX_TEXTURE_EDGE = 4096
MAX_TEXTURE_PIXELS = 4096 * 4096

logger = logging.getLogger(__name__)


def _parse_allowed_origins() -> list[str]:
    raw = os.getenv("SEAM_ALLOWED_ORIGINS", "").strip()
    if not raw:
        return DEFAULT_ALLOWED_ORIGINS
    return [item.strip() for item in raw.split(",") if item.strip()]


async def _read_upload_limited(upload: UploadFile, *, max_bytes: int, label: str) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ValueError(f"{label} 文件过大，最大允许 {max_bytes // (1024 * 1024)}MB")
        chunks.append(chunk)
    if total == 0:
        raise ValueError(f"{label} 不能为空")
    return b"".join(chunks)


def _open_image_checked(data: bytes, *, label: str) -> Image.Image:
    try:
        probe = Image.open(io.BytesIO(data))
        probe.verify()
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:
        raise ValueError(f"{label} 不是有效图片") from exc
    width, height = img.size
    if width < 2 or height < 2:
        raise ValueError(f"{label} 尺寸至少为 2x2")
    if width > MAX_TEXTURE_EDGE or height > MAX_TEXTURE_EDGE or width * height > MAX_TEXTURE_PIXELS:
        raise ValueError(f"{label} 尺寸过大，最大支持 {MAX_TEXTURE_EDGE}px 且总像素不超过 {MAX_TEXTURE_PIXELS}")
    return img


def _validate_repair_args(
    texture_kind: str,
    band_px: int,
    feather_px: int,
    sample_step_px: float,
    mode: str,
    alpha_method: str,
    guided_eps: float,
    color_match: str,
    poisson_iters: int,
) -> dict[str, object]:
    if texture_kind not in {"basecolor", "data", "normal"}:
        raise ValueError("texture_kind 必须是 basecolor、data 或 normal")
    if not 1 <= int(band_px) <= 64:
        raise ValueError("band_px 必须在 1 到 64 之间")
    if not 0 <= int(feather_px) <= 64:
        raise ValueError("feather_px 必须在 0 到 64 之间")
    if not 0.25 <= float(sample_step_px) <= 16.0:
        raise ValueError("sample_step_px 必须在 0.25 到 16 之间")
    if mode not in {"average", "a_to_b", "b_to_a"}:
        raise ValueError("mode 必须是 average、a_to_b 或 b_to_a")
    if alpha_method not in {"distance", "wacc"}:
        raise ValueError("alpha_method 必须是 distance 或 wacc")
    if not 1e-8 <= float(guided_eps) <= 1.0:
        raise ValueError("guided_eps 超出允许范围")
    if color_match not in {"none", "meanvar", "meanvar_edge"}:
        raise ValueError("color_match 必须是 none、meanvar 或 meanvar_edge")
    if not 0 <= int(poisson_iters) <= 200:
        raise ValueError("poisson_iters 必须在 0 到 200 之间")
    return {
        "texture_kind": str(texture_kind),
        "band_px": int(band_px),
        "feather_px": int(feather_px),
        "sample_step_px": float(sample_step_px),
        "mode": str(mode),
        "alpha_method": str(alpha_method),
        "guided_eps": float(guided_eps),
        "color_match": str(color_match),
        "poisson_iters": int(poisson_iters),
    }


app = FastAPI(title="WebSeamRepair", version="0.1.0")

# 允许主项目前端（如 localhost:3000）跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# Try to cache vendor scripts so browser doesn't need CDN.
try:
    if STATIC_DIR.exists():
        ensure_three_vendor(STATIC_DIR)
except Exception:
    # Vendor download failure should NOT break API usage.
    pass


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/repair")
async def api_repair(
    obj: UploadFile = File(..., description="OBJ 模型（含 vt UV）"),
    texture: UploadFile = File(..., description="要修复的贴图（BaseColor 等）"),
    seam_mask: UploadFile | None = File(None, description="SP 导出的 seam 黑白 mask（可选）"),
    texture_kind: str = Form("basecolor"),
    band_px: int = Form(8),
    feather_px: int = Form(6),
    sample_step_px: float = Form(2.0),
    mode: str = Form("average"),
    only_masked_seams: bool = Form(True),
    alpha_method: str = Form("distance"),
    alpha_edge_aware: bool = Form(True),
    guided_eps: float = Form(1e-4),
    color_match: str = Form("meanvar"),
    poisson_iters: int = Form(0),
) -> Response:
    try:
        opts = _validate_repair_args(
            texture_kind=texture_kind,
            band_px=band_px,
            feather_px=feather_px,
            sample_step_px=sample_step_px,
            mode=mode,
            alpha_method=alpha_method,
            guided_eps=guided_eps,
            color_match=color_match,
            poisson_iters=poisson_iters,
        )
        obj_bytes = await _read_upload_limited(obj, max_bytes=MAX_OBJ_BYTES, label="OBJ")
        tex_bytes = await _read_upload_limited(texture, max_bytes=MAX_IMAGE_BYTES, label="贴图")
        mask_bytes = await _read_upload_limited(seam_mask, max_bytes=MAX_MASK_BYTES, label="Mask") if seam_mask is not None else None

        tex_img = _open_image_checked(tex_bytes, label="贴图")
        mask_img = _open_image_checked(mask_bytes, label="Mask") if mask_bytes else None

        out_img = repair_texture_seams(
            obj_file=io.BytesIO(obj_bytes),
            texture_img=tex_img,
            seam_mask_img=mask_img,
            texture_kind=opts["texture_kind"],
            band_px=opts["band_px"],
            feather_px=opts["feather_px"],
            sample_step_px=opts["sample_step_px"],
            mode=opts["mode"],
            only_masked_seams=bool(only_masked_seams),
            alpha_method=opts["alpha_method"],
            alpha_edge_aware=bool(alpha_edge_aware),
            guided_eps=opts["guided_eps"],
            color_match=opts["color_match"],
            poisson_iters=opts["poisson_iters"],
        )

        buf = io.BytesIO()
        out_img.save(buf, format="PNG")
        return Response(content=buf.getvalue(), media_type="image/png")
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(exc)})
    except Exception:
        logger.exception("seam repair failed")
        return JSONResponse(status_code=500, content={"ok": False, "error": "贴图修缝失败，请检查输入规模或稍后重试"})


# ---------- frontend ----------


@app.get("/")
def index() -> HTMLResponse:
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        return HTMLResponse("<h3>frontend not found</h3>", status_code=500)
    return HTMLResponse(index_file.read_text(encoding="utf-8"))


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

