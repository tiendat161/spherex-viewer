"""Spectrum at a clicked position (T14): flux at an off-centre source, the wavelength at that pixel, schema, limits.
SIMULATED cutouts (a Gaussian source on a flat background), no network. The wavelength plane is simulated too (tests/conftest.py)."""
import json
import math
from pathlib import Path
from unittest import mock

import pytest
from jsonschema import Draft202012Validator

from pipeline.live import LiveSeries
from tests.conftest import SIM_WAVE_BASE, SIM_WAVE_PER_PIX
from tests.pipeline.synth import synthetic_cutout_bytes, synthetic_wcs
from tests.pipeline.test_flux_series import Client

ROOT = Path(__file__).resolve().parents[2]
SPECTRUM = Draft202012Validator(json.loads((ROOT / "contracts" / "spectrum.schema.json").read_text()))
RA, DEC = 10.0, 10.0
OFFSET = (0.01, 0.005)  # degrees east, north of the centre: about 6 and 3 pixels
SRC_RA, SRC_DEC = RA + OFFSET[0] / math.cos(math.radians(DEC)), DEC + OFFSET[1]


@pytest.fixture(autouse=True)
def fixed_wavelength():
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        yield


def valid(doc):
    assert not list(SPECTRUM.iter_errors(doc)), list(SPECTRUM.iter_errors(doc))


def finished_job(n=4, **kw):
    job = LiveSeries(RA, DEC, 0.2, n)
    job.run(Client(n=n, cutout=lambda uri: synthetic_cutout_bytes(RA, DEC, source_offset_deg=OFFSET, nx=120, ny=120, **kw)))
    assert job.status == "ready"
    return job


def test_flux_at_the_source_is_large_at_the_centre_it_is_not_and_the_document_is_valid():
    job = finished_job()
    on, centre = job.spectrum(SRC_RA, SRC_DEC), job.spectrum(RA, DEC)
    valid(on), valid(centre)
    assert on["status"] == "ready" and on["data_origin"] == "real" and len(on["frames"]) == 4
    assert on["photometry"]["at"] == "clicked_position" and on["point"] == {"ra": SRC_RA, "dec": SRC_DEC}
    assert on["series"] == {"ra": RA, "dec": DEC, "fov_deg": 0.2} and on["progress"]["done"] == 4
    f_on, f_centre = on["frames"][0]["flux"], centre["frames"][0]["flux"]
    assert f_on["ok"] and f_centre["ok"]
    assert f_on["flux_ujy"] > 20 * abs(f_centre["flux_ujy"]) and f_on["flux_ujy"] > 10 * f_on["flux_err_ujy"]


def test_wavelength_is_the_one_at_the_clicked_pixel():
    job = finished_job()
    w = synthetic_wcs(RA, DEC, 120, 120)
    for ra, dec in [(RA, DEC), (SRC_RA, SRC_DEC)]:
        x, _ = (float(v) for v in w.all_world2pix(ra, dec, 0))
        got = job.spectrum(ra, dec)["frames"][0]["wavelength_um"]
        assert got == pytest.approx(SIM_WAVE_BASE + SIM_WAVE_PER_PIX * round(x), abs=1e-5)
    assert job.spectrum(SRC_RA, SRC_DEC)["frames"][0]["wavelength_um"] != job.spectrum(RA, DEC)["frames"][0]["wavelength_um"]


def test_a_position_off_the_cutout_has_no_flux_and_says_why():
    doc = finished_job().spectrum(RA + 0.5, DEC)
    valid(doc)
    assert all(f["flux"] == {"ok": False, "reason": "aperture_off_image"} for f in doc["frames"]) and "photometry" not in doc


def test_released_pixels_and_errors_are_error_documents():
    job = finished_job()
    job.drop_pixels()
    doc = job.spectrum(SRC_RA, SRC_DEC)
    valid(doc)
    assert doc["status"] == "error" and "released" in doc["error"]["message"]
    bad = LiveSeries(RA, DEC, 0.2, 2)
    bad._fail("boom")
    assert bad.spectrum(RA, DEC)["error"]["message"] == "boom"
    valid(bad.spectrum(RA, DEC))


def test_native_cutouts_count_toward_the_pixel_budget_and_go_with_the_pixels():
    job = finished_job()
    with_native = job.pixel_bytes()
    assert with_native > 4 * (120 * 120 * 4) * 3  # image, flags, variance-less: at least image + flags + wave map per frame
    job.drop_pixels()
    assert job.pixel_bytes() == 0


def test_a_loading_series_reports_the_frames_measured_so_far():
    job = LiveSeries(RA, DEC, 0.2, 6)
    assert job.spectrum(RA, DEC)["frames"] == []
    valid(job.spectrum(RA, DEC))
