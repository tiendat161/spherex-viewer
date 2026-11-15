// One test per cached target against the real API (see verify/e2e.py).
// E2E_TARGETS is a JSON array of {id, ra, dec, done, total} taken from the API's own responses.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const outDir = fileURLToPath(new URL('../../verify/out/', import.meta.url));
const targets = JSON.parse(process.env.E2E_TARGETS || '[]');

test('target list was passed in', () => {
  expect(process.env.E2E_BASE_URL, 'run through `make verify`, not directly').toBeTruthy();
  expect(targets.length).toBeGreaterThan(0);
});

for (const t of targets) {
  test(`${t.id}: real badge, frames drawn, same-origin only, screenshot`, async ({ page }) => {
    const origin = new URL(process.env.E2E_BASE_URL).origin;
    const requests = [];
    const failed = [];
    page.on('request', (r) => requests.push(new URL(r.url())));
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

    await page.goto(`/?ra=${t.ra}&dec=${t.dec}`);
    await expect(page.locator('#badge')).toHaveText('REAL DATA');
    await expect(page.locator('#progress-text')).toContainText(`${t.done} / ${t.total} frames`);
    await expect(page.locator('#targets button')).toHaveCount(targets.length);
    await expect(page.locator('#message')).toBeHidden();

    // A cached series opens in the stacked view: one deep image per visit, centre not marked.
    await expect(page.locator('#view')).toHaveValue('stack');
    await expect(page.locator('#r-frame')).toHaveText(/^Visit \d+ of \d+$/);
    await expect(page.locator('#r-wave')).toContainText('combined');
    await expect(page.locator('#marker')).toBeHidden();
    await expect(page.locator('#vaxis')).toBeHidden(); // no wavelength slider for stacks
    await expect(page.locator('#seg-date')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#caption')).toContainText('images combined');
    await expect(page.locator('.visit-mark').first()).toBeVisible(); // the visit slider is the same one as for the frames
    await expect(page.locator('#play')).toHaveText('Pause');
    await page.locator('#play').click();
    await page.locator('#slider').fill('0');
    await page.evaluate(() => { document.getElementById('advanced').open = true; });
    await page.locator('#mark').check();
    await expect(page.locator('#marker')).toBeVisible();
    await page.locator('#diff').check();
    await expect(page.locator('#r-frame')).toContainText('minus first');
    await page.locator('#diff').uncheck();
    await page.locator('#slider').fill('1');
    mkdirSync(outDir, { recursive: true });
    await expect.poll(() => page.evaluate(() => document.getElementById('canvas').width)).toBe(116);
    await page.screenshot({ path: `${outDir}${t.id}-stack.png`, fullPage: true });

    // Individual frames: pause on a middle frame so the screenshot is repeatable.
    await page.locator('#seg-wl').click();
    await expect(page.locator('#view')).toHaveValue('frames');
    await expect(page.locator('#vaxis')).toBeVisible();
    const mid = Math.floor(t.done / 2);
    await page.locator('#slider').fill(String(mid));
    await expect(page.locator('#r-frame')).toContainText(` of ${t.total}`);
    await expect(page.locator('#r-date')).toHaveText(/^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
    await expect(page.locator('#r-wave')).toHaveText(/µm$/);

    // The flux panel: a spectrum when some frames could be measured, a plain message (not an empty chart) when none could.
    await expect(page.locator('#charts')).toBeVisible();
    const measured = await page.locator('.chart-dot').count();
    if (measured > 0) {
      await expect(page.locator('#chart-title')).toContainText(`${measured} of ${t.done} frames measured`);
      await expect(page.locator('#chart-title')).not.toContainText('SIMULATED');
      await page.locator('#tab-curve').click();
      await expect(page.locator('#chart-title')).toContainText(/Flux at about|Light curve/);
      await page.locator('#tab-spectrum').click();
    } else {
      await expect(page.locator('#chart-message')).toContainText('not zero flux');
    }

    // The frame is drawn at the grid size and is not a blank image.
    await expect.poll(() => page.evaluate(() => {
      const c = document.getElementById('canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
      return c.width === 116 && c.height === 116 && hi - lo > 50;
    })).toBe(true);

    // Every frame PNG was requested from our API, nothing failed, nothing left our origin.
    const frames = requests.filter((u) => new RegExp(`^/api/frames/${t.id}/\\d+\\.png$`).test(u.pathname));
    expect(frames.length).toBe(t.done);
    expect(failed).toEqual([]);
    expect(requests.filter((u) => u.origin !== origin).map(String)).toEqual([]);

    mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: `${outDir}${t.id}.png`, fullPage: true });
  });
}
