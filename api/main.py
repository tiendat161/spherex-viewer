"""FastAPI service. Reads the static cache written by `pipeline/`; never contacts IRSA.

    GET /api/series?ra=&dec=&fov=0.2&max_frames=40
    GET /api/targets
    GET /api/frames/<id>/NN.png
    web/dist (when it exists) is served at /
"""
import json
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from pipeline import targets as targets_mod

ROOT = Path(__file__).resolve().parent.parent
MATCH_ARCSEC = 1.0
CACHED_FOV = 0.2
CACHED_MAX_FRAMES = 40
ID_RE = re.compile(r"^[a-z0-9]+$")
FRAME_RE = re.compile(r"^\d{2,3}\.png$")


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


def create_app(series_dir: Optional[Path] = None, web_dist: Optional[Path] = None, targets_config: Optional[Path] = None) -> FastAPI:
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
            if not (0 <= ra < 360) or not (-90 <= dec <= 90):
                raise ValueError("ra must satisfy 0 <= ra < 360 and dec -90 to 90 (ICRS degrees)")
        except ValueError as e:
            return JSONResponse(error_doc(str(e)))
        if abs(fov - CACHED_FOV) > 1e-9 or max_frames != CACHED_MAX_FRAMES:
            return JSONResponse(error_doc(
                f"This prototype serves only cached series with fov={CACHED_FOV} and max_frames={CACHED_MAX_FRAMES}; "
                f"nothing is built live."))
        for _id, doc in cached():
            c = doc["grid"]["center"]
            if targets_mod.sep_arcsec(ra, dec, c["ra"], c["dec"]) <= MATCH_ARCSEC:
                return JSONResponse(doc)
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
            raise HTTPException(404, "not found")
        return FileResponse(path, media_type="image/png")

    @app.get("/api/{rest:path}")
    def unknown(rest: str):
        raise HTTPException(404, "not found")

    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="web")
    return app


app = create_app()
