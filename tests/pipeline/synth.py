"""SIMULATED inputs for tests only. Nothing here is archive data."""
import io

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS


def synthetic_wcs(ra, dec, nx=60, ny=60, scale_arcsec=6.2, rot_deg=17.0):
    """A SIMULATED detector WCS: TAN-SIP header-style, rotated on the sky (like a real detector)."""
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(nx + 1) / 2, (ny + 1) / 2]
    s = scale_arcsec / 3600.0
    t = np.radians(rot_deg)
    w.wcs.pc = [[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]]
    w.wcs.cdelt = [-s, s]
    w.wcs.radesys = "ICRS"
    return w


def synthetic_cutout_bytes(ra, dec, source_offset_deg=None, nx=60, ny=60, bunit="MJy / sr", background=1.0, amp=50.0):
    """SIMULATED cutout MEF (IMAGE, FLAGS). Optional point source at (dra_east, ddec_north) in degrees."""
    w = synthetic_wcs(ra, dec, nx, ny)
    img = np.full((ny, nx), background, dtype="float32")
    if source_offset_deg is not None:
        dra, ddec = source_offset_deg
        sx, sy = w.all_world2pix(ra + dra / np.cos(np.radians(dec)), dec + ddec, 0)
        yy, xx = np.mgrid[0:ny, 0:nx]
        img += (amp * np.exp(-((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * 1.2 ** 2))).astype("float32")
    hdr = w.to_header()
    hdr["BUNIT"] = bunit
    prim = fits.PrimaryHDU()
    im = fits.ImageHDU(img, header=hdr, name="IMAGE")
    fl = fits.ImageHDU(np.zeros((ny, nx), dtype="int32"), name="FLAGS")
    buf = io.BytesIO()
    fits.HDUList([prim, im, fl]).writeto(buf)
    return buf.getvalue()
