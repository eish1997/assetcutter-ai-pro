from __future__ import annotations

import io
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


app = FastAPI(title="WebSeamRepair", version="0.1.0")

# 允许主项目前端（如 localhost:3000）跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
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
        obj_bytes = await obj.read()
        tex_bytes = await texture.read()
        mask_bytes = await seam_mask.read() if seam_mask is not None else None

        tex_img = Image.open(io.BytesIO(tex_bytes))
        mask_img = Image.open(io.BytesIO(mask_bytes)) if mask_bytes else None

        out_img = repair_texture_seams(
            obj_file=io.BytesIO(obj_bytes),
            texture_img=tex_img,
            seam_mask_img=mask_img,
            texture_kind=str(texture_kind),
            band_px=int(band_px),
            feather_px=int(feather_px),
            sample_step_px=float(sample_step_px),
            mode=str(mode),
            only_masked_seams=bool(only_masked_seams),
            alpha_method=str(alpha_method),
            alpha_edge_aware=bool(alpha_edge_aware),
            guided_eps=float(guided_eps),
            color_match=str(color_match),
            poisson_iters=int(poisson_iters),
        )

        buf = io.BytesIO()
        out_img.save(buf, format="PNG")
        return Response(content=buf.getvalue(), media_type="image/png")
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


# ---------- frontend ----------


@app.get("/")
def index() -> HTMLResponse:
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        return HTMLResponse("<h3>frontend not found</h3>", status_code=500)
    return HTMLResponse(index_file.read_text(encoding="utf-8"))


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

