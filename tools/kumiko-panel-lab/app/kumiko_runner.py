from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

LAB_ROOT = Path(__file__).resolve().parents[1]
KUMIKO_ROOT = LAB_ROOT / "vendor" / "kumiko"

if str(KUMIKO_ROOT) not in sys.path:
    sys.path.insert(0, str(KUMIKO_ROOT))


def ensure_kumiko_vendor() -> None:
    if not (KUMIKO_ROOT / "kumikolib.py").is_file():
        raise RuntimeError(
            "未找到 Kumiko 源码。请在仓库根目录执行: npm run setup:kumiko-panel-lab"
        )


def detect_panels(
    image_path: str,
    *,
    rtl: bool = False,
    min_panel_size_ratio: float | None = None,
    panel_expansion: bool = True,
) -> dict[str, Any]:
    ensure_kumiko_vendor()
    from kumikolib import Kumiko  # noqa: WPS433 — runtime import after sys.path

    opts: dict[str, Any] = {
        "progress": False,
        "rtl": rtl,
        "panel_expansion": panel_expansion,
    }
    if min_panel_size_ratio is not None:
        opts["min_panel_size_ratio"] = min_panel_size_ratio

    k = Kumiko(opts)
    k.parse_image(image_path)
    infos = k.get_infos()
    if not infos:
        raise ValueError("Kumiko 未返回分格结果")
    return infos[0]
