// Pure helpers: no DOM, no network. Unit-tested in test/model.test.js.

export const FOVS_DEG = [0.1, 0.2, 0.5, 1]; // the field widths the API accepts (docs/contract.md)
export const FOV_DEG = 0.2; // default, and the only size in the static cache
export const WIDE_FOV_DEG = 0.5; // from here on the UI says the wavelength is exact at the centre only
export const MAX_FRAMES = 102; // ceiling the API accepts; each cached series has its own frame count
export const POLL_MS = 2000;
export const INITIAL_LOAD = 8; // frames asked for first when a position is built live (docs/contract.md, `load`)
export const MORE_STEP = 16; // what "Load more" adds
export const MAX_LOAD = 102; // the most a live series holds
export const IMAGES_PER_MIN = 30; // about, with 8 archive downloads at once (one position, one run: indicative only)
export const SLOW_SEARCH_S = 90; // after this long the archive search is called slow (it took 40 to 67 s in three runs, about 4 minutes once)
export const MB_PER_IMAGE = 4.4; // size of one archive cutout, whatever the field of view

/** The one request for a position. Identical on every poll (docs/contract.md, Polling). `load` is for live series only. */
export function seriesUrl(ra, dec, fov = FOV_DEG, load = null) {
  const q = new URLSearchParams({
    ra: String(ra),
    dec: String(dec),
    fov: String(fov),
    max_frames: String(MAX_FRAMES),
  });
  if (load) q.set('load', String(load));
  return `/api/series?${q}`;
}

/** Angular separation in arcseconds between two {ra, dec} positions in degrees. */
export function sepArcsec(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.dec - a.dec) * r) / 2) ** 2 + Math.cos(a.dec * r) * Math.cos(b.dec * r) * Math.sin(((b.ra - a.ra) * r) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * (180 / Math.PI) * 3600;
}

/** A position is one of the cached targets (opened at once, nothing is built) when it is within 1 arcsec of one at the cached field of view. */
export function isCachedPosition(targets, ra, dec, fov) {
  return fov === FOV_DEG && targets.some((t) => sepArcsec({ ra, dec }, t) <= 1);
}

/** Rough wait for `count` more images, in words. Indicative only (IMAGES_PER_MIN). */
export function loadTimeText(count) {
  const s = (count * 60) / IMAGES_PER_MIN;
  return s < 60 ? 'under a minute' : `about ${Math.round(s / 60)} min`;
}

/**
 * What can still be loaded for a finished live series: null when nothing (a cached series, or everything up to MAX_LOAD is in).
 * {have, available, more: frames in total after "Load more", all: frames in total after "Load all" or null if that is the same,
 * allIsCapped: the archive has more than MAX_LOAD}.
 */
export function loadPlan(resp) {
  const p = resp?.progress;
  if (!p || resp.status !== 'ready' || typeof p.available !== 'number') return null;
  const cap = Math.min(MAX_LOAD, p.available);
  if (p.total >= cap) return null;
  const more = Math.min(cap, p.total + MORE_STEP);
  return { have: p.total, available: p.available, more, all: cap > more ? cap : null, allIsCapped: p.available > MAX_LOAD };
}

/** Read ?ra=&dec=&fov= from a query string. Returns {ra, dec, fov} or null. A missing or unsupported fov is the default. */
export function parseLocation(search) {
  const q = new URLSearchParams(search);
  if (!q.has('ra') || !q.has('dec')) return null;
  const ra = Number(q.get('ra'));
  const dec = Number(q.get('dec'));
  if (q.get('ra').trim() === '' || q.get('dec').trim() === '') return null;
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
  if (ra < 0 || ra >= 360 || dec < -90 || dec > 90) return null;
  return { ra, dec, fov: parseFov(q.get('fov')) };
}

/** One of FOVS_DEG, or the default when the text is missing or not an allowed value. */
export function parseFov(text) {
  const v = text == null || String(text).trim() === '' ? NaN : Number(text);
  return FOVS_DEG.find((f) => Math.abs(f - v) < 1e-9) ?? FOV_DEG;
}

