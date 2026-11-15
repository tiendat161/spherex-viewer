// Dev-server-only mock of the API. Applied only by `vite --mode mock` (see vite.config.js);
// it is a serve-time plugin, so it can never be part of `vite build`.
// Serves fixtures/wise0855.json (data_origin "simulated"), a targets list, and generated placeholder frames.
// MOCK_LOADING=1 makes the series answer `loading` (growing frame count) for the first few polls.
// A position with a `load` parameter that is not WISE 0855 or Barnard's Star stands in for a live position (T40): the first poll answers
// `loading` with 0 frames (the archive search), then the first `load` fixture frames (at most 40) with `progress.available` 40, all SIMULATED.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { placeholderFrame } from './png.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = JSON.parse(readFileSync(root + 'fixtures/wise0855.json', 'utf8'));
const source = JSON.parse(readFileSync(root + 'verify/targets.json', 'utf8'));

const hms = (s, hours) => {
  const m = /^([+-]?)(\d+) (\d+) ([\d.]+)$/.exec(s.trim());
  const v = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600;
  return (m[1] === '-' ? -1 : 1) * v * (hours ? 15 : 1);
};

// ICRS J2000 degrees converted from the source positions. NOT propagated to 2025.85: the real
// pipeline does that. Only the first target has a series in this mock.
const targets = source.targets.map((t) => {
  const given = !t.position.ra_hms;
  const ra = given ? t.position.ra_deg : hms(t.position.ra_hms, true);
  const dec = given ? t.position.dec_deg : hms(t.position.dec_dms, false);
  return {
    id: t.id,
    name: t.name,
    ra: Number(ra.toFixed(6)),
    dec: Number(dec.toFixed(6)),
    position_note: given
      ? `MOCK. ${t.position_source}`
      : `MOCK: SIMBAD J2000 position converted to degrees, not propagated${t.propagate ? ' (the real cache propagates it to 2025.85)' : ''}.${t.id === 'barnard' ? ' The mock series is SIMULATED: WISE 0855 fixture metadata on placeholder frames.' : ' No series in the mock.'}`,
  };
});

// SIMULATED: the same fixture at another field of view, i.e. placeholder frames of the matching grid size.
const fovs = [0.1, 0.2, 0.5, 1];
const sizes = fovs.map((f) => Math.round((f * 3600) / 6.2));
const sized = (doc, fov) => {
  if (fov === 0.2) return doc;
  const n = Math.round((fov * 3600) / 6.2);
  return { ...doc, grid: { ...doc.grid, shape: [n, n] }, frames: doc.frames.map((f) => ({ ...f, url: `${f.url}?n=${n}` })) };
};

const sepArcsec = (a, b) => Math.hypot((a.ra - b.ra) * Math.cos((a.dec * Math.PI) / 180), a.dec - b.dec) * 3600;

export function mockApi() {
  let polls = 0;
  const searched = new Set(); // staged positions that have answered their first poll
  const send = (res, code, type, body) => {
    res.statusCode = code;
    res.setHeader('content-type', type);
    res.end(body);
  };
  const json = (res, obj) => send(res, 200, 'application/json', JSON.stringify(obj));
  return {
    name: 'spherex-mock-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://x');
        if (url.pathname === '/api/targets') return json(res, targets);
        const m = /^\/api\/frames\/placeholder\/(?:(barnard)\/)?(\d+)\.png$/.exec(url.pathname);
        if (m) {
          const n = sizes.includes(Number(url.searchParams.get('n'))) ? Number(url.searchParams.get('n')) : 116;
          return send(res, 200, 'image/png', placeholderFrame(Number(m[2]) + (m[1] ? 1000 : 0), n, n));
        }
        if (url.pathname === '/api/series') {
          const pos = { ra: Number(url.searchParams.get('ra')), dec: Number(url.searchParams.get('dec')) };
          const barnard = targets.find((t) => t.id === 'barnard');
          const isBarnard = sepArcsec(pos, barnard) <= 1;
          const c = fixture.grid.center;
          const load = Number(url.searchParams.get('load') ?? 0);
          if (!isBarnard && !(sepArcsec(pos, c) <= 1) && load > 0) {
            const key = `${pos.ra},${pos.dec}`;
            if (!searched.has(key)) {
              searched.add(key);
              return json(res, { status: 'loading', data_origin: 'simulated', progress: { done: 0, total: 0, failed: 0 }, grid: null, stretch: null, frames: [] });
            }
            const n = Math.min(load, fixture.frames.length);
            const fov = Number(url.searchParams.get('fov') ?? 0.2);
            return json(res, sized({ ...fixture, progress: { done: n, total: n, failed: 0, available: fixture.frames.length }, grid: { ...fixture.grid, center: { ra: pos.ra, dec: pos.dec } }, frames: fixture.frames.slice(0, n) }, fov));
          }
          if (!isBarnard && !(sepArcsec(pos, c) <= 1)) {
            return json(res, { status: 'error', data_origin: 'simulated', progress: { done: 0, total: 0, failed: 0 }, grid: null, stretch: null, frames: [], error: { message: 'MOCK: only WISE 0855 and Barnard Star have (simulated) series in this mock. The real API serves all cached targets.' } });
          }
          const fov = Number(url.searchParams.get('fov') ?? 0.2);
          if (!fovs.includes(fov)) return json(res, { status: 'error', data_origin: 'simulated', progress: { done: 0, total: 0, failed: 0 }, grid: null, stretch: null, frames: [], error: { message: 'MOCK: fov must be one of 0.1, 0.2, 0.5, 1.' } });
          if (process.env.MOCK_LOADING === '1' && polls < 5) {
            const done = polls * 8;
            polls++;
            return json(res, { status: 'loading', data_origin: 'simulated', progress: { done, total: 40, failed: 0 }, grid: null, stretch: null, frames: fixture.frames.slice(0, done) });
          }
          polls = 0;
          if (isBarnard) {
            // SIMULATED: fixture metadata (WISE 0855 times, placeholder wavelengths/flags) re-centred on Barnard's mock position.
            return json(res, sized({ ...fixture, grid: { ...fixture.grid, center: { ra: barnard.ra, dec: barnard.dec } }, frames: fixture.frames.map((f) => ({ ...f, url: f.url.replace('/placeholder/', '/placeholder/barnard/') })) }, fov));
          }
          return json(res, sized(fixture, fov));
        }
        next();
      });
    },
  };
}
