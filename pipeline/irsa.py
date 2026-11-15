"""The one IRSA client: TAP sync join query and cutout fetch.

Every request to IRSA, TAP or cutout, goes through `IrsaClient._send`, which
holds a single process-wide semaphore (MAX_IN_FLIGHT = 8). Nothing else in the
repository talks to IRSA. The transport is injectable so tests use a fake and
never touch the network.
"""
import csv
import io
import re
import threading
import time
import warnings
from typing import Callable, Dict, List, NamedTuple, Optional

BASE = "https://irsa.ipac.caltech.edu/"
TAP_URL = BASE + "TAP/sync"
SIA_URL = BASE + "SIA"
# One SIA2 query per release collection. The release is also in each file's URI, which select.py ranks.
SIA_COLLECTIONS = ("spherex_dr1", "spherex_qr3")
SIA_RADIUS_DEG = 0.0003      # a point, as in the TAP query: the images whose footprint contains the position
# 2026-11-15, T40: was 4. A direct test (8 images at once: 12 of 12 ok, about twice the rate of 4 at once) was fine;
# 12 at once had the server reset a connection (docs/WORKLOG.md). Network errors are retried like HTTP 503s.
MAX_IN_FLIGHT = 8
CUTOUT_ATTEMPTS = 4          # contract decision 11
TAP_ATTEMPTS = 3
SIA_ATTEMPTS = 2             # TAP is the fallback, so give up on SIA2 sooner
MAX_RETRY_WAIT_S = 30.0       # a server asking for longer does not park a worker that long (T44)
DEFAULT_RETRY_WAIT_S = 5.0   # spike: 503 carried retry-after: 5

# Process-wide: shared by every IrsaClient instance, covers TAP and cutouts.
_GATE = threading.BoundedSemaphore(MAX_IN_FLIGHT)
# Catalogue overlay queries (T15) are optional: they wait on their own small gate, so they never take a slot from image downloads.
CATALOGUE_IN_FLIGHT = 2
_CATALOGUE_GATE = threading.BoundedSemaphore(CATALOGUE_IN_FLIGHT)


class Response(NamedTuple):
    status: int
    headers: Dict[str, str]   # lower-case keys
    content: bytes


class IrsaError(Exception):
    pass


Transport = Callable[[str, str, Optional[dict]], Response]


def requests_transport(method: str, url: str, data: Optional[dict], timeout: float = 300) -> Response:
    import requests
    if method == "POST":
        r = requests.post(url, data=data, timeout=timeout)
    else:
        r = requests.get(url, timeout=timeout)
    return Response(r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.content)


def tap_query_text(ra: float, dec: float) -> str:
    # Join from spike/tap.py: geometry and time live in spherex.plane, file URI in spherex.artifact.
    return (
        "SELECT p.planeid, p.time_bounds_lower, p.time_bounds_upper, p.energy_bandpassname, a.uri, a.contentlength "
        "FROM spherex.plane p JOIN spherex.artifact a ON a.planeid=p.planeid "
        f"WHERE CONTAINS(POINT('ICRS',{ra:.9f},{dec:.9f}), p.poly)=1 ORDER BY p.time_bounds_lower"
    )


def sia_url(collection: str, ra: float, dec: float) -> str:
    return f"{SIA_URL}?COLLECTION={collection}&POS=circle%20{ra:.9f}%20{dec:.9f}%20{SIA_RADIUS_DEG}"


def parse_sia_rows(body: bytes) -> List[Dict[str, str]]:
    """SIA2 VOTable to the rows the pipeline reads (the same keys as the TAP rows).

    `contentlength` comes from `access_estsize`, which is in kilobytes, so it is an estimate (within 1 kB of TAP's on WISE 0855).
    `planeid` is not in SIA2 rows; `obs_id` stands in and nothing reads it.
    """
    from astropy.io.votable import parse
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # the archive's VOTable draws harmless spec warnings; "verify=ignore" would rename the columns col_N
        vot = parse(io.BytesIO(body))
    rows: List[Dict[str, str]] = []
    for table in vot.iter_tables():
        col = {f.name: (f.ID or f.name) for f in table.fields}  # the array is keyed by ID (col_N in the archive's answer), not by name
        if "access_url" not in col:
            continue  # the self-description table
        for r in table.array:
            url = str(r[col["access_url"]])
            if not url.startswith(BASE):
                raise IrsaError(f"SIA2 row with an unexpected URL: {url[:80]}")
            rows.append({
                "planeid": str(r[col["obs_id"]]),
                "time_bounds_lower": repr(float(r[col["t_min"]])),
                "time_bounds_upper": repr(float(r[col["t_max"]])),
                "energy_bandpassname": str(r[col["energy_bandpassname"]]),
                "uri": url[len(BASE):],
                "contentlength": str(int(r[col["access_estsize"]]) * 1000),
            })
    return rows


