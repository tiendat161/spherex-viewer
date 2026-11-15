"""Flux of a point at a sky position, measured on one native SPHEREx cutout (real data).

Method: circular aperture photometry on the cutout as downloaded, before any resampling onto the
shared grid, so no pixel is interpolated.

1. The position is converted to a pixel position with the cutout's own WCS.
2. Background: the median of the clean pixels in a ring around the aperture. It is measured here,
   not taken from the image, so it does not depend on whatever the archive already subtracted.
3. Flux: the sum over the aperture of (pixel - background), each pixel weighted by the fraction of
   it inside the circle, times the pixel solid angle. MJy/sr over a solid angle gives MJy; the result
   is returned in microjansky (1 MJy = 1e12 uJy).
4. Uncertainty: the VARIANCE extension summed over the aperture with the same weights, plus the
   uncertainty of the background level. Without a VARIANCE extension the scatter of the ring is used.

A pixel is unusable if it is not finite or has a FLAGS bit set other than `IGNORED_FLAG_BITS`
(the same rule as the images). If any pixel of the aperture is unusable no flux is returned,
rather than a sum that is biased low; the reason says why.

Not done, and not claimed: no aperture correction (the flux is the part of the source that falls in
the aperture), no PSF fitting, no colour correction, no treatment of neighbouring sources in the
ring. The aperture and ring sizes are first choices, not tuned (task T32).
"""
import numpy as np

from .cutout import pixel_area_sr, sky_to_pixel
from .grid import IGNORED_FLAG_BITS

APERTURE_RADIUS_PIX = 2.0       # first choice, not tuned: cutout pixels are about 6 arcsec
ANNULUS_PIX = (4.0, 7.0)        # inner and outer radius of the background ring, in pixels
SUBSAMPLE = 11                  # each pixel is split SUBSAMPLE x SUBSAMPLE to get its fraction inside a circle
MIN_BACKGROUND_PIX = 20         # fewest clean ring pixels that still give a background
MJY_TO_UJY = 1e12
MEDIAN_ERROR_FACTOR = float(np.sqrt(np.pi / 2.0))  # standard error of a median of Gaussian values, relative to the mean's


def circle_weights(shape, x, y, radius):
    """Float array `shape`: the fraction (0 to 1) of each pixel inside the circle at (x, y).

    Pixel centres are at integer coordinates (0-based), as in the WCS calls of `pipeline.cutout`.
    """
    ny, nx = shape
    w = np.zeros(shape, dtype="float64")
    x0, x1 = max(int(np.floor(x - radius - 1)), 0), min(int(np.ceil(x + radius + 1)), nx - 1)
    y0, y1 = max(int(np.floor(y - radius - 1)), 0), min(int(np.ceil(y + radius + 1)), ny - 1)
    if x1 < x0 or y1 < y0:
        return w
    offs = (np.arange(SUBSAMPLE) + 0.5) / SUBSAMPLE - 0.5
    xs = (np.arange(x0, x1 + 1)[:, None] + offs[None, :]).ravel()
    ys = (np.arange(y0, y1 + 1)[:, None] + offs[None, :]).ravel()
    inside = ((xs[None, :] - x) ** 2 + (ys[:, None] - y) ** 2) <= radius ** 2
    block = inside.reshape(y1 - y0 + 1, SUBSAMPLE, x1 - x0 + 1, SUBSAMPLE).mean(axis=(1, 3))
    w[y0:y1 + 1, x0:x1 + 1] = block
    return w


def _failure(reason, c, x=None, y=None):
    return {"ok": False, "reason": reason, "flux_ujy": None, "flux_err_ujy": None, "background": None,
            "x_pix": x, "y_pix": y, "wavelength_um": c.get("wavelength_um"), "mjd_avg": c.get("mjd_avg")}


