"""FastAPI service. Serves the static cache written by `pipeline/`. A position that is not
cached is built live from IRSA in the background (`pipeline/live.py`) while the client polls;
set SPHEREX_LIVE=0 to serve the cache only, in which case nothing here contacts IRSA.

    GET /api/series?ra=&dec=&fov=0.2&max_frames=102&load=8     (fov: 0.1, 0.2, 0.5 or 1; only 0.2 is cached;
                                                                `load`: frames of a live series to have loaded, a larger value extends it)
    GET /api/targets
    GET /api/frames/<id>/NN.png            (also s_<band>_<visit>.png and d_<band>_<visit>.png for stacks)
    web/dist (when it exists) is served at /
"""
import json
import os
import re
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
ID_RE = re.compile(r"^[a-z0-9]+$")
FRAME_RE = re.compile(r"^(\d{2,3}|[sd]_[A-Za-z0-9]+_\d{1,3})\.png$")  # frame NN.png, stack s_<band>_<visit>.png, difference d_...


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
               live: Optional[LiveBuilder] = None) -> FastAPI:
    """`live`: builder for uncached positions. None (the default) serves the cache only."""
    series_dir = Path(series_dir or os.environ.get("SPHEREX_SERIES_DIR") or ROOT / "static" / "series")
    web_dist = Path(web_dist) if web_dist is not None else ROOT / "web" / "dist"
    app = FastAPI(title="SPHEREx blink viewer API")

    def cached():
        """[(id, series doc)] for every directory that holds a series.json."""
        out = []
        for p in sorted(series_dir.glob("*/series.json")):
            if ID_RE.match(p.parent.name):
                out.append((p.parent.name, json.loads(p.read_text())))
        return out

    @app.get("/api/series")
    def series(request: Request):
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
        if load != 0 and not (1 <= load <= MAX_LIVE_FRAMES and load == int(load)):
            return JSONResponse(error_doc(f"load must be a whole number from 1 to {MAX_LIVE_FRAMES}."))
        # The static cache holds fov=0.2 only; every other size is built live, also at a cached position.
        for _id, doc in (cached() if fov == CACHED_FOV else []):
            c = doc["grid"]["center"]
            if targets_mod.sep_arcsec(ra, dec, c["ra"], c["dec"]) <= MATCH_ARCSEC:
                if doc["progress"]["total"] > max_frames:
                    return JSONResponse(error_doc(
                        f"The cached series has {doc['progress']['total']} frames; request max_frames >= that."))
                return JSONResponse(doc)
        if live is not None:
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
        if not ID_RE.match(series_id) or not FRAME_RE.match(name):
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
