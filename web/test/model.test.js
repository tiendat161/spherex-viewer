import { describe, expect, it } from 'vitest';
import { blinkPair, buildSlots, cycleVisit, labelIndexes, nearestWavelength, nearestY, padPosition, padSpec, stepVisit, stepWavelength, visitsOf, gridFovDeg, isWideField, locationQuery, mjdToUtc, nextSlot, parseFov, parseLocation, progressText, scaleBarArcsec, scaleBarLabel, seriesUrl, zoomRect } from '../src/model.js';
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
    expect(seriesUrl(133.795129, -7.245147)).toBe('/api/series?ra=133.795129&dec=-7.245147&fov=0.2&max_frames=102');
  });
  it('parses ?ra=&dec=', () => {
    expect(parseLocation('?ra=133.795129&dec=-7.245147')).toEqual({ ra: 133.795129, dec: -7.245147, fov: 0.2 });
    expect(parseLocation('')).toBeNull();
    expect(parseLocation('?ra=abc&dec=1')).toBeNull();
    expect(parseLocation('?ra=360&dec=1')).toBeNull();
    expect(parseLocation('?ra=&dec=1')).toBeNull();
  });
  it('field of view: request, page URL and parsing', () => {
    expect(seriesUrl(1, 2, 0.5)).toBe('/api/series?ra=1&dec=2&fov=0.5&max_frames=102');
    expect(parseLocation('?ra=1&dec=2&fov=0.5').fov).toBe(0.5);
    expect(parseLocation('?ra=1&dec=2&fov=1.0').fov).toBe(1);
    expect(parseLocation('?ra=1&dec=2&fov=0.3').fov).toBe(0.2); // not offered: default
    expect(parseLocation('?ra=1&dec=2&fov=').fov).toBe(0.2);
    expect(parseFov('abc')).toBe(0.2);
    expect(locationQuery(1, 2)).toBe('?ra=1&dec=2');
    expect(locationQuery(1, 2, 0.2)).toBe('?ra=1&dec=2');
    expect(locationQuery(1, 2, 1)).toBe('?ra=1&dec=2&fov=1');
  });
  it('scale bar grows with the field', () => {
    expect(gridFovDeg({ pixel_scale_arcsec: 6.2, shape: [290, 290] })).toBeCloseTo(0.4994, 4);
    expect([58, 116, 290, 581].map((n) => isWideField({ pixel_scale_arcsec: 6.2, shape: [n, n] }))).toEqual([false, false, true, true]);
    expect([360, 720, 1800, 3600, 180].map(scaleBarArcsec)).toEqual([60, 60, 120, 300, 60]);
    expect([60, 120, 300].map(scaleBarLabel)).toEqual(['60″', '2′', '5′']);
  });
  it('converts MJD to UTC (MJD 40587 = 1970-01-01)', () => {
    expect(mjdToUtc(40587)).toBe('1970-01-01 00:00 UTC');
    expect(mjdToUtc(60800.5)).toBe('2025-05-05 12:00 UTC'); // checked with Python datetime(1858,11,17)+60800.5 d
  });
});

describe('zoom', () => {
  it('1x draws the frame unchanged', () => expect(zoomRect(116, 116, 1)).toEqual({ dx: 0, dy: 0, dw: 116, dh: 116 }));
  it('4x keeps the grid centre at the canvas centre on whole pixels', () => {
    const z = zoomRect(116, 116, 4);
    expect(z).toEqual({ dx: -174, dy: -174, dw: 464, dh: 464 });
    expect(z.dx + 58 * 4).toBe(58); // source pixel 58 lands on canvas pixel 58
  });
});

describe('blink pair', () => {
  const f = (index, obs_mjd, wavelength_um) => ({ index, obs_mjd, wavelength_um });
  it('prefers the closest wavelengths among widely separated frames', () => {
    const slots = [f(0, 100, 2.3), f(1, 101, 1.39), { skipped: true, index: 2 }, f(3, 300, 4.4), f(4, 490, 1.37), f(5, 500, 4.3)];
    expect(blinkPair(slots)).toEqual([1, 4]);
  });
  it('never pairs frames closer than 80% of the time span', () => {
    const slots = [f(0, 100, 1.0), f(1, 110, 1.0), f(2, 500, 3.0)];
    expect(blinkPair(slots)).toEqual([0, 2]);
  });
  it('needs two usable frames', () => {
    expect(blinkPair([f(0, 100, 1.0), { skipped: true, index: 1 }])).toBeNull();
    expect(blinkPair([])).toBeNull();
  });
});

