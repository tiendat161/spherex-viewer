"""Keep finished live series on disk, so a restart of the server does not lose them (T22).

What is kept per series (real data, as built): the series document's data (frame metadata, flux, stretch, stacks) and the PNGs
(frames, stacks, differences). Not kept: pixels and native cutouts (large). A restored series therefore can be shown, blinked and
charted at once, but a spectrum at a clicked point or loading more frames needs its pixels again; the builder then rebuilds it from
the archive rows (`LiveBuilder.revive`, `get_or_start`), which are remembered separately by `pipeline.tapcache`.

Layout: <folder>/<series id>/meta.json, <series id>/png/<file name>. A series is written to a temporary folder and renamed, so a
crash leaves either the old or the new one. At most `max_kept` series are kept (newest first) and none older than TTL_S, so new data
releases are picked up. Anything unreadable is skipped as if it was never saved.
"""
import json
import os
import re
import shutil
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
TTL_S = 7 * 24 * 3600
FORMAT = 1
ID_RE = re.compile(r"^live[0-9a-f]{12}$")
PNG_RE = re.compile(r"^(\d{2,3}|[sd]_[A-Za-z0-9]+_\d{1,3})\.png$")  # same names as the API serves


def default_dir() -> Path:
    return Path(os.environ.get("SPHEREX_CACHE_DIR", ROOT / ".cache")) / "live-series"


def save(folder: Path, series_id: str, meta: dict, pngs: Dict[str, bytes], max_kept: int) -> None:
    """Write one series (replacing an earlier copy), then drop the oldest beyond `max_kept`."""
    folder = Path(folder)
    final, tmp = folder / series_id, folder / f".{series_id}.part"
    shutil.rmtree(tmp, ignore_errors=True)
    (tmp / "png").mkdir(parents=True)
    for name, data in pngs.items():
        (tmp / "png" / name).write_bytes(data)
    (tmp / "meta.json").write_text(json.dumps(dict(meta, format=FORMAT, saved_at=time.time())))
    shutil.rmtree(final, ignore_errors=True)
    tmp.replace(final)
    prune(folder, max_kept)


def _entries(folder: Path) -> List[Tuple[float, Path]]:
    out = []
    for p in Path(folder).glob("live*"):
        if ID_RE.match(p.name) and (p / "meta.json").is_file():
            try:
                out.append(((p / "meta.json").stat().st_mtime, p))
            except OSError:
                pass
    return sorted(out, key=lambda e: e[0], reverse=True)  # newest first


def prune(folder: Path, max_kept: int, now: Optional[float] = None) -> None:
    now = now if now is not None else time.time()
    for k, (mtime, p) in enumerate(_entries(folder)):
        if k >= max_kept or now - mtime > TTL_S:
            shutil.rmtree(p, ignore_errors=True)


def load_all(folder: Path, max_kept: int, now: Optional[float] = None) -> List[Tuple[dict, Dict[str, bytes]]]:
    """[(meta, {png file name: bytes})] for the newest `max_kept` readable series not older than TTL_S, oldest first."""
    now = now if now is not None else time.time()
    out = []
    for mtime, p in _entries(folder)[:max_kept]:
        if now - mtime > TTL_S:
            continue
        try:
            meta = json.loads((p / "meta.json").read_text())
            if meta.get("format") != FORMAT or meta.get("id") != p.name:
                continue
            pngs = {f.name: f.read_bytes() for f in (p / "png").iterdir() if PNG_RE.match(f.name)}
        except (OSError, ValueError):
            continue
        out.append((meta, pngs))
    return out[::-1]
