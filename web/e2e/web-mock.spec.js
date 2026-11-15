import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const outBase = fileURLToPath(new URL('../../verify/out/', import.meta.url));
// Chromium screenshots keep their names; other browsers write to verify/out/<browser>/.
let outDir = outBase;
test.beforeEach(({}, info) => { outDir = info.project.name === 'chromium' ? outBase : `${outBase}${info.project.name}/`; });
const wise = '/?ra=133.795129&dec=-7.245147';
// The target menu and the advanced settings are folded away until opened.
const openAdvanced = (page) => page.evaluate(() => { document.getElementById('advanced').open = true; });
const openTargets = (page) => page.evaluate(() => { document.getElementById('targets-menu').open = true; });

test('mock: simulated badge, 40 frames, play/step/slider, screenshot', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => requests.push(new URL(r.url())));
  await page.goto(wise);

  await expect(page.locator('#badge')).toHaveText('SIMULATED DATA');
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#slider')).toHaveAttribute('max', '39');
  await expect(page.locator('#targets button')).toHaveCount(5);
  await expect(page.locator('#targets')).toContainText('MOCK');

  // Playing advances the frame; pausing freezes it.
  await expect(page.locator('#play')).toHaveText('Pause');
  const first = await page.locator('#r-frame').textContent();
  await expect.poll(() => page.locator('#r-frame').textContent()).not.toBe(first);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText(/^Play/);

  // The step buttons follow the two sliders: visit forward and back, wavelength up and down.
  await page.locator('#slider').fill('0');
  await expect(page.locator('#r-frame')).toHaveText('1 of 40');
  await page.locator('#next').click();
  await expect(page.locator('.visit-labels .cur')).toHaveAttribute('data-visit', '1');
  await page.locator('#prev').click();
  await expect(page.locator('.visit-labels .cur')).toHaveAttribute('data-visit', '0');
  await page.locator('#slider').fill('9');
  await expect(page.locator('#r-frame')).toHaveText('10 of 40');
  await expect(page.locator('#r-date')).toHaveText(/^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
  await expect(page.locator('#r-wave')).toHaveText(/µm$/);
  await expect(page.locator('#r-flag')).toHaveText(/ %$/);

  // The frame image actually loaded and is drawn at 116x116.
  await expect.poll(() => page.evaluate(() => {
    const c = document.getElementById('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return c.width === 116 && c.height === 116 && d.some((v, i) => i % 4 === 0 && v > 100);
  })).toBe(true);

  // Target picker sets the URL; an uncached mock target shows the error message.
  await openTargets(page);
  await page.locator('#targets button').nth(2).click();
  await expect(page.locator('#message')).toContainText('only WISE 0855 and Barnard');
  expect(page.url()).toMatch(/\?ra=331\.\d+&dec=-56\.\d+/);
  await openTargets(page);
  await page.locator('#targets button').nth(1).click();
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#badge')).toHaveText('SIMULATED DATA');
  expect(page.url()).toMatch(/\?ra=269\.\d+&dec=4\.\d+/);
  await openTargets(page);
  await page.locator('#targets button').nth(0).click();
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#play')).toHaveText('Pause');
  await page.locator('#play').click();
  await page.locator('#slider').fill('12');
  await expect(page.locator('#r-frame')).toHaveText('13 of 40');
  await expect(page.locator('#targets button').nth(0)).toHaveAttribute('aria-pressed', 'true');

  // Only same-origin requests.
  expect(requests.every((u) => u.origin === 'http://localhost:5199')).toBe(true);

  mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: outDir + 'web-mock.png', fullPage: true });
});

test('partial frames while loading, then ready', async ({ page }) => {
  const fixture = await (await page.request.get('/api/series?ra=133.795129&dec=-7.245147&fov=0.2&max_frames=102')).json();
  let n = 0;
  await page.route('**/api/series*', (route) => {
    n++;
    const done = Math.min(40, n * 10);
    const body = n < 3 ? { ...fixture, status: 'loading', grid: null, stretch: null, progress: { done, total: 40, failed: 0 }, frames: fixture.frames.slice(0, done) } : fixture;
    return route.fulfill({ json: body });
  });
  await page.goto(wise);
  await expect(page.locator('#progress-text')).toHaveText('Loading: 10 / 40 frames');
  await expect(page.locator('#slider')).toHaveAttribute('max', '9');
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames', { timeout: 10000 });
});

