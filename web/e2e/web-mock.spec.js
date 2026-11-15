import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const outDir = fileURLToPath(new URL('../../verify/out/', import.meta.url));
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

test('visit slider and the vertical wavelength slider', async ({ page }) => {
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

  // Visit slider: click the middle mark, drag to the last, keep the wavelength as nearly as possible.
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

test('two play buttons follow the two sliders: across visits holds the wavelength, through wavelengths holds the visit', async ({ page }) => {
  await page.goto(wise);
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#play')).toHaveText('Pause');
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Play across visits');
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
  await expect(page.locator('#play')).toHaveText('Play across visits');

  // Through wavelengths: the visit stays, the wavelength goes up to the end and comes back.
  await page.locator('#play-wl').click();
  await expect(page.locator('#play-wl')).toHaveText('Pause');
  await expect(page.locator('#play')).toBeDisabled();
  await expect(page.locator('#play-note')).toContainText('through the wavelengths of visit');
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
    const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
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

  // The caption says in words what is on screen; the toggle is by date or by wavelength (the mock has no stacks, so only wavelength).
  await page.goto(wise);
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#caption')).toContainText('One image');
  await expect(page.locator('#caption')).toContainText('µm');
  await expect(page.locator('#seg-wl')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#seg-date')).toBeDisabled();
  // Advanced settings are folded away.
  await expect(page.locator('#advanced')).not.toHaveAttribute('open', '');
  await expect(page.locator('#zoom')).toBeHidden();
  await page.locator('#advanced summary').click();
  await expect(page.locator('#zoom')).toBeVisible();
  await page.screenshot({ path: outDir + 'web-mock-topbar.png', fullPage: true });
});
