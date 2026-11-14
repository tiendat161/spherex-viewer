import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

describe('production bundle', () => {
  it('has no archive hostname, no mock, and only relative /api/ requests', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'web-dist-'));
    await build({ root: webRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const text = walk(outDir).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(text.length).toBeGreaterThan(1000);
    expect(text).not.toContain('irsa.ipac.caltech.edu');
    expect(text).not.toMatch(/ipac|caltech/i);
    expect(text).not.toContain('spherex-mock-api');
    expect(text).not.toContain('placeholderFrame');
    expect(text).toContain('/api/series');
    expect(text).toContain('/api/targets');
    expect(text).not.toMatch(/fetch\(\s*["'`]https?:/);
  }, 60000);
});