def cutout_url(uri: str, ra: float, dec: float, size_deg: float) -> str:
    return f"{BASE}{uri}?center={ra:.9f},{dec:.9f}&size={size_deg}"


def _retry_after(resp: Response) -> float:
    try:
        return min(MAX_RETRY_WAIT_S, max(0.0, float(resp.headers.get("retry-after", DEFAULT_RETRY_WAIT_S))))
    except ValueError:
        return DEFAULT_RETRY_WAIT_S


class IrsaClient:
    def __init__(self, transport: Transport = requests_transport, sleep: Callable[[float], None] = time.sleep):
        self._transport = transport
        self._sleep = sleep

    def _send(self, method: str, url: str, data: Optional[dict] = None, timeout: Optional[float] = None,
              gate: Optional[threading.BoundedSemaphore] = None) -> Response:
        with (gate or _GATE):
            if timeout is None:
                return self._transport(method, url, data)
            return self._transport(method, url, data, timeout)  # only given when a caller asks for a shorter wait

    def _with_retries(self, what: str, attempts: int, method: str, url: str, data: Optional[dict] = None,
                      timeout: Optional[float] = None, gate: Optional[threading.BoundedSemaphore] = None) -> bytes:
        last = "no attempt"
        for attempt in range(1, attempts + 1):
            try:
                resp = self._send(method, url, data, timeout, gate)
            except Exception as e:  # network error: counts as an attempt
                last = f"{type(e).__name__}: {e}"
                wait = DEFAULT_RETRY_WAIT_S
            else:
                if resp.status == 200:
                    return resp.content
                last = f"HTTP {resp.status}"
                if resp.status not in (429, 500, 502, 503, 504):
                    break
                wait = _retry_after(resp)
            if attempt < attempts:
                self._sleep(wait)  # sleep outside the semaphore
        raise IrsaError(f"{what} failed after retries: {last}")

    def tap_rows(self, ra: float, dec: float, attempts: int = TAP_ATTEMPTS, timeout: Optional[float] = None) -> List[Dict[str, str]]:
        body = self._with_retries(
            "TAP query", attempts, "POST", TAP_URL,
            {"QUERY": tap_query_text(ra, dec), "LANG": "ADQL", "FORMAT": "csv"}, timeout,
        )
        return list(csv.DictReader(io.StringIO(body.decode("utf-8"))))

    def tap_query(self, adql: str, attempts: int = 1, timeout: Optional[float] = None) -> List[Dict[str, str]]:
        """Any ADQL query to IRSA TAP, rows as dicts (catalogue tables, pipeline/catalogue.py). One attempt by default and its
        own concurrency gate (CATALOGUE_IN_FLIGHT): an optional query must neither wait long nor take a slot from image downloads."""
        body = self._with_retries("TAP catalogue query", attempts, "POST", TAP_URL,
                                  {"QUERY": adql, "LANG": "ADQL", "FORMAT": "csv"}, timeout, _CATALOGUE_GATE)
        return list(csv.DictReader(io.StringIO(body.decode("utf-8"))))

    def sia_rows(self, ra: float, dec: float, timeout: Optional[float] = None) -> List[Dict[str, str]]:
        """Images covering a position, through SIA2 (one query per release collection). Used only by the live path, when TAP
        fails: on R Draconis it returns 539 of the 2493 images TAP lists (docs/WORKLOG.md, T43), so the list may be incomplete."""
        rows: List[Dict[str, str]] = []
        for collection in SIA_COLLECTIONS:
            body = self._with_retries(f"SIA2 query {collection}", SIA_ATTEMPTS, "GET", sia_url(collection, ra, dec), None, timeout)
            try:
                rows += parse_sia_rows(body)
            except IrsaError:
                raise
            except Exception as e:
                raise IrsaError(f"SIA2 answer for {collection} could not be read: {type(e).__name__}: {e}")
        return rows

    def fetch_cutout(self, uri: str, ra: float, dec: float, size_deg: float) -> bytes:
        return self._with_retries(f"cutout {uri}", CUTOUT_ATTEMPTS, "GET", cutout_url(uri, ra, dec, size_deg))


_OBS_RE = re.compile(r"level2_(?P<obs>.+?)_spx_")


def observation_key(uri: str) -> str:
    """Release-independent identity of an image, e.g. '2025W19_1B_0116_1D3'."""
    m = _OBS_RE.search(uri.rsplit("/", 1)[-1])
    return m.group("obs") if m else uri


def release_of(uri: str) -> str:
    m = re.search(r"/spherex/([^/]+)/", uri)
    return m.group(1) if m else ""
