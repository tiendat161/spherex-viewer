// Sky backdrop (T50): a dimmed Aladin Lite view of a survey from another telescope behind the page.
// It is decoration only: nothing here is SPHEREx data, and if anything fails the page works as before.
// Aladin Lite is loaded from a CDN at run time (not bundled; a CDN script keeps the build small and lets the page work
// unchanged when it cannot be reached), pinned to an exact release so a new upstream release cannot change the page.
// 3.8.2 is a stable release from 2026-03-06 (npm registry time stamp), well over two weeks old.
export const ALADIN_URL = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js';
export const SURVEY_NAME = 'DSS2 colour (optical)';
// HiPS roots of the same survey, tried in order: the CDS server, then the STScI (MAST) copy, then the CSIRO copy.
// Found in the survey's HiPS record (CDS MocServer, ID CDS/P/DSS2/color, 2026-11-15). The CDS server was returning an
// error page for this survey on that day, so the first one that answers is used and the backdrop is skipped if none does.
export const SURVEY_ROOTS = [
  'https://alasky.cds.unistra.fr/DSS/DSSColor',
  'https://stpubdata.s3.us-east-1.amazonaws.com/mast/skybackgrounds/DSSColor',
  'https://casda.csiro.au/hips/DSS2/color',
];
export const MIN_WIDTH_PX = 900;
const LOAD_TIMEOUT_MS = 10000;
const WIDE_FOV_DEG = 150;
const FLY_S = 2.5;

/** Width of the backdrop when the SPHEREx field is `fov` degrees wide: 1 degree for the small fields, 1.5x the field for 0.5 and 1 degree. */
export function backdropFov(fov) {
  return fov >= 0.5 ? 1.5 * fov : 1;
}

/** Off for automated browsers (tests) unless ?backdrop=on, off with ?backdrop=off, off on narrow screens, off without WebGL. */
export function backdropEnabled(win = window) {
  try {
    const flag = new URLSearchParams(win.location.search).get('backdrop');
    if (flag === 'off') return false;
    if (flag !== 'on' && win.navigator.webdriver) return false;
    if (!win.matchMedia(`(min-width:${MIN_WIDTH_PX}px)`).matches) return false;
    const c = win.document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

let starting = null; // promise of the aladin object, or null when it failed or is not wanted
let gaveUp = false;

// dist/aladin.js is an ES module whose default export is the Aladin Lite object `A`.
function loadAladin() {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS));
  return Promise.race([import(/* @vite-ignore */ ALADIN_URL).then((m) => m.default), timeout]);
}

async function findSurvey() {
  for (const root of SURVEY_ROOTS) {
    try {
      const r = await fetch(`${root}/properties`, { signal: AbortSignal.timeout(6000) });
      if (r.ok && (await r.text()).includes('hips_')) return root;
    } catch { /* try the next one */ }
  }
  throw new Error('no survey');
}

async function start(ra, dec) {
  const [A, root] = await Promise.all([loadAladin(), findSurvey()]);
  await A.init;
  const box = document.getElementById('sky');
  // Start wide and off to the side so the first Load visibly flies in.
  const a = A.aladin(box, {
    survey: root, fov: WIDE_FOV_DEG, target: `${(ra + 50) % 360} ${Math.max(-85, Math.min(85, dec))}`,
    cooFrame: 'ICRSd', projection: 'TAN', reticleSize: 0,
    showReticle: false, showZoomControl: false, showFullscreenControl: false, showLayersControl: false,
    showGotoControl: false, showSimbadPointerControl: false, showCooGridControl: false, showFrame: false,
    showProjectionControl: false, showContextMenu: false, showShareControl: false, showSettingsControl: false,
    showStatusBar: false, showCatalogue: false, showCooLocation: false, showFov: false,
    showFullscreen: false, showCooGrid: false,
  });
  return a;
}

function giveUp() {
  gaveUp = true;
  document.body.classList.remove('sky-on');
}

/** Fly the backdrop to the position. Never throws; the first call starts Aladin Lite. */
export function showSky(ra, dec, fov, { reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
  if (gaveUp || !backdropEnabled()) return;
  try {
    if (!starting) {
      starting = start(ra, dec).then((a) => { document.body.classList.add('sky-on'); return a; }).catch(() => { giveUp(); return null; });
    }
    starting.then((a) => {
      if (!a) return;
      try {
        const w = backdropFov(fov);
        if (reduceMotion) { a.gotoRaDec(ra, dec); a.setFoV(w); return; }
        a.animateToRaDec(ra, dec, FLY_S);
        a.zoomToFoV(w, FLY_S);
      } catch { giveUp(); }
    });
  } catch { giveUp(); }
}
