from __future__ import annotations

import base64
import time
import uuid
from pathlib import Path
from typing import Any

import cv2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.grid_detect import detect_panels_auto
from app.kumiko_runner import detect_panels, ensure_kumiko_vendor

LAB_ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = LAB_ROOT / "static"
UPLOAD_DIR = LAB_ROOT / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Kumiko Panel Lab", version="0.2.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

ALLOWED_SUFFIX = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def _draw_overlay(image_path: Path, panels: list[list[int]], splits: dict[str, list[int]] | None = None) -> bytes:
    img = cv2.imread(str(image_path))
    if img is None:
        raise ValueError("无法读取上传图片")
    h, w = img.shape[:2]
    if splits:
        for x in splits.get("x") or []:
            cv2.line(img, (x, 0), (x, h), (255, 120, 0), 2, cv2.LINE_AA)
        for y in splits.get("y") or []:
            cv2.line(img, (0, y), (w, y), (255, 120, 0), 2, cv2.LINE_AA)
    colors = [
        (46, 204, 113),
        (52, 152, 219),
        (155, 89, 182),
        (241, 196, 15),
        (231, 76, 60),
        (26, 188, 156),
    ]
    for i, panel in enumerate(panels):
        if len(panel) != 4:
            continue
        x, y, pw, ph = panel
        color = colors[i % len(colors)]
        cv2.rectangle(img, (x, y), (x + pw, y + ph), color, 3)
        cv2.putText(
            img,
            str(i + 1),
            (x + 8, y + 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            color,
            2,
            cv2.LINE_AA,
        )
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    if not ok:
        raise ValueError("预览图编码失败")
    return buf.tobytes()


def _parse_int(raw: str) -> int | None:
    t = raw.strip()
    if not t:
        return None
    try:
        n = int(t, 10)
        return n if n > 0 else None
    except ValueError:
        return None


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
def health() -> dict[str, object]:
    try:
        ensure_kumiko_vendor()
        vendor_ok = True
    except RuntimeError as e:
        return {"ok": False, "error": str(e), "vendorOk": False}
    return {"ok": True, "service": "kumiko-panel-lab", "vendorOk": vendor_ok}


@app.post("/api/detect")
async def api_detect(
    file: UploadFile = File(...),
    mode: str = Form("auto"),
    rtl: bool = Form(False),
    panel_expansion: bool = Form(True),
    min_panel_size_ratio: str = Form(""),
    grid_cols: str = Form(""),
    grid_rows: str = Form(""),
) -> dict[str, Any]:
    suffix = Path(file.filename or "upload.png").suffix.lower()
    if suffix not in ALLOWED_SUFFIX:
        raise HTTPException(status_code=400, detail=f"不支持的格式: {suffix}")

    prefer = (mode or "auto").strip().lower()
    if prefer not in {"auto", "kumiko", "grid", "uniform"}:
        raise HTTPException(status_code=400, detail="mode 须为 auto | kumiko | grid | uniform")

    ratio: float | None = None
    if min_panel_size_ratio.strip():
        try:
            ratio = float(min_panel_size_ratio.strip())
        except ValueError as e:
            raise HTTPException(status_code=400, detail="min_panel_size_ratio 须为数字") from e

    cols = _parse_int(grid_cols)
    rows = _parse_int(grid_rows)
    if prefer == "uniform" and (not cols or not rows):
        raise HTTPException(status_code=400, detail="uniform 模式须填写 grid_cols 与 grid_rows")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="空文件")
    if len(raw) > 30 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件超过 30MB")

    stamp = uuid.uuid4().hex[:12]
    saved = UPLOAD_DIR / f"{stamp}{suffix}"
    saved.write_bytes(raw)

    t0 = time.perf_counter()
    try:
        info = detect_panels_auto(
            str(saved),
            kumiko_detect=lambda: detect_panels(
                str(saved),
                rtl=rtl,
                panel_expansion=panel_expansion,
                min_panel_size_ratio=ratio,
            ),
            cols=cols,
            rows=rows,
            prefer=prefer,
        )
    except Exception as e:
        saved.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(e)) from e

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    panels = info.get("panels") or []
    splits = info.get("splits") if isinstance(info.get("splits"), dict) else None
    overlay_b64 = base64.b64encode(_draw_overlay(saved, panels, splits)).decode("ascii")

    return {
        "ok": True,
        "filename": file.filename,
        "engine": info.get("engine"),
        "fallback": info.get("fallback"),
        "warn": info.get("warn"),
        "size": info.get("size"),
        "panels": panels,
        "panelCount": len(panels),
        "grid": info.get("grid"),
        "splits": splits,
        "gutters": info.get("gutters"),
        "numbering": info.get("numbering"),
        "processingTimeNs": info.get("processing_time"),
        "elapsedMs": elapsed_ms,
        "overlayJpegBase64": overlay_b64,
        "options": {
            "mode": prefer,
            "rtl": rtl,
            "panel_expansion": panel_expansion,
            "min_panel_size_ratio": ratio,
            "grid_cols": cols,
            "grid_rows": rows,
        },
    }
