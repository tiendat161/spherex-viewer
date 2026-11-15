"""Live series for a position that is not in the static cache. Used by the API.

A request starts one background job: TAP query, frame ordering, cutout fetch, reprojection
onto the shared grid. Everything goes through the one IrsaClient, so the process-wide limit of
MAX_IN_FLIGHT requests still holds. Results are kept in memory only; raw cutouts are not
written to disk.

Staged loading (T40): a job is one per position and field of view and loads the first `cap`
images of `pipeline.select.spread_order` (any first N are spread over the dates and detector
bands). A later request with a larger `load` extends the same job: frames already loaded are
kept, only the new ones are fetched, and the stretch and stacks are rebuilt when they are in.
A finished job keeps its pixels so it can be extended; to bound memory only the most recent
ones do (HOT_PIXEL_BYTES), and extending an older one starts again from its archive rows.

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
from astropy.wcs import NoConvergence
from PIL import Image

from . import stretch as stretch_mod
from .cutout import CutoutError, read_cutout
from .grid import PIXEL_SCALE_ARCSEC, grid_shape, make_grid_wcs, reproject_frame, to_png_array
from .irsa import MAX_IN_FLIGHT, IrsaError
from . import tapcache
from .photometry import flux_for_series, method_block
from .select import spread_order
from .stack import band_id, build_stacks, subtract_background, with_urls
from .targets import sep_arcsec

LIVE_FRAMES = 40          # frames loaded when a request gives no `load` (the API uses min(max_frames, this))
MAX_LIVE_FRAMES = 102     # the most a live series can hold: the contract's frame ceiling
HOT_PIXEL_BYTES = 300e6   # pixels kept, over all finished series, so that they can be extended
CUTOUT_FOV_FACTOR = 1.5   # same oversize as pipeline.build: detector cutout vs sky grid corners
MATCH_ARCSEC = 1.0
MAX_TOTAL_BYTES = 600e6   # pixels plus PNGs over all live series; at the limit new builds are refused and old finished series are evicted (estimate, not measured on the host)
MAX_RUNNING = 2           # live series built at the same time
MAX_WAITING = 6           # further series allowed to queue before requests are refused
MAX_KEPT = 30             # finished series kept in memory
TAP_LIVE_ATTEMPTS = 2     # live archive search: TAP tries before falling back to SIA2 (T43)
TAP_LIVE_TIMEOUT_S = 90   # seconds one TAP try may take; the usual search takes 10 to 67 s, once about 4 minutes
SIA_LIVE_TIMEOUT_S = 60
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
    def __init__(self, ra, dec, fov, cap, rows=None, tap_dir=None):
        self.ra, self.dec, self.fov, self.cap = ra, dec, fov, cap
        self._tap_dir = tap_dir  # where earlier archive searches are remembered (None: not remembered)
        self.id = "live" + hashlib.sha1(f"{ra:.6f},{dec:.6f},{fov}".encode()).hexdigest()[:12]  # stable when `cap` grows
        self.shape = grid_shape(fov)
        self._lock = threading.Lock()
        self.status = "loading"
        self.total = 0
        self.search = None      # "tap" or "sia2": which archive service gave the list of images, once known
        self.available = None   # distinct images the archive lists, once it has answered
        self.failed = 0
        self.error = None
        self.finished_at = None
        self.last_used = time.time()
        self.pix_dropped = False  # True once the pixels were let go: the series can no longer be extended in place
        self.stretch = None     # {"kind","vmin","vmax","unit"} applied to the current PNGs
        self.gen = 0
        self._rows = rows       # the archive's rows, kept so that a rebuilt series does not search again
        self._order = None      # distinct images in spread_order; frame index i is _order[i]
        self._next = 0          # _order[:_next] have been handed to download threads
        self._frames = {}       # index -> {"obs_mjd","wavelength_um","flag_fraction","pix","flagged"}
        self._pngs = {}         # index -> bytes, rendered with self.stretch
        self._render_seq = 0    # numbers re-renders; only the newest finished one is installed
        self._installed_seq = 0
        self._stacks = None     # contract `stacks` with file names; from the last finished pass
        self._stack_pngs = {}   # file name -> bytes
        self._unit = None
        self._all_mjds = []

    # ---- read side (API threads) -------------------------------------------------
    def doc(self) -> dict:
        with self._lock:
            if self.status == "error":
                return {"status": "error", "data_origin": "real", "progress": {"done": 0, "total": 0, "failed": 0},
                        "grid": None, "stretch": None, "frames": [], "error": {"message": self.error}}
            frames = []
            for i, f in sorted(self._frames.items()):
                if i not in self._pngs:
                    continue
                e = {"index": i, "obs_mjd": round(f["obs_mjd"], 6), "wavelength_um": round(f["wavelength_um"], 5),
                     "url": f"/api/frames/{self.id}/{i:02d}.png?v={self.gen}", "flag_fraction": round(f["flag_fraction"], 4)}
                if f.get("mjd_avg") is not None:
                    e["mjd_avg"] = round(f["mjd_avg"], 6)
                if f.get("flux") is not None:
                    e["flux"] = f["flux"]
                frames.append(e)
            progress = {"done": len(frames), "total": self.total, "failed": self.failed}
            if self.available is not None:
                progress["available"] = self.available
            if self.search is not None:
                progress["search"] = self.search
            doc = {
                "status": self.status,
                "data_origin": "real",
                "progress": progress,
                "grid": {"center": {"ra": self.ra, "dec": self.dec}, "pixel_scale_arcsec": PIXEL_SCALE_ARCSEC, "shape": list(self.shape)},
                "stretch": dict(self.stretch) if self.stretch else None,
                "frames": frames,
                "background": "median_subtracted",
            }
            if any("flux" in e for e in frames):
                doc["photometry"] = method_block()
            if self._stacks:  # while the series is being extended these are the stacks of the frames loaded before
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

    def pixel_bytes(self) -> int:
        with self._lock:
            return sum(f["pix"].nbytes + f["flagged"].nbytes for f in self._frames.values() if "pix" in f)

    def png_bytes(self) -> int:
        with self._lock:
            return sum(map(len, self._pngs.values())) + sum(map(len, self._stack_pngs.values()))

    def drop_pixels(self):
        """Let the pixels go (the PNGs stay). The series can then be shown but not extended in place."""
        with self._lock:
            for f in self._frames.values():
                f.pop("pix", None), f.pop("flagged", None)
            self.pix_dropped = True

    def extend(self, cap) -> bool:
        """Ask for `cap` frames in total. True if the caller has to start a worker (the series was finished); False if it
        is still loading (the running worker takes the new total on its next pass), already has that many, or has failed."""
        with self._lock:
            cap = min(int(cap), MAX_LIVE_FRAMES)
            if cap <= self.cap or self.status == "error":
                return False
            self.cap = cap
            if self._order is not None:
                total = min(cap, len(self._order))
                if total == self.total:
                    return False  # the archive has no more images than are planned: nothing to load, no new stretch or stacks
                self.total = total
            if self.status == "ready":
                self.status, self.finished_at = "loading", None
                return True
            return False

    # ---- build side (worker threads) ---------------------------------------------
    def _render(self, items):
        """Limits over `items` ([(index, pix, flagged)]) and a PNG per item. No lock: this is the slow part (T44)."""
        vmin, vmax = stretch_mod.compute_limits([p for _, p, _ in items], [f for _, _, f in items])
        stretch = {"kind": stretch_mod.KIND, "vmin": round(vmin, 6), "vmax": round(vmax, 6), "unit": self._unit}
        return stretch, {i: _png_bytes(p, stretch["vmin"], stretch["vmax"]) for i, p, _ in items}

    def _items(self):
        """Frames that still hold pixels, as (index, pix, flagged). Lock held. The arrays are never changed in place."""
        return [(i, f["pix"], f["flagged"]) for i, f in self._frames.items() if "pix" in f]

    def _restretch(self):
        """Recompute the limits over the frames done so far and re-render every PNG. Called without the lock: the
        rendering runs outside it so polls are not held up, and the result is installed only if no newer one was."""
        with self._lock:
            self._render_seq += 1
            seq, items = self._render_seq, self._items()
        stretch, pngs = self._render(items)  # ValueError if every pixel is flagged
        with self._lock:
            if seq < self._installed_seq:
                return  # a newer re-render already landed
            self._installed_seq = seq
            self.stretch, self._pngs = stretch, pngs
            for i, pix, _ in self._items():  # frames that arrived while rendering get the new stretch now (cheap)
                if i not in pngs:
                    self._pngs[i] = _png_bytes(pix, stretch["vmin"], stretch["vmax"])
            self.gen += 1

    def _add(self, index, obs_mjd, band, c, pix, flagged, flux=None):
        with self._lock:
            if self._unit is None:
                self._unit = c["bunit"]
            elif c["bunit"] != self._unit:
                raise ValueError(f"frames disagree on BUNIT: {self._unit!r} and {c['bunit']!r}")
            self._frames[index] = {"obs_mjd": obs_mjd, "wavelength_um": c["wavelength_um"],
                                   "flag_fraction": float(flagged.mean()), "pix": pix, "flagged": flagged, "band": band,
                                   "flux": flux, "mjd_avg": c.get("mjd_avg")}
            n = len(self._frames)
            restretch = n & (n - 1) == 0 or self.stretch is None  # 1, 2, 4, 8, ...
            stretch = self.stretch
        if restretch:
            try:
                self._restretch()
            except ValueError:
                pass  # e.g. every pixel so far is flagged; the frame stays unlisted until a stretch exists
        else:
            png = _png_bytes(pix, stretch["vmin"], stretch["vmax"])
            with self._lock:
                if self.stretch is stretch:  # not replaced while rendering; otherwise the re-render covers this frame
                    self._pngs[index] = png

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
        if self._order is None:
            rows = self._rows
            if rows is None and self._tap_dir is not None:
                rows = tapcache.load(self._tap_dir, self.ra, self.dec)  # searched before: skip the slow step
                if rows is not None:
                    self.search = "tap"  # only complete TAP answers are remembered
            if rows is None:
                try:
                    rows = client.tap_rows(self.ra, self.dec, TAP_LIVE_ATTEMPTS, TAP_LIVE_TIMEOUT_S)
                    self.search = "tap"
                except IrsaError as tap_err:
                    # TAP is down or too slow: SIA2 answers in seconds but may list fewer images (T43). Say so, and do not remember it.
                    try:
                        rows = client.sia_rows(self.ra, self.dec, SIA_LIVE_TIMEOUT_S)
                        self.search = "sia2"
                    except IrsaError as sia_err:
                        return self._fail(f"The archive query failed: {tap_err}; the SIA2 fallback also failed: {sia_err}")
                if self._tap_dir is not None and self.search == "tap":
                    try:
                        tapcache.save(self._tap_dir, self.ra, self.dec, rows)
                    except OSError:
                        pass  # not remembering is only slower
            order = spread_order(rows)
            if not order:
                return self._fail("The SPHEREx archive lists no images covering this position.")
            with self._lock:
                self._rows, self._order = rows, order
                self._all_mjds = [float(r["time_bounds_lower"]) for r in rows]
                self.available = len(order)
                self.total = min(self.cap, len(order))
        gwcs = make_grid_wcs(self.ra, self.dec, self.shape)
        size = round(self.fov * CUTOUT_FOV_FACTOR, 4)

        def work(i):
            row = self._order[i]
            try:
                c = read_cutout(client.fetch_cutout(row["uri"], self.ra, self.dec, size), self.ra, self.dec)
                flux = flux_for_series(c, self.ra, self.dec)  # on the cutout as downloaded, before resampling
                pix, flagged = reproject_frame(c["image"], c["wcs"], c["flags"], gwcs, self.shape)
                if not np.isfinite(pix).any():
                    raise CutoutError("no coverage on the grid")
                pix = subtract_background(pix, flagged)
                self._add(i, float(row["time_bounds_lower"]), band_id(row.get("energy_bandpassname", "")), c, pix, flagged, flux)
            except (IrsaError, CutoutError, ValueError, NoConvergence):  # one bad frame (e.g. a WCS that does not converge) is a gap, not a failed series
                with self._lock:
                    self.failed += 1
                    self._frames.pop(i, None)
                    self._pngs.pop(i, None)

        while True:
            with self._lock:
                hi, lo = min(self.cap, len(self._order)), self._next
                if lo >= hi:
                    snap = [{**f, "index": i} for i, f in self._frames.items()]  # the frames this pass produced
                    if not snap:
                        self.status, self.finished_at = "error", time.time()
                        self.error = f"None of the {self.total} images could be read from the archive. Try again later."
                        return
                    total = hi
                else:
                    self._next, self.total = hi, hi
                    snap = None
            if snap is not None:
                # All frames up to `total` are in or failed. Stretch, PNGs and stacks are made outside the lock; the series
                # is marked ready only if `extend` did not raise the cap meanwhile (then it takes another pass).
                items = [(f["index"], f["pix"], f["flagged"]) for f in snap if "pix" in f]
                stretch, pngs = self._render(items)  # ValueError -> error (run)
                stacks, arrays = build_stacks(snap, self._unit, self._all_mjds)
                stack_pngs = {name: _encode(a) for name, a in arrays.items()}
                with self._lock:
                    if min(self.cap, len(self._order)) != total or self._next != total:
                        continue
                    self.stretch, self._pngs, self.gen = stretch, pngs, self.gen + 1
                    self._render_seq += 1
                    self._installed_seq = self._render_seq
                    self.failed = self.total - len(self._frames)
                    self._stacks, self._stack_pngs = stacks, stack_pngs
                    self.status, self.finished_at = "ready", time.time()
                return
            with ThreadPoolExecutor(MAX_IN_FLIGHT) as ex:
                list(ex.map(work, range(lo, hi)))  # re-raises anything unexpected from a worker


class LiveBuilder:
    """Owns the live series: one per (position within 1 arcsec, fov). A request for more frames extends it."""

    def __init__(self, client, max_running=MAX_RUNNING, max_waiting=MAX_WAITING, max_kept=MAX_KEPT, error_ttl_s=ERROR_TTL_S,
                 hot_pixel_bytes=HOT_PIXEL_BYTES, tap_dir=None, max_total_bytes=MAX_TOTAL_BYTES):
        self._client = client
        self._lock = threading.Lock()
        self._jobs = []  # oldest first
        self._pool = ThreadPoolExecutor(max_running, thread_name_prefix="live-series")
        self._limit = max_running + max_waiting
        self._max_kept = max_kept
        self._error_ttl_s = error_ttl_s
        self._hot_pixel_bytes = hot_pixel_bytes
        self._tap_dir = tap_dir  # folder for remembered archive searches, or None
        self._max_total_bytes = max_total_bytes

    def _run_job(self, job):
        job.run(self._client)
        self._trim()
        with self._lock:
            self._evict_to_budget()

    def _trim(self):
        """Keep the pixels of the most recently used finished series up to the byte budget (at least the latest one)."""
        with self._lock:
            kept = 0
            for j in sorted((j for j in self._jobs if j.status == "ready" and not j.pix_dropped), key=lambda j: j.last_used, reverse=True):
                size = j.pixel_bytes()
                if kept and kept + size > self._hot_pixel_bytes:
                    j.drop_pixels()
                else:
                    kept += size

    def total_bytes(self) -> int:
        """Pixels plus PNGs held by every series (the lock is held by the caller or not needed for a rough figure)."""
        return sum(j.pixel_bytes() + j.png_bytes() for j in list(self._jobs))

    def _evict_to_budget(self, keep_latest=True):
        """Forget the least recently used finished series until the total is within the budget, always keeping the
        most recent one so the series a visitor is looking at stays (caller holds the lock)."""
        for j in sorted((j for j in self._jobs if j.finished), key=lambda j: j.last_used)[:-1 if keep_latest else None]:
            if self.total_bytes() <= self._max_total_bytes:
                break
            self._jobs.remove(j)

    def _busy(self):
        return sum(not j.finished for j in self._jobs) >= self._limit

    def get_or_start(self, ra, dec, fov, cap) -> LiveSeries:
        cap = max(1, min(int(cap), MAX_LIVE_FRAMES))
        with self._lock:
            now = time.time()
            self._jobs = [j for j in self._jobs
                          if not (j.status == "error" and now - (j.finished_at or now) > self._error_ttl_s)]
            rows = rebuilt = None
            for j in self._jobs:
                if j.fov == fov and sep_arcsec(ra, dec, j.ra, j.dec) <= MATCH_ARCSEC:
                    j.last_used = now
                    if cap <= j.cap or j.status == "error":
                        return j
                    if self._busy() and j.finished:
                        raise LiveBusy("Too many positions are being built right now. Try again in a few minutes.")
                    if not j.pix_dropped:
                        if j.extend(cap):
                            self._pool.submit(self._run_job, j)
                        return j
                    rows, rebuilt = j._rows, (j.ra, j.dec)  # same position, so the same id and frame URLs
                    # its pixels were let go: build it again, without searching the archive again
                    self._jobs.remove(j)
                    break
            if rows is None and self._busy():
                raise LiveBusy("Too many positions are being built right now. Try again in a few minutes.")
            self._evict_to_budget(keep_latest=False)  # a new build may push out any finished series
            if self.total_bytes() > self._max_total_bytes:  # running series alone fill the budget
                raise LiveBusy("The server is holding as much data as it can. Try again in a few minutes.")
            done = [j for j in self._jobs if j.finished]
            for old in done[:max(0, len(self._jobs) + 1 - self._max_kept)]:
                self._jobs.remove(old)
            job = LiveSeries(*(rebuilt if rebuilt else (ra, dec)), fov, cap, rows=rows, tap_dir=self._tap_dir)
            self._jobs.append(job)
            self._pool.submit(self._run_job, job)
            return job

    def find(self, series_id):
        with self._lock:
            return next((j for j in self._jobs if j.id == series_id), None)
