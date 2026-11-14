"""Write static/series/<id>/series.json and frames/NN.png."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

from .grid import PIXEL_SCALE_ARCSEC, to_png_array


def frame_url(series_id, index):
    return f"/api/frames/{series_id}/{index:02d}.png"


def write_series(out_dir: Path, series_id, ra, dec, shape, stretch, frames, total, failed):
    """`frames`: list of dicts index, obs_mjd, wavelength_um, flag_fraction, png (uint8 array, south-up)."""
    out_dir = Path(out_dir)
    fdir = out_dir / "frames"
    fdir.mkdir(parents=True, exist_ok=True)
    for old in fdir.glob("*.png"):
        old.unlink()
    entries = []
    for f in frames:
        Image.fromarray(np.ascontiguousarray(to_png_array(f["png"]))).save(fdir / f"{f['index']:02d}.png", optimize=True)
        entries.append({
            "index": f["index"],
            "obs_mjd": round(f["obs_mjd"], 6),
            "wavelength_um": round(f["wavelength_um"], 5),
            "url": frame_url(series_id, f["index"]),
            "flag_fraction": round(f["flag_fraction"], 4),
        })
    doc = {
        "status": "ready",
        "data_origin": "real",
        "progress": {"done": len(entries), "total": total, "failed": failed},
        "grid": {"center": {"ra": ra, "dec": dec}, "pixel_scale_arcsec": PIXEL_SCALE_ARCSEC, "shape": list(shape)},
        "stretch": stretch,
        "frames": entries,
    }
    (out_dir / "series.json").write_text(json.dumps(doc, indent=1) + "\n")
    return doc
