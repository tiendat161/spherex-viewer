"""The shared grid and reprojection onto it.

Grid: TAN, ICRS, centred on the request position, north up, east left,
6.2 arcsec pixels, shape [116, 116] for fov 0.2. Array row 0 is the SOUTH edge
(FITS convention); `to_png_array` flips it so PNG row 0 is the north edge.
"""
import warnings

import numpy as np
from astropy.wcs import WCS
from reproject import reproject_interp

PIXEL_SCALE_ARCSEC = 6.2


def grid_shape(fov_deg: float):
    n = int(round(fov_deg * 3600.0 / PIXEL_SCALE_ARCSEC))
    return (n, n)


def make_grid_wcs(ra: float, dec: float, shape):
    ny, nx = shape
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.radesys = "ICRS"
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(nx + 1) / 2.0, (ny + 1) / 2.0]
    d = PIXEL_SCALE_ARCSEC / 3600.0
    w.wcs.cdelt = [-d, d]  # RA increases to the left (east left), Dec increases with row (north up)
    w.wcs.cunit = ["deg", "deg"]
    return w


def reproject_frame(image, image_wcs, flags, grid_wcs, shape):
    """Return (pixels, flagged) on the grid.

    pixels: float32, bilinear, NaN where the source has no coverage.
    flagged: bool, True where the nearest source pixel has any FLAGS bit set,
    or where there is no coverage (contract prototype choice 5).
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        pix, foot = reproject_interp((image, image_wcs), grid_wcs, shape_out=shape, order="bilinear")
        bad = (np.asarray(flags) != 0).astype("float32")
        fl, fl_foot = reproject_interp((bad, image_wcs), grid_wcs, shape_out=shape, order="nearest-neighbor")
    covered = (foot > 0) & np.isfinite(pix)
    flagged = (np.nan_to_num(fl) > 0.5) | (fl_foot <= 0) | ~covered
    return pix.astype("float32"), flagged


def to_png_array(a):
    """Flip so that north is the top row of the image."""
    return np.flipud(a)
