import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false });
export const validateSeries = ajv.compile(read('contracts/series.schema.json'));
export const validateTargets = new Ajv2020({ strict: false }).compile(read('contracts/targets.schema.json'));
export const fixture = () => read('fixtures/wise0855.json');

/** Hand-built responses. Each is checked against the schema in the tests, so they cannot drift from the contract. */
const frame = (index) => ({ index, obs_mjd: 60800 + index, wavelength_um: 1 + index / 10, url: `/api/frames/t/${index}.png`, flag_fraction: 0.05 });
export const loadingResponse = (done, total = 40) => ({
  status: 'loading', data_origin: 'simulated', progress: { done, total, failed: 0 }, grid: null, stretch: null,
  frames: Array.from({ length: done }, (_, i) => frame(i)),
});
export const errorResponse = (message) => ({
  status: 'error', data_origin: 'simulated', progress: { done: 0, total: 0, failed: 0 }, grid: null, stretch: null, frames: [], error: { message },
});
export const gapResponse = () => ({
  status: 'ready', data_origin: 'simulated', progress: { done: 3, total: 5, failed: 2 },
  grid: { center: { ra: 10, dec: 20 }, pixel_scale_arcsec: 6.2, shape: [116, 116] },
  stretch: { kind: 'asinh', vmin: 0, vmax: 1, unit: 'test' },
  frames: [frame(0), frame(2), frame(3)], // indices 1 and 4 failed
});
