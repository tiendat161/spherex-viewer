"""Run the TAP queries one at a time and print image counts (network)."""
import sys
import time
from collections import Counter

from . import targets
from .irsa import IrsaClient, observation_key, release_of


def main():
    client = IrsaClient()
    for t in targets.resolve(targets.load_config()):
        t0 = time.time()
        rows = client.tap_rows(t.ra, t.dec)
        keys = {observation_key(r["uri"]) for r in rows}
        rel = Counter(release_of(r["uri"]) for r in rows)
        mjd = [float(r["time_bounds_lower"]) for r in rows]
        print(f"{t.id}: ra={t.ra} dec={t.dec} rows={len(rows)} distinct_obs={len(keys)} releases={dict(rel)} "
              f"mjd={min(mjd) if mjd else None}..{max(mjd) if mjd else None} {time.time()-t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
