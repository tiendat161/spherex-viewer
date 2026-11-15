import { fetchTargets, pollSeries } from './api.js';
import { FOV_DEG, WIDE_FOV_DEG, bandLabel, blinkPair, buildSlots, cycleVisit, formatFlag, gridFovDeg, isWideField, locationQuery, mjdToUtc, nearestWavelength, nearestY, nextSlot, orderSlots, padPosition, padSpec, parseFov, parseLocation, progressText, scaleBarArcsec, scaleBarLabel, stackSlots, stepVisit, stepWavelength, visitsOf, zoomRect } from './model.js';

const $ = (id) => document.getElementById(id);
const el = {
  badge: $('badge'), targets: $('targets'), ra: $('ra'), dec: $('dec'), fov: $('fov'), fovNote: $('fov-note'), coords: $('coords'),
  progressText: $('progress-text'), bar: $('bar'), message: $('message'),
  frameBox: $('frame-box'), canvas: $('canvas'), scalebar: $('scalebar'), scalebarLabel: $('scalebar-label'), skipped: $('skipped'),
  prev: $('prev'), play: $('play'), next: $('next'), slider: $('slider'), visitBar: $('visit-bar'), vtrack: $('visit-track'), vmarks: $('visit-marks'), vhandle: $('visit-handle'), vlabels: $('visit-labels'), vaxis: $('vaxis'), vaxisHint: $('vaxis-hint'), toFrames: $('to-frames'), vTrack: $('vaxis-track'), vTicks: $('vaxis-ticks'), vHandle: $('vaxis-handle'), vLabels: $('vaxis-labels'), fps: $('fps'), zoom: $('zoom'), pair: $('pair'), pairNote: $('pair-note'), playNote: $('play-note'), playmode: $('playmode'), playmodeWrap: $('playmode-wrap'),
  view: $('view'), band: $('band'), bandWrap: $('band-wrap'), diff: $('diff'), diffWrap: $('diff-wrap'), order: $('order'), orderWrap: $('order-wrap'),
  mark: $('mark'), marker: $('marker'),
  rFrame: $('r-frame'), rDate: $('r-date'), rWave: $('r-wave'), rFlag: $('r-flag'), legend: $('legend'),
};

const state = { holdWl: null, targets: [], resp: null, slots: [], current: 0, playing: false, timer: null, abort: null, pos: null, pair: null };
let padShown = null; // {slots, stacks, key, spec, visit} of the visit and wavelength controls as drawn
const images = new Map(); // url -> HTMLImageElement, preloaded so blinking does not stutter
const ctx = el.canvas.getContext('2d');

function preload(url) {
  if (images.has(url)) return images.get(url);
  const img = new Image();
  img.onload = () => { if (currentFrameUrl() === url) drawCurrent(); };
  img.src = url;
  images.set(url, img);
  return img;
}

const currentSlot = () => state.slots[state.current];
const stackView = () => el.view.value === 'stack' && !!state.resp?.stacks;

/** Slots for the current view: stacked visits of one band, or the individual frames in the chosen order. */
function computeSlots() {
  if (!state.resp) return [];
  if (stackView()) return stackSlots(state.resp, el.band.value, el.diff.checked);
  return orderSlots(buildSlots(state.resp), el.order.value);
}

/** Rebuild the slots after a view, band, difference or order change. */
function reslot() {
  stopPlaying();
  state.pair = null;
  state.slots = computeSlots();
  state.current = 0;
  for (const s of state.slots) if (!s.skipped) preload(s.url);
  render();
}

function setView(view) {
  el.view.value = view;
  el.fps.value = view === 'stack' ? '1' : '5'; // a few deep images: blink slowly
}
const currentFrameUrl = () => (currentSlot() && !currentSlot().skipped ? currentSlot().url : null);

