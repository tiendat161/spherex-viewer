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

function errorResponse(message) {
  return {
    status: 'error',
    data_origin: null, // unknown: not a server response, so not schema-valid; UI shows UNKNOWN
    progress: { done: 0, total: 0, failed: 0 },
    grid: null,
    stretch: null,
    frames: [],
    error: { message },
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
      if (!res.ok) throw new Error(`GET /api/series returned HTTP ${res.status}`);
      resp = await res.json();
      if (!isSeriesResponse(resp)) throw new Error('Unexpected response from /api/series');
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      resp = errorResponse(e?.message || 'Request failed');
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
      if (!res.ok) throw new Error(`GET /api/spectrum returned HTTP ${res.status}`);
      resp = await res.json();
      if (!isSeriesResponse(resp)) throw new Error('Unexpected response from /api/spectrum');
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      resp = { status: 'error', data_origin: null, progress: { done: 0, total: 0, failed: 0 }, frames: [], error: { message: e?.message || 'Request failed' }, clientSide: true };
    }
    onUpdate?.(resp);
    if (resp.status !== 'loading') return resp;
    await sleep(intervalMs, signal);
  }
}