/** The page URL for a position. The default field of view is left out, so old links stay as they were. */
export function locationQuery(ra, dec, fov = FOV_DEG) {
  return `?ra=${ra}&dec=${dec}${fov === FOV_DEG ? '' : `&fov=${fov}`}`;
}

/** Width of the grid on the sky in degrees, from the response's own grid. */
export function gridFovDeg(grid) {
  return (grid.shape[1] * grid.pixel_scale_arcsec) / 3600;
}

/** True from WIDE_FOV_DEG up. The grid is a whole number of pixels (290 px is 0.4994°), so allow one pixel. */
export function isWideField(grid) {
  return gridFovDeg(grid) + grid.pixel_scale_arcsec / 3600 >= WIDE_FOV_DEG;
}

/** Scale bar length in arcseconds: the longest of 1, 2, 5, 10 arcmin that is at most a tenth of the field (never under 1 arcmin). */
export function scaleBarArcsec(fovArcsec) {
  return [600, 300, 120, 60].find((a) => a <= fovArcsec / 10) ?? 60;
}

export function scaleBarLabel(arcsec) {
  return arcsec > 60 ? `${arcsec / 60}′` : `${arcsec}″`;
}

/** Cheap structural guard for a response body; the schema is the real source of truth. */
export function isSeriesResponse(r) {
  return (
    !!r &&
    typeof r === 'object' &&
    ['ready', 'loading', 'error'].includes(r.status) &&
    !!r.progress &&
    Array.isArray(r.frames)
  );
}

/**
 * Turn the frames the API has so far into playback slots, one per planned index.
 * A gap in frames[].index is a failed frame and becomes {skipped: true, index}.
 * While loading, indices after the last present frame are not slots yet.
 * When ready, missing trailing indices up to progress.total are skipped too.
 */
export function buildSlots(resp) {
  const byIndex = new Map(resp.frames.map((f) => [f.index, f]));
  const last = resp.frames.length ? Math.max(...byIndex.keys()) : -1;
  const length = resp.status === 'ready' ? Math.max(resp.progress.total, last + 1) : last + 1;
  const slots = [];
  for (let i = 0; i < length; i++) {
    slots.push(byIndex.get(i) ?? { skipped: true, index: i });
  }
  return slots;
}

/**
 * Individual frames in the chosen order ('time' or 'wavelength'). If the frames already are in that
 * order the slots are returned untouched, failed ones in place; otherwise failed slots go last.
 */
export function orderSlots(slots, order) {
  const key = order === 'wavelength' ? 'wavelength_um' : 'obs_mjd';
  const live = slots.filter((s) => !s.skipped);
  if (live.every((s, i) => i === 0 || live[i - 1][key] <= s[key])) return slots;
  return [...live].sort((a, b) => a[key] - b[key] || a.index - b.index).concat(slots.filter((s) => s.skipped));
}

/**
 * Playback slots for the stacked view: one per visit that has an image in the band, in visit order.
 * With `diff`, only visits that have a difference image (every visit after the band's earliest).
 */
export function stackSlots(resp, bandId, diff = false) {
  const st = resp?.stacks;
  if (!st) return [];
  const band = st.bands.find((b) => b.id === bandId) ?? st.bands[0];
  if (!band) return [];
  return st.images
    .filter((e) => e.band === band.id && (!diff || e.diff_url))
    .sort((a, b) => a.visit - b.visit)
    .map((e) => {
      const v = st.visits.find((x) => x.index === e.visit);
      return {
        stack: true, diff, url: diff ? e.diff_url : e.url, visit: e.visit, visits: st.visits.length,
        start_mjd: v.start_mjd, end_mjd: v.end_mjd, n_images: e.n_images, flag_fraction: e.flag_fraction, band,
      };
    });
}

