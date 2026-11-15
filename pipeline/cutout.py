"""Read one SPHEREx cutout MEF: image, flags, WCS, unit and wavelength."""
import io
import math
import threading
import warnings

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


def read_cutout(source, ra, dec):
    """`source` is a path or bytes.

    Returns dict(image, flags, variance, wcs, bunit, wavelength_um, mjd_avg).
    `variance` (the VARIANCE extension, unit bunit squared) and `mjd_avg` (header MJD-AVG) are None
    when the file does not have them.
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
    except CutoutError:
        raise
    except Exception as e:
        raise CutoutError(f"unreadable cutout: {type(e).__name__}: {e}")
    if not bunit:
        raise CutoutError("IMAGE header has no BUNIT")
    return {"image": image, "flags": flags, "variance": variance, "wcs": wcs, "bunit": bunit,
            "wavelength_um": wl, "mjd_avg": None if mjd_avg is None else float(mjd_avg)}
