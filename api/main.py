"""FastAPI service. Serves the static cache written by `pipeline/`. A position that is not
cached is built live from IRSA in the background (`pipeline/live.py`) while the client polls;
set SPHEREX_LIVE=0 to serve the cache only, in which case nothing here contacts IRSA.

    GET /api/series?ra=&dec=&fov=0.2&max_frames=102&load=8     (fov: 0.1, 0.2, 0.5 or 1; only 0.2 is cached;
                                                                `load`: frames of a live series to have loaded, a larger value extends it)
    GET /api/spectrum?ra=&dec=&fov=0.2&at_ra=&at_dec=&load=40    (flux at a clicked position in every frame of the live series
                                                                at ra, dec, fov; always live, also at a cached position)
    GET /api/targets
    GET /api/frames/<id>/NN.png            (also s_<band>_<visit>.png and d_<band>_<visit>.png for stacks)
    web/dist (when it exists) is served at /
"""
import json
import math
import os
import re
import threading
import time
from collections import deque
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from pipeline import targets as targets_mod
from pipeline.grid import FOVS_DEG, allowed_fov
from pipeline.live import LIVE_FRAMES, MAX_LIVE_FRAMES, LiveBuilder, LiveBusy

ROOT = Path(__file__).resolve().parent.parent
MATCH_ARCSEC = 1.0
CACHED_FOV = 0.2
CACHED_MAX_FRAMES = 102  # default and ceiling; a cached series is returned if max_frames >= its frame count
ID_RE = re.compile(r"[a-z0-9]+")  # used with fullmatch: `$` would also accept a trailing newline
FRAME_RE = re.compile(r"([0-9]{2,3}|[sd]_[A-Za-z0-9]+_[0-9]{1,3})\.png")  # (fullmatch; ASCII digits only) frame NN.png, stack s_<band>_<visit>.png, difference d_...


RATE_LIMIT = 120      # /api/series requests per client per RATE_WINDOW_S (the web app polls every 2 s: 30 a minute per tab)
RATE_WINDOW_S = 60.0


class RateLimiter:
    """Sliding window per client key. In memory, one process (the service runs as one instance)."""

    def __init__(self, limit=RATE_LIMIT, window_s=RATE_WINDOW_S, max_keys=10000):
        self._limit, self._window, self._max_keys = limit, window_s, max_keys
        self._hits = {}
        self._lock = threading.Lock()

    def allow(self, key, now=None) -> bool:
        now = time.monotonic() if now is None else now
        with self._lock:
            if len(self._hits) > self._max_keys:  # bound the table: forget clients with no recent hits
                self._hits = {k: q for k, q in self._hits.items() if q and now - q[-1] < self._window}
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] >= self._window:
                q.popleft()
            if len(q) >= self._limit:
                return False
            q.append(now)
            return True


def error_doc(message: str) -> dict:
    return {
        "status": "error",
        "data_origin": "real",  # nothing in this response is placeholder or synthetic
        "progress": {"done": 0, "total": 0, "failed": 0},
        "grid": None,
        "stretch": None,
        "frames": [],
        "error": {"message": message},
    }


def spectrum_error_doc(message: str) -> dict:
    return {"status": "error", "data_origin": "real", "progress": {"done": 0, "total": 0, "failed": 0}, "frames": [],
            "error": {"message": message}}


def _num(request: Request, name: str, default: Optional[float] = None) -> float:
    raw = request.query_params.get(name)
    if raw is None:
        if default is None:
            raise ValueError(f"missing required parameter '{name}'")
        return default
    try:
        v = float(raw)
    except ValueError:
        raise ValueError(f"parameter '{name}' is not a number: {raw!r}")
    if v != v or v in (float("inf"), float("-inf")):
        raise ValueError(f"parameter '{name}' must be finite")
    return v


