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
    {"ra": RA, "dec": DEC, "fov": 0.3},          # not one of 0.1, 0.2, 0.5, 1
    {"ra": RA, "dec": DEC, "fov": 0.5},          # allowed, but not cached and this client has no live builder
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


def test_uncached_position_is_built_live_when_a_builder_is_given(tmp_path):
    import time
    from unittest import mock
    from pipeline.live import LiveBuilder
    from tests.pipeline.test_build import FakeClient
    series, doc = make_cache(tmp_path)
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist", live=LiveBuilder(FakeClient())))
        assert c.get("/api/series", params={"ra": RA, "dec": DEC}).json() == doc  # the cache still wins
        end = time.time() + 30
        while True:
            body = c.get("/api/series", params={"ra": 10, "dec": 10}).json()
            valid(body)
            if body["status"] != "loading" or time.time() > end:
                break
            time.sleep(0.05)
    assert body["status"] == "ready" and body["data_origin"] == "real"
    assert body["progress"] == {"done": 40, "total": 40, "failed": 0, "available": 50, "search": "tap"}
    r = c.get(body["frames"][-1]["url"])
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content.startswith(b"\x89PNG")
    assert c.get(body["frames"][-1]["url"].replace("39.png", "77.png")).status_code == 404
    assert c.get("/api/series", params={"ra": 10, "dec": 10, "fov": 0.3}).json()["status"] == "error"
    assert body["background"] == "median_subtracted"
    st = body["stacks"]  # the fake archive's 40 dates are one visit of one detector
    assert [b["id"] for b in st["bands"]] == ["all"] and st["images"][0]["n_images"] == 40
    r = c.get(st["images"][0]["url"])
    assert r.status_code == 200 and r.content.startswith(b"\x89PNG")
    assert c.get("/api/frames/wise0855/s_all_0.png").status_code == 404  # cached series in this test has no stacks


def test_other_fov_is_built_live_even_at_a_cached_position(tmp_path):
    import time
    from unittest import mock
    from pipeline.live import LiveBuilder
    from tests.pipeline.test_build import FakeClient
    series, doc = make_cache(tmp_path)
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist", live=LiveBuilder(FakeClient())))
        end = time.time() + 30
        while True:
            body = c.get("/api/series", params={"ra": RA, "dec": DEC, "fov": "0.50", "max_frames": 3}).json()
            valid(body)
            if body["status"] != "loading" or time.time() > end:
                break
            time.sleep(0.05)
    assert body["status"] == "ready" and body != doc
    assert body["grid"]["shape"] == [290, 290] and body["grid"]["center"] == {"ra": RA, "dec": DEC}
    assert body["progress"]["total"] == 3
    im = Image.open(__import__("io").BytesIO(c.get(body["frames"][0]["url"]).content))
    assert im.size == (290, 290)
    assert c.get("/api/series", params={"ra": RA, "dec": DEC, "fov": 0.2}).json() == doc  # 0.2 is still the cache


def test_load_parameter_sets_the_frames_of_a_live_series_and_extends_it(tmp_path):
    import time
    from unittest import mock
    from pipeline.live import LiveBuilder
    from tests.pipeline.test_build import FakeClient
    series, doc = make_cache(tmp_path)
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist", live=LiveBuilder(FakeClient())))

        def get(**params):
            end = time.time() + 30
            while True:
                body = c.get("/api/series", params={"ra": 10, "dec": 10, **params}).json()
                valid(body)
                if body["status"] != "loading" or time.time() > end:
                    return body
                time.sleep(0.05)

        a = get(load=8)
        assert a["status"] == "ready" and a["progress"] == {"done": 8, "total": 8, "failed": 0, "available": 50, "search": "tap"}
        b = get(load=20)  # the same position again with a larger load: the same series, extended
        assert b["progress"]["done"] == 20 and {f["url"].split("?")[0] for f in a["frames"]} <= {f["url"].split("?")[0] for f in b["frames"]}
        assert get(load=8)["progress"]["done"] == 20  # a smaller load keeps what it has
        # `load` is ignored for a cached position
        assert c.get("/api/series", params={"ra": RA, "dec": DEC, "load": 8}).json() == doc


@pytest.mark.parametrize("load", ["103", "1.5", "-3", "abc"])
def test_a_bad_load_is_an_error_document(tmp_path, load):
    from pipeline.live import LiveBuilder
    from tests.pipeline.test_build import FakeClient
    series, doc = make_cache(tmp_path)
    c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist", live=LiveBuilder(FakeClient())))
    body = c.get("/api/series", params={"ra": 10, "dec": 10, "load": load}).json()
    valid(body)
    assert body["status"] == "error" and "load" in body["error"]["message"]
    if load != "abc":  # (not a number at all is still rejected up front)
        assert c.get("/api/series", params={"ra": RA, "dec": DEC, "load": load}).json() == doc  # ignored for a cached series


