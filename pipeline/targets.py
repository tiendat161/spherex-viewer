"""Cached request positions from verify/targets.json.

Positions are derived here, not typed in: sexagesimal -> degrees, and a linear
proper-motion propagation from J2000.0 to `propagate_to_epoch` for targets
flagged `propagate`. Linear propagation (no radial velocity, no perspective
terms) is adequate at the ~0.01 arcsec level for 26 years and the targets used.
"""
import json
import math
from pathlib import Path
from typing import List, NamedTuple, Optional

from astropy.coordinates import Angle
import astropy.units as u

ROOT = Path(__file__).resolve().parent.parent
MAS_PER_DEG = 3.6e6


class Target(NamedTuple):
    id: str
    name: str
    ra: float
    dec: float
    position_note: str


def sep_arcsec(ra1, dec1, ra2, dec2) -> float:
    r1, d1, r2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    a = math.sin((d2 - d1) / 2) ** 2 + math.cos(d1) * math.cos(d2) * math.sin((r2 - r1) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(a)))) * 3600


def propagate(ra, dec, pm_ra_cosdec_mas, pm_dec_mas, years):
    dec_new = dec + pm_dec_mas * years / MAS_PER_DEG
    ra_new = ra + pm_ra_cosdec_mas * years / MAS_PER_DEG / math.cos(math.radians(dec))
    return ra_new % 360.0, dec_new


def load_config(path=None) -> dict:
    return json.loads(Path(path or ROOT / "verify" / "targets.json").read_text())


def resolve(cfg: dict) -> List[Target]:
    out = []
    epoch_to = cfg["propagate_to_epoch"]
    for t in cfg["targets"]:
        pos = t["position"]
        if "ra_deg" in pos:
            ra, dec = pos["ra_deg"], pos["dec_deg"]
            note = f"{t['position_source']}"
        else:
            ra = Angle(pos["ra_hms"], unit=u.hourangle).deg
            dec = Angle(pos["dec_dms"], unit=u.deg).deg
            note = f"{t['position_source']}, ICRS J2000 {pos['ra_hms']} {pos['dec_dms']}"
        if t.get("propagate"):
            pm = t["pm_mas_per_yr"]
            ra, dec = propagate(ra, dec, pm["pm_ra_cosdec"], pm["pm_dec"], epoch_to - pos["epoch"])
            note += f"; propagated to epoch {epoch_to} with SIMBAD proper motion ({pm['pm_ra_cosdec']}, {pm['pm_dec']} mas/yr), linear"
            cc = t.get("cross_check")
            if cc:
                sep = sep_arcsec(ra, dec, cc["ra_deg"], cc["dec_deg"])
                if sep > cc["max_sep_arcsec"]:
                    raise SystemExit(
                        f"{t['id']}: propagated position disagrees with cross_check by {sep:.2f} arcsec "
                        f"(max {cc['max_sep_arcsec']}); stopping."
                    )
                note += f" (cross-check vs {cc['source']}: {sep:.2f} arcsec)"
        else:
            note += "; used as given, no proper-motion correction" if "ra_deg" in pos else "; proper motion negligible, J2000 used as is"
        out.append(Target(t["id"], t["name"], round(ra, 6), round(dec, 6), note))
    return out