import { bandLabel, orderSlots, stackSlots } from '../src/model.js';

describe('orderSlots', () => {
  const f = (index, obs_mjd, wavelength_um) => ({ index, obs_mjd, wavelength_um, url: `/f/${index}` });
  it('leaves an already ordered series untouched, failed slots in place', () => {
    const slots = [f(0, 1, 5), { skipped: true, index: 1 }, f(2, 2, 3)];
    expect(orderSlots(slots, 'time')).toBe(slots);
  });
  it('sorts by the other key and puts failed slots last', () => {
    const slots = [f(0, 1, 5), { skipped: true, index: 1 }, f(2, 2, 3)];
    expect(orderSlots(slots, 'wavelength').map((s) => s.index)).toEqual([2, 0, 1]);
  });
  it('puts a wavelength-ordered series into time order', () => {
    const slots = [f(0, 9, 1), f(1, 3, 2), f(2, 6, 3)];
    expect(orderSlots(slots, 'time').map((s) => s.index)).toEqual([1, 2, 0]);
  });
});

describe('stackSlots', () => {
  const stretch = { kind: 'asinh', vmin: 0, vmax: 1, unit: 'MJy / sr' };
  const resp = { stacks: {
    visits: [{ index: 0, start_mjd: 60800, end_mjd: 60801 }, { index: 1, start_mjd: 60980, end_mjd: 61020 }],
    bands: [{ id: 'all', wavelength_min_um: 0.74, wavelength_max_um: 5.0, stretch, diff_limit: 0.1 }, { id: 'D6', wavelength_min_um: 4.41, wavelength_max_um: 5.0, stretch }],
    images: [
      { visit: 1, band: 'all', url: '/s1', diff_url: '/d1', n_images: 9, flag_fraction: 0 },
      { visit: 0, band: 'all', url: '/s0', n_images: 4, flag_fraction: 0.1 },
      { visit: 1, band: 'D6', url: '/s6', n_images: 2, flag_fraction: 0 },
    ] } };
  it('gives one slot per visit of the band, in visit order', () => {
    const s = stackSlots(resp, 'all');
    expect(s.map((x) => [x.url, x.visit, x.n_images, x.visits])).toEqual([['/s0', 0, 4, 2], ['/s1', 1, 9, 2]]);
    expect(s[1].start_mjd).toBe(60980);
    expect(stackSlots(resp, 'D6').map((x) => x.url)).toEqual(['/s6']);
  });
  it('difference mode keeps only visits with a difference image', () => {
    expect(stackSlots(resp, 'all', true).map((x) => x.url)).toEqual(['/d1']);
    expect(stackSlots(resp, 'D6', true)).toEqual([]);
  });
  it('falls back to the first band and tolerates no stacks', () => {
    expect(stackSlots(resp, 'nope').length).toBe(2);
    expect(stackSlots({ frames: [] }, 'all')).toEqual([]);
  });
  it('labels bands', () => {
    expect(bandLabel(resp.stacks.bands[0])).toBe('All detectors (0.74–5.00 µm)');
    expect(bandLabel(resp.stacks.bands[1])).toBe('D6 (4.41–5.00 µm)');
  });
});