test('zoom magnifies the centre; pair blink alternates two frames', async ({ page }) => {
  await page.goto(wise);
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await page.locator('#play').click();
  await page.locator('#slider').fill('0');
  const px = () => page.evaluate(() => {
    const c = document.getElementById('canvas');
    return { w: c.width, data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) };
  });
  await expect.poll(async () => (await px()).data.some((v) => v > 100)).toBe(true);
  const full = await px();
  await openAdvanced(page);
  await page.locator('#zoom').selectOption('4');
  const zoomed = await px();
  expect(zoomed.w).toBe(116);
  // Canvas pixel (x, y) at 4x shows source pixel (43 + floor((x + 2) / 4), same for y): check a few.
  const at = (d, x, y) => d.data[(y * 116 + x) * 4];
  for (const [x, y] of [[0, 0], [58, 58], [115, 115], [30, 90]]) {
    expect(at(zoomed, x, y)).toBe(at(full, 43 + Math.floor((x + 2) / 4), 43 + Math.floor((y + 2) / 4)));
  }

  await page.locator('#pair').check();
  await expect(page.locator('#pair-note')).toContainText('days apart');
  await expect(page.locator('#play')).toHaveText('Pause');
  const seen = new Set();
  for (let i = 0; i < 12; i++) { seen.add(await page.locator('#r-frame').textContent()); await page.waitForTimeout(120); }
  expect(seen.size).toBe(2);
  await page.locator('#slider').fill('5');
  await expect(page.locator('#pair')).not.toBeChecked();
  await expect(page.locator('#pair-note')).toBeHidden();
});

test('field of view: selector, URL parameter, grid size, wide-field note', async ({ page }) => {
  const series = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === '/api/series') series.push(u.searchParams.get('fov')); });
  await page.goto(wise);
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#fov')).toHaveValue('0.2');
  await expect(page.locator('#fov-note')).toBeHidden();
  await expect(page.locator('#scalebar-label')).toHaveText('60″');

  // Choosing a size reloads the same position at that size and puts it in the URL.
  await openAdvanced(page);
  await page.locator('#fov').selectOption('0.5');
  await expect(page).toHaveURL(/\?ra=133\.795129&dec=-7\.245147&fov=0\.5$/);
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  expect(series.at(-1)).toBe('0.5');
  await expect.poll(() => page.evaluate(() => document.getElementById('canvas').width)).toBe(290);
  await expect(page.locator('#fov-note')).toBeVisible();
  await expect(page.locator('#fov-note')).toContainText('exact only at the centre');
  await expect(page.locator('#scalebar-label')).toHaveText('2′');
  await page.locator('#play').click();
  await page.locator('#slider').fill('3');
  mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: outDir + 'web-mock-fov05.png', fullPage: true });

  // Back restores 0.2; a link with &fov=1 opens at 1 degree; a cached-target button goes back to 0.2.
  await page.goBack();
  await expect(page.locator('#fov')).toHaveValue('0.2');
  await expect(page.locator('#fov-note')).toBeHidden();
  await page.goto(wise + '&fov=1');
  await expect(page.locator('#fov')).toHaveValue('1');
  await expect.poll(() => page.evaluate(() => document.getElementById('canvas').width)).toBe(581);
  await expect(page.locator('#fov-note')).toBeVisible();
  await expect(page.locator('#scalebar-label')).toHaveText('5′');
  await openTargets(page);
  await page.locator('#targets button').nth(0).click();
  await expect(page.locator('#fov')).toHaveValue('0.2');
  await expect(page).toHaveURL(/dec=-7\.245147$/);
  await expect.poll(() => page.evaluate(() => document.getElementById('canvas').width)).toBe(116);
});

