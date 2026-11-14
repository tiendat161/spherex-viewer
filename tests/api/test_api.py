"""API tests against a tiny SIMULATED cache built in a temp directory. No network."""
import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from PIL import Image

from api.main import create_app

ROOT = Path(__file__).resolve().parents[2]
SERIES = Draft202012Validator(json.loads((ROOT / "contracts" / "series.schema.json").read_text()))
TARGETS = Draft202012Validator(json.loads((ROOT / "contracts" / "targets.schema.json").read_text()))
RA, DEC = 133.795129, -7.245147  # wise0855 cached position


def make_cache(tmp_path):
    d = tmp_path / "series" / "wise0855"
    (d / "frames").mkdir(parents=True)
    Image.fromarray(np.zeros((116, 116), dtype="uint8")).save(d / "frames" / "00.png")
    doc = {"status": "ready", "data_origin": "simulated",  # SIMULATED test document
           "progress": {"done": 1, "total": 1, "failed": 0},
           "grid": {"center": {"ra": RA, "dec": DEC}, "pixel_scale_arcsec": 6.2, "shape": [116, 116]},
           "stretch": {"kind": "asinh", "vmin": 0.0, "vmax": 1.0, "unit": "MJy / sr"},
           "frames": [{"index": 0, "obs_mjd": 60800.7, "wavelength_um": 2.5, "url": "/api/frames/wise0855/00.png", "flag_fraction": 0.0}]}
    (d / "series.json").write_text(json.dumps(doc))
    return tmp_path / "series", doc


@pytest.fixture
def client(tmp_path):
    series, doc = make_cache(tmp_path)
    c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist"))
    c.doc = doc
    return c


def valid(body):
    assert not list(SERIES.iter_errors(body))


def test_cached_position_returns_file_content(client):
    r = client.get("/api/series", params={"ra": RA, "dec": DEC})
    assert r.status_code == 200 and r.json() == client.doc
    valid(r.json())
    r = client.get("/api/series", params={"ra": RA + 0.5 / 3600, "dec": DEC, "fov": 0.2, "max_frames": 40})
    assert r.json() == client.doc


@pytest.mark.parametrize("params", [
    {"ra": RA + 2 / 3600, "dec": DEC},          # 2 arcsec away
    {"ra": 10, "dec": 10},                      # not cached
    {"ra": RA, "dec": DEC, "fov": 0.1},
    {"ra": RA, "dec": DEC, "max_frames": 103},      # above the 102 ceiling
    {"dec": DEC},                               # missing ra
    {"ra": "abc", "dec": DEC},
    {"ra": 400, "dec": DEC},
    {"ra": RA, "dec": 95},
])
def test_everything_else_is_schema_valid_error_with_http_200(client, params):
    r = client.get("/api/series", params=params)
    assert r.status_code == 200
    body = r.json()
    valid(body)
    assert body["status"] == "error" and body["error"]["message"]


def test_targets_endpoint_matches_schema_and_lists_cached_only(client):
    r = client.get("/api/targets")
    assert r.status_code == 200
    body = r.json()
    assert not list(TARGETS.iter_errors(body))
    assert [t["id"] for t in body] == ["wise0855"]
    assert body[0]["ra"] == RA and "as given" in body[0]["position_note"]


def test_frame_endpoint(client):
    r = client.get("/api/frames/wise0855/00.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert client.get("/api/frames/wise0855/07.png").status_code == 404
    assert client.get("/api/frames/wise0855/..%2Fseries.json").status_code == 404
    assert client.get("/api/frames/nope/00.png").status_code == 404


def test_serves_web_dist_when_present(tmp_path):
    series, _ = make_cache(tmp_path)
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>hi</html>")
    c = TestClient(create_app(series_dir=series, web_dist=dist))
    assert c.get("/").text == "<html>hi</html>"
    assert c.get("/api/targets").status_code == 200


def test_no_web_dist_means_no_root_route(client):
    assert client.get("/").status_code == 404
