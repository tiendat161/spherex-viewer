// Dev-server-only mock of the API. Applied only by `vite --mode mock` (see vite.config.js);
// it is a serve-time plugin, so it can never be part of `vite build`.
// Serves fixtures/wise0855.json (data_origin "simulated"), a targets list, and generated placeholder frames.
// MOCK_LOADING=1 makes the series answer `loading` (growing frame count) for the first few polls.
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
      : `MOCK: SIMBAD J2000 position converted to degrees, not propagated${t.propagate ? ' (the real cache propagates it to 2025.85)' : ''}. No series in the mock.`,
  };
});

const sepArcsec = (a, b) => Math.hypot((a.ra - b.ra) * Math.cos((a.dec * Math.PI) / 180), a.dec - b.dec) * 3600;

export function mockApi() {
  let polls = 0;
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
        const m = /^\/api\/frames\/placeholder\/(\d+)\.png$/.exec(url.pathname);
        if (m) return send(res, 200, 'image/png', placeholderFrame(Number(m[1])));
        if (url.pathname === '/api/series') {
          const pos = { ra: Number(url.searchParams.get('ra')), dec: Number(url.searchParams.get('dec')) };
          const c = fixture.grid.center;
          if (!(sepArcsec(pos, c) <= 1)) {
            return json(res, { status: 'error', data_origin: 'simulated', progress: { done: 0, total: 0, failed: 0 }, grid: null, stretch: null, frames: [], error: { message: 'MOCK: only the WISE 0855 series exists in this mock. The real API serves all cached targets.' } });
          }
          if (process.env.MOCK_LOADING === '1' && polls < 5) {
            const done = polls * 8;
            polls++;
            return json(res, { status: 'loading', data_origin: 'simulated', progress: { done, total: 40, failed: 0 }, grid: null, stretch: null, frames: fixture.frames.slice(0, done) });
          }
          polls = 0;
          return json(res, fixture);
        }
        next();
      });
    },
  };
}
