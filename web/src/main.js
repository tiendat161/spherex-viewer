import { fetchTargets, pollSeries, pollSpectrum } from './api.js';
import { PALETTE, fluxPoints, fluxSummary, lightCurveLayout, reasonText, reasonWords, spectrumLayout } from './chart.js';
import { FOV_DEG, SPECTRUM_LOAD, clickToImage, imageToBox, pixelToSky, parseAngle, INITIAL_LOAD, MB_PER_IMAGE, isCachedPosition, loadPlan, loadTimeText, captionText, splitCoordinates, WIDE_FOV_DEG, bandLabel, blinkPair, buildSlots, cycleVisit, pingPong, formatFlag, gridFovDeg, isWideField, locationQuery, mjdToUtc, nearestWavelength, nearestY, nextSlot, orderSlots, padPosition, padSpec, parseFov, parseLocation, progressText, scaleBarArcsec, scaleBarLabel, stackSlots, stepVisit, stepWavelength, visitsOf, zoomRect } from './model.js';

const $ = (id) => document.getElementById(id);
const el = {
  badge: $('badge'), targets: $('targets'), ra: $('ra'), dec: $('dec'), fov: $('fov'), fovNote: $('fov-note'), coords: $('coords'),
  progressText: $('progress-text'), bar: $('bar'), more: $('more'), moreText: $('more-text'), moreBtn: $('more-btn'), moreAll: $('more-all'), message: $('message'),
  frameBox: $('frame-box'), canvas: $('canvas'), scalebar: $('scalebar'), scalebarLabel: $('scalebar-label'), skipped: $('skipped'),
  prev: $('prev'), play: $('play'), next: $('next'), slider: $('slider'), visitBar: $('visit-bar'), vtrack: $('visit-track'), vmarks: $('visit-marks'), vhandle: $('visit-handle'), vlabels: $('visit-labels'), vaxis: $('vaxis'), segDate: $('seg-date'), segWl: $('seg-wl'), caption: $('caption'), targetsMenu: $('targets-menu'), targetsCurrent: $('targets-current'), vTrack: $('vaxis-track'), vTicks: $('vaxis-ticks'), vHandle: $('vaxis-handle'), vLabels: $('vaxis-labels'), fps: $('fps'), zoom: $('zoom'), pair: $('pair'), pairNote: $('pair-note'), playNote: $('play-note'), wdown: $('wdown'), wup: $('wup'), playWl: $('play-wl'),
  view: $('view'), band: $('band'), bandWrap: $('band-wrap'), diff: $('diff'), diffWrap: $('diff-wrap'),
  mark: $('mark'), marker: $('marker'),
  stageRow: $('stage-row'), charts: $('charts'), tabSpectrum: $('tab-spectrum'), tabPoint: $('tab-point'), pointMarker: $('point-marker'), tabCurve: $('tab-curve'), chart: $('chart'), chartTitle: $('chart-title'), chartLegend: $('chart-legend'), chartHelp: $('chart-help'), chartMessage: $('chart-message'), chartNote: $('chart-note'),
  rFrame: $('r-frame'), rDate: $('r-date'), rWave: $('r-wave'), rFlag: $('r-flag'), legend: $('legend'),
};

const state = { chartTab: 'spectrum', load: null, startedAt: 0, holdWl: null, playMode: null, dir: 1, targets: [], resp: null, slots: [], current: 0, playing: false, timer: null, abort: null, pos: null, pair: null, point: null }; // point: the clicked position and its spectrum {ra, dec, fx, fy, cached, resp, abort}
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

/** Slots for the current view: stacked visits of one band, or the individual frames in time order. */
function computeSlots() {
  if (!state.resp) return [];
  if (stackView()) return stackSlots(state.resp, el.band.value, el.diff.checked);
  return orderSlots(buildSlots(state.resp), 'time');
}

