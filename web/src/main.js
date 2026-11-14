import { fetchTargets, pollSeries } from './api.js';
import { buildSlots, formatFlag, locationQuery, mjdToUtc, nextSlot, parseLocation, progressText } from './model.js';

const $ = (id) => document.getElementById(id);
const el = {
  badge: $('badge'), targets: $('targets'), ra: $('ra'), dec: $('dec'), coords: $('coords'),
  progressText: $('progress-text'), bar: $('bar'), message: $('message'),
  frameBox: $('frame-box'), canvas: $('canvas'), scalebar: $('scalebar'), scalebarLabel: $('scalebar-label'), skipped: $('skipped'),
  prev: $('prev'), play: $('play'), next: $('next'), slider: $('slider'), fps: $('fps'),
  rFrame: $('r-frame'), rDate: $('r-date'), rWave: $('r-wave'), rFlag: $('r-flag'), legend: $('legend'),
};

const state = { targets: [], resp: null, slots: [], current: 0, playing: false, timer: null, abort: null, pos: null };
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
    el.skipped.textContent = `Frame ${slot.index + 1} was skipped (the API could not build it).`;
    return;
  }
  const img = slot && images.get(slot.url);
  if (!img || !img.complete || !img.naturalWidth) return;
  if (el.canvas.width !== img.naturalWidth || el.canvas.height !== img.naturalHeight) {
    el.canvas.width = img.naturalWidth;
    el.canvas.height = img.naturalHeight;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0); // untransformed: north up, east left as delivered
}

function renderReadout() {
  const slot = currentSlot();
  const n = state.slots.length;
  if (!slot) {
    for (const k of ['rFrame', 'rDate', 'rWave', 'rFlag']) el[k].textContent = '—';
    return;
  }
  el.rFrame.textContent = `${slot.index + 1} of ${Math.max(n, state.resp.progress.total)}`;
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
  for (const b of [el.prev, el.play, el.next, el.slider]) b.disabled = !has;
  el.slider.max = String(Math.max(0, state.slots.length - 1));
  el.slider.value = String(state.current);
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
      const arcsec = 60;
      el.scalebar.style.setProperty('--w', `${((arcsec / g.pixel_scale_arcsec) / g.shape[1]) * 100}%`);
      el.scalebarLabel.textContent = `${arcsec}″`;
    }
    el.legend.textContent = s
      ? `Stretch (already applied to every PNG, shown for reference only): ${s.kind}, ${s.vmin} to ${s.vmax} ${s.unit} mapped to 0 to 255.`
      : '';
  }
  renderReadout();
  drawCurrent();
}

function stopPlaying() {
  state.playing = false;
  clearInterval(state.timer);
  state.timer = null;
}

function startPlaying() {
  if (state.slots.filter((s) => !s.skipped).length < 2) return;
  state.playing = true;
  clearInterval(state.timer);
  state.timer = setInterval(() => go(nextSlot(state.slots, state.current, 1, { skipFailed: true })), 1000 / Number(el.fps.value));
}

function go(i) {
  if (i < 0) return;
  state.current = i;
  render();
}

function onUpdate(resp) {
  state.resp = resp;
  state.slots = buildSlots(resp);
  for (const s of state.slots) if (!s.skipped) preload(s.url);
  if (state.current >= state.slots.length) state.current = 0;
  // Start blinking once the series is complete, unless the user prefers reduced motion.
  if (resp.status === 'ready' && !state.autoStarted) {
    state.autoStarted = true;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) startPlaying();
  }
  render();
}

async function load(ra, dec, { push = false } = {}) {
  state.abort?.abort();
  stopPlaying();
  state.abort = new AbortController();
  state.pos = { ra, dec };
  state.autoStarted = false;
  state.resp = null;
  state.slots = [];
  state.current = 0;
  el.ra.value = String(ra);
  el.dec.value = String(dec);
  const url = locationQuery(ra, dec);
  if (push) history.pushState(null, '', url);
  markTargets();
  el.progressText.textContent = 'Requesting series…';
  el.message.hidden = true;
  render();
  try {
    await pollSeries(ra, dec, { onUpdate, signal: state.abort.signal });
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }
}

function markTargets() {
  for (const b of el.targets.querySelectorAll('button')) {
    const t = state.targets[Number(b.dataset.i)];
    b.setAttribute('aria-pressed', String(!!state.pos && t.ra === state.pos.ra && t.dec === state.pos.dec));
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
    b.addEventListener('click', () => load(t.ra, t.dec, { push: true }));
    li.append(b);
    return li;
  }));
  markTargets();
}

el.play.addEventListener('click', () => { state.playing ? stopPlaying() : startPlaying(); render(); });
el.prev.addEventListener('click', () => { stopPlaying(); go(nextSlot(state.slots, state.current, -1)); });
el.next.addEventListener('click', () => { stopPlaying(); go(nextSlot(state.slots, state.current, 1)); });
el.slider.addEventListener('input', () => { stopPlaying(); go(Number(el.slider.value)); });
el.fps.addEventListener('change', () => { if (state.playing) startPlaying(); });
el.coords.addEventListener('submit', (e) => {
  e.preventDefault();
  const p = parseLocation(`?ra=${encodeURIComponent(el.ra.value)}&dec=${encodeURIComponent(el.dec.value)}`);
  if (!p) {
    el.message.hidden = false;
    el.message.textContent = 'Enter RA in [0, 360) and Dec in [-90, 90], in decimal degrees.';
    return;
  }
  load(p.ra, p.dec, { push: true });
});
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
  if (e.key === ' ' && e.target === document.body) { e.preventDefault(); el.play.click(); }
  else if (e.key === 'ArrowRight') el.next.click();
  else if (e.key === 'ArrowLeft') el.prev.click();
});
window.addEventListener('popstate', () => {
  const p = parseLocation(location.search);
  if (p) load(p.ra, p.dec);
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
  if (p) load(p.ra, p.dec);
})();
