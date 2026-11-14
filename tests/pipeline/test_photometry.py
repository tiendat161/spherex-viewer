"""Aperture photometry on SIMULATED cutouts (see synth.py). Nothing here is archive data."""
import numpy as np
import pytest

from pipeline.cutout import pixel_area_sr
from pipeline.photometry import APERTURE_RADIUS_PIX, MJY_TO_UJY, circle_weights, measure_flux
from tests.pipeline.synth import synthetic_wcs

RA, DEC = 150.0, 2.0
N = 60
SIGMA_PIX = 1.2


def cutout(background=1.0, amp=50.0, noise=0.0, seed=0, flags=None, variance=True, src_offset_pix=(0.0, 0.0)):
    """SIMULATED cutout dict like read_cutout returns, with a Gaussian source near the centre."""
    w = synthetic_wcs(RA, DEC, N, N)
    cx, cy = (N - 1) / 2 + src_offset_pix[0], (N - 1) / 2 + src_offset_pix[1]
    yy, xx = np.mgrid[0:N, 0:N]
    img = background + amp * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * SIGMA_PIX ** 2))
    if noise:
        img = img + np.random.default_rng(seed).normal(0.0, noise, img.shape)
    return {"image": img.astype("float32"), "flags": np.zeros((N, N), dtype="int32") if flags is None else flags,
            "variance": np.full((N, N), noise ** 2, dtype="float32") if variance and noise else None,
            "wcs": w, "bunit": "MJy / sr", "wavelength_um": 1.5, "mjd_avg": 60000.5}


def expected_ujy(amp=50.0, radius=APERTURE_RADIUS_PIX):
    """Gaussian flux inside a circle centred on it: total * (1 - exp(-r^2 / 2 sigma^2)), in uJy."""
    total = amp * 2 * np.pi * SIGMA_PIX ** 2  # MJy/sr summed over pixels
    inside = 1 - np.exp(-radius ** 2 / (2 * SIGMA_PIX ** 2))
    return total * inside * pixel_area_sr(synthetic_wcs(RA, DEC, N, N)) * MJY_TO_UJY


def test_circle_weights_area():
    w = circle_weights((40, 40), 20.3, 19.6, 3.0)
    assert w.sum() == pytest.approx(np.pi * 9.0, rel=0.01)
    assert w.max() <= 1.0 and w.min() >= 0.0


def test_recovers_known_flux():
    r = measure_flux(cutout(), RA, DEC)
    assert r["ok"] and r["reason"] is None
    assert r["flux_ujy"] == pytest.approx(expected_ujy(), rel=0.02)
    assert (r["wavelength_um"], r["mjd_avg"]) == (1.5, 60000.5)


def test_flux_does_not_depend_on_the_background_level():
    a = measure_flux(cutout(background=1.0), RA, DEC)["flux_ujy"]
    b = measure_flux(cutout(background=300.0), RA, DEC)["flux_ujy"]
    assert a == pytest.approx(b, rel=1e-3)


def test_background_without_a_source_gives_zero_flux():
    r = measure_flux(cutout(amp=0.0, noise=0.5), RA, DEC)
    assert r["ok"] and abs(r["flux_ujy"]) < 4 * r["flux_err_ujy"]


@pytest.mark.parametrize("with_variance", [True, False])
def test_reported_error_matches_the_scatter(with_variance):
    """Over many noise realisations the spread of the flux is about the reported 1-sigma error."""
    fluxes, errs = [], []
    for seed in range(300):
        r = measure_flux(cutout(amp=0.0, noise=0.5, seed=seed, variance=with_variance), RA, DEC)
        fluxes.append(r["flux_ujy"])
        errs.append(r["flux_err_ujy"])
    assert np.std(fluxes) == pytest.approx(np.mean(errs), rel=0.2)
    assert r["error_basis"] == ("variance" if with_variance else "annulus_scatter")


def test_flagged_pixel_in_the_aperture_gives_no_flux():
    flags = np.zeros((N, N), dtype="int32")
    flags[N // 2, N // 2] = 1
    r = measure_flux(cutout(flags=flags), RA, DEC)
    assert not r["ok"] and r["reason"] == "aperture_flagged" and r["flux_ujy"] is None


def test_ignored_flag_bits_do_not_block():
    flags = np.zeros((N, N), dtype="int32")
    flags[N // 2, N // 2] = (1 << 21) | (1 << 12)  # SOURCE and FULLSAMPLE: informational only
    assert measure_flux(cutout(flags=flags), RA, DEC)["ok"]


def test_flagged_pixels_in_the_ring_are_left_out_of_the_background():
    flags = np.zeros((N, N), dtype="int32")
    c = cutout()
    flags[:, : N // 2 - 4] = 1  # whole left part is bad
    c["image"][:, : N // 2 - 4] = 1e6
    assert measure_flux(dict(c, flags=flags), RA, DEC)["flux_ujy"] == pytest.approx(expected_ujy(), rel=0.02)


def test_nan_pixels_away_from_the_aperture_do_not_matter():
    """Found on real cutouts: NaN pixels outside the aperture must not turn the sum into NaN."""
    c = cutout(noise=0.5)
    c["image"][0, :] = np.nan
    c["variance"][0, :] = np.nan
    c["flags"][0, :] = 1
    r = measure_flux(c, RA, DEC)
    assert r["ok"] and np.isfinite(r["flux_ujy"]) and np.isfinite(r["flux_err_ujy"])


def test_nan_in_the_aperture_gives_no_flux():
    c = cutout()
    c["image"][N // 2, N // 2] = np.nan
    assert measure_flux(c, RA, DEC)["reason"] == "aperture_flagged"


def test_position_off_the_image():
    r = measure_flux(cutout(), RA + 1.0, DEC)
    assert not r["ok"] and r["reason"] == "aperture_off_image"


def test_too_few_background_pixels():
    c = cutout()
    r = measure_flux(dict(c, flags=np.ones((N, N), dtype="int32") * 0 + (np.arange(N * N).reshape(N, N) % 2 == 0)), RA, DEC)
    assert not r["ok"]  # half the pixels flagged: the aperture hits a flagged pixel first
    clean = np.zeros((N, N), dtype="int32")
    clean[:, :] = 1
    clean[N // 2 - 2: N // 2 + 3, N // 2 - 2: N // 2 + 3] = 0  # only a 5x5 clean block: aperture ok, ring empty
    r = measure_flux(dict(c, flags=clean), RA, DEC)
    assert not r["ok"] and r["reason"] == "background_too_few_pixels"


def test_wrong_unit_is_refused():
    with pytest.raises(ValueError):
        measure_flux(dict(cutout(), bunit="DN"), RA, DEC)
