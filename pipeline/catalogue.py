"""Catalogue sources for the overlay (T15): AllWISE Source Catalog from IRSA TAP. REAL catalogue data.

Why AllWISE through IRSA TAP and not Gaia: the service already reaches IRSA (same client, same host, same retry and
concurrency rules, nothing new to open in the deployed container), and WISE is an infrared survey like SPHEREx.
The ESA Gaia TAP endpoint (https://gea.esac.esa.int/tap-server/tap/sync, documented at
https://www.cosmos.esa.int/web/gaia-users/archive/programmatic-access) was unreachable from the development machine on
2026-11-15, so it was not used. The table name `allwise_p3as_psd` is the one listed as the AllWISE Source Catalog's TAP table in
the IRSA/VO registry record (https://dc.g-vo.org/I/ivo://irsa.ipac/WISE/Catalog/AllWISE/Source_Catalog, found by search; the
column names `w1mpro` and `w1mjdmean` are from IRSA's AllWISE column documentation text). NOT confirmed against the live service
(HTTP 502 on 2026-11-15). Positions are the catalogue's, not moved for proper motion (contracts/catalogue.schema.json).
"""
import math
from typing import Dict, List, Optional

from pipeline import messages
from pipeline.irsa import IrsaClient, IrsaError

TABLE = "allwise_p3as_psd"
NAME = "AllWISE Source Catalog (WISE, NASA/IPAC IRSA)"
SERVICE = "https://irsa.ipac.caltech.edu/TAP/sync"
MAX_SOURCES = 400            # the brightest this many are returned
TIMEOUT_S = 20.0             # the whole wait: one attempt (tap_query attempts=1), no retries; the overlay is optional, so fail rather than hang


def query_text(ra: float, dec: float, fov_deg: float) -> str:
    ra = ra % 360.0  # CIRCLE on the sphere wraps at RA 0/360 and at the poles by itself; nothing to split here
    radius = fov_deg * 0.75  # half the diagonal is 0.707 * fov: covers the corners of the square field
    return (f"SELECT TOP {MAX_SOURCES + 1} designation, ra, dec, w1mpro, w1mjdmean FROM {TABLE} "
            f"WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {radius:.6f})) = 1 ORDER BY w1mpro")


def _float(v: Optional[str]) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def parse_rows(rows: List[Dict[str, str]]) -> List[dict]:
    out = []
    for r in rows:
        ra, dec = _float(r.get("ra")), _float(r.get("dec"))
        if ra is None or dec is None:
            continue
        out.append({"designation": (r.get("designation") or "").strip(), "ra": ra, "dec": dec,
                    "w1_mag": _float(r.get("w1mpro")), "mjd": _float(r.get("w1mjdmean"))})
    return out


def catalogue_document(ra: float, dec: float, fov_deg: float, client: Optional[IrsaClient] = None) -> dict:
    """The /api/catalogue answer. Never raises: a service failure is an error document."""
    info = {"name": NAME, "table": TABLE, "service": SERVICE}
    try:
        rows = (client or IrsaClient()).tap_query(query_text(ra, dec, fov_deg), timeout=TIMEOUT_S)
        sources = parse_rows(rows)
    except IrsaError as e:
        messages.log_failure("catalogue", messages.CATALOGUE_DOWN, str(e))
        return {"status": "error", "catalogue": info, "sources": [],
                "error": {"message": messages.CATALOGUE_DOWN, "detail": f"The catalogue service (IRSA TAP) did not answer: {e}"}}
    except Exception as e:  # unreadable answer
        messages.log_failure("catalogue", messages.CATALOGUE_UNREADABLE, f"{type(e).__name__}: {e}")
        return {"status": "error", "catalogue": info, "sources": [],
                "error": {"message": messages.CATALOGUE_UNREADABLE, "detail": f"{type(e).__name__}: {e}"}}
    truncated = len(sources) > MAX_SOURCES
    return {"status": "ok", "catalogue": info, "sources": sources[:MAX_SOURCES], "truncated": truncated}
