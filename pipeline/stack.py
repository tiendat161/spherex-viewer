"""Background subtraction, visit grouping and visit x band stacks.

Why: consecutive SPHEREx images of one position are in different wavelengths, so a
time-ordered blink mostly shows the background changing. The sky is revisited in
groups of dates ("visits") months apart; combining the images of one visit per band
gives a few deep images whose only difference is time.
"""
import math
import re
import warnings

import numpy as np
from astropy.stats import sigma_clip

from . import stretch as stretch_mod

VISIT_GAP_DAYS = 30.0      # a gap longer than this between consecutive images starts a new visit
MAX_VISIT_DAYS = 60.0      # a longer run of dates (continuously observed fields) is cut into equal bins
MIN_CLIP_IMAGES = 3        # sigma clipping needs a few values per pixel
CLIP_SIGMA = 3.0
DIFF_PCT = 99.5            # difference images: +-(this percentile of |difference|) maps to 0..255
ALL = "all"


def subtract_background(pix, flagged):
    """Subtract the median of the unflagged finite pixels (of all finite pixels if none are unflagged)."""
    ok = np.isfinite(pix)
    use = ok & ~flagged
    if not use.any():
        use = ok
    if not use.any():
        return pix
    return (pix - np.float32(np.median(pix[use]))).astype("float32")


def band_id(bandpass_name: str) -> str:
    """'SPHEREx-D3' -> 'D3'. Only letters and digits are kept."""
    return re.sub(r"[^A-Za-z0-9]", "", str(bandpass_name).replace("SPHEREx-", "")) or "unknown"


def assign_visits(mjds):
    """Visit number for each time, in input order, and [(start, end)] per visit."""
    if not len(mjds):
        return [], []
    order = sorted(range(len(mjds)), key=lambda i: mjds[i])
    runs, cur = [], [order[0]]
    for i in order[1:]:
        if mjds[i] - mjds[cur[-1]] > VISIT_GAP_DAYS:
            runs.append(cur)
            cur = [i]
        else:
            cur.append(i)
    runs.append(cur)
    groups = []
    for run in runs:
        t0, span = mjds[run[0]], mjds[run[-1]] - mjds[run[0]]
        nbins = max(1, math.ceil(span / MAX_VISIT_DAYS))
        bins = [[] for _ in range(nbins)]
        for i in run:
            bins[min(nbins - 1, int((mjds[i] - t0) / span * nbins) if span > 0 else 0)].append(i)
        groups += [b for b in bins if b]
    visit = [0] * len(mjds)
    for v, g in enumerate(groups):
        for i in g:
            visit[i] = v
    return visit, [(mjds[g[0]], mjds[g[-1]]) for g in groups]


def combine(pixels, flagged):
    """Sigma-clipped mean of the unflagged values per pixel (plain mean below MIN_CLIP_IMAGES).

    Where no image has an unflagged value the mean of the finite values is used instead, so a
    saturated star is still drawn. Returns (image, nodata) where nodata marks those fallback pixels.
    """
    cube = np.stack(pixels).astype("float32")
    bad = np.stack(flagged) | ~np.isfinite(cube)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        data = np.ma.masked_array(cube, mask=bad)
        if len(pixels) >= MIN_CLIP_IMAGES:
            data = sigma_clip(data, sigma=CLIP_SIGMA, axis=0, masked=True)
        out = data.mean(axis=0).filled(np.nan).astype("float32")
        nodata = ~np.isfinite(out)
        if nodata.any():
            out[nodata] = np.nanmean(np.where(np.isfinite(cube), cube, np.nan), axis=0)[nodata]
    return out, nodata


def render_diff(diff, limit):
    """Linear, zero at mid-grey. NaN -> mid-grey."""
    x = np.clip(np.nan_to_num(diff, nan=0.0) / limit, -1.0, 1.0)
    return np.rint((x + 1.0) * 127.5).astype(np.uint8)


