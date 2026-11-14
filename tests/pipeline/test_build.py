"""End-to-end build with a fake IRSA client and SIMULATED cutouts. No network."""
import json
from pathlib import Path
from unittest import mock

import numpy as np
from jsonschema import Draft202012Validator
from PIL import Image

from pipeline import build
from pipeline.irsa import IrsaError
from pipeline.targets import Target
from tests.pipeline.synth import synthetic_cutout_bytes

ROOT = Path(__file__).resolve().parents[2]
T = Target("sim", "Simulated", 133.795129, -7.245147, "SIMULATED test position")


class FakeClient:
    def __init__(self, n=50, fail=()):
        self.n, self.fail, self.fetched = n, set(fail), []

    def tap_rows(self, ra, dec):
        return [{"planeid": str(i), "time_bounds_lower": str(60000 + i), "time_bounds_upper": "0", "energy_bandpassname": "X",
                 "uri": f"ibe/data/spherex/dr1/level2/w/v/3/level2_OBS{i:04d}_spx_v.fits", "contentlength": "1"} for i in range(self.n)]

    def fetch_cutout(self, uri, ra, dec, size):
        self.fetched.append(uri)
        if any(f in uri for f in self.fail):
            raise IrsaError("simulated outage")
        return synthetic_cutout_bytes(ra, dec, (20 / 3600, 20 / 3600), nx=120, ny=120)


def run(tmp_path, client, min_frames=30):
    cfg = {"fov": 0.2, "max_frames": 40, "min_frames": min_frames}
    with mock.patch.dict("os.environ", {"SPHEREX_CACHE_DIR": str(tmp_path / "cache")}), \
         mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        return build.build_target(client, T, cfg, tmp_path / "out", log=lambda *_: None)


def test_build_writes_valid_series_with_gaps_for_failed_frames(tmp_path):
    client = FakeClient(fail=("OBS0020",))
    done, failed, st = run(tmp_path, client)
    assert (done, failed) == (39, 1) or (done, failed) == (40, 0)
    doc = json.loads((tmp_path / "out" / "sim" / "series.json").read_text())
    schema = json.loads((ROOT / "contracts" / "series.schema.json").read_text())
    assert not list(Draft202012Validator(schema).iter_errors(doc))
    assert doc["status"] == "ready" and doc["progress"]["total"] == 40
    assert doc["progress"]["done"] + doc["progress"]["failed"] == 40 and len(doc["frames"]) == doc["progress"]["done"]
    for f in doc["frames"]:
        im = Image.open(tmp_path / "out" / "sim" / "frames" / f["url"].rsplit("/", 1)[1])
        assert im.mode == "L" and im.size == (116, 116)


def test_resume_does_not_refetch_cached_cutouts(tmp_path):
    c1 = FakeClient()
    run(tmp_path, c1)
    c2 = FakeClient()
    run(tmp_path, c2)
    assert len(c1.fetched) == 40 and c2.fetched == []


def test_too_few_frames_is_reported_not_padded(tmp_path):
    import pytest
    with pytest.raises(SystemExit) as e:
        run(tmp_path, FakeClient(n=10))
    assert "usable frames" in str(e.value)
    assert not (tmp_path / "out" / "sim" / "series.json").exists()
