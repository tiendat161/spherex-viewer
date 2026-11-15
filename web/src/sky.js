// Sky backdrop (T50): a dimmed Aladin Lite view of a survey from another telescope behind the page.
// It is decoration only: nothing here is SPHEREx data, and if anything fails the page works as before.
// Aladin Lite is loaded from a CDN at run time (not bundled; a CDN script keeps the build small and lets the page work
// unchanged when it cannot be reached), pinned to an exact release so a new upstream release cannot change the page.
// 3.8.2 is a stable release from 2026-03-06 (npm registry time stamp), well over two weeks old.
// SHA-384 of that exact file (computed from the 3.8.2 file on 2026-11-15, 2390678 bytes). A dynamic import() cannot take an
// integrity attribute, so the file is fetched, hashed here and only then imported from a blob URL.
export const ALADIN_SHA384 = '/ymkiSIIZYSHUE2kIcPf4PWW4meM/MIvDZbgCurNjz4k6/Fe21cxLQ9cEn0DlBsZ';
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
const TILE_PATH = 'Norder3/Dir0/Npix0.jpg'; // one real survey tile must load before the backdrop is shown
const GLOBE_FOV_DEG = 360; // idle view: the whole sky as a round globe (SIN projection), like the Aladin Lite web app's start view
export const MARK_COLOUR = '#ff66ff';
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

let decided = null; // the on/off decision is made once per page load: Load rewrites the URL and drops ?backdrop=
const wanted = () => (decided ??= backdropEnabled());

let starting = null; // promise of the aladin object, or null when it failed or is not wanted
let gaveUp = false;
let latest = 0; // number of the newest showSky call; an older call does nothing when it is overtaken

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

// dist/aladin.js is an ES module whose default export is the Aladin Lite object `A`.
// The hash can be replaced by a test (window.__skyHash) that serves a stand-in file.
async function loadAladin() {
  const expected = window.__skyHash || ALADIN_SHA384;
  const r = await fetch(ALADIN_URL, { signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) });
  if (!r.ok) throw new Error('script');
  const bytes = await r.arrayBuffer();
  if (b64(await crypto.subtle.digest('SHA-384', bytes)) !== expected) throw new Error('hash');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  try {
    return (await import(/* @vite-ignore */ url)).default;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** First survey server whose tile loads (a tile, not only the properties file: the CDS server answered the latter with an error page). */
async function findSurvey() {
  for (const root of SURVEY_ROOTS) {
    try {
      const r = await fetch(`${root}/${TILE_PATH}`, { signal: AbortSignal.timeout(6000) });
      if (r.ok && (r.headers.get('content-type') || '').startsWith('image/')) return root;
    } catch { /* try the next one */ }
  }
  throw new Error('no survey');
}

async function start(ra, dec) {
  const [A, root] = await Promise.all([loadAladin(), findSurvey()]);
  await A.init;
  const box = document.getElementById('sky');
  // Start on the whole sky as a globe (SIN projection, 180 degrees) so the first Load visibly flies in.
  const a = A.aladin(box, {
    survey: root, fov: GLOBE_FOV_DEG, target: `${ra} ${dec}`,
    cooFrame: 'ICRSd', projection: 'SIN', reticleSize: 0,
    showReticle: false, showZoomControl: false, showFullscreenControl: false, showLayersControl: false,
    showGotoControl: false, showSimbadPointerControl: false, showCooGridControl: false, showFrame: false,
    showProjectionControl: false, showContextMenu: false, showShareControl: false, showSettingsControl: false,
    showStatusBar: false, showCatalogue: false, showCooLocation: false, showFov: false,
    showFullscreen: false, showCooGrid: false,
  });
  a.__A = A; // kept to build the mark later
  return a;
}

/** The magenta crosshair (thin lines, gap in the middle) as a canvas; Aladin Lite takes a canvas as a catalogue shape. Decoration only. */
function crosshair() {
  const c = document.createElement('canvas');
  c.width = c.height = 56;
  const x = c.getContext('2d');
  x.strokeStyle = MARK_COLOUR; x.lineWidth = 4; x.lineCap = 'round';
  x.shadowColor = '#000'; x.shadowBlur = 4; // dark edge so it reads on both dark sky and bright stars
  x.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { x.moveTo(28 + dx * 8, 28 + dy * 8); x.lineTo(28 + dx * 22, 28 + dy * 22); }
  x.stroke();
  return c;
}

let markLayer = null;
/** Put the mark at the position (one mark, moved on each Load). It stays on the star while Aladin pans and zooms. */
function setMark(A, a, ra, dec) {
  if (!markLayer) {
    markLayer = A.catalog({ name: 'viewed position', shape: crosshair(), sourceSize: 56 });
    a.addCatalog(markLayer);
  }
  markLayer.clear();
  markLayer.addSources([A.source(ra, dec, {})]);
}

/** Centre of the backdrop view so the position lands at screen height `ty` (north is up, so a target above the centre needs a centre
 *  further south) in a view `w` degrees wide in a `vw` x `vh` window. Null `ty` keeps the position at the centre. */
export function viewCentre(ra, dec, w, ty, vw, vh) {
  if (ty == null) return { ra, dec };
  return { ra, dec: Math.max(-89, Math.min(89, dec - (vh / 2 - ty) * (w / vw))) };
}

function giveUp() {
  gaveUp = true;
  document.body.classList.remove('sky-on');
}

// Where the idle view is centred before any position is chosen. Arbitrary: it is not a target and is not meant to show anything.
const IDLE_RA = 150;
const IDLE_DEC = 20;

function begin(ra, dec) {
  if (!starting) {
    starting = start(ra, dec).then((a) => { document.body.classList.add('sky-on'); return a; }).catch(() => { giveUp(); return null; });
  }
  return starting;
}

/** Start the backdrop on a wide view of the sky before any position is chosen, once the page has finished loading and is idle
 *  (the 2.4 MB script and its hash check must not compete with the first screen). Never throws. */
export function idleSky() {
  try {
    if (gaveUp || !wanted()) return;
    const go = () => { try { begin(IDLE_RA, IDLE_DEC); } catch { giveUp(); } };
    const later = () => (window.requestIdleCallback ? window.requestIdleCallback(go, { timeout: 3000 }) : setTimeout(go, 500));
    if (document.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
  } catch { giveUp(); }
}

/** Fly the backdrop to the position. Never throws; the first call starts Aladin Lite. The page is changed
 *  (body.sky-on: backdrop and label shown) only after the library is running and a survey tile has loaded. */
export function showSky(ra, dec, fov) {
  try {
    if (gaveUp || !wanted()) return;
    const me = ++latest;
    begin(ra, dec).then((a) => {
      if (!a || me !== latest) return;
      try {
        document.body.classList.add('sky-flown');
        const w = backdropFov(fov);
        try { setMark(a.__A, a, ra, dec); } catch { /* no mark: the backdrop still works */ }
        // The image panel and controls cover the middle of the page, so the position is put in the header strip, which is
        // translucent and always free at the top of the page (checked at 1280 to 1440 px wide).
        const hb = document.querySelector('header')?.getBoundingClientRect().bottom;
        const c = viewCentre(ra, dec, w, hb > 20 ? hb / 2 : null, innerWidth, innerHeight);
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) { a.gotoRaDec(c.ra, c.dec); a.setFoV(w); return; }
        a.animateToRaDec(c.ra, c.dec, FLY_S);
        a.zoomToFoV(w, FLY_S);
      } catch { giveUp(); }
    });
  } catch { giveUp(); }
}
