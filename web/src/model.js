// Pure helpers: no DOM, no network. Unit-tested in test/model.test.js.

export const FOVS_DEG = [0.1, 0.2, 0.5, 1]; // the field widths the API accepts (docs/contract.md)
export const FOV_DEG = 0.2; // default, and the only size in the static cache
export const WIDE_FOV_DEG = 0.5; // from here on the UI says the wavelength is exact at the centre only
export const MAX_FRAMES = 102; // ceiling the API accepts; each cached series has its own frame count
export const POLL_MS = 2000;

/** The one request for a position. Identical on every poll (docs/contract.md, Polling). */
export function seriesUrl(ra, dec, fov = FOV_DEG) {
  const q = new URLSearchParams({
    ra: String(ra),
    dec: String(dec),
    fov: String(fov),
    max_frames: String(MAX_FRAMES),
  });
  return `/api/series?${q}`;
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

/** Short status line for the progress area. */
export function progressText(resp) {
  const { done, total, failed } = resp.progress;
  if (resp.status === 'error') return 'Error';
  const base = total === 0 ? 'Waiting for the archive query (0 / 0)' : `${done} / ${total} frames`;
  const fail = failed > 0 ? `, ${failed} failed` : '';
  if (resp.status === 'loading') return `Loading: ${base}${fail}`;
  return `${base}${fail}`;
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