def measure_flux(c, ra, dec, aperture_pix=APERTURE_RADIUS_PIX, annulus_pix=ANNULUS_PIX):
    """Flux at (ra, dec) on one cutout `c` as returned by `pipeline.cutout.read_cutout`.

    Returns a dict. `ok` says whether a flux was measured. On success: `flux_ujy` and `flux_err_ujy`
    (1 sigma, microjansky), `background` (median of the ring, in the cutout's unit, `bunit`),
    `n_background_pix`, `error_basis` ("variance" or "annulus_scatter"). On failure `flux_ujy` is None and
    `reason` is one of: aperture_off_image, aperture_flagged, background_too_few_pixels.
    Always present: `x_pix`, `y_pix`, `wavelength_um`, `mjd_avg`.
    """
    unit = str(c["bunit"]).replace(" ", "")
    if unit != "MJy/sr":
        raise ValueError(f"expected BUNIT MJy/sr, got {c['bunit']!r}")
    img = np.asarray(c["image"], dtype="float64")
    x, y = sky_to_pixel(c["wcs"], ra, dec)
    w_ap = circle_weights(img.shape, x, y, aperture_pix)
    full_area = np.pi * aperture_pix ** 2
    if w_ap.sum() < 0.98 * full_area:  # the circle is not fully on the image
        return _failure("aperture_off_image", c, x, y)

    bad_flag = (np.asarray(c["flags"]).astype("int64") & ~IGNORED_FLAG_BITS) != 0
    usable = np.isfinite(img) & ~bad_flag
    if (~usable & (w_ap > 0)).any():
        return _failure("aperture_flagged", c, x, y)

    r_in, r_out = annulus_pix
    ring = (circle_weights(img.shape, x, y, r_out) - circle_weights(img.shape, x, y, r_in)) >= 0.5
    ring &= usable
    n_bkg = int(ring.sum())
    if n_bkg < MIN_BACKGROUND_PIX:
        return _failure("background_too_few_pixels", c, x, y)
    ring_vals = img[ring]
    bkg = float(np.median(ring_vals))
    sigma_ring = 1.4826 * float(np.median(np.abs(ring_vals - bkg)))  # robust scatter, ignores a neighbouring source

    inside = w_ap > 0  # only these pixels: a NaN elsewhere times a zero weight would still give NaN
    w = w_ap[inside]
    net = float(np.sum(w * (img[inside] - bkg)))  # MJy/sr summed over pixels
    if c.get("variance") is not None:
        var = np.asarray(c["variance"], dtype="float64")[inside]
        if not np.isfinite(var).all():
            return _failure("aperture_flagged", c, x, y)
        var_term, basis = float(np.sum(w ** 2 * var)), "variance"
    else:
        var_term, basis = float(np.sum(w ** 2) * sigma_ring ** 2), "annulus_scatter"
    bkg_term = (float(w_ap.sum()) * MEDIAN_ERROR_FACTOR * sigma_ring / np.sqrt(n_bkg)) ** 2
    omega = pixel_area_sr(c["wcs"])
    return {"ok": True, "reason": None,
            "flux_ujy": net * omega * MJY_TO_UJY,
            "flux_err_ujy": float(np.sqrt(var_term + bkg_term)) * omega * MJY_TO_UJY,
            "background": bkg, "n_background_pix": n_bkg, "error_basis": basis,
            "x_pix": x, "y_pix": y, "wavelength_um": c.get("wavelength_um"), "mjd_avg": c.get("mjd_avg")}


def method_block():
    """The contract's top-level `photometry` object: how the fluxes in a series were measured."""
    return {"method": "aperture", "aperture_radius_pix": APERTURE_RADIUS_PIX, "annulus_inner_pix": ANNULUS_PIX[0],
            "annulus_outer_pix": ANNULUS_PIX[1], "aperture_corrected": False, "at": "request_position"}


def flux_for_series(c, ra, dec):
    """The contract's `frames[].flux` object for one cutout: flux and uncertainty in microjansky, or ok false and a reason."""
    try:
        r = measure_flux(c, ra, dec)
    except ValueError:  # BUNIT is not MJy/sr
        return {"ok": False, "reason": "unexpected_unit"}
    if not r["ok"]:
        return {"ok": False, "reason": r["reason"]}
    return {"ok": True, "flux_ujy": round(float(r["flux_ujy"]), 3), "flux_err_ujy": round(float(r["flux_err_ujy"]), 3)}