function setBadge(resp) {
  const origin = resp?.data_origin;
  el.badge.className = 'badge ' + (origin === 'simulated' ? 'badge-simulated' : origin === 'real' ? 'badge-real' : 'badge-unknown');
  el.badge.textContent = origin === 'simulated' ? 'SIMULATED DATA' : origin === 'real' ? 'REAL DATA' : resp ? 'DATA ORIGIN UNKNOWN' : 'NO DATA YET';
}

function drawCurrent() {
  const slot = currentSlot();
  el.skipped.hidden = !slot?.skipped;
  if (slot?.skipped) {
    el.skipped.textContent = `Frame ${slot.index + 1} of the planned series was skipped (the API could not build it).`;
    return;
  }
  const img = slot && images.get(slot.url);
  if (!img || !img.complete || !img.naturalWidth) return;
  if (el.canvas.width !== img.naturalWidth || el.canvas.height !== img.naturalHeight) {
    el.canvas.width = img.naturalWidth;
    el.canvas.height = img.naturalHeight;
  }
  ctx.imageSmoothingEnabled = false;
  // Untransformed apart from the centred zoom: north up, east left as delivered.
  const z = zoomRect(img.naturalWidth, img.naturalHeight, Number(el.zoom.value));
  ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
  ctx.drawImage(img, z.dx, z.dy, z.dw, z.dh);
}

function renderReadout() {
  const slot = currentSlot();
  const n = state.slots.length;
  if (!slot) {
    for (const k of ['rFrame', 'rDate', 'rWave', 'rFlag']) el[k].textContent = '—';
    return;
  }
  if (slot.stack) {
    el.rFrame.textContent = `Visit ${slot.visit + 1} of ${slot.visits}${slot.diff ? ' minus first' : ''}`;
    el.rDate.textContent = `${mjdToUtc(slot.start_mjd).slice(0, 10)} to ${mjdToUtc(slot.end_mjd).slice(0, 10)} UTC`;
    el.rWave.textContent = `${slot.band.wavelength_min_um.toFixed(2)}–${slot.band.wavelength_max_um.toFixed(2)} µm, ${slot.n_images} image${slot.n_images === 1 ? '' : 's'} combined`;
    el.rFlag.textContent = formatFlag(slot.flag_fraction);
    return;
  }
  el.rFrame.textContent = `${state.current + 1} of ${Math.max(n, state.resp.progress.total)}`;
  if (slot.skipped) {
    el.rDate.textContent = el.rWave.textContent = el.rFlag.textContent = 'skipped';
    return;
  }
  el.rDate.textContent = mjdToUtc(slot.obs_mjd);
  el.rWave.textContent = `${slot.wavelength_um.toFixed(3)} µm`;
  el.rFlag.textContent = formatFlag(slot.flag_fraction);
}

