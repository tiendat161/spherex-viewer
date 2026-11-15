"""Read one SPHEREx cutout MEF: image, flags, WCS, unit and wavelength."""
import io
import math
import threading
import warnings

import numpy as np
from astropy import log as astropy_log
from astropy.io import fits
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_area


astropy_log.setLevel("WARNING")  # silences the per-frame SIP/CTYPE INFO text
_WCS_LOCK = threading.Lock()  # wcslib is not thread-safe


class CutoutError(Exception):
    pass


def wavelength_um_at(hdul, hdr, ra, dec) -> float:
    """Wavelength at the sky position, from the WCS-WAVE lookup table (WCS key 'W').

    Evaluated with astropy's WAVE-TAB support. Raises CutoutError if it cannot be
    evaluated; never falls back to a nominal band value.
    """
    with _WCS_LOCK, warnings.catch_warnings():
        warnings.simplefilter("ignore")
        cel = WCS(hdr, hdul)
        wav = WCS(hdr, hdul, key="W")
        x, y = cel.all_world2pix(ra, dec, 0)
        w = float(wav.all_pix2world(x, y, 0)[0])
    if not (w == w) or w <= 0:
        raise CutoutError(f"WCS-WAVE evaluated to {w}")
    return w


def sky_to_pixel(wcs, ra, dec):
    """(x, y), 0-based pixel position of a sky position (ICRS degrees) in a cutout."""
    with _WCS_LOCK, warnings.catch_warnings():
        warnings.simplefilter("ignore")
        x, y = wcs.all_world2pix(ra, dec, 0)
    return float(x), float(y)


def pixel_area_sr(wcs) -> float:
    """Solid angle of one cutout pixel in steradians (at the reference pixel)."""
    with _WCS_LOCK, warnings.catch_warnings():
        warnings.simplefilter("ignore")
        deg2 = float(proj_plane_pixel_area(wcs))
    return deg2 * (math.pi / 180.0) ** 2


def wavelength_map(hdul, hdr, shape):
    """Wavelength in micrometres at every pixel of the cutout (float32, `shape`), from the WCS-WAVE lookup table.

    The wavelength changes across the detector (about 4 percent over one 0.3 degree cutout), so a position away
    from the centre has its own wavelength. Raises CutoutError if the table cannot be evaluated.
    """
    ny, nx = shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    with _WCS_LOCK, warnings.catch_warnings():
        warnings.simplefilter("ignore")
        w = WCS(hdr, hdul, key="W").all_pix2world(xx.ravel(), yy.ravel(), 0)[0].reshape(ny, nx)
    if not np.isfinite(w).all() or (w <= 0).any():
        raise CutoutError("WCS-WAVE gives no valid wavelength over the cutout")
    return w.astype("float32")


def wavelength_at(c, x, y):
    """Wavelength (um) at the 0-based pixel position (x, y) of a cutout read with `with_wave_map=True` (nearest pixel, clipped to the image)."""
    m = c["wave_map"]
    return float(m[min(max(int(round(y)), 0), m.shape[0] - 1), min(max(int(round(x)), 0), m.shape[1] - 1)])


def read_cutout(source, ra, dec, with_wave_map=False):
    """`source` is a path or bytes.

    Returns dict(image, flags, variance, wcs, bunit, wavelength_um, mjd_avg).
    `variance` (the VARIANCE extension, unit bunit squared) and `mjd_avg` (header MJD-AVG) are None
    when the file does not have them. With `with_wave_map` the dict also has `wave_map`, the wavelength at every pixel
    (used to measure at other positions than (ra, dec)).
    """
    f = io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else source
    try:
        with fits.open(f) as hdul:
            hdr = hdul["IMAGE"].header
            with _WCS_LOCK, warnings.catch_warnings():
                warnings.simplefilter("ignore")
                wcs = WCS(hdr)
            image = hdul["IMAGE"].data.astype("float32")
            flags = hdul["FLAGS"].data.copy()
            variance = hdul["VARIANCE"].data.astype("float32") if "VARIANCE" in hdul else None
            mjd_avg = hdr.get("MJD-AVG")
            bunit = str(hdr.get("BUNIT", "")).strip()
            wl = wavelength_um_at(hdul, hdr, ra, dec)
            wave_map = wavelength_map(hdul, hdr, image.shape) if with_wave_map else None
    except CutoutError:
        raise
    except Exception as e:
        raise CutoutError(f"unreadable cutout: {type(e).__name__}: {e}")
    if not bunit:
        raise CutoutError("IMAGE header has no BUNIT")
    return {"image": image, "flags": flags, "variance": variance, "wcs": wcs, "bunit": bunit,
            "wavelength_um": wl, "mjd_avg": None if mjd_avg is None else float(mjd_avg),
            **({"wave_map": wave_map} if with_wave_map else {})}
