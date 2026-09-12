/**
 * Generates the PWA icons.
 *
 * Written by hand rather than pulled from an image library: the mark is three
 * rounded bars — two entries and a heavier total rule — so it rasterises from a
 * few signed-distance checks, and the project keeps one less native dependency.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const ACCENT = [20, 92, 85]; // #145C55
const INK = [251, 250, 248]; // #FBFAF8

/** Distance from a point to a rounded rectangle, negative inside. */
function roundedRectSdf(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * @param size    pixel dimension
 * @param padding fraction of the canvas kept clear, for maskable icons
 */
function render(size, padding = 0) {
  const ss = 3; // supersample factor, for clean edges
  const n = size * ss;
  const pixels = new Uint8Array(size * size * 4);

  // Bars: [centre-y, width, height] as fractions of the mark area.
  const bars = [
    [0.30, 0.62, 0.105],
    [0.50, 0.40, 0.105],
    [0.735, 0.62, 0.15], // the total rule, deliberately heavier
  ];

  const inset = padding * n;
  const markSize = n - inset * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x * ss + sx + 0.5;
          const py = y * ss + sy + 0.5;

          let colour = ACCENT;
          for (const [cy, w, h] of bars) {
            const halfW = (w * markSize) / 2;
            const halfH = (h * markSize) / 2;
            const d = roundedRectSdf(
              px, py,
              inset + markSize / 2,
              inset + cy * markSize,
              halfW, halfH,
              halfH,
            );
            if (d <= 0) { colour = INK; break; }
          }
          r += colour[0]; g += colour[1]; b += colour[2];
        }
      }
      const samples = ss * ss;
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(r / samples);
      pixels[i + 1] = Math.round(g / samples);
      pixels[i + 2] = Math.round(b / samples);
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

// --- minimal PNG writer ----------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });

for (const [name, size, padding] of [
  ['icon-192.png', 192, 0.16],
  ['icon-512.png', 512, 0.16],
  ['apple-touch-icon.png', 180, 0.14],
]) {
  writeFileSync(`public/${name}`, png(size, render(size, padding)));
  console.log(`public/${name}`);
}

// A matching favicon, as vector so it stays crisp in a tab.
const bars = [
  { y: 30, w: 62, h: 10.5 },
  { y: 50, w: 40, h: 10.5 },
  { y: 73.5, w: 62, h: 15 },
]
  .map((b) => `<rect x="${(100 - b.w) / 2}" y="${b.y - b.h / 2}" width="${b.w}" height="${b.h}" rx="${b.h / 2}" fill="#FBFAF8"/>`)
  .join('');

writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#145C55"/>${bars}</svg>\n`,
);
console.log('public/favicon.svg');
