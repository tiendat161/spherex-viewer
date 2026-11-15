// All requests are relative /api/ paths. The browser never contacts the archive.
import { POLL_MS, isSeriesResponse, seriesUrl, spectrumUrl } from './model.js';

const sleepMs = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

export async function fetchTargets(fetchFn = fetch) {
  const res = await fetchFn('/api/targets');
  if (!res.ok) throw new Error(`GET /api/targets returned HTTP ${res.status}`);
  return res.json();
}

export const CACHED_STILL_WORK = 'The cached targets still work.';

/**
 * What a visitor reads when the request itself failed (T56): one plain sentence, no status codes; `detail` keeps the technical text
 * for the "i". `status` is the HTTP status when the server answered with one; `cause` is a network error or a parse problem.
 */
export function clientError(path, { status = null, cause = null } = {}) {
  const detail = status ? `GET ${path} returned HTTP ${status}` : `GET ${path}: ${cause?.message || 'request failed'}`;
  if (status === 429) return { message: 'You are sending requests too fast. Wait a minute and try again.', detail };
  if (status) return { message: `The server could not answer right now. Try again in a few minutes. ${CACHED_STILL_WORK}`, detail };
  if (cause && cause.kind === 'unreadable') return { message: `The server sent an answer this page cannot read. Try again in a few minutes. ${CACHED_STILL_WORK}`, detail };
  return { message: 'This page could not reach the server. Check your internet connection and try again.', detail };
}

/** The body of a non-OK reply, when the server sent one of its own error documents (for example the 429 of its per-client limit). */
async function serverErrorBody(res) {
  try {
    const body = await res.json();
    return isSeriesResponse(body) && body.status === 'error' && body.error?.message ? body : null;
  } catch {
    return null;
  }
}

function errorResponse(message, detail) {
  return {
    status: 'error',
    data_origin: null, // unknown: not a server response, so not schema-valid; UI shows UNKNOWN
    progress: { done: 0, total: 0, failed: 0 },
    grid: null,
    stretch: null,
    frames: [],
    error: detail ? { message, detail } : { message },
    clientSide: true,
  };
}

/**
 * Request the series, repeating the identical GET every POLL_MS while status is 'loading'.
 * Calls onUpdate with every parsed response. Resolves with the final one.
 * Network and HTTP failures become a client-side 'error' response.
 */
export async function pollSeries(ra, dec, { fov, load = null, fetchFn = fetch, sleep = sleepMs, onUpdate, signal, intervalMs = POLL_MS } = {}) {
  const url = seriesUrl(ra, dec, fov, load);
  for (;;) {
    let resp;
    try {
      const res = await fetchFn(url, { signal });
      if (!res.ok) {
        const own = await serverErrorBody(res);
        if (own) { resp = own; } else { const c = clientError('/api/series', { status: res.status }); resp = errorResponse(c.message, c.detail); }
      } else {
        resp = await res.json();
        if (!isSeriesResponse(resp)) throw Object.assign(new Error('Unexpected response from /api/series'), { kind: 'unreadable' });
      }
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      const c = clientError('/api/series', { cause: e?.name === 'SyntaxError' ? { kind: 'unreadable', message: e.message } : e });
      resp = errorResponse(c.message, c.detail);
    }
    onUpdate?.(resp);
    if (resp.status !== 'loading') return resp;
    await sleep(intervalMs, signal);
  }
}

/**
 * The flux at a clicked position, repeating the identical GET every POLL_MS while status is 'loading' (docs/contract.md, Spectrum endpoint).
 * Same rules as `pollSeries`; failures become a client-side 'error' response.
 */
export async function pollSpectrum(ra, dec, fov, point, { load, fetchFn = fetch, sleep = sleepMs, onUpdate, signal, intervalMs = POLL_MS } = {}) {
  const url = spectrumUrl(ra, dec, fov, point, load);
  for (;;) {
    let resp;
    try {
      const res = await fetchFn(url, { signal });
      if (!res.ok) {
        const own = await serverErrorBody(res);
        if (own) { resp = own; } else { const c = clientError('/api/spectrum', { status: res.status }); resp = { ...errorResponse(c.message, c.detail), data_origin: null }; }
      } else {
        resp = await res.json();
        if (!isSeriesResponse(resp)) throw Object.assign(new Error('Unexpected response from /api/spectrum'), { kind: 'unreadable' });
      }
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      const c = clientError('/api/spectrum', { cause: e?.name === 'SyntaxError' ? { kind: 'unreadable', message: e.message } : e });
      resp = errorResponse(c.message, c.detail);
    }
    onUpdate?.(resp);
    if (resp.status !== 'loading') return resp;
    await sleep(intervalMs, signal);
  }
}

/** AllWISE sources in the field (real catalogue data). Resolves to the API document; a network failure becomes an error document. */
export async function fetchCatalogue(ra, dec, fov, { signal, fetchFn = fetch } = {}) {
  try {
    const res = await fetchFn(`/api/catalogue?ra=${ra}&dec=${dec}&fov=${fov}`, { signal });
    const doc = await res.json();
    if (doc && (doc.status === 'ok' || doc.status === 'error') && Array.isArray(doc.sources)) return doc;
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    return { status: 'error', sources: [], error: { message: 'The WISE star catalogue could not be fetched right now. The images are not affected.', detail: `GET /api/catalogue: ${e.message}` } };
  }
}
