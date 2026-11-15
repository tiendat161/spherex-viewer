"""Remember the archive's answer to "which images cover this position" for live series, on disk.

The archive search is the slowest and least predictable step of a live build (47 to 67 s in three runs,
about 4 minutes once), and the answer for a position changes only when the archive gets new images. So
a position that has been searched before skips it, also after the server restarts. Entries older than
TTL_S are ignored, so new data releases are picked up. Positions are matched to 1e-4 degrees (0.36
arcsec): the search is a point query, so positions that close give the same images.

The cache build (`pipeline/build.py`) has its own copies of these rows under .cache/tap/<target>_*.csv.
"""
import csv
import os
import time
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
TTL_S = 7 * 24 * 3600


def default_dir() -> Path:
    return Path(os.environ.get("SPHEREX_CACHE_DIR", ROOT / ".cache")) / "tap" / "live"


def _path(folder: Path, ra: float, dec: float) -> Path:
    return Path(folder) / f"{ra:.4f}_{dec:.4f}.csv"


def load(folder: Path, ra: float, dec: float, now: Optional[float] = None) -> Optional[List[Dict[str, str]]]:
    """The remembered rows, or None if there are none or they are older than TTL_S."""
    p = _path(folder, ra, dec)
    try:
        if (now if now is not None else time.time()) - p.stat().st_mtime > TTL_S:
            return None
        with p.open(newline="") as f:
            rows = list(csv.DictReader(f))
    except (OSError, csv.Error, ValueError):  # missing, unreadable or damaged: as if it was never remembered
        return None
    return rows or None


def save(folder: Path, ra: float, dec: float, rows: List[Dict[str, str]]) -> None:
    """Remember `rows` (nothing is written for an empty answer, which is not worth keeping)."""
    if not rows:
        return
    p = _path(folder, ra, dec)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".part")
    with tmp.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    tmp.replace(p)
