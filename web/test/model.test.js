import { describe, expect, it } from 'vitest';
import { pixelToSky, clickToImage, imageToBox, spectrumUrl, parseAngle, isCachedPosition, loadPlan, loadTimeText, sepArcsec, captionText, splitCoordinates, blinkPair, buildSlots, cycleVisit, pingPong, labelIndexes, nearestWavelength, nearestY, padPosition, padSpec, stepVisit, stepWavelength, visitsOf, gridFovDeg, isWideField, locationQuery, mjdToUtc, nextSlot, parseFov, parseLocation, progressText, PARTIAL_LIST_NOTE, scaleBarArcsec, scaleBarLabel, seriesUrl, zoomRect } from '../src/model.js';
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
  it('says when a backup search gave the list', () => {
    const b = loadingResponse(12, 40); b.progress.search = 'sia2';
    expect(progressText(b)).toBe('Loading: 12 / 40 frames' + PARTIAL_LIST_NOTE);
    b.progress.search = 'tap';
    expect(progressText(b)).toBe('Loading: 12 / 40 frames');
  });
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
  it('walks up a visit\'s wavelengths and back down, turning round at the ends', () => {
    // visit A is slots 0, 2, 1 from the shortest to the longest wavelength
    let at = { slot: 0, dir: 1 }; const seen = [];
    for (let i = 0; i < 6; i++) { at = pingPong(spec, at.slot, at.dir); seen.push(at.slot); }
    expect(seen).toEqual([2, 1, 2, 0, 2, 1]);
    expect(pingPong(padSpec([f(0, 1, 1), f(1, 1, 2)], []), 0, -1)).toEqual({ slot: 1, dir: 1 }); // turns round at the start
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

describe('splitCoordinates: RA and Dec pasted together', () => {
  it.each([
    ['133.795129 -7.245147', ['133.795129', '-7.245147']],
    ['  133.795129   -7.245147  ', ['133.795129', '-7.245147']],
    ['133.795129,-7.245147', ['133.795129', '-7.245147']],
    ['133.795129, -7.245147', ['133.795129', '-7.245147']],
    ['133.795129\t-7.245147', ['133.795129', '-7.245147']],
  ])('%j', (text, out) => expect(splitCoordinates(text)).toEqual(out));
  it.each(['133.795129', '', '   ', '1 2 3', 'abc def', '133.7 north', '08h55m10.8s', '400 10', '10 95'])('does not split %j', (text) => {
    expect(splitCoordinates(text)).toBeNull();
  });
  it('is null for missing text', () => expect(splitCoordinates(undefined)).toBeNull());
});

describe('captionText', () => {
  const frame = { obs_mjd: 60800.5, wavelength_um: 1.2346, skipped: false };
  const stack = { stack: true, visit: 1, visits: 3, start_mjd: 60980, end_mjd: 61022, n_images: 56, band: { wavelength_min_um: 0.74, wavelength_max_um: 5 } };
  it('describes one image with its date, wavelength and visit', () => {
    expect(captionText(frame, 'visit 2 of 3')).toBe(`One image · ${mjdToUtc(60800.5)} · 1.235 µm · visit 2 of 3`);
    expect(captionText(frame)).not.toContain('visit');
  });
  it('describes a stack by visit, dates, how many images and the band', () => {
    expect(captionText(stack)).toBe(`Visit 2 of 3 · ${mjdToUtc(60980).slice(0, 10)} to ${mjdToUtc(61022).slice(0, 10)} · 56 images combined, 0.74–5.00 µm`);
    expect(captionText({ ...stack, diff: true, n_images: 1, end_mjd: 60980.2 })).toContain('1 image combined');
    expect(captionText({ ...stack, diff: true })).toContain('minus the first visit');
  });
  it('is empty without a frame, or for a failed one', () => {
    expect(captionText(undefined)).toBe('');
    expect(captionText({ skipped: true, index: 3 })).toBe('');
  });
});

describe('staged loading helpers', () => {
  const resp = (p, status = 'ready') => ({ status, progress: { done: p.total, failed: 0, ...p } });
  it('seriesUrl adds load only when given', () => {
    expect(seriesUrl(1, 2, 0.2)).toBe('/api/series?ra=1&dec=2&fov=0.2&max_frames=102');
    expect(seriesUrl(1, 2, 0.2, 8)).toBe('/api/series?ra=1&dec=2&fov=0.2&max_frames=102&load=8');
  });
  it('sepArcsec and isCachedPosition: within 1 arcsec at the cached field of view', () => {
    expect(sepArcsec({ ra: 10, dec: 20 }, { ra: 10, dec: 20 + 1 / 3600 })).toBeCloseTo(1, 3);
    const targets = [{ ra: 133.795129, dec: -7.245147 }];
    expect(isCachedPosition(targets, 133.795129, -7.245147, 0.2)).toBe(true);
    expect(isCachedPosition(targets, 133.795129 + 0.5 / 3600, -7.245147, 0.2)).toBe(true);
    expect(isCachedPosition(targets, 133.795129 + 3 / 3600, -7.245147, 0.2)).toBe(false);
    expect(isCachedPosition(targets, 133.795129, -7.245147, 0.5)).toBe(false); // the cache holds 0.2 only
  });
  it('says how long loading more takes, in words', () => {
    expect(loadTimeText(16)).toBe('under a minute');
    expect(loadTimeText(62)).toBe('about 2 min');
    expect(loadTimeText(94)).toBe('about 3 min');
  });
  it('plans what can still be loaded', () => {
    expect(loadPlan(resp({ total: 8, available: 269 }))).toEqual({ have: 8, available: 269, more: 24, all: 102, allIsCapped: true });
    expect(loadPlan(resp({ total: 8, available: 20 }))).toEqual({ have: 8, available: 20, more: 20, all: null, allIsCapped: false }); // one step reaches them all
    expect(loadPlan(resp({ total: 90, available: 269 }))).toEqual({ have: 90, available: 269, more: 102, all: null, allIsCapped: true });
    expect(loadPlan(resp({ total: 102, available: 269 }))).toBeNull(); // at the ceiling
    expect(loadPlan(resp({ total: 40, available: 40 }))).toBeNull();   // everything is in
    expect(loadPlan(resp({ total: 40 }))).toBeNull();                 // a cached series has no `available`
    expect(loadPlan(resp({ total: 8, available: 269 }, 'loading'))).toBeNull();
    expect(loadPlan(null)).toBeNull();
  });
  it('progressText: the archive search with elapsed time, images found, images loaded', () => {
    expect(progressText(loadingResponse(0, 0), 12.4)).toContain('12 s');
    expect(progressText(loadingResponse(0, 0), 12.4)).toContain('Asking the archive');
    expect(progressText(loadingResponse(0, 0), 89)).toContain('usually under a few minutes');
    expect(progressText(loadingResponse(0, 0), 150)).toContain('slower than usual');
    expect(progressText(loadingResponse(0, 0), 150)).toContain('150 s');
    const found = { status: 'loading', progress: { done: 3, total: 8, failed: 0, available: 269 } };
    expect(progressText(found)).toBe('Loading: 3 / 8 frames · 269 images found');
    expect(progressText(resp({ total: 8, available: 269 }))).toBe('8 of 269 images loaded');
    expect(progressText({ status: 'ready', progress: { done: 7, total: 8, failed: 1, available: 269 } })).toBe('7 of 269 images loaded, 1 failed');
  });
});

describe('parseAngle: decimal or sexagesimal', () => {
  const close = (a, b) => expect(a).toBeCloseTo(b, 6);
  it('the challenge text coordinates of WISE 0855 are the cached degrees', () => {
    close(parseAngle('08h55m10.831s', 'ra'), 133.795129);
    close(parseAngle('-7d14m42.53s', 'dec'), -7.245147);
    close(parseAngle('08 55 10.831', 'ra'), 133.795129);
    close(parseAngle('-07:14:42.53', 'dec'), -7.245147);
    close(parseAngle('8h 55m 10.831s', 'ra'), 133.795129);
    close(parseAngle('-07\u00B014\u203242.53\u2033', 'dec'), -7.245147);
  });
  it('decimal degrees as before, and plus or minus signs', () => {
    expect(parseAngle('133.795129', 'ra')).toBe(133.795129);
    expect(parseAngle('-7.5', 'dec')).toBe(-7.5);
    expect(parseAngle('+4 41 36.11', 'dec')).toBeCloseTo(4.693364, 5);
    expect(parseAngle('-0d30m', 'dec')).toBeCloseTo(-0.5, 9); // minus on a zero degree part still counts
  });
  it('a unit letter decides hours or degrees', () => {
    expect(parseAngle('6h', 'ra')).toBe(90);
    expect(parseAngle('90d', 'ra')).toBe(90);
    expect(parseAngle('1h30m', 'ra')).toBeCloseTo(22.5, 9);
  });
  it.each([
    ['360', 'ra'], ['-1', 'ra'], ['24h', 'ra'], ['91', 'dec'], ['-90d1m', 'dec'], ['8h60m', 'ra'], ['8h5m60s', 'ra'],
    ['', 'ra'], ['abc', 'ra'], ['8h55m10s extra', 'ra'], ['1:2:3:4', 'ra'], ['NaN', 'dec'],
  ])('refuses %j as %s', (text, kind) => expect(parseAngle(text, kind)).toBeNull());
  it('splits a pasted pair of sexagesimal values', () => {
    expect(splitCoordinates('08h55m10.831s -7d14m42.53s')).toEqual(['08h55m10.831s', '-7d14m42.53s']);
    expect(splitCoordinates('08:55:10.831 -07:14:42.53')).toEqual(['08:55:10.831', '-07:14:42.53']);
    expect(splitCoordinates('08 55 10.831 -07 14 42.53')).toEqual(['08 55 10.831', '-07 14 42.53']);
    expect(splitCoordinates('08h 55m 10.831s -7d 14m 42.53s')).toEqual(['08h 55m 10.831s', '-7d 14m 42.53s']);
    expect(splitCoordinates('133.795129 -7d14m42.53s')).toEqual(['133.795129', '-7d14m42.53s']); // mixed is fine
  });
});

describe('clicked position (T14)', () => {
  // Reference values: the grid WCS of pipeline/grid.py (astropy TAN) at the same pixels.
  const grid = (ra, dec) => ({ center: { ra, dec }, pixel_scale_arcsec: 6.2, shape: [116, 116] });
  it.each([
    [133.795129, -7.245147, 0.25, 0.75, 133.84548099566945, -7.295088645127735],
    [133.795129, -7.245147, 0.9, 0.1, 133.714589047665, -7.165228935183362],
    [10.0, 80.0, 0.8, 0.3, 9.653491489557501, 80.03977705022034],
  ])('pixelToSky matches the grid projection (%s, %s, %s, %s)', (ra, dec, fx, fy, wantRa, wantDec) => {
    const p = pixelToSky(grid(ra, dec), fx, fy);
    expect(p.ra).toBeCloseTo(wantRa, 7);
    expect(p.dec).toBeCloseTo(wantDec, 7);
  });
  it('the image centre is the grid centre; east is left and north is up', () => {
    const g = grid(200, 30);
    expect(pixelToSky(g, 0.5, 0.5)).toEqual({ ra: 200, dec: 30 });
    expect(pixelToSky(g, 0.2, 0.5).ra).toBeGreaterThan(200);
    expect(pixelToSky(g, 0.5, 0.2).dec).toBeGreaterThan(30);
  });
  it('keeps the right ascension in 0 to 360 across the wrap', () => {
    const p = pixelToSky(grid(0.001, 0), 0.0, 0.5);
    expect(p.ra).toBeGreaterThan(0);
    expect(p.ra).toBeLessThan(0.2);
    expect(pixelToSky(grid(0.001, 0), 1.0, 0.5).ra).toBeGreaterThan(359.9);
  });
  it('clickToImage undoes the centred zoom and imageToBox is its inverse', () => {
    expect(clickToImage(0.5, 0.5, 4)).toEqual({ fx: 0.5, fy: 0.5 });
    expect(clickToImage(0.75, 0.25, 2)).toEqual({ fx: 0.625, fy: 0.375 });
    const { fx, fy } = clickToImage(0.9, 0.2, 2.5);
    const b = imageToBox(fx, fy, 2.5);
    expect(b.u).toBeCloseTo(0.9, 12);
    expect(b.v).toBeCloseTo(0.2, 12);
  });
  it('spectrumUrl names the series position and the clicked one', () => {
    expect(spectrumUrl(1, 2, 0.2, { ra: 1.01, dec: 2.02 })).toBe('/api/spectrum?ra=1&dec=2&fov=0.2&at_ra=1.01&at_dec=2.02&load=40');
    expect(spectrumUrl(1, 2, 0.5, { ra: 1.01, dec: 2.02 }, 8)).toContain('load=8');
  });
});

describe('skyToPixel', () => {
  const grid = { center: { ra: 133.795, dec: -7.245 }, pixel_scale_arcsec: 6.2, shape: [116, 116] };
  it('is the inverse of pixelToSky', async () => {
    const { pixelToSky, skyToPixel } = await import('../src/model.js');
    for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.9], [0.8, 0.2]]) {
      const { ra, dec } = pixelToSky(grid, fx, fy);
      const p = skyToPixel(grid, ra, dec);
      expect(p.fx).toBeCloseTo(fx, 9);
      expect(p.fy).toBeCloseTo(fy, 9);
    }
  });
  it('is null on the far side of the sky', async () => {
    const { skyToPixel } = await import('../src/model.js');
    expect(skyToPixel(grid, 313.795, 7.245)).toBeNull();
  });
});

describe('medianMjd', () => {
  it('takes the median of the finite values and ignores the rest', async () => {
    const { medianMjd } = await import('../src/model.js');
    expect(medianMjd([{ mjd: 3 }, { mjd: null }, { mjd: 1 }, { mjd: 2 }])).toBe(2);
    expect(medianMjd([{ mjd: null }])).toBeNull();
    expect(medianMjd([])).toBeNull();
  });
});