function render() {
  const r = state.resp;
  setBadge(r);
  const has = state.slots.length > 0;
  el.frameBox.hidden = !has;
  for (const b of [el.prev, el.play, el.next, el.slider, el.pair]) b.disabled = !has;
  const stacked = stackView();
  el.pair.disabled = !has || stacked;
  el.view.disabled = !r?.stacks;
  el.bandWrap.hidden = el.diffWrap.hidden = !stacked;
  el.orderWrap.hidden = stacked;
  el.marker.hidden = !el.mark.checked;
  el.pair.checked = !!state.pair;
  renderPairNote();
  renderPlayNote();
  el.slider.max = String(Math.max(0, state.slots.length - 1));
  el.slider.value = String(state.current);
  renderPad();
  el.playmodeWrap.hidden = !(padActive()?.visits.length > 1);
  el.play.textContent = state.playing ? 'Pause' : 'Play';
  if (r) {
    el.progressText.textContent = progressText(r);
    el.bar.max = Math.max(1, r.progress.total);
    el.bar.value = r.progress.done + r.progress.failed;
    el.message.hidden = r.status !== 'error';
    if (r.status === 'error') el.message.textContent = r.error.message;
    const g = r.grid, s = r.stretch;
    el.scalebar.hidden = !g;
    if (g) {
      const arcsec = scaleBarArcsec(gridFovDeg(g) * 3600 / Number(el.zoom.value));
      el.scalebar.style.setProperty('--w', `${((arcsec / g.pixel_scale_arcsec) / g.shape[1]) * 100 * Number(el.zoom.value)}%`);
      el.scalebarLabel.textContent = scaleBarLabel(arcsec);
    }
    const bg = r.background === 'median_subtracted' ? ' Each image had its own median background subtracted first.' : '';
    const slot = currentSlot();
    if (stacked && slot?.diff) {
      el.legend.textContent = `Difference image: this visit minus the earliest visit in this band. Linear, −${slot.band.diff_limit} to +${slot.band.diff_limit} ${slot.band.stretch.unit} mapped to black to white; mid-grey means no change.${bg}`;
    } else if (stacked && slot) {
      const b = slot.band.stretch;
      el.legend.textContent = `Each frame is the sigma-clipped mean of the images taken in one visit in this band. Stretch (shared by all visits of the band): ${b.kind}, ${b.vmin} to ${b.vmax} ${b.unit} mapped to 0 to 255.${bg}`;
    } else {
      el.legend.textContent = s
        ? `Stretch (already applied to every PNG, shown for reference only): ${s.kind}, ${s.vmin} to ${s.vmax} ${s.unit} mapped to 0 to 255.${bg}`
        : '';
    }
  }
  // The wavelength in the readout is the one at the grid centre; on a wide field say so.
  el.fovNote.hidden = !(r?.grid ? isWideField(r.grid) : state.pos?.fov >= WIDE_FOV_DEG);
  renderReadout();
  drawCurrent();
}

/** The pad spec for the frames on screen, or null (stacked view, or too few wavelengths): then the plain slider is used. */
const padActive = () => padShown?.spec ?? null;

/**
 * The visit slider (horizontal, one evenly spaced mark per visit) and the wavelength slider (vertical, one evenly
 * spaced mark per frame of the current visit). A frame is a (visit, wavelength) point: the visit slider picks the
 * visit, the vertical one the frame within it. Changing visit keeps the wavelength as nearly as it can.
 */
function renderPad() {
  const key = String(stackView());
  if (!padShown || padShown.slots !== state.slots || padShown.stacks !== state.resp?.stacks || padShown.key !== key) {
    const spec = stackView() ? null : padSpec(state.slots, visitsOf(state.resp, state.slots));
    padShown = { slots: state.slots, stacks: state.resp?.stacks, key, spec, visit: -1 };
    const n = spec?.visits.length ?? 0;
    const vx = (i) => (n === 1 ? 0.5 : i / (n - 1)) * 100;
    el.vmarks.replaceChildren(...(n > 1 ? spec.visits.map((_, i) => { const m = document.createElement('div'); m.className = 'visit-mark'; m.style.left = `${vx(i)}%`; return m; }) : []));
    el.vlabels.replaceChildren(...(n > 1 ? spec.visits.map((v, i) => {
      const d = document.createElement('div');
      d.dataset.visit = String(i);
      d.style.left = `${vx(i)}%`;
      const b = document.createElement('b');
      b.textContent = `Visit ${i + 1}`;
      const span = `${mjdToUtc(v.start_mjd).slice(0, 10)}${v.end_mjd - v.start_mjd >= 1 ? ` to ${mjdToUtc(v.end_mjd).slice(0, 10)}` : ''}`;
      d.append(b, document.createElement('br'), `${span} · ${v.points.length}`);
      return d;
    }) : []));
  }
  const spec = padShown.spec;
  el.vaxisHint.hidden = !stackView(); // the stacked view has no wavelength slider: say so, and offer the way to it
  el.vaxis.hidden = !spec;
  el.visitBar.hidden = !spec || spec.visits.length < 2;
  el.slider.classList.toggle('visually-hidden', !!spec); // the native slider stays for the keyboard and screen readers
  if (!spec) return;
  const at = padPosition(spec, state.current);
  const cur = at ? spec.visits[at.visit].points[at.point] : null;
  if (at && at.visit !== padShown.visit) { // marks, gaps and wavelengths of the visit now shown
    padShown.visit = at.visit;
    const v = spec.visits[at.visit];
    const mk = (cls, y) => { const t = document.createElement('div'); t.className = cls; t.style.top = `${(1 - y) * 100}%`; return t; };
    el.vTicks.replaceChildren(...v.points.map((p) => mk('vaxis-tick', p.y)), ...v.gaps.map((g) => mk('vaxis-gap', g.y)));
    el.vLabels.replaceChildren(...v.labels.map((k) => {
      const e = document.createElement('span');
      e.dataset.y = String(v.points[k].y);
      e.style.top = `${(1 - v.points[k].y) * 100}%`;
      e.textContent = `${v.points[k].wl.toFixed(2)} µm`;
      return e;
    }));
  }
  el.vHandle.hidden = !at;
  // The wavelength of the current frame is written at the handle; written wavelengths close to it step aside.
  el.vLabels.querySelector('.cur')?.remove();
  for (const e of el.vLabels.children) e.hidden = !!cur && Math.abs(Number(e.dataset.y) - cur.y) < 0.07;
  if (cur) {
    el.vHandle.style.top = `${(1 - cur.y) * 100}%`;
    const e = document.createElement('span');
    e.className = 'cur';
    e.style.top = `${(1 - cur.y) * 100}%`;
    e.textContent = `${cur.wl.toFixed(2)} µm`;
    el.vLabels.append(e);
  }
  if (at && !el.visitBar.hidden) {
    const n = spec.visits.length;
    el.vhandle.style.left = `${(at.visit / (n - 1)) * 100}%`;
    for (const d of el.vlabels.children) d.classList.toggle('cur', Number(d.dataset.visit) === at.visit);
  }
}