def test_ids_and_frame_names_must_match_in_full(tmp_path):
    series, _ = make_cache(tmp_path)
    c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist"))
    assert c.get("/api/frames/wise0855/00.png").status_code == 200
    for name in ("00.png%0A", "%DF%A0%DF%A0.png"):  # trailing newline; non-ASCII digits
        assert c.get(f"/api/frames/wise0855/{name}").status_code == 404
    assert c.get("/api/frames/wise0855%0A/00.png").status_code == 404


def test_a_changed_or_damaged_series_file_is_picked_up_without_a_restart(tmp_path):
    series, doc = make_cache(tmp_path)
    c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist"))
    params = {"ra": RA, "dec": DEC}
    assert c.get("/api/series", params=params).json() == doc
    f = series / "wise0855" / "series.json"
    f.write_text("{not json")
    assert c.get("/api/series", params=params).json()["status"] == "error"  # damaged: skipped, not a 500
    f.write_text(json.dumps(doc))
    assert c.get("/api/series", params=params).json() == doc


def test_series_requests_are_limited_per_client(tmp_path):
    series, doc = make_cache(tmp_path)
    c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist", rate_limit=3))
    for _ in range(3):
        assert c.get("/api/series", params={"ra": RA, "dec": DEC}).status_code == 200
    r = c.get("/api/series", params={"ra": RA, "dec": DEC})
    assert r.status_code == 429 and r.headers["retry-after"] == "30"
    valid_doc = r.json()
    assert valid_doc["status"] == "error" and "Too many" in valid_doc["error"]["message"]
    assert c.get("/api/targets").status_code == 200  # other routes are not limited


def test_rate_limiter_window_slides_and_bounds_its_table():
    from api.main import RateLimiter
    rl = RateLimiter(limit=2, window_s=10, max_keys=2)
    assert rl.allow("a", 0) and rl.allow("a", 1) and not rl.allow("a", 2)
    assert rl.allow("a", 11)  # the first hit has left the window
    for k in "bcd":
        rl.allow(k, 100)
    assert len(rl._hits) <= 3


SPECTRUM = Draft202012Validator(json.loads((ROOT / "contracts" / "spectrum.schema.json").read_text()))


def test_spectrum_at_a_cached_position_starts_a_live_series_and_measures_the_clicked_point(tmp_path):
    import time
    from unittest import mock
    from pipeline.live import LiveBuilder
    from tests.pipeline.test_build import FakeClient
    series, _ = make_cache(tmp_path)
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist", live=LiveBuilder(FakeClient())))
        params = {"ra": RA, "dec": DEC, "at_ra": RA + 0.01, "at_dec": DEC + 0.01, "load": 8}
        end = time.time() + 30
        while True:
            body = c.get("/api/spectrum", params=params).json()
            assert not list(SPECTRUM.iter_errors(body)), body
            if body["status"] != "loading" or time.time() > end:
                break
            time.sleep(0.05)
    assert body["status"] == "ready" and body["data_origin"] == "real" and len(body["frames"]) == 8
    assert body["photometry"]["at"] == "clicked_position" and body["series"]["fov_deg"] == 0.2
    assert c.get("/api/series", params={"ra": RA, "dec": DEC}).json()["data_origin"] == "simulated"  # the cached series is untouched


@pytest.mark.parametrize("params", [{"at_ra": 11, "at_dec": 10}, {"at_ra": 10.5, "at_dec": 10}, {"at_ra": 10, "at_dec": 10.2},
                                    {"at_ra": 10}, {"at_ra": "x", "at_dec": 10}, {"at_ra": 10, "at_dec": 10, "load": 500},
                                    {"at_ra": 10, "at_dec": 10, "fov": 0.3}])
def test_a_bad_spectrum_request_is_an_error_document(tmp_path, params):
    from pipeline.live import LiveBuilder
    from tests.pipeline.test_build import FakeClient
    series, _ = make_cache(tmp_path)
    c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist", live=LiveBuilder(FakeClient())))
    body = c.get("/api/spectrum", params={"ra": 10, "dec": 10, **params}).json()
    assert not list(SPECTRUM.iter_errors(body)), body
    assert body["status"] == "error"


def test_spectrum_without_live_builds_says_so(client):
    body = client.get("/api/spectrum", params={"ra": RA, "dec": DEC, "at_ra": RA, "at_dec": DEC}).json()
    assert not list(SPECTRUM.iter_errors(body)) and body["status"] == "error" and "live" in body["error"]["message"]


def test_spectrum_load_zero_uses_the_series_as_loaded_and_never_extends_it(tmp_path):
    import time
    from unittest import mock
    from pipeline.live import LiveBuilder
    from tests.pipeline.test_build import FakeClient
    series, _ = make_cache(tmp_path)
    live = LiveBuilder(FakeClient())
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist", live=live))

        def get(load, **kw):
            end = time.time() + 30
            while True:
                body = c.get("/api/spectrum", params={"ra": 10, "dec": 10, "at_ra": 10.01, "at_dec": 10.01, "load": load, **kw}).json()
                assert not list(SPECTRUM.iter_errors(body)), body
                if body["status"] != "loading" or time.time() > end:
                    return body
                time.sleep(0.05)

        assert len(get(8)["frames"]) == 8
        assert len(get(0)["frames"]) == 8  # not extended to the default 40
        assert len(get(0, at_ra=10.02)["frames"]) == 8
        assert live.find_at(10, 10, 0.2).cap == 8
        assert len(get(12)["frames"]) == 12  # an explicit larger load still extends
        # with no series at all, load=0 starts one with the default number of frames
        assert len(get(0, ra=20, at_ra=20.01)["frames"]) == 40


