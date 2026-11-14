import { describe, expect, it } from 'vitest';
import { buildSlots, mjdToUtc, nextSlot, parseLocation, progressText, seriesUrl } from '../src/model.js';
import { errorResponse, fixture, gapResponse, loadingResponse, validateSeries, validateTargets } from './helpers.js';

describe('hand-built responses are schema-valid', () => {
  it.each([
    ['loading (partial)', loadingResponse(12)],
    ['loading (nothing yet)', loadingResponse(0, 0)],
    ['error', errorResponse('not cached')],
    ['ready with an index gap', gapResponse()],
    ['fixture', fixture()],
  ])('%s', (_, r) => {
    expect(validateSeries(r), JSON.stringify(validateSeries.errors)).toBe(true);
  });
  it('rejects an error response without error.message (guards the helper)', () => {
    const bad = errorResponse('x'); delete bad.error;
    expect(validateSeries(bad)).toBe(false);
  });
  it('a targets response validates', () => {
    expect(validateTargets([{ id: 'a1', name: 'A', ra: 1, dec: 2, position_note: 'n' }])).toBe(true);
  });
});

describe('loading', () => {
  const r = loadingResponse(12);
  it('shows done / total', () => expect(progressText(r)).toBe('Loading: 12 / 40 frames'));
  it('shows the wait before the archive query returns', () => expect(progressText(loadingResponse(0, 0))).toContain('Waiting'));
  it('exposes the partial frames as slots', () => {
    const slots = buildSlots(r);
    expect(slots).toHaveLength(12);
    expect(slots.every((s) => !s.skipped)).toBe(true);
  });
});

describe('error', () => {
  it('has no slots and a plain status', () => {
    const r = errorResponse('Only cached targets are served');
    expect(buildSlots(r)).toEqual([]);
    expect(progressText(r)).toBe('Error');
    expect(r.error.message).toBe('Only cached targets are served');
  });
});

describe('index gap', () => {
  const slots = buildSlots(gapResponse());
  it('turns missing indices into skipped slots, including trailing ones', () => {
    expect(slots.map((s) => !!s.skipped)).toEqual([false, true, false, false, true]);
    expect(slots[1]).toEqual({ skipped: true, index: 1 });
  });
  it('reports failures in the progress text', () => expect(progressText(gapResponse())).toBe('3 / 5 frames, 2 failed'));
  it('playback jumps over skipped frames, stepping does not', () => {
    expect(nextSlot(slots, 0, 1, { skipFailed: true })).toBe(2);
    expect(nextSlot(slots, 3, 1, { skipFailed: true })).toBe(0);
    expect(nextSlot(slots, 0, 1)).toBe(1);
    expect(nextSlot(slots, 0, -1)).toBe(4);
  });
  it('a gap while loading counts as skipped only before the last present frame', () => {
    const r = { ...loadingResponse(0), frames: gapResponse().frames };
    expect(buildSlots(r).map((s) => !!s.skipped)).toEqual([false, true, false, false]);
  });
});

describe('url and dates', () => {
  it('builds the contract request', () => {
    expect(seriesUrl(133.795129, -7.245147)).toBe('/api/series?ra=133.795129&dec=-7.245147&fov=0.2&max_frames=40');
  });
  it('parses ?ra=&dec=', () => {
    expect(parseLocation('?ra=133.795129&dec=-7.245147')).toEqual({ ra: 133.795129, dec: -7.245147 });
    expect(parseLocation('')).toBeNull();
    expect(parseLocation('?ra=abc&dec=1')).toBeNull();
    expect(parseLocation('?ra=360&dec=1')).toBeNull();
    expect(parseLocation('?ra=&dec=1')).toBeNull();
  });
  it('converts MJD to UTC (MJD 40587 = 1970-01-01)', () => {
    expect(mjdToUtc(40587)).toBe('1970-01-01 00:00 UTC');
    expect(mjdToUtc(60800.5)).toBe('2025-05-05 12:00 UTC'); // checked with Python datetime(1858,11,17)+60800.5 d
  });
});