test('epoch slider and the vertical wavelength slider', async ({ page }) => {
  await page.goto(wise);
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#play')).toHaveText('Pause');
  await page.locator('#play').click(); // stop the auto-blink
  await expect(page.locator('#play')).toHaveText(/^Play/);
  await expect(page.locator('#vaxis')).toBeVisible();
  await expect(page.locator('.visit-mark')).toHaveCount(3); // the mock series spans three groups of dates
  await expect(page.locator('.visit-labels .cur')).toHaveAttribute('data-visit', '0');

  const wave = async () => Number.parseFloat(await page.locator('#r-wave').textContent());
  const box = await page.locator('#vaxis-track').boundingBox();
  const x = box.x + box.width / 2;
  // Marks are evenly spaced, one per frame of this visit; the shortest wavelength is at the bottom.
  const marks = await page.locator('.vaxis-tick').count();
  expect(marks).toBeGreaterThan(2);
  await page.mouse.click(x, box.y + box.height - 1);
  const low = await wave();
  await page.mouse.click(x, box.y + 1);
  const high = await wave();
  expect(high).toBeGreaterThan(low);
  await expect(page.locator('.vaxis-labels .cur')).toHaveText(`${high.toFixed(2)} µm`);
  // Dragging follows the pointer.
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y - 8, { steps: 8 });
  await page.mouse.up();
  expect(await wave()).toBe(high);
  // One arrow step is one frame: down goes to a shorter wavelength.
  await page.keyboard.press('ArrowDown');
  expect(await wave()).toBeLessThan(high);
  await page.mouse.click(x, box.y + 1);
  const top = await wave();

  // Epoch slider: click the middle mark, drag to the last, keep the wavelength as nearly as possible.
  const vbox = await page.locator('#visit-track').boundingBox();
  const vy = vbox.y + vbox.height / 2;
  const date = () => page.locator('#r-date').textContent();
  const d0 = await date();
  await page.mouse.click(vbox.x + vbox.width / 2, vy);
  await expect(page.locator('.visit-labels .cur')).toHaveAttribute('data-visit', '1');
  expect(await date()).not.toBe(d0);
  expect(Math.abs(Math.log((await wave()) / top))).toBeLessThan(0.5); // nearest wavelength, not the same frame
  await page.mouse.move(vbox.x + vbox.width / 2, vy);
  await page.mouse.down();
  await page.mouse.move(vbox.x + vbox.width + 8, vy, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.visit-labels .cur')).toHaveAttribute('data-visit', '2');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.visit-labels .cur')).toHaveAttribute('data-visit', '1');
  await page.screenshot({ path: outDir + 'web-mock-pad.png', fullPage: true });
});

test('two play buttons follow the two sliders: across epochs holds the wavelength, through wavelengths holds the epoch', async ({ page }) => {
  await page.goto(wise);
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#play')).toHaveText('Pause');
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Play across epochs');
  await expect(page.locator('#play-wl')).toHaveText('Play through wavelengths');
  await expect(page.locator('#order')).toHaveCount(0); // no Order selector: the two sliders are the two orders

  // Across visits: start from a frame in the first visit; each visit always shows the same frame, so the wavelength does not drift.
  const box = await page.locator('#vaxis-track').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const held = Number.parseFloat(await page.locator('#r-wave').textContent());
  await openAdvanced(page);
  await page.locator('#fps').selectOption('10');
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Pause');
  await expect(page.locator('#play-wl')).toBeDisabled();
  await expect(page.locator('#play-note')).toContainText(`${held.toFixed(2)} µm`);
  const waveOf = new Map();
  for (let i = 0; i < 14; i++) {
    const [v, w] = await page.evaluate(() => [document.querySelector('.visit-labels .cur').dataset.visit, document.getElementById('r-wave').textContent]); // read together: playback is running
    expect(waveOf.get(v) ?? w).toBe(w);
    waveOf.set(v, w);
    await page.waitForTimeout(110);
  }
  expect(waveOf.size).toBe(3); // all three visits were shown
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Play across epochs');

  // Through wavelengths: the visit stays, the wavelength goes up to the end and comes back.
  await page.locator('#play-wl').click();
  await expect(page.locator('#play-wl')).toHaveText('Pause');
  await expect(page.locator('#play')).toBeDisabled();
  await expect(page.locator('#play-note')).toContainText('through the wavelengths of epoch');
  const visit = await page.locator('.visit-labels .cur').getAttribute('data-visit');
  const waves = [];
  for (let i = 0; i < 40; i++) {
    const [v, w] = await page.evaluate(() => [document.querySelector('.visit-labels .cur').dataset.visit, Number.parseFloat(document.getElementById('r-wave').textContent)]);
    expect(v).toBe(visit);
    if (waves.at(-1) !== w) waves.push(w);
    await page.waitForTimeout(110);
  }
  await page.locator('#play-wl').click();
  expect(waves.length).toBeGreaterThan(4);
  expect(waves.some((w, i) => i > 0 && w < waves[i - 1])).toBe(true); // it came back down
  expect(waves.some((w, i) => i > 0 && w > waves[i - 1])).toBe(true);
});