/** Rebuild the slots after a view, band or difference change. */
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
  // An error document carries no data, so its data_origin says nothing about what is on screen.
  const origin = resp?.status === 'error' ? undefined : resp?.data_origin;
  el.badge.className = 'badge ' + (origin === 'simulated' ? 'badge-simulated' : origin === 'real' ? 'badge-real' : 'badge-unknown');
  el.badge.textContent = origin === 'simulated' ? 'SIMULATED DATA' : origin === 'real' ? 'REAL DATA' : resp && resp.status !== 'error' ? 'DATA ORIGIN UNKNOWN' : 'NO DATA YET';
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
  for (const b of [el.prev, el.next, el.slider, el.pair]) b.disabled = !has;
  const stacked = stackView();
  el.pair.disabled = !has || stacked;
  el.view.disabled = !r?.stacks;
  el.segDate.disabled = !r?.stacks; // stacks exist once the series has finished loading
  el.segDate.setAttribute('aria-pressed', String(stacked));
  el.segWl.setAttribute('aria-pressed', String(!stacked));
  el.bandWrap.hidden = el.diffWrap.hidden = !stacked;
  el.marker.hidden = !el.mark.checked;
  el.pair.checked = !!state.pair;
  renderPairNote();
  renderPlayNote();
  renderMore();
  renderCharts();
  renderPointMarker();
  el.slider.max = String(Math.max(0, state.slots.length - 1));
  el.slider.value = String(state.current);
  renderPad();
  renderButtons();
  if (r) {
    el.progressText.textContent = progressText(r, (Date.now() - state.startedAt) / 1000);
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
  const at = padActive() && padPosition(padActive(), state.current);
  el.caption.textContent = captionText(currentSlot(), at && padActive().visits.length > 1 ? `visit ${at.visit + 1} of ${padActive().visits.length}` : '');
  drawCurrent();
}

/** The pad spec for the frames on screen, or null (stacked view, or too few wavelengths): then the plain slider is used. */
const padActive = () => padShown?.spec ?? null;

/**
 * What the visit slider shows: one item per visit, which one is current, and the slot to go to for visit i. Null when there is
 * no choice (fewer than two visits). Individual frames: the visits of the pad, keeping the wavelength. Stacks: one slot per visit.
 */
function visitInfo() {
  if (stackView()) {
    if (state.slots.length < 2) return null;
    return {
      items: state.slots.map((s) => ({ n: s.visit + 1, start: s.start_mjd, end: s.end_mjd, count: `${s.n_images} image${s.n_images === 1 ? '' : 's'}` })),
      at: state.current, pick: (i) => i,
    };
  }
  const spec = padActive();
  if (!spec || spec.visits.length < 2) return null;
  const at = padPosition(spec, state.current);
  return {
    items: spec.visits.map((v, i) => ({ n: i + 1, start: v.start_mjd, end: v.end_mjd, count: `${v.points.length} frames` })),
    at: at ? at.visit : -1,
    pick: (i) => nearestWavelength(spec.visits[i], currentWavelength() ?? spec.visits[0].points[0].wl), // the closest wavelength in that visit
  };
}

/**
 * The visit slider (horizontal, one evenly spaced mark per visit) and, for individual frames, the wavelength slider (vertical,
 * one evenly spaced mark per frame of the current visit). A frame is a (visit, wavelength) point: the visit slider picks the
 * visit, the vertical one the frame within it. Changing visit keeps the wavelength as nearly as it can.
 */
function renderPad() {
  const key = String(stackView());
  if (!padShown || padShown.slots !== state.slots || padShown.stacks !== state.resp?.stacks || padShown.key !== key) {
    const spec = stackView() ? null : padSpec(state.slots, visitsOf(state.resp, state.slots));
    padShown = { slots: state.slots, stacks: state.resp?.stacks, key, spec, visit: -1 };
    const items = (stackView() ? visitInfo() : spec && spec.visits.length > 1 ? visitInfo() : null)?.items ?? [];
    const n = items.length;
    const vx = (i) => (n === 1 ? 0.5 : i / (n - 1)) * 100;
    el.vmarks.replaceChildren(...items.map((_, i) => { const m = document.createElement('div'); m.className = 'visit-mark'; m.style.left = `${vx(i)}%`; return m; }));
    el.vlabels.replaceChildren(...items.map((v, i) => {
      const d = document.createElement('div');
      d.dataset.visit = String(i);
      d.style.left = `${vx(i)}%`;
      const b = document.createElement('b');
      b.textContent = `Visit ${v.n}`;
      const span = `${mjdToUtc(v.start).slice(0, 10)}${v.end - v.start >= 1 ? ` to ${mjdToUtc(v.end).slice(0, 10)}` : ''}`;
      const sub = document.createElement('span');
      sub.className = 'sub'; // hidden on a narrow screen, where the caption already gives the dates
      sub.append(document.createElement('br'), `${span} · ${v.count}`);
      d.append(b, sub);
      return d;
    }));
  }
  const spec = padShown.spec;
  const info = visitInfo();
  el.vaxis.hidden = !spec;
  el.visitBar.hidden = !info;
  el.slider.classList.toggle('visually-hidden', !!spec || !!info); // the native slider stays for the keyboard and screen readers
  if (info) { // the handle and the current visit's label
    el.vhandle.style.left = `${(info.items.length === 1 ? 0.5 : Math.max(0, info.at) / (info.items.length - 1)) * 100}%`;
    for (const d of el.vlabels.children) d.classList.toggle('cur', Number(d.dataset.visit) === info.at);
  }
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
}

