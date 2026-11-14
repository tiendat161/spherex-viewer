// Pure helpers: no DOM, no network. Unit-tested in test/model.test.js.

export const FOV_DEG = 0.2;
export const MAX_FRAMES = 40;
export const POLL_MS = 2000;

/** The one request for a position. Identical on every poll (docs/contract.md, Polling). */
export function seriesUrl(ra, dec) {
  const q = new URLSearchParams({
    ra: String(ra),
    dec: String(dec),
    fov: String(FOV_DEG),
    max_frames: String(MAX_FRAMES),
  });
  return `/api/series?${q}`;
}

/** Read ?ra=&dec= from a query string. Returns {ra, dec} or null. */
export function parseLocation(search) {
  const q = new URLSearchParams(search);
  if (!q.has('ra') || !q.has('dec')) return null;
  const ra = Number(q.get('ra'));
  const dec = Number(q.get('dec'));
  if (q.get('ra').trim() === '' || q.get('dec').trim() === '') return null;
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
  if (ra < 0 || ra >= 360 || dec < -90 || dec > 90) return null;
  return { ra, dec };
}

export function locationQuery(ra, dec) {
  return `?ra=${ra}&dec=${dec}`;
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
