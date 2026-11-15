import { describe, expect, it, vi } from 'vitest';
import { clientError, pollSeries, pollSpectrum } from '../src/api.js';
import { errorResponse, fixture, loadingResponse } from './helpers.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

describe('pollSeries', () => {
  it('repeats the identical GET every 2 s while loading, then stops at ready', async () => {
    const bodies = [loadingResponse(0, 0), loadingResponse(8), fixture()];
    const fetchFn = vi.fn(async () => ok(bodies.shift()));
    const sleep = vi.fn(async () => {});
    const seen = [];
    const last = await pollSeries(133.795129, -7.245147, { fetchFn, sleep, onUpdate: (r) => seen.push(r.status) });
    expect(seen).toEqual(['loading', 'loading', 'ready']);
    expect(last.status).toBe('ready');
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual(Array(3).fill('/api/series?ra=133.795129&dec=-7.245147&fov=0.2&max_frames=102'));
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 2000]);
  });
  it('passes the field of view through to the request', async () => {
    const fetchFn = vi.fn(async () => ok(fixture()));
    await pollSeries(1, 2, { fov: 0.5, fetchFn });
    expect(fetchFn.mock.calls[0][0]).toBe('/api/series?ra=1&dec=2&fov=0.5&max_frames=102');
  });
  it('stops on a server error response and does not sleep', async () => {
    const sleep = vi.fn();
    const last = await pollSeries(1, 2, { fetchFn: async () => ok(errorResponse('nope')), sleep });
    expect(last.error.message).toBe('nope');
    expect(sleep).not.toHaveBeenCalled();
  });
  it('turns HTTP and network failures into a client-side error', async () => {
    const http = await pollSeries(1, 2, { fetchFn: async () => ({ ok: false, status: 502 }) });
    expect(http.status).toBe('error');
    expect(http.error.message).not.toMatch(/502|HTTP/);
    expect(http.error.message).toContain('cached targets still work');
    expect(http.error.detail).toBe('GET /api/series returned HTTP 502');
    const net = await pollSeries(1, 2, { fetchFn: async () => { throw new TypeError('offline'); } });
    expect(net.error.message).toBe('This page could not reach the server. Check your internet connection and try again.');
    expect(net.error.detail).toContain('offline');
    const junk = await pollSeries(1, 2, { fetchFn: async () => ok({ hello: 1 }) });
    expect(junk.status).toBe('error');
  });
});

describe('pollSpectrum', () => {
  const part = (status, done) => ({ status, data_origin: 'real', progress: { done, total: 8, failed: 0 }, frames: [] });
  it('repeats the identical GET while loading and stops at ready', async () => {
    const bodies = [part('loading', 0), part('loading', 3), part('ready', 8)];
    const fetchFn = vi.fn(async () => ok(bodies.shift()));
    const sleep = vi.fn(async () => {});
    const last = await pollSpectrum(1, 2, 0.2, { ra: 1.01, dec: 2.01 }, { fetchFn, sleep });
    expect(last.status).toBe('ready');
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual(Array(3).fill('/api/spectrum?ra=1&dec=2&fov=0.2&at_ra=1.01&at_dec=2.01&load=40'));
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it('turns failures into a client-side error', async () => {
    expect((await pollSpectrum(1, 2, 0.2, { ra: 1, dec: 2 }, { fetchFn: async () => ({ ok: false, status: 500 }) })).error.detail).toContain('500');
    expect((await pollSpectrum(1, 2, 0.2, { ra: 1, dec: 2 }, { fetchFn: async () => ok({ hello: 1 }) })).status).toBe('error');
  });
});

describe('fetchCatalogue', () => {
  const ok = { status: 'ok', sources: [], catalogue: {} };
  it('returns the API document, also for an error status such as 429', async () => {
    const { fetchCatalogue } = await import('../src/api.js');
    const urls = [];
    const f = async (u) => { urls.push(u); return { status: 429, json: async () => ({ status: 'error', sources: [], error: { message: 'Too many' } }) }; };
    expect((await fetchCatalogue(1, 2, 0.2, { fetchFn: f })).error.message).toBe('Too many');
    expect(urls[0]).toBe('/api/catalogue?ra=1&dec=2&fov=0.2');
    expect((await fetchCatalogue(1, 2, 0.2, { fetchFn: async () => ({ status: 200, json: async () => ok }) })).status).toBe('ok');
  });
  it('turns a network failure or a non-document answer into an error document', async () => {
    const { fetchCatalogue } = await import('../src/api.js');
    const down = await fetchCatalogue(1, 2, 0.2, { fetchFn: async () => { throw new Error('offline'); } });
    expect(down.status).toBe('error');
    expect(down.error.detail).toContain('offline');
    const html = await fetchCatalogue(1, 2, 0.2, { fetchFn: async () => ({ status: 502, json: async () => { throw new SyntaxError('x'); } }) });
    expect(html.status).toBe('error');
  });
});

describe('error texts for a visitor (T56)', () => {
  const jargon = /HTTP|\b[45]\d\d\b|TAP|SIA|retries|fetch|JSON/i;
  it('keeps the server\'s own error document when it sends one with a 429', async () => {
    const body = { ...errorResponse('You are sending requests too fast. Wait a minute and try again.'), error: { message: 'You are sending requests too fast. Wait a minute and try again.', detail: 'per-client rate limit (HTTP 429)' } };
    const r = await pollSeries(1, 2, { fetchFn: async () => ({ ok: false, status: 429, json: async () => body }) });
    expect(r.error.message).toMatch(/too fast/);
    expect(r.error.detail).toContain('429');
  });
  it('maps each client-side kind to one plain sentence with the technical text in detail', () => {
    for (const [args, text] of [
      [{ status: 502 }, 'The server could not answer right now. Try again in a few minutes. The cached targets still work.'],
      [{ status: 429 }, 'You are sending requests too fast. Wait a minute and try again.'],
      [{ cause: new TypeError('Failed to fetch') }, 'This page could not reach the server. Check your internet connection and try again.'],
      [{ cause: { kind: 'unreadable', message: 'x' } }, 'The server sent an answer this page cannot read. Try again in a few minutes. The cached targets still work.'],
    ]) {
      const e = clientError('/api/series', args);
      expect(e.message).toBe(text);
      expect(e.message).not.toMatch(jargon);
      expect(e.detail).toContain('/api/series');
    }
  });
  it('treats a body that is not JSON as an unreadable answer, not a crash', async () => {
    const r = await pollSeries(1, 2, { fetchFn: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }) });
    expect(r.error.message).toMatch(/cannot read/);
    expect(r.error.detail).toContain('Unexpected token');
  });
});