/**
 * With the visit and wavelength sliders in use (and not blinking a pair) the buttons follow the two axes: step the visit,
 * step the wavelength, and play along either one. Otherwise (stacked view, one wavelength) they are plain frame buttons.
 */
const padMode = () => (padActive() && !state.pair ? (padActive().visits.length > 1 ? 'multi' : 'single') : 'classic');

function renderButtons() {
  const m = padMode(), playing = state.playing;
  const set = (b, text) => { b.textContent = text; };
  set(el.prev, m === 'multi' ? '◀︎ Visit' : 'Step ◀︎');
  set(el.next, m === 'multi' ? 'Visit ▶︎' : 'Step ▶︎');
  el.prev.hidden = el.next.hidden = m === 'single';
  el.wdown.hidden = el.wup.hidden = el.playWl.hidden = m === 'classic';
  el.play.hidden = m === 'single';
  set(el.play, playing && state.playMode !== 'wl' ? 'Pause' : m === 'classic' ? 'Play' : 'Play across visits');
  set(el.playWl, playing && state.playMode === 'wl' ? 'Pause' : 'Play through wavelengths');
  const has = state.slots.length > 0;
  el.wdown.disabled = el.wup.disabled = !has;
  el.play.disabled = !has || (playing && state.playMode === 'wl');
  el.playWl.disabled = !has || (playing && state.playMode !== 'wl');
}

function renderPlayNote() {
  const at = padActive() && padPosition(padActive(), state.current);
  el.playNote.hidden = !(state.playing && (state.playMode === 'visits' ? state.holdWl : state.playMode === 'wl' && at));
  if (el.playNote.hidden) return;
  el.playNote.textContent = state.playMode === 'visits'
    ? `Playing across visits at about ${state.holdWl.toFixed(2)} µm: each visit shows its frame closest to that wavelength, and the readout gives the exact one.`
    : `Playing through the wavelengths of visit ${at.visit + 1}, shortest to longest and back.`;
}

/** "Load more" and "Load all" for a finished live series that has more images in the archive than it has loaded. */
function renderMore() {
  const plan = loadPlan(state.resp);
  el.more.hidden = !plan;
  if (!plan) return;
  const n1 = plan.more - plan.have;
  el.moreText.textContent = `The other images are not downloaded yet. The ones shown are spread over the observation dates and the detector bands.`;
  el.moreBtn.textContent = `Load ${n1} more (${loadTimeText(n1)})`;
  el.moreBtn.dataset.total = String(plan.more);
  el.moreAll.hidden = !plan.all;
  if (plan.all) {
    const n2 = plan.all - plan.have;
    el.moreAll.textContent = `${plan.allIsCapped ? `Load up to ${plan.all}` : `Load all ${plan.all}`} (${loadTimeText(n2)}, about ${Math.round(n2 * MB_PER_IMAGE)} MB)`;
    el.moreAll.dataset.total = String(plan.all);
  }
}

const SVG = 'http://www.w3.org/2000/svg';
function svg(name, attrs = {}, text) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  return e;
}
let chartShown = null; // {resp, tab, index} of the chart as drawn