def create_app(series_dir: Optional[Path] = None, web_dist: Optional[Path] = None, targets_config: Optional[Path] = None,
               live: Optional[LiveBuilder] = None, rate_limit: Optional[int] = None) -> FastAPI:
    """`live`: builder for uncached positions. None (the default) serves the cache only."""
    series_dir = Path(series_dir or os.environ.get("SPHEREX_SERIES_DIR") or ROOT / "static" / "series")
    web_dist = Path(web_dist) if web_dist is not None else ROOT / "web" / "dist"
    app = FastAPI(title="SPHEREx blink viewer API")
    if rate_limit is None:
        rate_limit = int(os.environ.get("SPHEREX_RATE_LIMIT", RATE_LIMIT))  # 0 turns the limit off
    limiter = RateLimiter(rate_limit) if rate_limit > 0 else None

    docs = {}  # path -> (mtime_ns, doc): series.json is read again only when the file changes

    def cached():
        """[(id, series doc)] for every directory that holds a readable series.json (a damaged one is skipped)."""
        out = []
        for p in sorted(series_dir.glob("*/series.json")):
            if not ID_RE.fullmatch(p.parent.name):
                continue
            try:
                mtime = p.stat().st_mtime_ns
                hit = docs.get(p)
                if hit is None or hit[0] != mtime:
                    hit = docs[p] = (mtime, json.loads(p.read_text()))
            except (OSError, ValueError):
                continue
            out.append((p.parent.name, hit[1]))
        return out

    @app.get("/api/series")
    def series(request: Request):
        if limiter is not None and not limiter.allow(request.client.host if request.client else "?"):
            return JSONResponse(error_doc("Too many requests from this address. Wait a minute and try again."), status_code=429,
                                headers={"Retry-After": "30"})
        try:
            ra = _num(request, "ra")
            dec = _num(request, "dec")
            fov = _num(request, "fov", CACHED_FOV)
            max_frames = _num(request, "max_frames", CACHED_MAX_FRAMES)
            load = _num(request, "load", 0)  # live series only; 0 means not given
            if not (0 <= ra < 360) or not (-90 <= dec <= 90):
                raise ValueError("ra must satisfy 0 <= ra < 360 and dec -90 to 90 (ICRS degrees)")
        except ValueError as e:
            return JSONResponse(error_doc(str(e)))
        fov = allowed_fov(fov)
        if fov is None or not (1 <= max_frames <= CACHED_MAX_FRAMES):
            return JSONResponse(error_doc(
                f"fov must be one of {', '.join(f'{f:g}' for f in FOVS_DEG)} (degrees) and 1 <= max_frames <= {CACHED_MAX_FRAMES}."))
        # The static cache holds fov=0.2 only; every other size is built live, also at a cached position.
        for _id, doc in (cached() if fov == CACHED_FOV else []):
            c = doc["grid"]["center"]
            if targets_mod.sep_arcsec(ra, dec, c["ra"], c["dec"]) <= MATCH_ARCSEC:
                if doc["progress"]["total"] > max_frames:
                    return JSONResponse(error_doc(
                        f"The cached series has {doc['progress']['total']} frames; request max_frames >= that."))
                return JSONResponse(doc)
        if live is not None:
            if load != 0 and not (1 <= load <= MAX_LIVE_FRAMES and load == int(load)):  # ignored for cached series
                return JSONResponse(error_doc(f"load must be a whole number from 1 to {MAX_LIVE_FRAMES}."))
            try:
                cap = int(load) if load else min(int(max_frames), LIVE_FRAMES)  # without `load`: as before, at most LIVE_FRAMES
                return JSONResponse(live.get_or_start(ra, dec, fov, cap).doc())
            except LiveBusy as e:
                return JSONResponse(error_doc(str(e)))
        if fov != CACHED_FOV:
            return JSONResponse(error_doc(
                f"Only fov={CACHED_FOV:g} is cached, and this server does not build series live."))
        return JSONResponse(error_doc(
            "No cached series within 1 arcsec of this position. This prototype serves only its cached targets "
            "(see /api/targets); nothing is built live."))

    @app.get("/api/spectrum")
    def spectrum(request: Request):
        """The flux at a clicked position in every frame of the live series at (ra, dec, fov). Polled like /api/series."""
        try:
            ra, dec = _num(request, "ra"), _num(request, "dec")
            at_ra, at_dec = _num(request, "at_ra"), _num(request, "at_dec")
            fov = _num(request, "fov", CACHED_FOV)
            load = _num(request, "load", LIVE_FRAMES)
            if not (0 <= ra < 360) or not (-90 <= dec <= 90) or not (0 <= at_ra < 360) or not (-90 <= at_dec <= 90):
                raise ValueError("ra must satisfy 0 <= ra < 360 and dec -90 to 90 (ICRS degrees)")
        except ValueError as e:
            return JSONResponse(spectrum_error_doc(str(e)))
        fov = allowed_fov(fov)
        if fov is None:
            return JSONResponse(spectrum_error_doc(f"fov must be one of {', '.join(f'{f:g}' for f in FOVS_DEG)} (degrees)."))
        if not (1 <= load <= MAX_LIVE_FRAMES and load == int(load)):
            return JSONResponse(spectrum_error_doc(f"load must be a whole number from 1 to {MAX_LIVE_FRAMES}."))
        # Inside the field of view (a square of side fov around the position; flat-sky approximation, fine at one degree).
        d_dec = abs(at_dec - dec)
        d_ra = abs((at_ra - ra + 180) % 360 - 180) * math.cos(math.radians(dec))
        if d_dec > fov / 2 or d_ra > fov / 2:
            return JSONResponse(spectrum_error_doc("The clicked position is outside the field of view."))
        if live is None:
            return JSONResponse(spectrum_error_doc(
                "This server does not build series live, so a spectrum at a clicked position cannot be measured "
                "(it needs the archive cutouts, which only live series keep)."))
        try:
            doc = live.get_or_start(ra, dec, fov, int(load)).spectrum(at_ra, at_dec)
        except LiveBusy as e:
            return JSONResponse(spectrum_error_doc(str(e)))
        return JSONResponse(doc)

    @app.get("/api/targets")
    def targets():
        names = {t.id: t for t in targets_mod.resolve(targets_mod.load_config(targets_config))}
        out = []
        for _id, doc in cached():
            t = names.get(_id)
            if t is None:
                continue
            c = doc["grid"]["center"]
            out.append({"id": _id, "name": t.name, "ra": c["ra"], "dec": c["dec"], "position_note": t.position_note})
        return out

    @app.get("/api/frames/{series_id}/{name}")
    def frame(series_id: str, name: str):
        if not ID_RE.fullmatch(series_id) or not FRAME_RE.fullmatch(name):
            raise HTTPException(404, "not found")
        path = series_dir / series_id / "frames" / name
        if not path.is_file():
            job = live.find(series_id) if live is not None else None
            png = job.png(name) if job is not None else None
            if png is None:
                raise HTTPException(404, "not found")
            # The same path is re-rendered when the stretch is refined; URLs carry ?v=<gen>.
            return Response(png, media_type="image/png", headers={"Cache-Control": "no-cache"})
        return FileResponse(path, media_type="image/png")

    @app.get("/api/{rest:path}")
    def unknown(rest: str):
        raise HTTPException(404, "not found")

    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="web")
    return app


def default_live() -> Optional[LiveBuilder]:
    if os.environ.get("SPHEREX_LIVE", "1") == "0":
        return None
    from pipeline import tapcache
    from pipeline.irsa import IrsaClient
    return LiveBuilder(IrsaClient(), tap_dir=tapcache.default_dir())


app = create_app(live=default_live())
