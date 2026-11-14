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