/**
 * The Spectrum and Light curve next to the image: the flux of every frame that could be measured, coloured by visit.
 * The light curve takes the frames near the wavelength on screen (the vertical slider drives it). A click on a point shows that frame.
 */
function renderCharts() {
  const r = state.resp;
  const pt = state.point;
  const onPoint = state.chartTab === 'point';
  const src = onPoint ? pt?.resp : r; // the clicked point's spectrum, or the series' own fluxes
  const frames = src?.frames ?? [];
  const sum = fluxSummary(frames);
  const show = fluxSummary(r?.frames ?? []).hasFlux || !!pt;
  el.charts.hidden = !show;
  el.stageRow.classList.toggle('has-charts', show);
  if (!show) return;
  const cur = !stackView() ? currentSlot() : null;
  // A click on a cached target is measured on a live series whose frames are not the ones on screen: no frame to highlight or open.
  const sameFrames = !(onPoint && pt?.cached);
  const curIndex = cur && !cur.skipped && sameFrames ? cur.index : null;
  if (chartShown && chartShown.resp === r && chartShown.tab === state.chartTab && chartShown.index === curIndex && chartShown.src === src && chartShown.pt === pt) return;
  chartShown = { resp: r, tab: state.chartTab, index: curIndex, src, pt };
  for (const [tab, on] of [[el.tabSpectrum, state.chartTab === 'spectrum'], [el.tabPoint, onPoint], [el.tabCurve, state.chartTab === 'curve']]) tab.setAttribute('aria-selected', String(on));

  // Visit of each frame, for the colour: the same grouping as the visit slider.
  const slots = orderSlots(buildSlots(r), 'time');
  const pad = padSpec(slots, visitsOf(r, slots));
  const visitOf = new Map();
  pad?.visits.forEach((v, i) => v.points.forEach((p) => visitOf.set(slots[p.slot].index, i)));
  const points = fluxPoints(frames, sameFrames ? visitOf : new Map());
  const wl0 = cur && !cur.skipped ? cur.wavelength_um : points.length ? [...points].sort((a, b) => a.wl - b.wl)[Math.floor(points.length / 2)].wl : null;
  const curve = state.chartTab === 'curve';
  const lay = curve ? (wl0 ? lightCurveLayout(points, wl0) : null) : spectrumLayout(points);

  el.chart.replaceChildren();
  el.chartLegend.replaceChildren();
  el.chartMessage.hidden = !!lay;
  // One plain sentence on how to read the chart.
  el.chartHelp.textContent = curve
    ? 'Frames within 5% of the wavelength on screen, by date. A change counts only if it is larger than the error bars. The measuring circle stays on the requested position, so a moving object can leave it.'
    : onPoint ? 'The brightness at the point you clicked, in each frame. The wavelength of a point is read at its own pixel, because it changes across the detector. Overlapping error bars cannot be told apart. A nearby source adds to the flux.'
    : 'Each colour is one visit, a group of observation dates. A visit covers only some wavelengths, so the points are not joined. Overlapping error bars mean the visits cannot be told apart.';
  el.chart.hidden = !lay; // no empty frame when there is nothing to draw
  const sim = !onPoint && r.data_origin === 'simulated' ? 'SIMULATED. ' : '';
  if (!lay) {
    el.chartTitle.textContent = curve ? 'Light curve' : onPoint ? 'Clicked point' : 'Spectrum';
    el.chartMessage.textContent = onPoint ? pointMessage(pt, points.length, sum) : !points.length
      ? `No flux could be measured in any of the ${sum.total} frames at this position. Reason: ${reasonWords(sum.reasons)}. This is not zero flux.`
      : `Fewer than two measured frames near ${wl0.toFixed(2)} µm on different dates. Move the wavelength slider to a wavelength that several visits observed.`;
  } else {
    el.chartTitle.textContent = sim + (curve
      ? `Flux at about ${wl0.toFixed(2)} µm: ${lay.dots.length} frames within 5%`
      : onPoint ? `Flux at RA ${pt.ra.toFixed(4)}°, Dec ${pt.dec.toFixed(4)}°: ${sum.measured} of ${src.progress.total} frames measured`
      : `Flux at the requested position: ${sum.measured} of ${sum.total} frames measured`);
    const { plot } = lay;
    const axis = { stroke: '#2c313c', 'stroke-width': 1 };
    el.chart.append(svg('rect', { x: plot.x0, y: plot.y0, width: plot.x1 - plot.x0, height: plot.y1 - plot.y0, fill: 'none', ...axis }));
    for (const t of lay.yTicks) {
      el.chart.append(svg('line', { x1: plot.x0, x2: plot.x1, y1: t.y, y2: t.y, stroke: '#2c313c', 'stroke-width': 0.5 }));
      el.chart.append(svg('text', { x: plot.x0 - 5, y: t.y + 3.5, 'text-anchor': 'end', fill: '#9aa1ad', 'font-size': 10.5 }, t.label));
    }
    for (const t of lay.xTicks) {
      el.chart.append(svg('line', { x1: t.x, x2: t.x, y1: plot.y1, y2: plot.y1 + 4, ...axis }));
      el.chart.append(svg('text', { x: t.x, y: plot.y1 + 16, 'text-anchor': 'middle', fill: '#9aa1ad', 'font-size': 10.5 }, t.label));
    }
    if (lay.zeroY != null) el.chart.append(svg('line', { x1: plot.x0, x2: plot.x1, y1: lay.zeroY, y2: lay.zeroY, stroke: '#9aa1ad', 'stroke-dasharray': '3 3', 'stroke-width': 1 }));
    el.chart.append(svg('text', { x: (plot.x0 + plot.x1) / 2, y: 276, 'text-anchor': 'middle', fill: '#9aa1ad', 'font-size': 11 }, curve ? 'Date (UTC)' : 'Wavelength (µm)'));
    el.chart.append(svg('text', { transform: `translate(12 ${(plot.y0 + plot.y1) / 2}) rotate(-90)`, 'text-anchor': 'middle', fill: '#9aa1ad', 'font-size': 11 }, 'Flux (µJy)'));
    for (const d of lay.dots) {
      const color = PALETTE[d.visit % PALETTE.length];
      const g = sameFrames
        ? svg('g', { class: 'chart-dot', 'data-index': d.index, tabindex: 0, role: 'button', 'aria-label': `Show the frame at ${d.wl.toFixed(3)} micrometres` })
        : svg('g', { class: 'chart-dot-static' });
      const when = mjdToUtc(d.mjd).slice(0, 10);
      g.append(svg('title', {}, `${d.wl.toFixed(3)} µm · ${when} · ${d.flux.toFixed(1)} ± ${d.err.toFixed(1)} µJy · visit ${d.visit + 1}`));
      g.append(svg('line', { x1: d.cx, x2: d.cx, y1: d.y0, y2: d.y1, stroke: color, 'stroke-width': 1.2, opacity: 0.8 }));
      g.append(svg('circle', { cx: d.cx, cy: d.cy, r: d.index === curIndex ? 5.5 : 3.4, fill: color, stroke: d.index === curIndex ? '#fff' : 'none', 'stroke-width': 2 }));
      el.chart.append(g);
    }
    const visits = [...new Set(lay.dots.map((d) => d.visit))].sort((a, b) => a - b);
    for (const v of (visits.length > 1 ? visits : [])) {
      const item = document.createElement('span');
      const dot = document.createElement('i');
      dot.style.background = PALETTE[v % PALETTE.length];
      item.append(dot, `Visit ${v + 1}`);
      el.chartLegend.append(item);
    }
  }
  const ph = src?.photometry;
  el.chartNote.textContent = onPoint ? pointNote(pt, ph, sum, !!lay) : (ph ? `Aperture photometry at the requested position: ${ph.aperture_radius_pix} pixel radius (about ${Math.round(ph.aperture_radius_pix * 6.2)}″), background from a ring ${ph.annulus_inner_pix} to ${ph.annulus_outer_pix} pixels out, not aperture-corrected. These sizes are first choices, not checked against a source of known brightness. ` : '')
    + (sum.measured < sum.total && lay ? `${sum.total - sum.measured} of ${sum.total} frames have no flux: ${reasonText(sum.reasons)}. ` : '')
    + (curve ? 'Time is the mid-exposure time of each image.' : '');
  el.chart.setAttribute('aria-label', `${curve ? 'Light curve' : onPoint ? 'Clicked point spectrum' : 'Spectrum'}: ${lay ? lay.dots.length : 0} measured frames`);
}