def visits_for(mjds, all_mjds=None):
    """Like `assign_visits(mjds)`, but with the visit boundaries taken from `all_mjds` (every archive
    image of the position) so that a sparse sample of images does not split a visit at its own gaps.
    Visits with no image are dropped; bounds are those of the images actually present."""
    if not all_mjds:
        return assign_visits(mjds)
    _, ref = assign_visits(list(all_mjds))
    raw = [min(range(len(ref)), key=lambda v: 0.0 if ref[v][0] <= t <= ref[v][1] else min(abs(t - ref[v][0]), abs(t - ref[v][1])))
           for t in mjds]
    renumber = {v: k for k, v in enumerate(sorted(set(raw)))}
    visit = [renumber[v] for v in raw]
    bounds = [(min(t for t, v in zip(mjds, visit) if v == k), max(t for t, v in zip(mjds, visit) if v == k))
              for k in range(len(renumber))]
    return visit, bounds


def build_stacks(items, unit, all_mjds=None):
    """`items`: dicts with obs_mjd, band (id), wavelength_um, pix (background-subtracted), flagged.
    `all_mjds`: observation times of every archive image of the position, for the visit boundaries.

    Returns (meta, pngs) or (None, {}) if nothing can be stacked. `meta` is the contract's `stacks`
    object with file names in place of URLs ("url"/"diff_url" hold names like 's_D3_0.png'); `pngs`
    maps each name to a uint8 array (row 0 = south, like the frame arrays before `to_png_array`).
    """
    if not items:
        return None, {}
    visit_of, bounds = visits_for([it["obs_mjd"] for it in items], all_mjds)
    band_ids = [ALL] + sorted({it["band"] for it in items})
    if len(band_ids) == 2:  # a single detector: 'all' would repeat it
        band_ids = [ALL]
    bands, images, pngs = [], [], {}
    for b in band_ids:
        members = [(v, it) for v, it in zip(visit_of, items) if b == ALL or it["band"] == b]
        per_visit = {}
        for v in sorted({v for v, _ in members}):
            its = [it for vv, it in members if vv == v]
            img, nodata = combine([it["pix"] for it in its], [it["flagged"] for it in its])
            if np.isfinite(img).any():
                per_visit[v] = (img, nodata, len(its))
        if not per_visit:
            continue
        try:
            vmin, vmax = stretch_mod.compute_limits([p[0] for p in per_visit.values()],
                                                    [~np.isfinite(p[0]) for p in per_visit.values()])
        except ValueError:
            continue
        st = {"kind": stretch_mod.KIND, "vmin": round(vmin, 6), "vmax": round(vmax, 6), "unit": unit}
        wl = [it["wavelength_um"] for _, it in members]
        band = {"id": b, "wavelength_min_um": round(min(wl), 5), "wavelength_max_um": round(max(wl), 5), "stretch": st}
        first = min(per_visit)
        diffs = {v: p[0] - per_visit[first][0] for v, p in per_visit.items() if v != first}
        finite = [np.abs(d[np.isfinite(d)]) for d in diffs.values()]
        limit = float(np.percentile(np.concatenate(finite), DIFF_PCT)) if finite and sum(f.size for f in finite) else 0.0
        limit = round(limit, 6)
        if limit > 0:
            band["diff_limit"] = limit
        bands.append(band)
        for v, (img, nodata, n) in sorted(per_visit.items()):
            name = f"s_{b}_{v}.png"
            pngs[name] = stretch_mod.apply(img, st["vmin"], st["vmax"])
            entry = {"visit": v, "band": b, "url": name, "n_images": n, "flag_fraction": round(float(nodata.mean()), 4)}
            if v in diffs and limit > 0:
                dname = f"d_{b}_{v}.png"
                pngs[dname] = render_diff(diffs[v], limit)
                entry["diff_url"] = dname
            images.append(entry)
    if not bands:
        return None, {}
    meta = {"visits": [{"index": i, "start_mjd": round(a, 6), "end_mjd": round(z, 6)} for i, (a, z) in enumerate(bounds)],
            "bands": bands, "images": sorted(images, key=lambda e: (e["visit"], band_ids.index(e["band"])))}
    return meta, pngs


def with_urls(meta, url_for):
    """Copy of `meta` with file names replaced by URLs."""
    out = dict(meta, images=[dict(e) for e in meta["images"]])
    for e in out["images"]:
        e["url"] = url_for(e["url"])
        if "diff_url" in e:
            e["diff_url"] = url_for(e["diff_url"])
    return out