def test_spectrum_errors_name_the_bad_parameter(tmp_path):
    series, _ = make_cache(tmp_path)
    c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist"))
    msg = lambda **p: c.get("/api/spectrum", params={"ra": 10, "dec": 10, "at_ra": 10, "at_dec": 10, **p}).json()["error"]["message"]
    assert "at_ra" in msg(at_ra=400) and "at_dec" in msg(at_dec=95) and msg(ra=400).startswith("ra ")
    assert "outside" in msg(at_ra=11)


def test_a_spectrum_on_a_series_restored_after_a_restart_rebuilds_it_and_measures(tmp_path):
    import time
    from unittest import mock
    from pipeline.live import LiveBuilder
    from tests.pipeline.test_build import FakeClient
    from tests.pipeline.test_live import wait
    series, _ = make_cache(tmp_path)
    store = tmp_path / "store"
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        first = LiveBuilder(FakeClient(), store_dir=store)
        wait(first.get_or_start(10, 10, 0.2, 8))
        first._pool.shutdown(wait=True)
        c = TestClient(create_app(series_dir=series, web_dist=tmp_path / "nodist", live=LiveBuilder(FakeClient(), store_dir=store)))
        shown = c.get("/api/series", params={"ra": 10, "dec": 10, "load": 8}).json()  # served from disk, no build
        assert shown["status"] == "ready" and len(shown["frames"]) == 8
        assert c.get(shown["frames"][0]["url"]).status_code == 200
        params = {"ra": 10, "dec": 10, "at_ra": 10.01, "at_dec": 10.01, "load": 0}
        end = time.time() + 30
        while True:
            body = c.get("/api/spectrum", params=params).json()
            assert not list(SPECTRUM.iter_errors(body)), body
            if body["status"] == "ready" or time.time() > end:
                break
            time.sleep(0.05)
    assert body["status"] == "ready" and len(body["frames"]) == 8

def test_catalogue_endpoint(tmp_path, monkeypatch):
    from api import main as api_main
    series_dir, _ = make_cache(tmp_path)
    monkeypatch.setattr(api_main.catalogue_mod, "catalogue_document",
                        lambda ra, dec, fov: {"status": "ok", "catalogue": {"name": "n", "table": "t", "service": "s"}, "sources": []})
    c = TestClient(create_app(series_dir=series_dir, live=object()))
    assert c.get("/api/catalogue", params={"ra": RA, "dec": DEC}).json()["status"] == "ok"
    assert c.get("/api/catalogue", params={"ra": 400, "dec": 0}).json()["status"] == "error"
    assert c.get("/api/catalogue", params={"ra": RA, "dec": DEC, "fov": 0.3}).json()["status"] == "error"
    off = TestClient(create_app(series_dir=series_dir))  # live=None: no archive contact
    assert off.get("/api/catalogue", params={"ra": RA, "dec": DEC}).json()["status"] == "error"


def test_catalogue_cached_and_rate_limited(tmp_path, monkeypatch):
    from api import main as api_main
    series_dir, _ = make_cache(tmp_path)
    calls = []
    def fake(ra, dec, fov):
        calls.append((ra, dec, fov))
        return {"status": "ok", "catalogue": {"name": "n", "table": "t", "service": "s"}, "sources": []}
    monkeypatch.setattr(api_main.catalogue_mod, "catalogue_document", fake)
    c = TestClient(create_app(series_dir=series_dir, live=object(), rate_limit=3))
    p = {"ra": RA, "dec": DEC}
    assert c.get("/api/catalogue", params=p).status_code == 200
    assert c.get("/api/catalogue", params=p).status_code == 200
    assert len(calls) == 1  # the second answer came from the cache
    assert c.get("/api/catalogue", params={"ra": RA, "dec": DEC, "fov": 0.5}).status_code == 200 and len(calls) == 2
    r = c.get("/api/catalogue", params=p)
    assert r.status_code == 429 and r.headers["retry-after"] == "30" and r.json()["status"] == "error"


def test_catalogue_failure_is_not_cached(tmp_path, monkeypatch):
    from api import main as api_main
    series_dir, _ = make_cache(tmp_path)
    calls = []
    def fake(ra, dec, fov):
        calls.append(1)
        return {"status": "error", "catalogue": {"name": "n", "table": "t", "service": "s"}, "sources": [], "error": {"message": "down"}}
    monkeypatch.setattr(api_main.catalogue_mod, "catalogue_document", fake)
    c = TestClient(create_app(series_dir=series_dir, live=object()))
    c.get("/api/catalogue", params={"ra": RA, "dec": DEC}); c.get("/api/catalogue", params={"ra": RA, "dec": DEC})
    assert len(calls) == 2
