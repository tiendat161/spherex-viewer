"""One shared asinh stretch per series."""
import numpy as np

KIND = "asinh"
LOW_PCT, HIGH_PCT = 1.0, 99.5
# Softening of the asinh curve: y = asinh(A * x) / asinh(A) for x in [0, 1].
# A is a display choice; it is not part of the contract (the PNGs are pre-stretched).
ASINH_A = 10.0


def compute_limits(frames_pixels, frames_flagged):
    vals = [p[~f & np.isfinite(p)] for p, f in zip(frames_pixels, frames_flagged)]
    allv = np.concatenate(vals) if vals else np.array([])
    if allv.size == 0:
        raise ValueError("no unflagged finite pixels in any frame; cannot compute a stretch")
    vmin, vmax = np.percentile(allv, [LOW_PCT, HIGH_PCT])
    if not vmax > vmin:
        raise ValueError("degenerate stretch: vmax <= vmin")
    return float(vmin), float(vmax)


def apply(pixels, vmin, vmax):
    """Map to 8-bit. NaN (no coverage) -> 0."""
    x = (np.nan_to_num(pixels, nan=vmin) - vmin) / (vmax - vmin)
    x = np.clip(x, 0.0, 1.0)
    y = np.arcsinh(ASINH_A * x) / np.arcsinh(ASINH_A)
    return np.rint(y * 255.0).astype(np.uint8)
