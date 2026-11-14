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
  const fixture = await (await page.request.get('/api/series?ra=133.795129&dec=-7.245147&fov=0.2&max_frames=40')).json();
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
