"""Flux in the series document (T29): cached build, live path, schema. SIMULATED cutouts, no network."""
import io
import json
from pathlib import Path
from unittest import mock

import numpy as np
import pytest
from astropy.io import fits
from jsonschema import Draft202012Validator

from pipeline.live import LiveSeries
from pipeline.photometry import APERTURE_RADIUS_PIX
from tests.pipeline.synth import synthetic_wcs
from tests.pipeline.test_build import FakeClient, run

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = Draft202012Validator(json.loads((ROOT / "contracts" / "series.schema.json").read_text()))
RA, DEC = 10.0, 10.0


@pytest.fixture(autouse=True)
def fixed_wavelength():
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        yield


def errors(doc):
    return list(SCHEMA.iter_errors(doc))


def cutout_with_source_at_centre(flag_centre=False, mjd_avg=None, variance=True, unit="MJy / sr", ra=RA, dec=DEC):
    """SIMULATED MEF: a point source at the centre of a 120 x 120 cutout, optionally a bad pixel in the aperture."""
    ny = nx = 120
    w = synthetic_wcs(ra, dec, nx, ny)
    x, y = (float(v) for v in w.all_world2pix(ra, dec, 0))
    yy, xx = np.mgrid[0:ny, 0:nx]
    img = (1.0 + 40.0 * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * 1.2 ** 2))).astype("float32")
    hdr = w.to_header()
    hdr["BUNIT"] = unit
    if mjd_avg is not None:
        hdr["MJD-AVG"] = mjd_avg
    flags = np.zeros((ny, nx), dtype="int32")
    if flag_centre:
        flags[int(round(y)), int(round(x))] = 1
    hdus = [fits.PrimaryHDU(), fits.ImageHDU(img, header=hdr, name="IMAGE"), fits.ImageHDU(flags, name="FLAGS")]
    if variance:
        hdus.append(fits.ImageHDU(np.full((ny, nx), 0.04, dtype="float32"), name="VARIANCE"))
    buf = io.BytesIO()
    fits.HDUList(hdus).writeto(buf)
    return buf.getvalue()


class Client(FakeClient):
    def __init__(self, **kw):
        self.cutout = kw.pop("cutout")
        super().__init__(**kw)

    def fetch_cutout(self, uri, ra, dec, size):
        self.fetched.append(uri)
        return self.cutout(uri)


def test_live_series_carries_flux_the_method_and_mid_exposure_time():
    job = LiveSeries(RA, DEC, 0.2, 6)
    job.run(Client(n=6, cutout=lambda uri: cutout_with_source_at_centre(mjd_avg=60000.25)))
    doc = job.doc()
    assert doc["status"] == "ready" and not errors(doc)
    assert doc["photometry"] == {"method": "aperture", "aperture_radius_pix": APERTURE_RADIUS_PIX, "annulus_inner_pix": 4.0,
                                 "annulus_outer_pix": 7.0, "aperture_corrected": False, "at": "request_position"}
    for f in doc["frames"]:
        assert f["flux"]["ok"] is True and f["flux"]["flux_ujy"] > 0 and f["flux"]["flux_err_ujy"] > 0
        assert f["mjd_avg"] == 60000.25
    # the source is 40 MJy/sr at the peak of a 1.2 pixel Gaussian: the flux in a 2 pixel aperture is the same in every frame
    assert len({f["flux"]["flux_ujy"] for f in doc["frames"]}) == 1


def test_a_flagged_aperture_gives_no_flux_and_a_reason_not_a_zero():
    job = LiveSeries(RA, DEC, 0.2, 4)
    job.run(Client(n=4, cutout=lambda uri: cutout_with_source_at_centre(flag_centre=True)))
    doc = job.doc()
    assert doc["status"] == "ready" and not errors(doc)
    assert [f["flux"] for f in doc["frames"]] == [{"ok": False, "reason": "aperture_flagged"}] * 4
    assert all("mjd_avg" not in f for f in doc["frames"])  # no MJD-AVG in these files: left out, not invented


def test_an_unexpected_unit_is_a_reason_not_a_crash():
    job = LiveSeries(RA, DEC, 0.2, 3)
    job.run(Client(n=3, cutout=lambda uri: cutout_with_source_at_centre(unit="DN")))
    doc = job.doc()
    assert doc["status"] == "ready" and not errors(doc)
    assert all(f["flux"] == {"ok": False, "reason": "unexpected_unit"} for f in doc["frames"])


def test_the_cached_build_writes_the_same_fields(tmp_path):
    from tests.pipeline.test_build import T
    client = Client(n=50, cutout=lambda uri: cutout_with_source_at_centre(mjd_avg=60001.5, ra=T.ra, dec=T.dec))
    run(tmp_path, client)
    doc = json.loads((tmp_path / "out" / "sim" / "series.json").read_text())
    assert not errors(doc) and doc["photometry"]["method"] == "aperture"
    assert all("flux" in f and f["mjd_avg"] == 60001.5 for f in doc["frames"])


@pytest.mark.parametrize("flux, valid", [
    ({"ok": True, "flux_ujy": 12.5, "flux_err_ujy": 1.0}, True),
    ({"ok": True, "flux_ujy": -3.0, "flux_err_ujy": 2.0}, True),                       # a faint source can measure below zero
    ({"ok": False, "reason": "aperture_flagged"}, True),
    ({"ok": True, "flux_ujy": 1.0}, False),                                            # no uncertainty
    ({"ok": True, "flux_ujy": 1.0, "flux_err_ujy": -1.0}, False),                      # negative uncertainty
    ({"ok": True, "flux_ujy": 1.0, "flux_err_ujy": 1.0, "reason": "aperture_flagged"}, False),
    ({"ok": False}, False),                                                            # no reason
    ({"ok": False, "reason": "aperture_flagged", "flux_ujy": 0.0}, False),             # a zero must not stand in for "no flux"
    ({"ok": False, "reason": "because"}, False),
    ({"flux_ujy": 1.0, "flux_err_ujy": 1.0}, False),
])
def test_the_schema_accepts_and_refuses_the_right_flux_objects(flux, valid):
    job = LiveSeries(RA, DEC, 0.2, 2)
    job.run(Client(n=2, cutout=lambda uri: cutout_with_source_at_centre()))
    doc = job.doc()
    doc["frames"][0]["flux"] = flux
    assert (not errors(doc)) is valid
