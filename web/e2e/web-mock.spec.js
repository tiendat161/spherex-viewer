import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const outDir = fileURLToPath(new URL('../../verify/out/', import.meta.url));
const wise = '/?ra=133.795129&dec=-7.245147';

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
  await expect(page.locator('#play')).toHaveText('Play');

  await page.locator('#slider').fill('9');
  await expect(page.locator('#r-frame')).toHaveText('10 of 40');
  await page.locator('#next').click();
  await expect(page.locator('#r-frame')).toHaveText('11 of 40');
  await page.locator('#prev').click();
  await page.locator('#prev').click();
  await expect(page.locator('#r-frame')).toHaveText('9 of 40');
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
  await page.locator('#targets button').nth(2).click();
  await expect(page.locator('#message')).toContainText('only WISE 0855 and Barnard');
  expect(page.url()).toMatch(/\?ra=331\.\d+&dec=-56\.\d+/);
  await page.locator('#targets button').nth(1).click();
  await expect(page.locator('#progress-text')).toHaveText('40 / 40 frames');
  await expect(page.locator('#badge')).toHaveText('SIMULATED DATA');
  expect(page.url()).toMatch(/\?ra=269\.\d+&dec=4\.\d+/);
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
  await expect(page.locator('#play')).toHaveText('Play');
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