describe('visits and the wavelength pad', () => {
  const f = (i, mjd, wl) => ({ index: i, obs_mjd: mjd, wavelength_um: wl, url: `/${i}.png`, flag_fraction: 0 });
  // visit A (days 100-101): 1, 2, 4 um; visit B (day 300): 1.1, 3 um; one failed frame
  const slots = [f(0, 100, 1), f(1, 100.5, 4), f(2, 101, 2), { skipped: true, index: 3 }, f(4, 300, 3), f(5, 300.1, 1.1)];
  const visits = visitsOf(null, slots);
  const spec = padSpec(slots, visits);

  it('groups frames into visits by the 30 day gap rule, or uses the response stacks.visits', () => {
    expect(visits).toEqual([{ index: 0, start_mjd: 100, end_mjd: 101 }, { index: 1, start_mjd: 300, end_mjd: 300.1 }]);
    const given = [{ index: 0, start_mjd: 0, end_mjd: 1 }];
    expect(visitsOf({ stacks: { visits: given } }, slots)).toBe(given);
  });
  it('lists each visit\'s frames by wavelength, evenly spaced, leaving out failed frames', () => {
    expect(spec.visits.map((v) => v.points.map((p) => p.slot))).toEqual([[0, 2, 1], [5, 4]]);
    expect(spec.visits[0].points.map((p) => p.y)).toEqual([0, 0.5, 1]);
    expect(spec.visits[1].points.map((p) => p.y)).toEqual([0, 1]);
    expect(spec.visits[0].labels).toEqual([0, 1, 2]); // few frames: all are labelled
  });
  it('spaces marks by rank, not by wavelength: 1, 1.1 and 4 um are equally spaced', () => {
    const s = padSpec([f(0, 1, 1), f(1, 2, 1.1), f(2, 3, 4)], []);
    expect(s.visits[0].points.map((p) => p.y)).toEqual([0, 0.5, 1]);
  });
  it('labels about seven frames of a long list, always the first and last', () => {
    expect(labelIndexes(3)).toEqual([0, 1, 2]);
    expect(labelIndexes(56)).toEqual([0, 9, 18, 28, 37, 46, 55]);
    expect(labelIndexes(8)).toEqual([0, 1, 2, 4, 5, 6, 7]);
  });
  it('marks a break where the wavelength jumps far more than usual', () => {
    const wl = [1, 1.1, 1.2, 1.3, 3, 3.1, 3.2];
    const s = padSpec(wl.map((w, i) => f(i, 100, w)), []);
    expect(s.visits[0].gaps).toEqual([{ after: 3, y: (3 / 6 + 4 / 6) / 2 }]);
    expect(padSpec([f(0, 1, 1), f(1, 1, 2), f(2, 1, 9)], []).visits[0].gaps).toEqual([]); // fewer than 4 frames
    expect(padSpec([1, 1.1, 1.2, 1.3, 1.4].map((w, i) => f(i, 1, w)), []).visits[0].gaps).toEqual([]);
  });
  it('puts a frame that is a little outside every visit into the nearest one', () => {
    const s = padSpec([f(0, 100, 1), f(1, 100, 2), f(2, 140, 3)], [{ index: 0, start_mjd: 100, end_mjd: 101 }, { index: 1, start_mjd: 200, end_mjd: 201 }]);
    expect(s.visits.map((v) => v.points.map((p) => p.slot))).toEqual([[0, 1, 2]]); // the empty visit is left out
  });
  it('finds where a slot is', () => {
    expect(padPosition(spec, 2)).toEqual({ visit: 0, point: 1 });
    expect(padPosition(spec, 4)).toEqual({ visit: 1, point: 1 });
    expect(padPosition(spec, 3)).toBeNull(); // the failed frame
  });
  it('steps through wavelengths within a visit and stops at the ends', () => {
    expect(stepWavelength(spec, 0, 1)).toBe(2);
    expect(stepWavelength(spec, 2, 1)).toBe(1);
    expect(stepWavelength(spec, 1, 1)).toBe(1);
    expect(stepWavelength(spec, 0, -1)).toBe(0);
  });
  it('changes visit keeping the nearest wavelength, and stops at the first and last visit', () => {
    expect(stepVisit(spec, 2, 1)).toBe(4); // 2 um -> 3 um (log distance 0.41) rather than 1.1 um (0.60)
    expect(stepVisit(spec, 0, 1)).toBe(5); // 1 um -> 1.1 um
    expect(stepVisit(spec, 4, -1)).toBe(1); // 3 um -> 4 um (0.29) rather than 2 um (0.41)
    expect(stepVisit(spec, 0, -1)).toBe(0);
    expect(stepVisit(spec, 4, 1)).toBe(4);
  });
  it('cycles through the visits at a held wavelength and wraps round', () => {
    expect(cycleVisit(spec, 2, 2)).toBe(4); // visit A (2 um) -> visit B: 3 um is nearer 2 than 1.1 um is
    expect(cycleVisit(spec, 4, 2)).toBe(2); // visit B -> wraps to visit A: the 2 um frame
    expect(cycleVisit(spec, 4, 1.05)).toBe(0); // the held wavelength, not the current frame, decides
    expect(cycleVisit(spec, 3, 2)).toBe(3); // a failed frame has no visit: stays put
  });
  it('nearestWavelength and nearestY pick within one visit', () => {
    expect(nearestWavelength(spec.visits[1], 1.5)).toBe(5);
    expect(nearestWavelength(spec.visits[1], 2.9)).toBe(4);
    expect(nearestY(spec.visits[0], 0.6)).toBe(2);
    expect(nearestY(spec.visits[0], 0.95)).toBe(1);
  });
  it('is null with fewer than two distinct wavelengths', () => {
    expect(padSpec([f(0, 1, 1)], [])).toBeNull();
    expect(padSpec([f(0, 1, 1), f(1, 2, 1)], [])).toBeNull();
    expect(padSpec([], [])).toBeNull();
  });
});