/** What the chart area says when the clicked point has nothing to draw: nothing clicked yet, an error, waiting, or no measurable frame. */
function pointMessage(pt, measured, sum) {
  if (!pt) return 'Click a point on the image to measure its brightness in every frame.';
  const resp = pt.resp;
  if (resp?.status === 'error') return resp.error?.message ?? 'The spectrum could not be measured.';
  if (!resp || (resp.status === 'loading' && !measured)) {
    const p = resp?.progress;
    return pt.cached
      ? `Building a live series at this position to measure the point${p?.total ? `: ${p.done} of ${p.total} frames in` : ''}. The first click on a cached target takes minutes, because the cached frames are not kept on the server and the archive is asked again.`
      : `Measuring the clicked point${p?.total ? `: ${p.done} of ${p.total} frames in` : ''}…`;
  }
  return `No flux could be measured at this point in any of the ${sum.total} frames. Reason: ${reasonWords(sum.reasons)}. This is not zero flux.`;
}

/** The small print under the clicked-point chart: method, progress, why some frames have no flux, and which frames these are. */
function pointNote(pt, ph, sum, drawn) {
  const parts = [];
  if (ph) parts.push(`Real SPHEREx data. Aperture photometry at the clicked position, ${ph.aperture_radius_pix} pixel radius, background from a ring ${ph.annulus_inner_pix} to ${ph.annulus_outer_pix} pixels out, not aperture-corrected; the same method as the flux at the requested position (checked against 2MASS stars there, not at other positions).`);
  if (pt?.resp?.status === 'loading' && drawn) parts.push(`Still loading: ${pt.resp.progress.done} of ${pt.resp.progress.total} frames so far.`);
  if (drawn && sum.measured < sum.total) parts.push(`${sum.total - sum.measured} of ${sum.total} frames have no flux: ${reasonText(sum.reasons)}.`);
  if (pt?.cached) parts.push('These frames are not the cached frames shown in the image: the server builds a live series at this position and chooses its frames by its own rule (spread over dates and bands), so the points cannot be opened as frames here.');
  return parts.join(' ');
}