test('top bar: target menu, pasting RA and Dec, view toggle, caption', async ({ page }) => {
  await page.goto('/');
  // The target list is folded away in a bar; picking one closes it, names it in the bar and loads it.
  await expect(page.locator('#targets-menu')).not.toHaveAttribute('open', '');
  await expect(page.locator('#targets-current')).toHaveText('Pick a cached target');
  await expect(page.locator('#targets button').first()).toBeHidden();
  await page.locator('#targets-menu summary').click();
  await expect(page.locator('#targets button').first()).toBeVisible();
  await page.locator('#targets button').nth(1).click();
  await expect(page.locator('#targets-menu')).not.toHaveAttribute('open', '');
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#targets-current')).not.toHaveText('Pick a cached target');
  // Clicking elsewhere closes an open menu.
  await page.locator('#targets-menu summary').click();
  await page.locator('h1').click();
  await expect(page.locator('#targets-menu')).not.toHaveAttribute('open', '');

  // Paste RA and Dec together into either box: both fill. A single value pastes normally.
  const paste = (id, text) => page.evaluate(([i, t]) => {
    const dt = new DataTransfer();
    dt.setData('text', t);
    // Firefox's ClipboardEvent constructor drops the data, so a plain event carries it instead.
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: dt });
    document.getElementById(i).dispatchEvent(e);
    return e.defaultPrevented;
  }, [id, text]);
  expect(await paste('ra', '133.795129 -7.245147')).toBe(true);
  await expect(page.locator('#ra')).toHaveValue('133.795129');
  await expect(page.locator('#dec')).toHaveValue('-7.245147');
  expect(await paste('dec', '10.5, 20.25')).toBe(true);
  await expect(page.locator('#ra')).toHaveValue('10.5');
  await expect(page.locator('#dec')).toHaveValue('20.25');
  expect(await paste('ra', '77.7')).toBe(false); // one value: the browser pastes it as usual
  // Hours and degrees work too: pasted together they fill both boxes, and Load turns them into the same position as the degrees.
  expect(await paste('dec', '08h55m10.831s -7d14m42.53s')).toBe(true);
  await expect(page.locator('#ra')).toHaveValue('08h55m10.831s');
  await expect(page.locator('#dec')).toHaveValue('-7d14m42.53s');
  await page.getByRole('button', { name: 'Load' }).click();
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#ra')).toHaveValue('133.795129');
  await expect(page.locator('#dec')).toHaveValue('-7.245147');
  expect(page.url()).toContain('ra=133.795129&dec=-7.245147');
  // Something that is not a position gets a message that says what is accepted.
  await page.locator('#ra').fill('25h');
  await page.getByRole('button', { name: 'Load' }).click();
  await expect(page.locator('#message')).toContainText('08h55m10.831s');

  // The caption says in words what is on screen; the toggle is Combined or Single images (the mock has no stacks, so only Single images).
  await page.goto(wise);
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#caption')).toContainText('One image');
  await expect(page.locator('#caption')).toContainText('µm');
  await expect(page.locator('#seg-wl')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#seg-date')).toHaveText('Combined');
  await expect(page.locator('#seg-wl')).toHaveText('Single images');
  await expect(page.locator('#seg-date')).toBeDisabled();
  // Advanced settings are folded away.
  await expect(page.locator('#advanced')).not.toHaveAttribute('open', '');
  await expect(page.locator('#zoom')).toBeHidden();
  await page.locator('#advanced summary').click();
  await expect(page.locator('#zoom')).toBeVisible();
  await page.screenshot({ path: outDir + 'web-mock-topbar.png', fullPage: true });
});

test('a new position loads a first batch, says it is searching, then loads more on request', async ({ page }) => {
  const urls = [];
  page.on('request', (r) => { if (r.url().includes('/api/series')) urls.push(new URL(r.url())); });

  // A cached target is opened whole: no `load` parameter, no load buttons.
  await page.goto(wise);
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#more')).toBeHidden();
  expect(urls.every((u) => !u.searchParams.has('load'))).toBe(true);

  // Any other position: the archive search first (nothing to show yet), then the first 8 frames.
  urls.length = 0;
  // The mock remembers a position once it has been "searched" (one server for all browser projects), so each project uses its own.
  const ra = 10 + ['chromium', 'firefox', 'webkit'].indexOf(test.info().project.name);
  await page.goto(`/?ra=${ra}&dec=20`);
  await expect(page.locator('#progress-text')).toContainText('Asking the archive');
  await expect(page.locator('#progress-text')).toContainText(' s ');
  await expect(page.locator('#progress-text')).toHaveText('8 of 40 images loaded', { timeout: 10000 });
  expect(urls[0].searchParams.get('load')).toBe('8');
  await expect(page.locator('#more')).toBeVisible();
  await expect(page.locator('#more-btn')).toHaveText(/^Load 16 more \(under a minute\)$/);
  await expect(page.locator('#more-all')).toHaveText(/^Load all 40 \(.+, about 141 MB\)$/);
  await expect(page.locator('#slider')).toHaveAttribute('max', '7');

  // Load more: the same position asks for 24 in all and the screen keeps working; then the rest.
  await page.locator('#more-btn').click();
  await expect(page.locator('#progress-text')).toHaveText('24 of 40 images loaded');
  expect(urls.at(-1).searchParams.get('load')).toBe('24');
  await expect(page.locator('#slider')).toHaveAttribute('max', '23');
  await expect(page.locator('#more-btn')).toHaveText(/^Load 16 more/);
  await expect(page.locator('#more-all')).toBeHidden(); // one more step reaches everything, so there is only one button
  await page.locator('#more-btn').click();
  await expect(page.locator('#progress-text')).toHaveText('40 of 40 images loaded');
  expect(urls.at(-1).searchParams.get('load')).toBe('40');
  await expect(page.locator('#more')).toBeHidden(); // everything the archive lists is in
  await page.screenshot({ path: outDir + 'web-mock-staged.png', fullPage: true });
});

