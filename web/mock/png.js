// Minimal 8-bit grayscale PNG encoder (node:zlib only) and the placeholder frame generator.
import { deflateSync } from 'node:zlib';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

export function encodeGray(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8-bit grayscale
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width, width).copy(raw, y * (width + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 3x5 glyphs for the SIMULATED watermark and frame number.
const GLYPHS = {
  S: '111100111001111', I: '111010010010111', M: '1000111011101011000110001', U: '101101101101111',
  L: '100100100100111', A: '010101111101101', T: '111010010010010', E: '111100111100111', D: '110101101101110',
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
  ' ': '000000000000000',
};
function text(px, w, str, x0, y0, scale, value) {
  let cx = x0;
  for (const ch of str) {
    const g = GLYPHS[ch];
    if (!g) continue;
    const gw = g.length / 5; // 3 columns, or 5 for M
    for (let r = 0; r < 5; r++) for (let c = 0; c < gw; c++) if (g[r * gw + c] === '1')
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const x = cx + c * scale + dx, y = y0 + r * scale + dy;
        if (x >= 0 && x < w && y >= 0) px[y * w + x] = value;
      }
    cx += (gw + 1) * scale;
  }
}

/**
 * SIMULATED placeholder frame: seeded noise, fixed "stars", a dot that moves a little each frame
 * (so blinking has something to show), hatched border and a SIMULATED watermark.
 * None of this is sky data.
 */
export function placeholderFrame(index, w = 116, h = 116) {
  const px = new Uint8Array(w * h);
  let seed = 12345 + index * 7919;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < px.length; i++) px[i] = 30 + Math.floor(rnd() * 25);
  const star = (x, y, v) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && X < w && Y >= 0 && Y < h) px[Y * w + X] = Math.max(px[Y * w + X], v - (Math.abs(dx) + Math.abs(dy)) * 50);
    }
  };
  let s2 = 99;
  for (let k = 0; k < 14; k++) { s2 = (Math.imul(s2, 1103515245) + 12345) >>> 0; const x = 6 + (s2 % (w - 12)); s2 = (Math.imul(s2, 1103515245) + 12345) >>> 0; star(x, 6 + (s2 % (h - 12)), 150 + (s2 % 100)); }
  star(Math.round(w / 2 + 14 + index * 0.7), Math.round(h / 2 - 10 + index * 0.5), 255); // the "moving object"
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x < 3 || y < 3 || x >= w - 3 || y >= h - 3) && (x + y) % 6 < 3) px[y * w + x] = 255;
  text(px, w, 'SIMULATED', 8, h - 16, 2, 200);
  text(px, w, String(index + 1).padStart(2, '0'), 8, 8, 2, 200);
  return encodeGray(w, h, px);
}
