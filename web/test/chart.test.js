import { describe, expect, it } from 'vitest';
import { fluxPoints, fluxSummary, frameMjd, lightCurveLayout, niceTicks, pointsNear, reasonText, reasonWords, spectrumLayout } from '../src/chart.js';

const f = (index, wl, mjd, flux, err = 1, extra = {}) => ({ index, wavelength_um: wl, obs_mjd: mjd, flux: flux === null ? { ok: false, reason: 'aperture_flagged' } : { ok: true, flux_ujy: flux, flux_err_ujy: err }, ...extra });

describe('niceTicks', () => {
  it('gives round values inside the range', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0.74, 5.0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(niceTicks(-3, 7, 5)).toEqual([-2, 0, 2, 4, 6]);
    expect(niceTicks(60800, 61200, 4)).toEqual([60800, 60900, 61000, 61100, 61200]);
  });
  it('copes with an empty range', () => expect(niceTicks(5, 5)).toEqual([5]));
});

describe('fluxPoints and fluxSummary', () => {
  const frames = [f(0, 1, 100, 10, 1, { mjd_avg: 100.5 }), f(1, 2, 101, null), f(2, 3, 102, -2, 0.5), { index: 3, wavelength_um: 4, obs_mjd: 103 }];
  it('keeps the frames that have a flux, with the header time when there is one', () => {
    const p = fluxPoints(frames, new Map([[0, 1], [2, 2]]));
    expect(p).toEqual([
      { index: 0, wl: 1, mjd: 100.5, flux: 10, err: 1, visit: 1 },
      { index: 2, wl: 3, mjd: 102, flux: -2, err: 0.5, visit: 2 }, // a negative flux is a measurement, not a missing one
    ]);
    expect(frameMjd(frames[0])).toBe(100.5);
    expect(frameMjd(frames[2])).toBe(102);
  });
  it('counts what was measured and why not', () => {
    expect(fluxSummary(frames)).toEqual({ total: 4, measured: 2, reasons: { aperture_flagged: 1 }, hasFlux: true });
    expect(fluxSummary([{ index: 0 }]).hasFlux).toBe(false); // an older file with no flux fields
  });
  it('says why in words', () => {
    expect(reasonText({ aperture_flagged: 9 })).toContain('9 frames: a pixel in the aperture is flagged');
    expect(reasonText({ aperture_flagged: 1, aperture_off_image: 2 })).toContain('1 frame:');
    expect(reasonWords({ aperture_flagged: 38 })).toBe('a pixel in the aperture is flagged or invalid (bright sources saturate the detector)'); // no count when all are the same
  });
});

describe('layouts', () => {
  const pts = fluxPoints([f(0, 1, 100, 10, 2), f(1, 2, 200, 30, 2), f(2, 4, 300, 20, 2), f(3, 2.05, 101, 28, 2)]);
  it('spectrum: one dot per point, wavelength rightwards and flux upwards, error bars around each', () => {
    const l = spectrumLayout(pts, { width: 400, height: 300 });
    expect(l.dots).toHaveLength(4);
    const [a, b, c] = l.dots;
    expect(a.cx).toBeLessThan(b.cx);
    expect(b.cx).toBeLessThan(c.cx);
    expect(b.cy).toBeLessThan(c.cy); // 30 is above 20 on the screen (smaller y)
    expect(b.y0).toBeLessThan(b.cy);
    expect(b.y1).toBeGreaterThan(b.cy);
    for (const d of l.dots) {
      expect(d.cx).toBeGreaterThanOrEqual(l.plot.x0);
      expect(d.cx).toBeLessThanOrEqual(l.plot.x1);
      expect(d.cy).toBeGreaterThanOrEqual(l.plot.y0);
      expect(d.cy).toBeLessThanOrEqual(l.plot.y1);
    }
    expect(l.xTicks.length).toBeGreaterThan(1);
    expect(l.zeroY).toBeNull(); // all flux is positive, so no zero line
    expect(spectrumLayout([])).toBeNull();
  });
  it('a zero line appears when the data crosses zero', () => {
    const l = spectrumLayout(fluxPoints([f(0, 1, 1, -5, 1), f(1, 2, 2, 5, 1)]));
    expect(l.zeroY).not.toBeNull();
  });
  it('light curve: the frames near one wavelength, by date; null without two dates', () => {
    expect(pointsNear(pts, 2).map((p) => p.index)).toEqual([1, 3]); // 2.0 and 2.05 um are within 5%; 1 and 4 are not
    const l = lightCurveLayout(pts, 2);
    expect(l.dots.map((d) => d.index)).toEqual([1, 3]);
    expect(l.dots[0].cx).toBeGreaterThan(l.dots[1].cx); // frame 1 is later than frame 3
    expect(l.xTicks[0].label).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(lightCurveLayout(pts, 1)).toBeNull(); // only one frame near 1 um
    expect(lightCurveLayout(fluxPoints([f(0, 2, 100, 1), f(1, 2, 100, 2)]), 2)).toBeNull(); // both on the same date
  });
});