test('flux charts: spectrum and light curve next to the image, coloured by visit, a click shows the frame', async ({ page }) => {
  await page.goto(wise);
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#play')).toHaveText('Pause');
  await page.locator('#play').click();

  // The panel sits next to the image and says the data is simulated (this is the mock).
  await expect(page.locator('#charts')).toBeVisible();
  const box = await page.locator('#charts').boundingBox();
  const img = await page.locator('#frame-box').boundingBox();
  expect(box.x).toBeGreaterThan(img.x + img.width - 5); // to the right of the image, not below it
  await expect(page.locator('#chart-title')).toHaveText('SIMULATED. Flux at the requested position: 36 of 40 frames measured');
  await expect(page.locator('.chart-dot')).toHaveCount(36);
  await expect(page.locator('#chart-legend span')).toHaveCount(3); // one colour per visit
  await expect(page.locator('#chart-help')).toContainText('Each colour is one epoch');
  await expect(page.locator('#chart-method')).toContainText('not aperture-corrected');
  await expect(page.locator('#chart-note')).toContainText('4 of 40 frames have no flux');
  await expect(page.locator('#chart-method')).toContainText('first choices, not checked');

  // A click on a point shows that frame, and the point is marked.
  await page.locator('.chart-dot[data-index="10"]').click();
  await expect(page.locator('#slider')).toHaveValue('10');
  await expect(page.locator('#r-frame')).toHaveText('11 of 40');
  await expect(page.locator('.chart-dot[data-index="10"] circle')).toHaveAttribute('r', '5.5');
  await page.locator('.chart-dot[data-index="20"]').click();
  await expect(page.locator('#slider')).toHaveValue('20');
  await expect(page.locator('.chart-dot[data-index="10"] circle')).toHaveAttribute('r', '3.4');

  // Light curve: the frames within 5% of the wavelength on screen, by date. The mock's wavelengths step by 0.11 um, so frame 20 (2.9 um)
  // has two neighbours inside the window and frame 0 (0.75 um) has none.
  await page.locator('#tab-curve').click();
  await expect(page.locator('#tab-curve')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#chart-title')).toContainText('Flux at about 2.9');
  expect(await page.locator('.chart-dot').count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#chart-method')).toContainText('mid-exposure time');
  await expect(page.locator('#chart-help')).toContainText('larger than the error bars');
  await page.locator('#slider').fill('0');
  await expect(page.locator('#chart-message')).toContainText('Fewer than two measured frames near 0.75');
  await expect(page.locator('.chart-dot')).toHaveCount(0);
  await page.locator('#slider').fill('20');
  await page.locator('#tab-spectrum').click();
  await expect(page.locator('.chart-dot')).toHaveCount(36);
  await page.screenshot({ path: outDir + 'web-mock-charts.png', fullPage: true });
});

test('mock: catalogue overlay is off by default, draws circles with a hover label, and fails softly', async ({ page }) => {
  await page.goto(wise);
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#cat-canvas')).toBeHidden();
  await openAdvanced(page);
  await page.locator('#catalogue').check();
  await expect(page.locator('#cat-note')).toContainText('REAL catalogue data: 8 AllWISE');
  await expect(page.locator('#cat-detail')).toContainText('not corrected for proper motion');
  await expect(page.locator('#cat-canvas')).toBeVisible();
  // Hover the first circle: its designation and catalogue epoch appear.
  // The mock's source 0 is 0.03 deg east of the centre: 0.03 * cos(dec) * 3600 / 6.2 pixels left of the middle of the 116-pixel image.
  const box = await page.locator('#canvas').boundingBox();
  const fx = 0.5 - (0.03 * Math.cos((-7.245147 * Math.PI) / 180) * 3600) / 6.2 / 116;
  await page.mouse.move(box.x + box.width * fx, box.y + box.height / 2);
  await expect(page.locator('#cat-tip')).toContainText('MOCK-');
  await expect(page.locator('#cat-tip')).toContainText('catalogue epoch');
  await page.screenshot({ path: `${outDir}catalogue-overlay.png` });
  await page.locator('#catalogue').uncheck();
  await expect(page.locator('#cat-canvas')).toBeHidden();
});

test('mock: catalogue service failure gives a message and keeps the images', async ({ page }) => {
  await page.goto('/?ra=0&dec=0');
  await openAdvanced(page);
  await page.locator('#catalogue').check();
  await expect(page.locator('#cat-note')).toContainText('could not be fetched');
  await expect(page.locator('#badge')).not.toHaveText('NO DATA YET');
});

// Sky backdrop (T50). ?backdrop=on forces it for an automated browser; the real Aladin Lite is replaced by a stand-in.
const ALADIN = /cdn\.jsdelivr\.net\/npm\/aladin-lite@/;
const TILE = /\/Norder3\/Dir0\/Npix0\.jpg$/;
const STUB = `export default { init: Promise.resolve(),
  aladin(box, opts) {
  const c = document.createElement('canvas'); c.width = 50; c.height = 50; box.append(c);
  window.__flights = (window.__flights || 0); window.__opts = { projection: opts.projection, fov: opts.fov }; window.__aims = [];
  return { animateToRaDec(ra, dec) { window.__flights++; window.__aims.push([ra, dec]); }, zoomToFoV() {}, gotoRaDec(ra, dec) { window.__aims.push([ra, dec]); }, setFoV() {} };
} };`;
const stubHash = createHash('sha384').update(STUB).digest('base64');
const pixel = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const wide = { width: 1280, height: 900 };

test('mock: backdrop on with the script blocked leaves the page as it was (no label, no class)', async ({ page }) => {
  await page.setViewportSize(wide);
  await page.route(ALADIN, (r) => r.abort());
  await page.goto(wise + '&backdrop=on');
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.body.className)).toBe('');
  await expect(page.locator('#sky-label')).toBeHidden();
});

