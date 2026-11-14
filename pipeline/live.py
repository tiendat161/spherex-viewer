"""Live series for a position that is not in the static cache. Used by the API.

A request starts one background job: TAP query, time-evenly frame selection, cutout
fetch, reprojection onto the shared grid. Everything goes through the one IrsaClient,
so the process-wide limit of MAX_IN_FLIGHT requests still holds. Results are kept in
memory only; raw cutouts are not written to disk.

Stretch while loading: the contract wants one stretch for the whole series, which is
only known once every frame is in. So the limits are recomputed (same rule as the
cached build, over the frames done so far) when the done count reaches 1, 2, 4, 8, ...
and once more at the end. Each recompute re-renders every PNG and bumps `gen`, which
is appended to frame URLs as `?v=<gen>` so the browser refetches. The final stretch is
the all-frames one, identical in rule to `pipeline.build`.
"""
import hashlib
import io
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

from . import stretch as stretch_mod
from .cutout import CutoutError, read_cutout
from .grid import PIXEL_SCALE_ARCSEC, grid_shape, make_grid_wcs, reproject_frame, to_png_array
from .irsa import MAX_IN_FLIGHT, IrsaError
from .select import select_frames
from .stack import band_id, build_stacks, subtract_background, with_urls
from .targets import sep_arcsec

LIVE_FRAMES = 40          # frames planned per live series (same as the cached time_evenly rule)
CUTOUT_FOV_FACTOR = 1.5   # same oversize as pipeline.build: detector cutout vs sky grid corners
MATCH_ARCSEC = 1.0
MAX_RUNNING = 2           # live series built at the same time
MAX_WAITING = 6           # further series allowed to queue before requests are refused
MAX_KEPT = 30             # finished series kept in memory
ERROR_TTL_S = 60.0        # a failed series is retried if asked for again after this long


class LiveBusy(Exception):
    pass


def _encode(arr) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(to_png_array(arr))).save(buf, "PNG")
    return buf.getvalue()


def _png_bytes(pixels, vmin, vmax) -> bytes:
    return _encode(stretch_mod.apply(pixels, vmin, vmax))


