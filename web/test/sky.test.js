import { describe, expect, it } from 'vitest';
import { ALADIN_URL, SURVEY_ROOTS, backdropEnabled, backdropFov } from '../src/sky.js';

const fakeWindow = ({ search = '', webdriver = false, wide = true, gl = true } = {}) => ({
  location: { search },
  navigator: { webdriver },
  matchMedia: () => ({ matches: wide }),
  document: { createElement: () => ({ getContext: () => (gl ? {} : null) }) },
});

describe('sky backdrop', () => {
  it('is 1 degree wide for the small fields, 1.5x the field for 0.5 and 1 degree', () => {
    expect([0.1, 0.2, 0.5, 1].map(backdropFov)).toEqual([1, 1, 0.75, 1.5]);
  });
  it('is on for a wide screen with WebGL', () => {
    expect(backdropEnabled(fakeWindow())).toBe(true);
  });
  it('is off on a narrow screen, without WebGL, with ?backdrop=off, and for automated browsers', () => {
    expect(backdropEnabled(fakeWindow({ wide: false }))).toBe(false);
    expect(backdropEnabled(fakeWindow({ gl: false }))).toBe(false);
    expect(backdropEnabled(fakeWindow({ search: '?backdrop=off' }))).toBe(false);
    expect(backdropEnabled(fakeWindow({ webdriver: true }))).toBe(false);
    expect(backdropEnabled(fakeWindow({ webdriver: true, search: '?backdrop=on' }))).toBe(true);
  });
  it('loads one pinned Aladin Lite release', () => {
    expect(ALADIN_URL).toMatch(/aladin-lite@\d+\.\d+\.\d+\//);
    expect(SURVEY_ROOTS.length).toBeGreaterThan(1);
  });
});