test('mock: backdrop gives up when no survey tile loads', async ({ page }) => {
  await page.setViewportSize(wide);
  await page.addInitScript((h) => { window.__skyHash = h; }, stubHash);
  await page.route(ALADIN, (r) => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.route(TILE, (r) => r.fulfill({ status: 404, contentType: 'text/html', body: 'nope' }));
  await page.goto(wise + '&backdrop=on');
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.body.className)).toBe('');
  await expect(page.locator('#sky-label')).toBeHidden();
});

test('mock: backdrop refuses a script whose hash does not match the pinned one', async ({ page }) => {
  await page.setViewportSize(wide);
  await page.route(ALADIN, (r) => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.route(TILE, (r) => r.fulfill({ contentType: 'image/jpeg', body: pixel }));
  await page.goto(wise + '&backdrop=on');
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.body.className)).toBe('');
});

test('mock: with the backdrop on the SPHEREx canvas still gets the pointer (there is no Clicked point tab any more)', async ({ page }) => {
  await page.setViewportSize(wide);
  await page.addInitScript((h) => { window.__skyHash = h; }, stubHash);
  await page.route(ALADIN, (r) => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.route(TILE, (r) => r.fulfill({ contentType: 'image/jpeg', body: pixel }));
  await page.goto(wise + '&backdrop=on');
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('body')).toHaveClass(/sky-on/);
  await expect(page.locator('#sky-label')).toBeVisible();
  await expect(page.locator('#sky-label')).toContainText('not SPHEREx data');
  await expect(page.locator('#sky-label')).toContainText('STScI/NASA, CDS');
  const skyInfo = page.locator('#sky-label .info-btn');
  const skyPop = page.locator('#' + (await skyInfo.getAttribute('aria-describedby')));
  await skyInfo.click();
  await expect(skyPop).toBeVisible();
  await expect(skyPop).toContainText('Digitized Sky Survey - STScI/NASA, Colored & Healpixed by CDS');
  await expect(skyPop).toContainText('sends the sky position to the survey tile servers');
  const sr = await skyPop.boundingBox(); // above the backdrop and the page
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.info-pop'), [sr.x + sr.width / 2, sr.y + sr.height / 2])).toBe(true);
  await page.screenshot({ path: outDir + 'web-mock-backdrop-info.png' });
  await skyInfo.click();
  expect(await page.evaluate(() => window.__flights)).toBeGreaterThanOrEqual(1);
  const box = await page.locator('#canvas').boundingBox();
  const x = box.x + box.width * 0.4, y = box.y + box.height * 0.6;
  expect(await page.evaluate(([a, b]) => document.elementFromPoint(a, b).id, [x, y])).toBe('canvas');
  await page.mouse.click(x, y); // T58: a click on the image does nothing
  await expect(page.locator('#tab-point')).toHaveCount(0);
  await expect(page.locator('#point-marker')).toHaveCount(0);
  await expect(page.locator('#tab-spectrum')).toHaveAttribute('aria-selected', 'true');
});

