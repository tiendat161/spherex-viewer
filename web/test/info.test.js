import { describe, expect, it } from 'vitest';
import { infoVisible, placePopover } from '../src/info.js';

describe('infoVisible', () => {
  it('is shown by hover, focus or a pin, and a click or Escape hides it until the pointer leaves', () => {
    expect(infoVisible({})).toBe(false);
    expect(infoVisible({ hover: true })).toBe(true);
    expect(infoVisible({ focus: true })).toBe(true);
    expect(infoVisible({ pinned: true })).toBe(true);
    expect(infoVisible({ hover: true, suppressed: true })).toBe(false);
    expect(infoVisible({ focus: true, suppressed: true })).toBe(false);
    expect(infoVisible({ pinned: true, hover: true, suppressed: true })).toBe(true); // a pin wins; closing a pin clears it first
  });
});

describe('placePopover', () => {
  const a = (left, top) => ({ left, top, right: left + 18, bottom: top + 18 });
  it('goes below the icon, centred on it', () => {
    const p = placePopover(a(500, 100), { width: 200, height: 80 }, 1280, 900);
    expect(p.placement).toBe('below');
    expect(p.top).toBe(100 + 18 + 6);
    expect(p.left).toBe(509 - 100);
  });
  it('flips above when it does not fit below and there is more room above', () => {
    const p = placePopover(a(500, 800), { width: 200, height: 150 }, 1280, 900);
    expect(p.placement).toBe('above');
    expect(p.top).toBe(800 - 6 - 150);
  });
  it('is kept inside the screen at the left and right edges', () => {
    expect(placePopover(a(0, 100), { width: 300, height: 50 }, 375, 700).left).toBe(8);
    const r = placePopover(a(360, 100), { width: 300, height: 50 }, 375, 700);
    expect(r.left).toBe(375 - 300 - 8);
  });
  it('limits the height to the room it has when the text is long', () => {
    const p = placePopover(a(100, 300), { width: 300, height: 2000 }, 375, 700);
    expect(p.maxHeight).toBeLessThanOrEqual(700);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(700 - 8 + 1);
  });
});