function clearPoint() {
  state.point?.abort?.abort();
  state.point = null;
  if (state.chartTab === 'point') state.chartTab = 'spectrum';
}

/** The marker on the image at the clicked point; follows the zoom. */
function renderPointMarker() {
  const pt = state.point;
  el.pointMarker.hidden = !pt;
  if (!pt) return;
  const { u, v } = imageToBox(pt.fx, pt.fy, Number(el.zoom.value));
  el.pointMarker.hidden = u < 0 || u > 1 || v < 0 || v > 1;
  el.pointMarker.style.left = `${u * 100}%`;
  el.pointMarker.style.top = `${v * 100}%`;
}

/** Measure the point on the live series at the current position. A cached target has no cutouts on the server, so the API starts a live series there. */
async function measurePoint() {
  const pt = state.point;
  if (!pt || !state.pos) return;
  pt.abort?.abort();
  pt.abort = new AbortController();
  const { ra, dec, fov } = state.pos;
  try {
    await pollSpectrum(ra, dec, fov, pt, {
      load: pt.cached ? SPECTRUM_LOAD : state.load ?? SPECTRUM_LOAD, // a live series on screen is measured as loaded, not extended
      signal: pt.abort.signal,
      onUpdate: (resp) => { if (state.point === pt) { pt.resp = resp; pt.doneAt = resp.progress.done; render(); } },
    });
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }
}