export function bandLabel(b) {
  return `${b.id === 'all' ? 'All detectors' : b.id} (${b.wavelength_min_um.toFixed(2)}–${b.wavelength_max_um.toFixed(2)} µm)`;
}

/** Next slot to show. Playback skips failed frames; manual stepping does not. */
export function nextSlot(slots, current, dir, { skipFailed = false } = {}) {
  const n = slots.length;
  if (n === 0) return -1;
  let i = current;
  for (let k = 0; k < n; k++) {
    i = (((i + dir) % n) + n) % n;
    if (!skipFailed || !slots[i].skipped) return i;
  }
  return current;
}

/** MJD to 'YYYY-MM-DD HH:MM UTC'. MJD 40587 is 1970-01-01T00:00Z. */
export function mjdToUtc(mjd) {
  const d = new Date((mjd - 40587) * 86400000);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export function formatFlag(fraction) {
  return `${(fraction * 100).toFixed(1)} %`;
}

/** Short status line for the progress area. `elapsedS`: seconds since the request, to say how long the archive search has taken. */
export function progressText(resp, elapsedS = null) {
  const { done, total, failed, available } = resp.progress;
  if (resp.status === 'error') return 'Error';
  const fail = failed > 0 ? `, ${failed} failed` : '';
  if (resp.status === 'loading' && total === 0) {
    if (elapsedS == null) return 'Waiting for the archive query (0 / 0)';
    const s = Math.round(elapsedS);
    return elapsedS < SLOW_SEARCH_S
      ? `Asking the archive which images cover this position… ${s} s (it usually takes about a minute)`
      : `The archive is slower than usual today. Still waiting for the list of images that cover this position… ${s} s. Nothing is wrong on this page; this step is the archive's own queue.`;
  }
  if (resp.status === 'loading') return `Loading: ${done} / ${total} frames${fail}${typeof available === 'number' ? ` · ${available} images found` : ''}`;
  if (typeof available === 'number') return `${done} of ${available} images loaded${fail}`;
  return `${done} / ${total} frames${fail}`;
}

/**
 * Where to draw a frame on a canvas of its own size so the centre is magnified `zoom` times.
 * The grid centre stays at the canvas centre. Offsets are whole pixels when (zoom - 1) * size is even.
 */
export function zoomRect(width, height, zoom) {
  return { dx: ((1 - zoom) * width) / 2, dy: ((1 - zoom) * height) / 2, dw: width * zoom, dh: height * zoom };
}

/**
 * Two frames to blink against each other to show motion: far apart in time, close in wavelength.
 * Among pairs separated by at least `minBaseline` of the full time span, pick the smallest
 * wavelength difference (ties: the longer baseline). Returns slot positions [early, late] or null.
 */
export function blinkPair(slots, { minBaseline = 0.8 } = {}) {
  const live = slots.map((s, i) => ({ s, i })).filter(({ s }) => !s.skipped);
  if (live.length < 2) return null;
  const times = live.map(({ s }) => s.obs_mjd);
  const span = Math.max(...times) - Math.min(...times);
  let best = null;
  for (let a = 0; a < live.length; a++) {
    for (let b = a + 1; b < live.length; b++) {
      const dt = Math.abs(live[b].s.obs_mjd - live[a].s.obs_mjd);
      if (dt < minBaseline * span) continue;
      const dw = Math.abs(live[b].s.wavelength_um - live[a].s.wavelength_um);
      if (!best || dw < best.dw || (dw === best.dw && dt > best.dt)) {
        const [e, l] = live[a].s.obs_mjd <= live[b].s.obs_mjd ? [live[a].i, live[b].i] : [live[b].i, live[a].i];
        best = { dw, dt, pair: [e, l] };
      }
    }
  }
  return best ? best.pair : null;
}

const MAX_LABELS = 7; // at most this many wavelengths are written beside the vertical slider
const GAP_FACTOR = 3; // a step in wavelength this many times the typical step is drawn as a break
export const VISIT_GAP_DAYS = 30; // same rule as pipeline/stack.py: a longer gap between consecutive frames starts a new visit

/**
 * Visits for the individual frames: [{index, start_mjd, end_mjd}]. The response's own `stacks.visits` when
 * it has them (the finished series), otherwise grouped here from the frame dates with the pipeline's gap rule,
 * so the control also works while a series is still loading.
 */
export function visitsOf(resp, slots) {
  if (resp?.stacks?.visits?.length) return resp.stacks.visits;
  const t = slots.filter((s) => !s.skipped).map((s) => s.obs_mjd).sort((a, b) => a - b);
  const out = [];
  for (const m of t) {
    const last = out[out.length - 1];
    if (last && m - last.end_mjd <= VISIT_GAP_DAYS) last.end_mjd = m;
    else out.push({ index: out.length, start_mjd: m, end_mjd: m });
  }
  return out;
}

/** Indices 0..n-1 to label on a slider of n marks: all of them for a few, otherwise about MAX_LABELS evenly spread, ends included. */
export function labelIndexes(n) {
  if (n <= MAX_LABELS) return [...Array(n).keys()];
  return [...new Set(Array.from({ length: MAX_LABELS }, (_, k) => Math.round((k * (n - 1)) / (MAX_LABELS - 1))))];
}

/** Where the wavelength jumps much more than usual between neighbouring frames: [{after: index, y}]. Needs at least 4 frames. */
function gapsOf(points) {
  if (points.length < 4) return [];
  const d = points.slice(1).map((p, k) => Math.log(p.wl / points[k].wl));
  const typical = [...d].sort((a, b) => a - b)[Math.floor(d.length / 2)];
  const out = [];
  d.forEach((step, k) => { if (step > GAP_FACTOR * typical && step > 0.1) out.push({ after: k, y: (points[k].y + points[k + 1].y) / 2 }); });
  return out;
}

/**
 * The visit and wavelength controls for individual frames. Each frame is a point: its visit and its place
 * among that visit's frames by wavelength. The marks of the vertical slider are evenly spaced (one step per
 * frame, y from 0 at the shortest wavelength to 1 at the longest), not placed by wavelength value, so every
 * frame can be reached; the real spacing shows in the wavelengths written beside it and in `gaps`.
 * Failed frames have no position and are left out. Returns null when there are fewer than two distinct
 * wavelengths; the plain slider is used then. `visits[i].points` are sorted by wavelength.
 */
export function padSpec(slots, visits) {
  const live = [];
  slots.forEach((s, slot) => {
    if (!s.skipped && Number.isFinite(s.wavelength_um) && s.wavelength_um > 0) live.push({ slot, wl: s.wavelength_um, mjd: s.obs_mjd });
  });
  if (live.length < 2 || !(Math.max(...live.map((p) => p.wl)) > Math.min(...live.map((p) => p.wl)))) return null;
  const vs = (visits.length ? visits : [{ index: 0, start_mjd: -Infinity, end_mjd: Infinity }]).map((v) => ({ ...v, points: [] }));
  for (const p of live) {
    // inside its dates, else the nearest visit (a date can sit a little outside a visit's recorded range)
    const dist = (v) => (p.mjd < v.start_mjd ? v.start_mjd - p.mjd : p.mjd > v.end_mjd ? p.mjd - v.end_mjd : 0);
    vs.reduce((best, v) => (dist(v) < dist(best) ? v : best)).points.push({ slot: p.slot, wl: p.wl });
  }
  const used = vs.filter((v) => v.points.length);
  for (const v of used) {
    v.points.sort((a, b) => a.wl - b.wl || a.slot - b.slot);
    v.points.forEach((p, k) => { p.y = v.points.length === 1 ? 0.5 : k / (v.points.length - 1); });
    v.labels = labelIndexes(v.points.length);
    v.gaps = gapsOf(v.points);
  }
  return { visits: used };
}

/** Position of a slot in the pad: {visit (index into spec.visits), point (index into its points)} or null. */
export function padPosition(spec, slot) {
  for (let v = 0; v < spec.visits.length; v++) {
    const k = spec.visits[v].points.findIndex((p) => p.slot === slot);
    if (k >= 0) return { visit: v, point: k };
  }
  return null;
}

/** Slot in `visit` whose wavelength is closest (in log) to `wl`. */
export function nearestWavelength(visit, wl) {
  return visit.points.reduce((best, p) => (Math.abs(Math.log(p.wl / wl)) < Math.abs(Math.log(best.wl / wl)) ? p : best)).slot;
}

/** Slot in `visit` closest to the vertical position `y` (0 to 1). */
export function nearestY(visit, y) {
  return visit.points.reduce((best, p) => (Math.abs(p.y - y) < Math.abs(best.y - y) ? p : best)).slot;
}

/** Next shorter (dir -1) or longer (+1) wavelength in the same visit; stays put at the ends. */
export function stepWavelength(spec, slot, dir) {
  const at = padPosition(spec, slot);
  if (!at) return slot;
  const pts = spec.visits[at.visit].points;
  return pts[Math.min(pts.length - 1, Math.max(0, at.point + dir))].slot;
}

/** The previous (dir -1) or next (+1) visit, keeping the wavelength as nearly as it can; stays put at the ends. */
export function stepVisit(spec, slot, dir) {
  const at = padPosition(spec, slot);
  const to = at && at.visit + dir;
  if (!at || to < 0 || to >= spec.visits.length) return slot;
  return nearestWavelength(spec.visits[to], spec.visits[at.visit].points[at.point].wl);
}

/** The next visit (wrapping round) as a slot: the frame of that visit closest in wavelength to `wl`. Used to blink across visits at one wavelength. */
export function cycleVisit(spec, slot, wl) {
  const at = padPosition(spec, slot);
  if (!at) return slot;
  return nearestWavelength(spec.visits[(at.visit + 1) % spec.visits.length], wl);
}

/**
 * One step of walking through a visit's wavelengths and back: the next frame in direction `dir` (+1 longer, -1 shorter),
 * turning round at either end. Returns {slot, dir}.
 */
export function pingPong(spec, slot, dir) {
  const next = stepWavelength(spec, slot, dir);
  if (next !== slot) return { slot: next, dir };
  const back = stepWavelength(spec, slot, -dir);
  return { slot: back, dir: back === slot ? dir : -dir };
}

/**
 * RA and Dec pasted together, separated by spaces (or a comma or semicolon): ['133.79', '-7.24'], else null.
 * Only decimal degrees, the same as the boxes accept. A single value or anything else is not split.
 */
export function splitCoordinates(text) {
  const t = String(text ?? '').trim().split(/[\s,;]+/).filter(Boolean);
  return t.length === 2 && t.every((x) => x !== '' && Number.isFinite(Number(x))) ? t : null;
}

/** One plain sentence about the frame on screen. `visitText` is e.g. 'visit 2 of 3' for an individual frame, or ''. */
export function captionText(slot, visitText = '') {
  if (!slot || slot.skipped) return '';
  if (slot.stack) {
    const d = (m) => mjdToUtc(m).slice(0, 10);
    const dates = slot.end_mjd - slot.start_mjd >= 1 ? `${d(slot.start_mjd)} to ${d(slot.end_mjd)}` : d(slot.start_mjd);
    const band = `${slot.band.wavelength_min_um.toFixed(2)}–${slot.band.wavelength_max_um.toFixed(2)} µm`;
    return `Visit ${slot.visit + 1} of ${slot.visits} · ${dates} · ${slot.n_images} image${slot.n_images === 1 ? '' : 's'} combined, ${band}${slot.diff ? ' · minus the first visit' : ''}`;
  }
  return `One image · ${mjdToUtc(slot.obs_mjd)} · ${slot.wavelength_um.toFixed(3)} µm${visitText ? ` · ${visitText}` : ''}`;
}
