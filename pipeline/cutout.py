"""Read one SPHEREx cutout MEF: image, flags, WCS, unit and wavelength."""
import io
import threading
import warnings

from astropy.io import fits
from astropy.wcs import WCS


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


def read_cutout(source, ra, dec):
    """`source` is a path or bytes. Returns dict(image, flags, wcs, bunit, wavelength_um)."""
    f = io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else source
    try:
        with fits.open(f) as hdul:
            hdr = hdul["IMAGE"].header
            with _WCS_LOCK, warnings.catch_warnings():
                warnings.simplefilter("ignore")
                wcs = WCS(hdr)
            image = hdul["IMAGE"].data.astype("float32")
            flags = hdul["FLAGS"].data.copy()
            bunit = str(hdr.get("BUNIT", "")).strip()
            wl = wavelength_um_at(hdul, hdr, ra, dec)
    except CutoutError:
        raise
    except Exception as e:
        raise CutoutError(f"unreadable cutout: {type(e).__name__}: {e}")
    if not bunit:
        raise CutoutError("IMAGE header has no BUNIT")
    return {"image": image, "flags": flags, "wcs": wcs, "bunit": bunit, "wavelength_um": wl}
