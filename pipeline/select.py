"""Frame selection: de-duplicate across releases, time order, even spacing."""
from .irsa import observation_key, release_of


def dedupe_prefer_dr1(rows):
    best = {}
    for r in rows:
        k = observation_key(r["uri"])
        cur = best.get(k)
        if cur is None or (release_of(r["uri"]) == "dr1" and release_of(cur["uri"]) != "dr1"):
            best[k] = r
    return list(best.values())


def select_frames(rows, max_frames):
    rows = sorted(dedupe_prefer_dr1(rows), key=lambda r: (float(r["time_bounds_lower"]), r["uri"]))
    n = len(rows)
    if n <= max_frames:
        return rows
    idx = sorted({round(i * (n - 1) / (max_frames - 1)) for i in range(max_frames)})
    return [rows[i] for i in idx]


BAND_TOL_UM = 0.002  # contract: wavelengths this close (chained) are one band


def select_per_wavelength(frames, cap, tol=BAND_TOL_UM):
    """One frame per wavelength band, ordered by wavelength, at most `cap` bands.

    `frames` are dicts with `wavelength_um` and `flag_fraction`. Sorted wavelengths are
    chained into bands (a gap above `tol` starts a new band). In each band the frame with
    the lowest flag_fraction is kept (ties: earlier obs_mjd). If there are more bands than
    `cap`, the bands whose best frame is most flagged are dropped.
    """
    if not frames:
        return []
    ordered = sorted(frames, key=lambda f: f["wavelength_um"])
    bands, cur = [], [ordered[0]]
    for f in ordered[1:]:
        if f["wavelength_um"] - cur[-1]["wavelength_um"] <= tol:
            cur.append(f)
        else:
            bands.append(cur)
            cur = [f]
    bands.append(cur)
    best = [min(b, key=lambda f: (f["flag_fraction"], f["obs_mjd"])) for b in bands]
    if len(best) > cap:
        keep = sorted(sorted(best, key=lambda f: (f["flag_fraction"], f["wavelength_um"]))[:cap], key=lambda f: f["wavelength_um"])
        best = keep
    return best
