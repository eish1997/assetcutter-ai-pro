from __future__ import annotations

import re
import urllib.request
from pathlib import Path


THREE_VER = "0.161.0"


def _download_bytes(url: str, *, timeout_sec: float = 20.0) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "WebSeamRepair/0.1 (python urllib)",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
        return resp.read()


def _ensure_file(dst: Path, urls: list[str]) -> None:
    if dst.exists() and dst.stat().st_size > 1024:
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    last_err: Exception | None = None
    for url in urls:
        try:
            data = _download_bytes(url)
            if len(data) < 1024:
                raise RuntimeError(f"下载内容太小：{url}")
            dst.write_bytes(data)
            return
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"无法下载依赖文件：{dst.name}，最后错误：{last_err}")


def ensure_three_vendor(static_dir: Path) -> Path:
    """
    Ensure three.js vendor files exist under:
      <static_dir>/vendor/three/
    This avoids browser-side CDN restrictions by serving scripts from localhost.
    """
    vendor_dir = (static_dir / "vendor" / "three").resolve()
    vendor_dir.mkdir(parents=True, exist_ok=True)

    cdns = [
        f"https://unpkg.com/three@{THREE_VER}",
        f"https://cdn.jsdelivr.net/npm/three@{THREE_VER}",
        f"https://fastly.jsdelivr.net/npm/three@{THREE_VER}",
    ]

    three_mod = vendor_dir / "three.module.min.js"
    orbit = vendor_dir / "OrbitControls.js"
    obj = vendor_dir / "OBJLoader.js"

    _ensure_file(
        three_mod,
        [f"{b}/build/three.module.min.js" for b in cdns],
    )
    _ensure_file(
        orbit,
        [f"{b}/examples/jsm/controls/OrbitControls.js" for b in cdns],
    )
    _ensure_file(
        obj,
        [f"{b}/examples/jsm/loaders/OBJLoader.js" for b in cdns],
    )

    # Patch bare-module import "three" to a local relative file.
    # This avoids needing import maps in the browser.
    def patch_import(path: Path) -> None:
        s = path.read_text(encoding="utf-8", errors="ignore")
        s2 = re.sub(r'from\s+[\'"]three[\'"]', 'from "./three.module.min.js"', s)
        if s2 != s:
            path.write_text(s2, encoding="utf-8")

    patch_import(orbit)
    patch_import(obj)

    return vendor_dir