/** Playing across visits: Play shows the same wavelength in each visit in turn instead of walking through the frames. */
const acrossVisits = () => !state.pair && el.playmode.value === 'visits' && padActive()?.visits.length > 1;

function renderPlayNote() {
  el.playNote.hidden = !(state.playing && acrossVisits() && state.holdWl);
  if (!el.playNote.hidden) el.playNote.textContent = `Playing across visits at about ${state.holdWl.toFixed(2)} µm: each visit shows its frame closest to that wavelength, and the readout gives the exact one. Change Play to "through the frames" to walk through them in order.`;
}

function renderPairNote() {
  el.pairNote.hidden = !state.pair;
  if (!state.pair) return;
  const [a, b] = state.pair.map((i) => state.slots[i]);
  el.pairNote.textContent = `Blinking frames ${a.index + 1} and ${b.index + 1}: ${(b.obs_mjd - a.obs_mjd).toFixed(0)} days apart, ${a.wavelength_um.toFixed(3)} and ${b.wavelength_um.toFixed(3)} µm. Chosen as the closest wavelengths among frames at least 80% of the series' time span apart.`;
}

/** Next slot for stepping or playback. In pair mode there are only the two chosen frames. */
function advance(dir, opts) {
  if (state.pair) return state.current === state.pair[0] ? state.pair[1] : state.pair[0];
  return nextSlot(state.slots, state.current, dir, opts);
}

function stopPlaying() {
  state.playing = false;
  clearInterval(state.timer);
  state.timer = null;
}

/** Wavelength of the current frame, or null when the visit and wavelength controls are not in use. */
function currentWavelength() {
  const spec = padActive(), at = spec && padPosition(spec, state.current);
  return at ? spec.visits[at.visit].points[at.point].wl : null;
}

function tick() {
  if (acrossVisits()) {
    state.holdWl ??= currentWavelength(); // held from the moment blinking across visits begins
    if (state.holdWl) return go(cycleVisit(padActive(), state.current, state.holdWl));
  }
  go(advance(1, { skipFailed: true }));
}