/** A click on the image: where on the sky, then its spectrum. */
function onImageClick(e) {
  const g = state.resp?.grid;
  if (!g || !state.pos || el.frameBox.hidden) return;
  const box = el.canvas.getBoundingClientRect();
  const { fx, fy } = clickToImage((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height, Number(el.zoom.value));
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
  const { ra, dec } = pixelToSky(g, fx, fy);
  state.point?.abort?.abort();
  state.point = { ra, dec, fx, fy, cached: isCachedPosition(state.targets, state.pos.ra, state.pos.dec, state.pos.fov), resp: null, abort: null, doneAt: -1 };
  state.chartTab = 'point';
  measurePoint();
  render();
}

function selectFrame(frameIndex) {
  if (stackView()) { setView('frames'); reslot(); }
  const slot = state.slots.findIndex((s) => !s.skipped && s.index === frameIndex);
  if (slot >= 0) pickSlot(slot);
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
  const spec = padActive();
  if (state.playMode === 'visits' && spec) {
    state.holdWl ??= currentWavelength(); // held from the moment blinking across visits begins
    if (state.holdWl) return go(cycleVisit(spec, state.current, state.holdWl));
  } else if (state.playMode === 'wl' && spec) {
    const next = pingPong(spec, state.current, state.dir);
    state.dir = next.dir;
    return go(next.slot);
  }
  go(advance(1, { skipFailed: true }));
}

/** mode: 'visits' (hold the wavelength, change visit), 'wl' (hold the visit, walk the wavelengths), or 'frames' (every frame in time order). Default: the first that fits. */
function startPlaying(mode) {
  if (state.slots.filter((s) => !s.skipped).length < 2) return;
  const m = padMode();
  state.playMode = mode ?? (m === 'multi' ? 'visits' : m === 'single' ? 'wl' : 'frames');
  state.playing = true;
  state.holdWl = currentWavelength(); // the wavelength held while blinking across visits
  state.dir = 1;
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
  // More frames of a live series arrived after the clicked point was measured: measure those too.
  const pt = state.point;
  if (pt && !pt.cached && pt.resp && pt.resp.status !== 'loading' && resp.progress.done > pt.doneAt) measurePoint();
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
  clearPoint();
  el.ra.value = String(ra);
  el.dec.value = String(dec);
  el.fov.value = String(fov);
  const url = locationQuery(ra, dec, fov);
  if (push) history.pushState(null, '', url);
  markTargets();
  el.progressText.textContent = 'Requesting series…';
  el.message.hidden = true;
  state.startedAt = Date.now();
  // A cached target is served whole; any other position is built live, a first batch at a time.
  state.load = isCachedPosition(state.targets, ra, dec, fov) ? null : INITIAL_LOAD;
  render();
  await poll(ra, dec, fov, state.load);
}

async function poll(ra, dec, fov, load) {
  try {
    await pollSeries(ra, dec, { fov, load, onUpdate, signal: state.abort.signal });
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }
}

/** Ask for `total` frames in all: the same series is extended, what is on screen stays while the new frames arrive. */
async function loadMore(total) {
  if (!state.pos) return;
  state.abort?.abort();
  state.abort = new AbortController();
  state.load = total;
  state.startedAt = Date.now();
  render();
  await poll(state.pos.ra, state.pos.dec, state.pos.fov, total);
}

function markTargets() {
  let current = null;
  for (const b of el.targets.querySelectorAll('button')) {
    const t = state.targets[Number(b.dataset.i)];
    const on = !!state.pos && t.ra === state.pos.ra && t.dec === state.pos.dec && state.pos.fov === FOV_DEG;
    b.setAttribute('aria-pressed', String(on));
    if (on) current = t.name;
  }
  el.targetsCurrent.textContent = current ?? (state.pos ? 'Your own position' : 'Pick a cached target');
}

function renderTargets() {
  el.targets.replaceChildren(...state.targets.map((t, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.i = String(i);
    b.dataset.id = t.id;
    const name = document.createElement('span'); name.className = 'name'; name.textContent = t.name;
    const note = document.createElement('span'); note.className = 'note'; note.textContent = `RA ${t.ra}, Dec ${t.dec}. ${t.position_note}`; note.title = note.textContent; // one line here, in full on hover
    b.append(name, note);
    b.addEventListener('click', () => { el.targetsMenu.open = false; load(t.ra, t.dec, { push: true }); }); // the cached series: default field of view
    li.append(b);
    return li;
  }));
  markTargets();
}

el.moreBtn.addEventListener('click', () => loadMore(Number(el.moreBtn.dataset.total)));
el.moreAll.addEventListener('click', () => loadMore(Number(el.moreAll.dataset.total)));
el.play.addEventListener('click', () => { state.playing ? stopPlaying() : startPlaying(); render(); });
el.playWl.addEventListener('click', () => { state.playing ? stopPlaying() : startPlaying('wl'); render(); });
el.prev.addEventListener('click', () => { stopPlaying(); if (padMode() === 'multi') pickSlot(stepVisit(padActive(), state.current, -1)); else go(advance(-1)); render(); });
el.next.addEventListener('click', () => { stopPlaying(); if (padMode() === 'multi') pickSlot(stepVisit(padActive(), state.current, 1)); else go(advance(1)); render(); });
el.wdown.addEventListener('click', () => { stopPlaying(); pickSlot(stepWavelength(padActive(), state.current, -1)); render(); });
el.wup.addEventListener('click', () => { stopPlaying(); pickSlot(stepWavelength(padActive(), state.current, 1)); render(); });
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
  const info = visitInfo();
  if (!info) return;
  const r = el.vtrack.getBoundingClientRect();
  const to = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (info.items.length - 1));
  if (to !== info.at) pickSlot(info.pick(to));
}
let draggingVisit = false;
el.vtrack.addEventListener('pointerdown', (e) => { draggingVisit = true; el.vtrack.setPointerCapture(e.pointerId); el.slider.focus({ preventScroll: true }); pickOnVisits(e); });
el.vtrack.addEventListener('pointermove', (e) => { if (draggingVisit) pickOnVisits(e); });
for (const t of ['pointerup', 'pointercancel']) el.vtrack.addEventListener(t, () => { draggingVisit = false; });
// "By date" (stacked visits) and "By wavelength" (individual frames) set the hidden view selector.
el.segDate.addEventListener('click', () => { if (state.resp?.stacks && !stackView()) { setView('stack'); reslot(); } });
el.segWl.addEventListener('click', () => { if (stackView()) { setView('frames'); reslot(); } });
el.tabSpectrum.addEventListener('click', () => { state.chartTab = 'spectrum'; render(); });
el.tabPoint.addEventListener('click', () => { state.chartTab = 'point'; render(); });
el.canvas.addEventListener('click', onImageClick);
el.tabCurve.addEventListener('click', () => { state.chartTab = 'curve'; render(); });
el.chart.addEventListener('click', (e) => { const g = e.target.closest('.chart-dot'); if (g) selectFrame(Number(g.dataset.index)); });
el.chart.addEventListener('keydown', (e) => { const g = e.target.closest?.('.chart-dot'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectFrame(Number(g.dataset.index)); } });
el.zoom.addEventListener('change', render);
el.mark.addEventListener('change', render);
el.view.addEventListener('change', () => { setView(el.view.value); reslot(); });
for (const c of [el.band, el.diff]) c.addEventListener('change', reslot);
el.pair.addEventListener('change', () => {
  state.pair = el.pair.checked ? blinkPair(state.slots) : null;
  if (state.pair) { go(state.pair[0]); startPlaying(); }
  render();
});
el.fps.addEventListener('change', () => { if (state.playing) startPlaying(state.playMode); });
// Paste "RA Dec" into either box and both fill; a single value pastes as usual.
for (const box of [el.ra, el.dec]) {
  box.addEventListener('paste', (e) => {
    const both = splitCoordinates(e.clipboardData?.getData('text'));
    if (!both) return;
    e.preventDefault();
    [el.ra.value, el.dec.value] = both;
  });
}
document.addEventListener('click', (e) => { if (el.targetsMenu.open && !el.targetsMenu.contains(e.target)) el.targetsMenu.open = false; });
el.coords.addEventListener('submit', (e) => {
  e.preventDefault();
  const ra = parseAngle(el.ra.value, 'ra'), dec = parseAngle(el.dec.value, 'dec');
  if (ra === null || dec === null) {
    el.message.hidden = false;
    el.message.textContent = 'Enter RA below 360 and Dec from -90 to 90, as decimal degrees (133.795129, -7.245147) or as hours and degrees (08h55m10.831s, -7d14m42.53s).';
    return;
  }
  load(Number(ra.toFixed(6)), Number(dec.toFixed(6)), { fov: parseFov(el.fov.value), push: true });
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
