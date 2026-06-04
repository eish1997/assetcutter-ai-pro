#!/usr/bin/env python3
"""
PaddleOCR 本机 HTTP 服务（AssetCutter 本地伴侣基础设施）。

环境变量：
  COMPANION_PADDLEOCR_PORT       监听端口，默认 18082
  COMPANION_PADDLEOCR_DEVICE     cpu | gpu，默认 cpu
  COMPANION_PADDLEOCR_MODELS_DIR 模型缓存目录（可选，会写入 PADDLEOCR_HOME）
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.parse import urlparse

PORT = int(os.environ.get("COMPANION_PADDLEOCR_PORT", "18082"))
DEVICE = os.environ.get("COMPANION_PADDLEOCR_DEVICE", "cpu").strip().lower() or "cpu"
MODELS_DIR = os.environ.get("COMPANION_PADDLEOCR_MODELS_DIR", "").strip()
# PaddlePaddle 3.3+ CPU：须在 import paddle 前关闭 MKLDNN，否则 PIR/OneDNN 崩溃
os.environ.setdefault("FLAGS_use_mkldnn", "0")
SERVER_BUILD = "2026-06-04-mkldnn1"

_ENGINE_LOCK = Lock()
_OCR_ENGINES: dict[str, Any] = {}
_STRUCTURE_ENGINE: Any | None = None


def _ensure_models_dir() -> None:
    if not MODELS_DIR:
        return
    p = Path(MODELS_DIR)
    p.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("PADDLEOCR_HOME", str(p))


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(_json_safe_deep(payload), ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("body must be a JSON object")
    return data


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "tolist"):
        try:
            return value.tolist()
        except Exception:
            pass
    return value


def _json_safe_deep(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "tolist"):
        try:
            return _json_safe_deep(value.tolist())
        except Exception:
            pass
    if isinstance(value, dict):
        return {str(k): _json_safe_deep(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe_deep(v) for v in value]
    return str(value)


def _at_index(seq: Any, i: int) -> Any:
    if seq is None:
        return None
    try:
        return seq[i]
    except (TypeError, IndexError, KeyError):
        return None


def _blocks_from_ocr_dict(raw: dict[str, Any]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []

    def push_block(box: Any, text: str, score: float | None) -> None:
        if not text:
            return
        blocks.append({"text": text, "box": _json_safe(box), "score": score})

    def pick_optional(*keys: str) -> Any:
        for key in keys:
            if key in raw and raw[key] is not None:
                return raw[key]
        return None

    for key in ("rec_texts", "texts"):
        texts = raw.get(key)
        boxes = pick_optional("rec_boxes", "boxes", "rec_polys", "dt_polys")
        scores = pick_optional("rec_scores", "scores")
        if isinstance(texts, list):
            for i, t in enumerate(texts):
                box = _at_index(boxes, i)
                score = _at_index(scores, i)
                push_block(box, str(t), float(score) if score is not None else None)
            if blocks:
                return blocks

    text = str(raw.get("text") or raw.get("rec_text") or "")
    if text:
        box = raw.get("box") or raw.get("dt_poly") or raw.get("poly")
        score = raw.get("score") or raw.get("rec_score")
        push_block(box, text, float(score) if score is not None else None)
    return blocks


def _normalize_ocr_result(raw: Any) -> dict[str, Any]:
    blocks: list[dict[str, Any]] = []

    def push_block(box: Any, text: str, score: float | None) -> None:
        if not text:
            return
        blocks.append({"text": text, "box": _json_safe(box), "score": score})

    if isinstance(raw, dict):
        blocks = _blocks_from_ocr_dict(raw)
        if blocks:
            return {"blocks": blocks}
        if "result" in raw:
            return _normalize_ocr_result(raw["result"])

    if isinstance(raw, list):
        for item in raw:
            if not item:
                continue
            if isinstance(item, dict):
                blocks.extend(_blocks_from_ocr_dict(item))
                continue
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                box = item[0]
                meta = item[1]
                if isinstance(meta, (list, tuple)) and len(meta) >= 1:
                    text = str(meta[0])
                    score = float(meta[1]) if len(meta) > 1 and meta[1] is not None else None
                    push_block(box, text, score)
                elif isinstance(meta, str):
                    push_block(box, meta, None)
        return {"blocks": blocks}

    return {"blocks": blocks, "rawType": type(raw).__name__}


def _extract_markdown_from_structure(raw: Any) -> str:
    parts: list[str] = []

    def walk(node: Any) -> None:
        if node is None:
            return
        if isinstance(node, str):
            s = node.strip()
            if s:
                parts.append(s)
            return
        if isinstance(node, dict):
            for key in ("markdown", "md", "text", "content"):
                v = node.get(key)
                if isinstance(v, str) and v.strip():
                    parts.append(v.strip())
            for key in ("rec_texts", "texts"):
                v = node.get(key)
                if isinstance(v, list):
                    for t in v:
                        s = str(t).strip()
                        if s:
                            parts.append(s)
            for key in ("pages", "elements", "layout", "result", "data"):
                if key in node:
                    walk(node[key])
            return
        if isinstance(node, list):
            for x in node:
                walk(x)

    walk(raw)
    if not parts:
        return ""
    return "\n\n".join(parts)


def _inference_common_kwargs() -> dict[str, Any]:
    """PaddlePaddle 3.3+ CPU 默认 MKLDNN 会触发 PIR/OneDNN 崩溃，须显式关闭。"""
    kwargs: dict[str, Any] = {"device": DEVICE}
    if DEVICE != "gpu":
        kwargs["enable_mkldnn"] = False
    return kwargs


def _get_ocr_engine(lang: str) -> Any:
    key = f"{lang}:{DEVICE}:mkldnn0"
    with _ENGINE_LOCK:
        if key in _OCR_ENGINES:
            return _OCR_ENGINES[key]
        from paddleocr import PaddleOCR

        kwargs: dict[str, Any] = {"lang": lang, **_inference_common_kwargs()}
        try:
            engine = PaddleOCR(use_textline_orientation=True, **kwargs)
        except TypeError:
            engine = PaddleOCR(enable_mkldnn=False, lang=lang, device=DEVICE)
        _OCR_ENGINES[key] = engine
        return engine


def _get_structure_engine() -> Any:
    global _STRUCTURE_ENGINE
    with _ENGINE_LOCK:
        if _STRUCTURE_ENGINE is not None:
            return _STRUCTURE_ENGINE
        from paddleocr import PPStructureV3

        kwargs = _inference_common_kwargs()
        try:
            _STRUCTURE_ENGINE = PPStructureV3(**kwargs)
        except TypeError:
            _STRUCTURE_ENGINE = PPStructureV3(enable_mkldnn=False, device=DEVICE)
        return _STRUCTURE_ENGINE


def _predict(engine: Any, input_path: str) -> Any:
    if hasattr(engine, "predict"):
        return engine.predict(input_path)
    if hasattr(engine, "ocr"):
        return engine.ocr(input_path, cls=True)
    raise RuntimeError("PaddleOCR engine has no predict/ocr method")


def _run_pipeline(pipeline: str, input_path: str, lang: str) -> dict[str, Any]:
    t0 = time.time()
    path = Path(input_path)
    if not path.is_file():
        raise FileNotFoundError(f"input not found: {input_path}")

    if pipeline == "pp_ocr_v5":
        if path.suffix.lower() == ".pdf":
            raise ValueError("pp_ocr_v5 does not accept PDF; use pp_structure_v3")
        engine = _get_ocr_engine(lang)
        raw = _predict(engine, str(path))
        result = _normalize_ocr_result(raw)
        return {
            "ok": True,
            "pipeline": pipeline,
            "lang": lang,
            "device": DEVICE,
            "result": result,
            "elapsed_ms": int((time.time() - t0) * 1000),
        }

    if pipeline == "pp_structure_v3":
        engine = _get_structure_engine()
        raw = _predict(engine, str(path))
        markdown = _extract_markdown_from_structure(raw)
        result = raw if isinstance(raw, (dict, list)) else {"value": str(raw)}
        return {
            "ok": True,
            "pipeline": pipeline,
            "lang": lang,
            "device": DEVICE,
            "result": _json_safe_deep(result),
            "markdown": markdown,
            "elapsed_ms": int((time.time() - t0) * 1000),
        }

    raise ValueError(f"unsupported pipeline: {pipeline}")


class Handler(BaseHTTPRequestHandler):
    server_version = "AssetCutterPaddleOCR/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            _json_response(
                self,
                200,
                {
                    "ok": True,
                    "service": "assetcutter-paddleocr",
                    "device": DEVICE,
                    "serverBuild": SERVER_BUILD,
                    "pipelines": ["pp_ocr_v5", "pp_structure_v3"],
                },
            )
            return
        _json_response(self, 404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/v1/run":
            _json_response(self, 404, {"ok": False, "error": "not_found"})
            return
        try:
            body = _read_json_body(self)
            input_path = str(body.get("input_path") or "").strip()
            pipeline = str(body.get("pipeline") or "pp_ocr_v5").strip()
            lang = str(body.get("lang") or "ch").strip() or "ch"
            if not input_path:
                _json_response(self, 400, {"ok": False, "error": "missing input_path"})
                return
            payload = _run_pipeline(pipeline, input_path, lang)
            _json_response(self, 200, payload)
        except Exception as e:
            _json_response(
                self,
                500,
                {
                    "ok": False,
                    "error": str(e),
                    "trace": traceback.format_exc(limit=6),
                },
            )


def main() -> None:
    _ensure_models_dir()
    host = "127.0.0.1"
    httpd = ThreadingHTTPServer((host, PORT), Handler)
    sys.stderr.write(f"[paddleocr-service] listening http://{host}:{PORT} device={DEVICE}\n")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
