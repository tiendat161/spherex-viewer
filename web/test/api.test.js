import { describe, expect, it, vi } from 'vitest';
import { pollSeries, pollSpectrum } from '../src/api.js';
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
    expect(http.error.message).toContain('502');
    const net = await pollSeries(1, 2, { fetchFn: async () => { throw new Error('offline'); } });
    expect(net.error.message).toBe('offline');
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
    expect((await pollSpectrum(1, 2, 0.2, { ra: 1, dec: 2 }, { fetchFn: async () => ({ ok: false, status: 500 }) })).error.message).toContain('500');
    expect((await pollSpectrum(1, 2, 0.2, { ra: 1, dec: 2 }, { fetchFn: async () => ok({ hello: 1 }) })).status).toBe('error');
  });
});
