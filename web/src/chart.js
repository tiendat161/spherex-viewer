// Pure helpers for the Spectrum and Light curve charts: which frames have a flux, and where to draw each point. No DOM.
// Unit-tested in test/chart.test.js. The drawing itself is in main.js (renderCharts).
import { mjdToUtc } from './model.js';

// Okabe-Ito colours: told apart by people with common colour-vision differences, and readable on the dark page.
export const PALETTE = ['#56B4E9', '#E69F00', '#009E73', '#F0E442', '#CC79A7', '#D55E00', '#0072B2', '#999999'];
export const NEAR_WAVELENGTH = 0.05; // the light curve takes frames within +-5% of the wavelength (|ln(wl / wl0)|)

/** About `n` round tick values between lo and hi (steps of 1, 2 or 5 times a power of ten). */
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, n);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return out;
}

/** The time to plot for a frame: the header's mid-exposure time when the file has it, else the archive's start time. */
export const frameMjd = (f) => (typeof f.mjd_avg === 'number' ? f.mjd_avg : f.obs_mjd);

/**
 * Frames that have a flux, as points. `visitOf`: Map from frame index to visit number (0-based), for the colour.
 * {index, wl, mjd, flux, err, visit}, in the order of `frames`.
 */
export function fluxPoints(frames, visitOf = new Map()) {
  return frames
    .filter((f) => f.flux?.ok)
    .map((f) => ({ index: f.index, wl: f.wavelength_um, mjd: frameMjd(f), flux: f.flux.flux_ujy, err: f.flux.flux_err_ujy, visit: visitOf.get(f.index) ?? 0 }));
}

/** How many frames were measured, and why the others were not: {total, measured, reasons: {reason: count}}. `hasFlux` is false for a series with no flux fields at all. */
export function fluxSummary(frames) {
  const reasons = {};
  let measured = 0;
  let any = false;
  for (const f of frames) {
    if (!f.flux) continue;
    any = true;
    if (f.flux.ok) measured++;
    else reasons[f.flux.reason] = (reasons[f.flux.reason] ?? 0) + 1;
  }
  return { total: frames.length, measured, reasons, hasFlux: any };
}

/** Points within +-NEAR_WAVELENGTH (in ln) of `wl0`. */
export const pointsNear = (points, wl0, tol = NEAR_WAVELENGTH) => points.filter((p) => Math.abs(Math.log(p.wl / wl0)) <= tol);

function span(values, pad) {
  const lo = Math.min(...values), hi = Math.max(...values);
  const d = hi > lo ? hi - lo : Math.abs(hi) || 1;
  return [lo - d * pad, hi + d * pad];
}

/**
 * Where to draw `points` in a chart of `width` x `height` pixels: x from `xOf(point)`, y the flux with its error bar.
 * Returns {dots: [{...point, cx, cy, y0, y1}], xTicks: [{x, label}], yTicks: [{y, label}], zeroY: number|null, plot: {x0, y0, x1, y1}}.
 */
export function layout(points, xOf, xLabel, { width = 380, height = 280, margin = { l: 54, r: 12, t: 12, b: 38 } } = {}) {
  const plot = { x0: margin.l, y0: margin.t, x1: width - margin.r, y1: height - margin.b };
  const xs = points.map(xOf);
  const [xlo, xhi] = span(xs, 0.06);
  const [ylo, yhi] = span(points.flatMap((p) => [p.flux - p.err, p.flux + p.err]), 0.08);
  const sx = (v) => plot.x0 + ((v - xlo) / (xhi - xlo)) * (plot.x1 - plot.x0);
  const sy = (v) => plot.y1 - ((v - ylo) / (yhi - ylo)) * (plot.y1 - plot.y0);
  return {
    plot,
    dots: points.map((p) => ({ ...p, cx: sx(xOf(p)), cy: sy(p.flux), y0: sy(p.flux + p.err), y1: sy(p.flux - p.err) })),
    xTicks: niceTicks(xlo, xhi, 5).map((v) => ({ x: sx(v), label: xLabel(v) })),
    yTicks: niceTicks(ylo, yhi, 5).map((v) => ({ y: sy(v), label: String(v) })),
    zeroY: ylo < 0 && yhi > 0 ? sy(0) : null,
  };
}

/** Flux against wavelength for every measured frame. Null with no points. */
export function spectrumLayout(points, size) {
  return points.length ? layout(points, (p) => p.wl, (v) => v.toFixed(v < 10 ? 1 : 0), size) : null;
}

/** Flux against date for the frames near `wl0`. Null with fewer than two points, or all on one date. */
export function lightCurveLayout(points, wl0, size) {
  const near = pointsNear(points, wl0);
  if (near.length < 2 || new Set(near.map((p) => p.mjd)).size < 2) return null;
  return layout(near, (p) => p.mjd, (v) => mjdToUtc(v).slice(0, 10), size);
}

const REASON_WORDS = {
  aperture_flagged: 'a pixel in the aperture is flagged or invalid (bright sources saturate the detector)',
  aperture_off_image: 'the aperture is not fully on the image',
  background_too_few_pixels: 'too few clean pixels around it for a background',
  unexpected_unit: 'the image is not in the expected unit',
};

/** The reasons without counts, for when none of the frames could be measured: "a pixel in the aperture is flagged ...; ...". */
export const reasonWords = (reasons) => Object.keys(reasons).map((k) => REASON_WORDS[k] ?? k).join('; ');

/** The reasons with counts, for when some were measured: "9 frames: a pixel in the aperture is flagged ...". */
export function reasonText(reasons) {
  return Object.entries(reasons).map(([k, n]) => `${n} ${n === 1 ? 'frame' : 'frames'}: ${REASON_WORDS[k] ?? k}`).join('; ');
}