test('mock: with the backdrop on every option of the open target menu is on top and the last one loads', async ({ page }) => {
  await page.setViewportSize(wide);
  await page.addInitScript((h) => { window.__skyHash = h; }, stubHash);
  await page.route(ALADIN, (r) => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.route(TILE, (r) => r.fulfill({ contentType: 'image/jpeg', body: pixel }));
  await page.goto(wise + '&backdrop=on');
  await expect(page.locator('body')).toHaveClass(/sky-on/);
  await openTargets(page);
  const buttons = page.locator('#targets button');
  const n = await buttons.count();
  expect(n).toBeGreaterThan(1);
  for (let i = 0; i < n; i++) {
    const b = await buttons.nth(i).boundingBox();
    const inside = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.targets'), [b.x + b.width / 2, b.y + b.height / 2]);
    expect(inside, `option ${i}`).toBe(true);
  }
  await page.screenshot({ path: outDir + 'web-mock-backdrop-menu.png' });
  await buttons.nth(n - 1).click();
  await expect(page.locator('#targets-current')).not.toHaveText('Your own position');
  await expect(page.locator('#ra')).not.toHaveValue(/^133\.795/); // the last target was loaded (the mock has no series for it, so no frames are checked)
});

test('mock: the backdrop starts on its own with no position chosen, then flies when one is loaded', async ({ page }) => {
  await page.setViewportSize(wide);
  await page.addInitScript((h) => { window.__skyHash = h; }, stubHash);
  await page.route(ALADIN, (r) => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.route(TILE, (r) => r.fulfill({ contentType: 'image/jpeg', body: pixel }));
  await page.goto('/?backdrop=on');
  await expect(page.locator('body')).toHaveClass(/sky-on/);
  expect(await page.evaluate(() => window.__flights)).toBe(0);
  expect(await page.evaluate(() => window.__opts)).toEqual({ projection: 'SIN', fov: 360 }); // the idle view is the whole-sky globe (360 degrees across a wide window shows the whole sphere)
  await expect(page.locator('#sky-label .sky-idle')).toBeVisible();
  await page.evaluate(() => { document.getElementById('ra').value = '133.795'; document.getElementById('dec').value = '-7.245'; });
  await page.locator('#coords button[type=submit]').click();
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect.poll(() => page.evaluate(() => window.__flights)).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#sky-label .sky-idle')).toBeHidden();
  expect(await page.evaluate(() => window.__aims.at(-1))).toEqual([133.795, -7.245]); // flies to the loaded RA/Dec
  await expect(page.locator('#sky-label')).not.toContainText('cross');
});

test('mock: no backdrop below 900 px', async ({ page }) => {
  await page.addInitScript((h) => { window.__skyHash = h; }, stubHash);
  await page.route(ALADIN, (r) => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.route(TILE, (r) => r.fulfill({ contentType: 'image/jpeg', body: pixel }));
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(wise + '&backdrop=on');
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__opts)).toBeUndefined();
  await expect(page.locator('#sky-label')).toBeHidden();
});

test('mock: the image panel has the orange panel border', async ({ page }) => {
  await page.goto(wise);
  const c = await page.evaluate(() => {
    const st = getComputedStyle(document.querySelector('.stage'));
    return [st.borderTopColor, st.borderTopWidth, getComputedStyle(document.documentElement).getPropertyValue('--accent-panel').trim()];
  });
  expect(c).toEqual(['rgb(224, 123, 0)', '2px', '#e07b00']);
});

// The "i" icon (T51): hover shows, leaving hides, a click pins, a second click closes, Escape and a click elsewhere close.
test('mock: the i icon: hover shows and leaving hides, click pins, second click closes, Escape and an outside click close', async ({ page }) => {
  await page.goto('/');
  const btn = page.locator('.coords-hint .info-btn');
  const pop = page.locator('#' + (await btn.getAttribute('aria-describedby')));
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(pop).toBeHidden();
  await expect(pop).toHaveAttribute('role', 'tooltip');
  await btn.hover();
  await expect(pop).toBeVisible();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(pop).toContainText('Decimal degrees or sexagesimal');
  await page.mouse.move(600, 600);
  await expect(pop).toBeHidden();
  // click pins: it stays when the pointer leaves
  await btn.click();
  await page.mouse.move(600, 600);
  await page.waitForTimeout(300);
  await expect(pop).toBeVisible();
  // a second click closes it, also while the pointer is still on the button
  await btn.click();
  await expect(pop).toBeHidden();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  // Escape closes a pinned one
  await btn.click();
  await page.mouse.move(600, 600);
  await expect(pop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  // a click elsewhere closes a pinned one
  await btn.click();
  await page.mouse.click(600, 600);
  await expect(pop).toBeHidden();
});

test('mock: the i icon opens with the keyboard and only one is pinned at a time', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Safari does not Tab to buttons unless the user changes a setting');
  await page.goto('/');
  const a = page.locator('.coords-hint .info-btn');
  const popA = page.locator('#' + (await a.getAttribute('aria-describedby')));
  await page.keyboard.press('Tab'); // walks to the first focusable control; keep going until the icon has focus
  for (let i = 0; i < 12 && !(await a.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(a).toBeFocused();
  await expect(popA).toBeVisible(); // keyboard focus shows it
  await page.keyboard.press('Enter');
  await expect(popA).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(popA).toBeHidden();
  await a.click();
  await expect(popA).toBeVisible();
  await page.goto(wise);
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  const c = page.locator('#charts .info-btn[aria-label^="How to read"]');
  const popC = page.locator('#' + (await c.getAttribute('aria-describedby')));
  await c.click();
  await expect(popC).toBeVisible();
  await a.click();
  await expect(popC).toBeHidden();
});

test('mock: the i popover stays inside the screen, on a wide and a phone-sized one, and above the page', async ({ page }) => {
  for (const size of [{ width: 1280, height: 900 }, { width: 375, height: 700 }]) {
    await page.setViewportSize(size);
    await page.goto(wise);
    await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
    await openAdvanced(page);
    const btns = page.locator('.info-btn:visible');
    const n = await btns.count();
    expect(n).toBeGreaterThan(3);
    for (let i = 0; i < n; i++) {
      const b = btns.nth(i);
      await b.scrollIntoViewIfNeeded();
      await b.click();
      const pop = page.locator('#' + (await b.getAttribute('aria-describedby')));
      await expect(pop).toBeVisible();
      const r = await pop.boundingBox();
      expect(r.x, `${size.width}px, icon ${i}`).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(size.width);
      expect(r.y + r.height).toBeLessThanOrEqual(size.height);
      expect(r.width).toBeLessThanOrEqual(321);
      // nothing covers the middle of it
      expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.info-pop'), [r.x + r.width / 2, r.y + r.height / 2])).toBe(true);
      await b.click();
    }
  }
});

test('mock: the i texts are in place: sky label short, wide-field note short, catalogue and chart detail in popovers', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(wise + '&fov=0.5');
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#fov-note')).toContainText('exact only at the centre');
  const pop = page.locator('#fov-note .info-btn');
  await pop.click(); // a tap
  await expect(page.locator('#' + (await pop.getAttribute('aria-describedby')))).toContainText('has not been measured');
  await page.screenshot({ path: outDir + 'web-mock-info-phone.png' });
});

// T56: the archive being down is one short sentence; the long technical text is only in the "i".
const LONG = 'The archive query failed: TAP query failed after retries: HTTP 502; the SIA2 fallback also failed: SIA2 query spherex_dr1 failed after retries: HTTP 502';
const FRIENDLY = "The search failed because NASA's data archive (IRSA) is not available right now. Try again in a few minutes. The cached targets still work.";
test('mock: archive down shows a short friendly message, the technical text only in the "i"', async ({ page }) => {
  await page.route('**/api/series*', (route) => route.fulfill({ json: {
    status: 'error', data_origin: 'real', progress: { done: 0, total: 0, failed: 0 }, grid: null, stretch: null, frames: [],
    error: { message: FRIENDLY, detail: LONG } } }));
  await page.goto('/?ra=10&dec=20');
  const box = page.locator('#message');
  await expect(box).toBeVisible();
  await expect(page.locator('#message-text')).toHaveText(FRIENDLY);
  await expect(box).not.toContainText('502');
  await expect(box).not.toContainText('SIA2');
  await expect(page.locator('#message-detail')).toHaveText(LONG); // in the popover, which is not shown until asked for
  await expect(page.locator('#message-detail')).toBeHidden();
  await box.locator('.info-btn').click();
  await expect(page.locator('#message-detail')).toBeVisible();
  await expect(page.locator('#message-detail')).toContainText('HTTP 502');
  await page.screenshot({ path: `${outDir}error-archive-down.png` }); // popover open
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.locator('#message-detail')).toBeVisible();
  await page.screenshot({ path: `${outDir}error-archive-down-narrow.png` });
});

test('mock: a raw HTTP 502 from the server reads as a plain sentence too', async ({ page }) => {
  await page.route('**/api/series*', (route) => route.fulfill({ status: 502, body: '<html>Bad gateway</html>', contentType: 'text/html' }));
  await page.goto('/?ra=10&dec=20');
  await expect(page.locator('#message-text')).toHaveText('The server could not answer right now. Try again in a few minutes. The cached targets still work.');
  await expect(page.locator('#message')).not.toContainText('502');
  await expect(page.locator('#message-detail')).toContainText('HTTP 502');
});
