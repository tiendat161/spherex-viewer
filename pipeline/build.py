"""Build cached series from real IRSA data. `make cache` runs this (network).

    python -m pipeline.build [verify/targets.json] [--only id ...] [--refresh-tap]

Resumable: the TAP rows and each raw cutout FITS are cached under
$SPHEREX_CACHE_DIR (default ./.cache) and reused on re-runs.
"""
import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from . import stretch as stretch_mod
from . import targets as targets_mod
from .cutout import CutoutError, read_cutout
from .grid import grid_shape, make_grid_wcs, reproject_frame
from .irsa import MAX_IN_FLIGHT, IrsaClient, IrsaError
from .select import select_frames
from .writer import write_series

ROOT = Path(__file__).resolve().parent.parent
CUTOUT_FOV_FACTOR = 1.5  # cutout is square on the detector, grid on the sky: oversize so corners are covered


def cache_dir() -> Path:
    return Path(os.environ.get("SPHEREX_CACHE_DIR", ROOT / ".cache"))


def tap_rows_cached(client, t, refresh=False):
    import csv
    path = cache_dir() / "tap" / f"{t.id}_{t.ra:.6f}_{t.dec:.6f}.csv"
    if path.is_file() and not refresh:
        return list(csv.DictReader(path.open()))
    rows = client.tap_rows(t.ra, t.dec)
    path.parent.mkdir(parents=True, exist_ok=True)
    if rows:
        with path.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
    return rows


def fetch_raw(client, t, row, fov):
    path = cache_dir() / "cutouts" / t.id / f"{row['uri'].rsplit('/', 1)[-1]}"
    if not path.is_file():
        data = client.fetch_cutout(row["uri"], t.ra, t.dec, round(fov * CUTOUT_FOV_FACTOR, 4))
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(path)
    return path


def build_target(client, t, cfg, out_root, refresh_tap=False, log=print):
    fov, max_frames, min_frames = cfg["fov"], cfg["max_frames"], cfg["min_frames"]
    rows = tap_rows_cached(client, t, refresh_tap)
    chosen = select_frames(rows, max_frames)
    total = len(chosen)
    log(f"[{t.id}] {len(rows)} TAP rows, {total} frames selected")
    shape = grid_shape(fov)
    gwcs = make_grid_wcs(t.ra, t.dec, shape)

    def work(i_row):
        i, row = i_row
        try:
            path = fetch_raw(client, t, row, fov)
            c = read_cutout(str(path), t.ra, t.dec)
            pix, flagged = reproject_frame(c["image"], c["wcs"], c["flags"], gwcs, shape)
            if not np.isfinite(pix).any():
                raise CutoutError("no coverage on the grid")
            log(f"[{t.id}] frame {i:02d} ok  {c['wavelength_um']:.3f} um")
            return i, {"index": i, "obs_mjd": float(row["time_bounds_lower"]), "wavelength_um": c["wavelength_um"],
                       "pix": pix, "flagged": flagged, "bunit": c["bunit"]}, None
        except (IrsaError, CutoutError) as e:
            log(f"[{t.id}] frame {i:02d} FAILED: {e}")
            return i, None, str(e)

    with ThreadPoolExecutor(MAX_IN_FLIGHT) as ex:
        results = list(ex.map(work, enumerate(chosen)))
    good = [r for _, r, _ in results if r is not None]
    failed = total - len(good)
    if len(good) < min_frames:
        raise SystemExit(f"{t.id}: only {len(good)} usable frames (< {min_frames}); not writing a series. "
                         f"Failures: " + "; ".join(f"{i}: {e}" for i, r, e in results if e))
    units = {g["bunit"] for g in good}
    if len(units) != 1:
        raise SystemExit(f"{t.id}: frames disagree on BUNIT: {units}")
    vmin, vmax = stretch_mod.compute_limits([g["pix"] for g in good], [g["flagged"] for g in good])
    st = {"kind": stretch_mod.KIND, "vmin": round(vmin, 6), "vmax": round(vmax, 6), "unit": units.pop()}
    frames = [{"index": g["index"], "obs_mjd": g["obs_mjd"], "wavelength_um": g["wavelength_um"],
               "flag_fraction": float(g["flagged"].mean()),
               "png": stretch_mod.apply(g["pix"], st["vmin"], st["vmax"])} for g in good]
    write_series(Path(out_root) / t.id, t.id, t.ra, t.dec, shape, st, frames, total, failed)
    log(f"[{t.id}] done={len(good)} failed={failed} total={total} stretch={st}")
    return len(good), failed, st


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("config", nargs="?", default=str(ROOT / "verify" / "targets.json"))
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--refresh-tap", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "static" / "series"))
    a = ap.parse_args(argv)
    cfg = targets_mod.load_config(a.config)
    tl = targets_mod.resolve(cfg)  # raises SystemExit if a cross-check fails
    client = IrsaClient()
    for t in tl:
        if a.only and t.id not in a.only:
            continue
        build_target(client, t, cfg, a.out, a.refresh_tap)
    # targets index for the API
    return 0


if __name__ == "__main__":
    sys.exit(main())
