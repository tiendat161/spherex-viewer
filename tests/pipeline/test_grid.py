"""Grid and orientation tests. Inputs are SIMULATED (tests/pipeline/synth.py)."""
import numpy as np
from PIL import Image

from pipeline import stretch, writer
from pipeline.cutout import read_cutout
from pipeline.grid import grid_shape, make_grid_wcs, reproject_frame, to_png_array
from tests.pipeline.synth import synthetic_cutout_bytes

RA, DEC = 133.795129, -7.245147


def test_shape_for_default_fov():
    assert grid_shape(0.2) == (116, 116)


def run(offset):
    from unittest import mock
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        c = read_cutout(synthetic_cutout_bytes(RA, DEC, offset), RA, DEC)
    shape = grid_shape(0.2)
    pix, flagged = reproject_frame(c["image"], c["wcs"], c["flags"], make_grid_wcs(RA, DEC, shape), shape)
    return pix, flagged, shape


def test_source_north_east_lands_up_left_in_png(tmp_path):
    # SIMULATED source 30 arcsec north and 30 arcsec east of the centre.
    off = (30 / 3600.0, 30 / 3600.0)
    pix, flagged, shape = run(off)
    vmin, vmax = stretch.compute_limits([pix], [flagged])
    png8 = stretch.apply(pix, vmin, vmax)
    # go through the real writer and read the PNG back
    writer.write_series(tmp_path, "sim", RA, DEC, shape, {"kind": "asinh", "vmin": vmin, "vmax": vmax, "unit": "MJy / sr"},
                        [{"index": 0, "obs_mjd": 60000.0, "wavelength_um": 2.5, "flag_fraction": 0.0, "png": png8}], 1, 0)
    im = np.asarray(Image.open(tmp_path / "frames" / "00.png"))
    assert im.shape == shape
    # the stretch saturates the source, so use the centroid of the bright pixels, not argmax
    rr, cc = np.nonzero(im >= 0.8 * im.max())
    row, col = rr.mean(), cc.mean()
    cy, cx = (shape[0] - 1) / 2, (shape[1] - 1) / 2
    assert row < cy - 3, "north must be up"
    assert col < cx - 3, "east must be left"
    # 30 arcsec / 6.2 arcsec = about 4.8 px each way
    assert abs((cy - row) - 30 / 6.2) < 1.5 and abs((cx - col) - 30 / 6.2) < 1.5


def test_other_quadrants():
    for (dra, ddec, up, left) in [(-30, -30, False, False), (30, -30, False, True), (-30, 30, True, False)]:
        pix, flagged, shape = run((dra / 3600.0, ddec / 3600.0))
        png = to_png_array(np.nan_to_num(pix))
        row, col = np.unravel_index(np.argmax(png), png.shape)
        assert (row < 57.5) == up and (col < 57.5) == left


def test_no_coverage_counts_as_flagged_and_png_zero():
    pix, flagged, shape = run(None)
    # the 60x60 px (372") synthetic detector does not fill the 720" grid
    assert np.isnan(pix).any() and flagged[np.isnan(pix)].all()
    assert 0 < flagged.mean() < 1
    assert stretch.apply(np.array([[np.nan]], dtype="float32"), 0.0, 1.0)[0, 0] == 0


def test_stretch_limits_use_unflagged_pixels_only():
    p = np.array([[1, 2, 3, 1000]], dtype="float32")
    f = np.array([[False, False, False, True]])
    vmin, vmax = stretch.compute_limits([p], [f])
    assert vmax < 4
    assert stretch.apply(np.array([[vmin, vmax]], dtype="float32"), vmin, vmax).tolist() == [[0, 255]]
