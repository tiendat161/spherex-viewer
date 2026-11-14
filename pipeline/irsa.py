"""The one IRSA client: TAP sync join query and cutout fetch.

Every request to IRSA, TAP or cutout, goes through `IrsaClient._send`, which
holds a single process-wide semaphore (MAX_IN_FLIGHT = 4). Nothing else in the
repository talks to IRSA. The transport is injectable so tests use a fake and
never touch the network.
"""
import csv
import io
import re
import threading
import time
from typing import Callable, Dict, List, NamedTuple, Optional

BASE = "https://irsa.ipac.caltech.edu/"
TAP_URL = BASE + "TAP/sync"
MAX_IN_FLIGHT = 4
CUTOUT_ATTEMPTS = 4          # contract decision 11
TAP_ATTEMPTS = 3
DEFAULT_RETRY_WAIT_S = 5.0   # spike: 503 carried retry-after: 5

# Process-wide: shared by every IrsaClient instance, covers TAP and cutouts.
_GATE = threading.BoundedSemaphore(MAX_IN_FLIGHT)


class Response(NamedTuple):
    status: int
    headers: Dict[str, str]   # lower-case keys
    content: bytes


class IrsaError(Exception):
    pass


Transport = Callable[[str, str, Optional[dict]], Response]


def requests_transport(method: str, url: str, data: Optional[dict]) -> Response:
    import requests
    if method == "POST":
        r = requests.post(url, data=data, timeout=300)
    else:
        r = requests.get(url, timeout=300)
    return Response(r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.content)


def tap_query_text(ra: float, dec: float) -> str:
    # Join from spike/tap.py: geometry and time live in spherex.plane, file URI in spherex.artifact.
    return (
        "SELECT p.planeid, p.time_bounds_lower, p.time_bounds_upper, p.energy_bandpassname, a.uri, a.contentlength "
        "FROM spherex.plane p JOIN spherex.artifact a ON a.planeid=p.planeid "
        f"WHERE CONTAINS(POINT('ICRS',{ra:.9f},{dec:.9f}), p.poly)=1 ORDER BY p.time_bounds_lower"
    )


def cutout_url(uri: str, ra: float, dec: float, size_deg: float) -> str:
    return f"{BASE}{uri}?center={ra:.9f},{dec:.9f}&size={size_deg}"


def _retry_after(resp: Response) -> float:
    try:
        return max(0.0, float(resp.headers.get("retry-after", DEFAULT_RETRY_WAIT_S)))
    except ValueError:
        return DEFAULT_RETRY_WAIT_S


class IrsaClient:
    def __init__(self, transport: Transport = requests_transport, sleep: Callable[[float], None] = time.sleep):
        self._transport = transport
        self._sleep = sleep

    def _send(self, method: str, url: str, data: Optional[dict] = None) -> Response:
        with _GATE:
            return self._transport(method, url, data)

    def _with_retries(self, what: str, attempts: int, method: str, url: str, data: Optional[dict] = None) -> bytes:
        last = "no attempt"
        for attempt in range(1, attempts + 1):
            try:
                resp = self._send(method, url, data)
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

    def tap_rows(self, ra: float, dec: float) -> List[Dict[str, str]]:
        body = self._with_retries(
            "TAP query", TAP_ATTEMPTS, "POST", TAP_URL,
            {"QUERY": tap_query_text(ra, dec), "LANG": "ADQL", "FORMAT": "csv"},
        )
        return list(csv.DictReader(io.StringIO(body.decode("utf-8"))))

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