class LiveSeries:
    def __init__(self, ra, dec, fov, cap):
        self.ra, self.dec, self.fov, self.cap = ra, dec, fov, cap
        self.id = "live" + hashlib.sha1(f"{ra:.6f},{dec:.6f},{fov},{cap}".encode()).hexdigest()[:12]
        self.shape = grid_shape(fov)
        self._lock = threading.Lock()
        self.status = "loading"
        self.total = 0
        self.failed = 0
        self.error = None
        self.finished_at = None
        self.stretch = None     # {"kind","vmin","vmax","unit"} applied to the current PNGs
        self.gen = 0
        self._frames = {}       # index -> {"obs_mjd","wavelength_um","flag_fraction","pix","flagged"}
        self._pngs = {}         # index -> bytes, rendered with self.stretch
        self._stacks = None     # contract `stacks` with file names, set when ready
        self._stack_pngs = {}   # file name -> bytes
        self._unit = None

    # ---- read side (API threads) -------------------------------------------------
    def doc(self) -> dict:
        with self._lock:
            if self.status == "error":
                return {"status": "error", "data_origin": "real", "progress": {"done": 0, "total": 0, "failed": 0},
                        "grid": None, "stretch": None, "frames": [], "error": {"message": self.error}}
            frames = [{"index": i, "obs_mjd": round(f["obs_mjd"], 6), "wavelength_um": round(f["wavelength_um"], 5),
                       "url": f"/api/frames/{self.id}/{i:02d}.png?v={self.gen}", "flag_fraction": round(f["flag_fraction"], 4)}
                      for i, f in sorted(self._frames.items()) if i in self._pngs]
            doc = {
                "status": self.status,
                "data_origin": "real",
                "progress": {"done": len(frames), "total": self.total, "failed": self.failed},
                "grid": {"center": {"ra": self.ra, "dec": self.dec}, "pixel_scale_arcsec": PIXEL_SCALE_ARCSEC, "shape": list(self.shape)},
                "stretch": dict(self.stretch) if self.stretch else None,
                "frames": frames,
                "background": "median_subtracted",
            }
            if self._stacks:
                doc["stacks"] = with_urls(self._stacks, lambda name: f"/api/frames/{self.id}/{name}?v={self.gen}")
            return doc

    def png(self, name: str):
        """`name` is 'NN.png' for a frame or a stack file name."""
        with self._lock:
            if name in self._stack_pngs:
                return self._stack_pngs[name]
            stem = name[:-4]
            return self._pngs.get(int(stem)) if stem.isdigit() else None

    @property
    def finished(self) -> bool:
        return self.status != "loading"

    # ---- build side (worker threads) ---------------------------------------------
    def _restretch(self):
        """Recompute the limits over the frames done so far and re-render every PNG. Lock held."""
        fs = list(self._frames.values())
        vmin, vmax = stretch_mod.compute_limits([f["pix"] for f in fs], [f["flagged"] for f in fs])
        self.stretch = {"kind": stretch_mod.KIND, "vmin": round(vmin, 6), "vmax": round(vmax, 6), "unit": self._unit}
        self._pngs = {i: _png_bytes(f["pix"], self.stretch["vmin"], self.stretch["vmax"]) for i, f in self._frames.items()}
        self.gen += 1

    def _add(self, index, obs_mjd, band, c, pix, flagged):
        with self._lock:
            if self._unit is None:
                self._unit = c["bunit"]
            elif c["bunit"] != self._unit:
                raise ValueError(f"frames disagree on BUNIT: {self._unit!r} and {c['bunit']!r}")
            self._frames[index] = {"obs_mjd": obs_mjd, "wavelength_um": c["wavelength_um"],
                                   "flag_fraction": float(flagged.mean()), "pix": pix, "flagged": flagged, "band": band}
            n = len(self._frames)
            if n & (n - 1) == 0 or self.stretch is None:  # 1, 2, 4, 8, ...
                try:
                    self._restretch()
                except ValueError:
                    pass  # e.g. every pixel so far is flagged; the frame stays unlisted until a stretch exists
            else:
                self._pngs[index] = _png_bytes(pix, self.stretch["vmin"], self.stretch["vmax"])

    def _fail(self, message):
        with self._lock:
            self.status, self.error, self.finished_at = "error", message, time.time()
            self._frames, self._pngs = {}, {}

    def run(self, client):
        try:
            self._run(client)
        except Exception as e:  # a job must always end in ready or error, never hang in loading
            self._fail(f"{type(e).__name__}: {e}")

    def _run(self, client):
        try:
            rows = client.tap_rows(self.ra, self.dec)
        except IrsaError as e:
            return self._fail(f"The archive query failed: {e}")
        self._all_mjds = [float(r["time_bounds_lower"]) for r in rows]
        chosen = select_frames(rows, max(self.cap, 2))[:self.cap]  # select_frames needs a cap of at least 2
        if not chosen:
            return self._fail("The SPHEREx archive lists no images covering this position.")
        with self._lock:
            self.total = len(chosen)
        gwcs = make_grid_wcs(self.ra, self.dec, self.shape)
        size = round(self.fov * CUTOUT_FOV_FACTOR, 4)

        def work(i_row):
            i, row = i_row
            try:
                c = read_cutout(client.fetch_cutout(row["uri"], self.ra, self.dec, size), self.ra, self.dec)
                pix, flagged = reproject_frame(c["image"], c["wcs"], c["flags"], gwcs, self.shape)
                if not np.isfinite(pix).any():
                    raise CutoutError("no coverage on the grid")
                pix = subtract_background(pix, flagged)
            except (IrsaError, CutoutError):
                with self._lock:
                    self.failed += 1
                return
            self._add(i, float(row["time_bounds_lower"]), band_id(row.get("energy_bandpassname", "")), c, pix, flagged)

        with ThreadPoolExecutor(MAX_IN_FLIGHT) as ex:
            list(ex.map(work, enumerate(chosen)))  # re-raises anything unexpected from a worker

        with self._lock:
            if not self._frames:
                empty = True
            else:
                empty = False
                self._restretch()  # final: all frames, the contract's shared stretch (ValueError -> error)
                self.failed = self.total - len(self._frames)
                self._stacks, arrays = build_stacks(list(self._frames.values()), self._unit, self._all_mjds)
                self._stack_pngs = {name: _encode(a) for name, a in arrays.items()}
                for f in self._frames.values():  # pixels are no longer needed once the PNGs are final
                    f.pop("pix"), f.pop("flagged")
                self.status, self.finished_at = "ready", time.time()
        if empty:
            self._fail(f"None of the {self.total} images could be read from the archive. Try again later.")


class LiveBuilder:
    """Owns the live series: one per (position within 1 arcsec, fov, frame cap)."""

    def __init__(self, client, max_running=MAX_RUNNING, max_waiting=MAX_WAITING, max_kept=MAX_KEPT, error_ttl_s=ERROR_TTL_S):
        self._client = client
        self._lock = threading.Lock()
        self._jobs = []  # oldest first
        self._pool = ThreadPoolExecutor(max_running, thread_name_prefix="live-series")
        self._limit = max_running + max_waiting
        self._max_kept = max_kept
        self._error_ttl_s = error_ttl_s

    def get_or_start(self, ra, dec, fov, cap) -> LiveSeries:
        cap = min(int(cap), LIVE_FRAMES)
        with self._lock:
            now = time.time()
            self._jobs = [j for j in self._jobs
                          if not (j.status == "error" and now - (j.finished_at or now) > self._error_ttl_s)]
            for j in self._jobs:
                if j.fov == fov and j.cap == cap and sep_arcsec(ra, dec, j.ra, j.dec) <= MATCH_ARCSEC:
                    return j
            if sum(not j.finished for j in self._jobs) >= self._limit:
                raise LiveBusy("Too many positions are being built right now. Try again in a few minutes.")
            done = [j for j in self._jobs if j.finished]
            for old in done[:max(0, len(self._jobs) + 1 - self._max_kept)]:
                self._jobs.remove(old)
            job = LiveSeries(ra, dec, fov, cap)
            self._jobs.append(job)
            self._pool.submit(job.run, self._client)
            return job

    def find(self, series_id):
        with self._lock:
            return next((j for j in self._jobs if j.id == series_id), None)