function startPlaying() {
  if (state.slots.filter((s) => !s.skipped).length < 2) return;
  state.playing = true;
  state.holdWl = currentWavelength(); // the wavelength held while blinking across visits
  clearInterval(state.timer);
  state.timer = setInterval(tick, 1000 / Number(el.fps.value));
}

function go(i) {
  if (i < 0) return;
  state.current = i;
  render();
}

function onUpdate(resp) {
  state.resp = resp;
  if (resp.stacks && !state.stacksSeen) {
    // Stacks arrive with the finished series: fill the band list and show the stacked view first.
    state.stacksSeen = true;
    el.band.replaceChildren(...resp.stacks.bands.map((b) => new Option(bandLabel(b), b.id)));
    setView('stack');
    state.current = 0;
  }
  state.slots = computeSlots();
  if (state.pair && resp.status !== 'ready') state.pair = null;
  for (const s of state.slots) if (!s.skipped) preload(s.url);
  if (state.current >= state.slots.length) state.current = 0;
  // Start blinking once the series is complete, unless the user prefers reduced motion.
  if (resp.status === 'ready' && !state.autoStarted) {
    state.autoStarted = true;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) startPlaying();
  }
  render();
}

async function load(ra, dec, { fov = FOV_DEG, push = false } = {}) {
  state.abort?.abort();
  stopPlaying();
  state.abort = new AbortController();
  state.pos = { ra, dec, fov };
  state.autoStarted = false;
  state.stacksSeen = false;
  setView('frames');
  el.diff.checked = false;
  state.resp = null;
  state.slots = [];
  state.current = 0;
  state.pair = null;
  el.ra.value = String(ra);
  el.dec.value = String(dec);
  el.fov.value = String(fov);
  const url = locationQuery(ra, dec, fov);
  if (push) history.pushState(null, '', url);
  markTargets();
  el.progressText.textContent = 'Requesting series…';
  el.message.hidden = true;
  render();
  try {
    await pollSeries(ra, dec, { fov, onUpdate, signal: state.abort.signal });
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }
}

function markTargets() {
  for (const b of el.targets.querySelectorAll('button')) {
    const t = state.targets[Number(b.dataset.i)];
    b.setAttribute('aria-pressed', String(!!state.pos && t.ra === state.pos.ra && t.dec === state.pos.dec && state.pos.fov === FOV_DEG));
  }
}

function renderTargets() {
  el.targets.replaceChildren(...state.targets.map((t, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.i = String(i);
    b.dataset.id = t.id;
    const name = document.createElement('span'); name.className = 'name'; name.textContent = t.name;
    const note = document.createElement('span'); note.className = 'note'; note.textContent = `RA ${t.ra}, Dec ${t.dec}. ${t.position_note}`;
    b.append(name, note);
    b.addEventListener('click', () => load(t.ra, t.dec, { push: true })); // the cached series: default field of view
    li.append(b);
    return li;
  }));
  markTargets();
}

