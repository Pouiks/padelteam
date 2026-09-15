'use strict';
/**
 * Génère les icônes PNG de l'application sans aucune dépendance :
 *   public/apple-touch-icon.png (180) — iOS n'accepte pas les SVG ici
 *   public/icon-192.png, public/icon-512.png — manifeste (any + maskable)
 *   public/badge-96.png — pastille monochrome des notifications Android
 * Même dessin que public/icon.svg : un « V » blanc sur fond vert.
 * Usage : npm run icons
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const GREEN = [0x15, 0x7a, 0x4a];
const OUT = path.join(__dirname, '..', 'public');

// --- Encodeur PNG minimal (RGBA 8 bits, sans filtre) ---------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filtre « None »
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // couleur RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Dessin ---------------------------------------------------------------------

/** Distance d'un point au segment [a, b]. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Rend un « V » à traits épais et bouts ronds.
 * @param size taille en pixels
 * @param background true : fond vert opaque ; false : transparent (pastille)
 */
function render(size, background) {
  const pixels = Buffer.alloc(size * size * 4);
  const [p0, p1, p2] = [
    [0.293, 0.293],
    [0.5, 0.727],
    [0.707, 0.293],
  ].map(([x, y]) => [x * size, y * size]);
  const halfWidth = (0.113 * size) / 2;
  const SS = 3; // sur-échantillonnage 3×3 pour l'anticrénelage

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let covered = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const cx = x + (sx + 0.5) / SS;
          const cy = y + (sy + 0.5) / SS;
          const d = Math.min(
            segmentDistance(cx, cy, p0[0], p0[1], p1[0], p1[1]),
            segmentDistance(cx, cy, p1[0], p1[1], p2[0], p2[1]),
          );
          if (d <= halfWidth) covered++;
        }
      }
      const alpha = covered / (SS * SS);
      const i = (y * size + x) * 4;
      if (background) {
        pixels[i] = Math.round(GREEN[0] + (255 - GREEN[0]) * alpha);
        pixels[i + 1] = Math.round(GREEN[1] + (255 - GREEN[1]) * alpha);
        pixels[i + 2] = Math.round(GREEN[2] + (255 - GREEN[2]) * alpha);
        pixels[i + 3] = 255;
      } else {
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 255;
        pixels[i + 3] = Math.round(255 * alpha);
      }
    }
  }
  return pixels;
}

const targets = [
  ['apple-touch-icon.png', 180, true],
  ['icon-192.png', 192, true],
  ['icon-512.png', 512, true],
  ['badge-96.png', 96, false],
];

for (const [name, size, background] of targets) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, encodePng(size, render(size, background)));
  console.log(`✔ ${path.relative(process.cwd(), file)} (${size}×${size})`);
}
