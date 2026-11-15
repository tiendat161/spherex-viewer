"""Write static/series/<id>/series.json and frames/NN.png."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

from .grid import PIXEL_SCALE_ARCSEC, to_png_array
from .photometry import method_block
from .stack import with_urls


def frame_url(series_id, index):
    return f"/api/frames/{series_id}/{index:02d}.png"


def _save(arr, path):
    Image.fromarray(np.ascontiguousarray(to_png_array(arr))).save(path, optimize=True)


def write_series(out_dir: Path, series_id, ra, dec, shape, stretch, frames, total, failed,
                 background="none", stacks=None, stack_pngs=None):
    """`frames`: list of dicts index, obs_mjd, wavelength_um, flag_fraction, png (uint8 array, south-up), and optionally
    `flux` (the contract object from `pipeline.photometry.flux_for_series`) and `mjd_avg`.

    `stacks`, `stack_pngs`: the pair returned by `pipeline.stack.build_stacks` (file names, uint8 arrays).
    """
    out_dir = Path(out_dir)
    fdir = out_dir / "frames"
    fdir.mkdir(parents=True, exist_ok=True)
    for old in fdir.glob("*.png"):
        old.unlink()
    entries = []
    for f in frames:
        _save(f["png"], fdir / f"{f['index']:02d}.png")
        entry = {
            "index": f["index"],
            "obs_mjd": round(f["obs_mjd"], 6),
            "wavelength_um": round(f["wavelength_um"], 5),
            "url": frame_url(series_id, f["index"]),
            "flag_fraction": round(f["flag_fraction"], 4),
        }
        if f.get("mjd_avg") is not None:
            entry["mjd_avg"] = round(f["mjd_avg"], 6)
        if f.get("flux") is not None:
            entry["flux"] = f["flux"]
        entries.append(entry)
    doc = {
        "status": "ready",
        "data_origin": "real",
        "progress": {"done": len(entries), "total": total, "failed": failed},
        "grid": {"center": {"ra": ra, "dec": dec}, "pixel_scale_arcsec": PIXEL_SCALE_ARCSEC, "shape": list(shape)},
        "stretch": stretch,
        "frames": entries,
        "background": background,
    }
    if any("flux" in e for e in entries):
        doc["photometry"] = method_block()
    if stacks:
        for name, arr in (stack_pngs or {}).items():
            _save(arr, fdir / name)
        doc["stacks"] = with_urls(stacks, lambda name: f"/api/frames/{series_id}/{name}")
    (out_dir / "series.json").write_text(json.dumps(doc, indent=1) + "\n")
    return doc