el.play.addEventListener('click', () => { state.playing ? stopPlaying() : startPlaying(); render(); });
el.prev.addEventListener('click', () => { stopPlaying(); go(advance(-1)); });
el.next.addEventListener('click', () => { stopPlaying(); go(advance(1)); });
el.slider.addEventListener('input', () => { stopPlaying(); state.pair = null; go(Number(el.slider.value)); });
// Pad: every change goes through the slider, so pair mode and stopping playback behave as for any other slider move.
function pickSlot(slot) {
  if (slot >= 0 && slot !== state.current) { el.slider.value = String(slot); el.slider.dispatchEvent(new Event('input')); }
}
let dragging = false;
function pickOnVAxis(e) {
  const spec = padActive(), at = spec && padPosition(spec, state.current);
  if (!at) return;
  const r = el.vTrack.getBoundingClientRect();
  pickSlot(nearestY(spec.visits[at.visit], 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))));
}
el.vTrack.addEventListener('pointerdown', (e) => { dragging = true; el.vTrack.setPointerCapture(e.pointerId); el.slider.focus({ preventScroll: true }); pickOnVAxis(e); });
el.vTrack.addEventListener('pointermove', (e) => { if (dragging) pickOnVAxis(e); });
for (const t of ['pointerup', 'pointercancel']) el.vTrack.addEventListener(t, () => { dragging = false; });
function pickOnVisits(e) {
  const spec = padActive(), at = spec && padPosition(spec, state.current);
  if (!spec || spec.visits.length < 2) return;
  const r = el.vtrack.getBoundingClientRect();
  const to = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (spec.visits.length - 1));
  if (at && to === at.visit) return;
  const wl = at ? spec.visits[at.visit].points[at.point].wl : spec.visits[0].points[0].wl;
  pickSlot(nearestWavelength(spec.visits[to], wl)); // the closest wavelength in that visit
}
let draggingVisit = false;
el.vtrack.addEventListener('pointerdown', (e) => { draggingVisit = true; el.vtrack.setPointerCapture(e.pointerId); el.slider.focus({ preventScroll: true }); pickOnVisits(e); });
el.vtrack.addEventListener('pointermove', (e) => { if (draggingVisit) pickOnVisits(e); });
for (const t of ['pointerup', 'pointercancel']) el.vtrack.addEventListener(t, () => { draggingVisit = false; });
el.toFrames.addEventListener('click', () => { setView('frames'); reslot(); });
el.zoom.addEventListener('change', render);
el.mark.addEventListener('change', render);
el.view.addEventListener('change', () => { setView(el.view.value); reslot(); });
for (const c of [el.band, el.diff, el.order]) c.addEventListener('change', reslot);
el.pair.addEventListener('change', () => {
  state.pair = el.pair.checked ? blinkPair(state.slots) : null;
  if (state.pair) { go(state.pair[0]); startPlaying(); }
  render();
});
el.fps.addEventListener('change', () => { if (state.playing) startPlaying(); });
el.playmode.addEventListener('change', () => { if (state.playing) startPlaying(); render(); });
el.coords.addEventListener('submit', (e) => {
  e.preventDefault();
  const p = parseLocation(`?ra=${encodeURIComponent(el.ra.value)}&dec=${encodeURIComponent(el.dec.value)}`);
  if (!p) {
    el.message.hidden = false;
    el.message.textContent = 'Enter RA in [0, 360) and Dec in [-90, 90], in decimal degrees.';
    return;
  }
  load(p.ra, p.dec, { fov: parseFov(el.fov.value), push: true });
});
// Changing the field of view reloads the position on screen at the new size (a live build unless it is the cached 0.2°).
el.fov.addEventListener('change', () => { if (state.pos) load(state.pos.ra, state.pos.dec, { fov: parseFov(el.fov.value), push: true }); });
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
  if (e.key === ' ' && e.target === document.body) { e.preventDefault(); el.play.click(); }
  else if (padActive() && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    // With the visit and wavelength controls: up and down change the wavelength, left and right the visit.
    e.preventDefault(); // the hidden slider would otherwise step by itself as well
    pickSlot(e.key === 'ArrowUp' ? stepWavelength(padActive(), state.current, 1) : e.key === 'ArrowDown' ? stepWavelength(padActive(), state.current, -1)
      : stepVisit(padActive(), state.current, e.key === 'ArrowRight' ? 1 : -1));
  }
  else if (e.key === 'ArrowRight') el.next.click();
  else if (e.key === 'ArrowLeft') el.prev.click();
});
window.addEventListener('popstate', () => {
  const p = parseLocation(location.search);
  if (p) load(p.ra, p.dec, { fov: p.fov });
});

(async function init() {
  render();
  try {
    state.targets = await fetchTargets();
    renderTargets();
  } catch (e) {
    el.targets.innerHTML = '';
    const li = document.createElement('li');
    li.textContent = `Could not load targets: ${e.message}`;
    el.targets.append(li);
  }
  const p = parseLocation(location.search);
  if (p) load(p.ra, p.dec, { fov: p.fov });
})();
