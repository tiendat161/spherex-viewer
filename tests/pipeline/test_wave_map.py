"""The real `wavelength_map` (tests/conftest.py replaces it elsewhere), on a SIMULATED cutout whose WCS-WAVE table has the layout of the
archive's files (WAVE-TAB keys on the IMAGE header, a one-row WCS-WAVE table with X, Y and VALUES). The numbers are made up."""
import io
import time
from unittest import mock

import numpy as np
import pytest
from astropy.io import fits

from pipeline.cutout import CutoutError, read_cutout, wavelength_at, wavelength_um_at
from pipeline.live import LiveSeries
from tests.conftest import REAL_WAVELENGTH_MAP
from tests.pipeline.synth import synthetic_wcs
from tests.pipeline.test_flux_series import Client

RA, DEC, N = 10.0, 10.0, 40
TABLE_X = np.array([1, 256, 511, 766, 1021, 1275, 1530, 1785, 2040], dtype="int32")
TABLE_Y = np.array([1, 36, 71, 105, 140, 141, 379, 617, 855, 1091, 1326, 1564, 1802, 2040], dtype="int32")


def cutout_with_wave_table(nan_at=None, n=N, fill=np.nan):
    """SIMULATED MEF: noisy flat image, a WCS-WAVE table where wavelength = 1 + 0.001 x + 0.0005 y (um) in detector pixels."""
    w = synthetic_wcs(RA, DEC, n, n)
    hdr = w.to_header()
    hdr["BUNIT"] = "MJy / sr"
    for k, v in [("WCSAXESW", 2), ("CRPIX1W", -1298.0), ("CRPIX2W", -1820.0), ("CDELT1W", 1), ("CDELT2W", 1), ("CUNIT1W", "um"), ("CUNIT2W", "um"),
                 ("CTYPE1W", "WAVE-TAB"), ("CTYPE2W", "WAVE-TAB"), ("CRVAL1W", 1), ("CRVAL2W", 1), ("PV1_3W", 1), ("PV2_3W", 2),
                 ("PS1_0W", "WCS-WAVE"), ("PS2_0W", "WCS-WAVE"), ("PS1_1W", "VALUES"), ("PS2_1W", "VALUES"), ("PS1_2W", "X"), ("PS2_2W", "Y")]:
        hdr[k] = v
    values = np.zeros((len(TABLE_Y), len(TABLE_X), 2), dtype="float32")
    values[..., 0] = 1.0 + 0.001 * TABLE_X[None, :] + 0.0005 * TABLE_Y[:, None]
    values[..., 1] = 0.03
    if nan_at is not None:
        values[nan_at] = fill
    table = fits.BinTableHDU.from_columns([
        fits.Column(name="X", format="9J", array=TABLE_X[None, :]), fits.Column(name="Y", format="14J", array=TABLE_Y[None, :]),
        fits.Column(name="VALUES", format="252E", dim="(2,9,14)", array=values[None])], name="WCS-WAVE")
    buf = io.BytesIO()
    fits.HDUList([fits.PrimaryHDU(), fits.ImageHDU(np.random.default_rng(0).normal(1.0, 0.1, (n, n)).astype("float32"), header=hdr, name="IMAGE"),
                  fits.ImageHDU(np.zeros((n, n), "int32"), name="FLAGS"), table]).writeto(buf)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def real_wave_map():
    with mock.patch("pipeline.cutout.wavelength_map", REAL_WAVELENGTH_MAP):
        yield


def test_the_map_has_the_image_shape_varies_across_it_and_agrees_with_the_point_lookup():
    c = read_cutout(cutout_with_wave_table(), RA, DEC, with_wave_map=True)
    m = c["wave_map"]
    assert m.shape == (N, N) and m.dtype == np.float32 and np.isfinite(m).all()
    assert m[:, -1].mean() > m[:, 0].mean() + 0.01 and m[-1, :].mean() > m[0, :].mean() + 0.005  # grows along x and along y
    # The same wavelength as the single-position lookup the series uses at its centre, and at another pixel.
    w = synthetic_wcs(RA, DEC, N, N)
    with fits.open(io.BytesIO(cutout_with_wave_table())) as hdul:
        for x, y in [(N // 2, N // 2), (5, 30)]:
            ra, dec = (float(v) for v in w.all_pix2world(x, y, 0))
            assert wavelength_um_at(hdul, hdul["IMAGE"].header, ra, dec) == pytest.approx(float(m[y, x]), abs=1e-4)
    assert wavelength_at(c, 5.2, 29.8) == pytest.approx(float(m[30, 5]))
    assert wavelength_at(c, -3, 1000) == pytest.approx(float(m[N - 1, 0]))  # clipped to the image


def wave_map_of(table_values_hook):
    with fits.open(io.BytesIO(table_values_hook)) as hdul:
        return REAL_WAVELENGTH_MAP(hdul, hdul["IMAGE"].header, (N, N))


def test_a_table_with_nan_or_non_positive_wavelengths_is_refused_by_the_map():
    with pytest.raises(CutoutError):
        wave_map_of(cutout_with_wave_table(nan_at=(12, 5)))
    with pytest.raises(CutoutError):
        wave_map_of(cutout_with_wave_table(nan_at=(12, 5), fill=-1.0))


def test_a_cutout_whose_map_fails_still_reads_without_one():
    # The table's linear interpolation makes one bad node spoil the whole cutout (the single-position lookup too), so the
    # map failing alone is simulated: the wavelength at the centre is fine, the per-pixel plane is not.
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5), \
            mock.patch("pipeline.cutout.wavelength_map", side_effect=CutoutError("WCS-WAVE gives no valid wavelength over the cutout")):
        c = read_cutout(cutout_with_wave_table(), RA, DEC, with_wave_map=True)
    assert c["wave_map"] is None and c["image"].shape == (N, N) and c["wavelength_um"] == 2.5
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        assert "wave_map" not in read_cutout(cutout_with_wave_table(), RA, DEC)  # not asked for: not computed


def test_a_frame_without_a_wave_map_stays_in_the_series_and_only_the_spectrum_loses_it():
    calls = []

    def fails_for_the_first_frame(hdul, hdr, shape):
        calls.append(1)
        if len(calls) == 1:
            raise CutoutError("no valid wavelength")
        return REAL_WAVELENGTH_MAP(hdul, hdr, shape)

    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5), mock.patch("pipeline.cutout.wavelength_map", fails_for_the_first_frame):
        job = LiveSeries(RA, DEC, 0.2, 4)
        job.run(Client(n=4, cutout=lambda uri: cutout_with_wave_table()))
    assert job.status == "ready" and job.failed == 0 and len(job.doc()["frames"]) == 4
    assert len(job.spectrum(RA, DEC)["frames"]) == 3  # a worker thread's first call failed: that frame has no native cutout
    assert job.pixel_bytes() > 0


def test_cost_of_one_full_map(capsys):
    with fits.open(io.BytesIO(cutout_with_wave_table(n=175))) as hdul:
        t = time.perf_counter()
        REAL_WAVELENGTH_MAP(hdul, hdul["IMAGE"].header, (175, 175))
        dt = time.perf_counter() - t
    print(f"wavelength map of a 175 x 175 cutout: {dt * 1000:.1f} ms")
    assert dt < 2.0
