// Génère les icônes PNG de l'extension (16/32/48/128) sans dépendance :
// fond bleu arrondi + document blanc + flèche verte "télécharger".
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.OUT
  ? join(root, process.env.OUT)
  : join(root, 'arena-extension', 'icons');
// Couleur de fond "R,G,B" (défaut : bleu Arena Saver ; ex: violet Arena Auto).
const BG = (process.env.BG || '37,99,235').split(',').map(Number);
mkdirSync(outDir, { recursive: true });

// --- CRC32 (requis par le format PNG) ---
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filtre "none"
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4)
      .copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Dessin ---
function inRoundRect(x, y, rx, ry, rw, rh, r) {
  const nx = Math.min(Math.max(x, rx + r), rx + rw - r);
  const ny = Math.min(Math.max(y, ry + r), ry + rh - r);
  const dx = x - nx, dy = y - ny;
  return dx * dx + dy * dy <= r * r && x >= rx && x < rx + rw && y >= ry && y < ry + rh;
}
function inTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
  const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
  return l1 >= 0 && l2 >= 0 && l1 + l2 <= 1;
}

function draw(size) {
  const S = size;
  const buf = new Uint8ClampedArray(S * S * 4);
  const px = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  const DOC = [248, 250, 252];   // blanc
  const FOLD = [147, 197, 253];  // bleu clair (coin plié)
  const ARROW = [22, 163, 74];   // vert

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inRoundRect(x, y, 0, 0, S, S, S * 0.22)) continue;
      px(x, y, ...BG);
      // Document
      const dx0 = S * 0.30, dy0 = S * 0.10, dx1 = S * 0.70, dy1 = S * 0.90;
      if (inRoundRect(x, y, dx0, dy0, dx1 - dx0, dy1 - dy0, S * 0.04)) {
        px(x, y, ...DOC);
        // coin plié en haut à droite
        if (inTriangle(x, y, dx1, dy0, dx1, dy0 + (dx1 - dx0) * 0.45, dx1 - (dx1 - dx0) * 0.45, dy0)) {
          px(x, y, ...FOLD);
        }
      }
      // Flèche "télécharger" : tige + pointe
      const cx = S * 0.5;
      const shaftW = Math.max(1, S * 0.07);
      const top = S * 0.42, midY = S * 0.64, tipY = S * 0.78;
      const halfW = S * 0.13;
      if (x >= cx - shaftW / 2 && x < cx + shaftW / 2 && y >= top && y < midY) px(x, y, ...ARROW);
      if (inTriangle(x, y, cx - halfW, midY, cx + halfW, midY, cx, tipY)) px(x, y, ...ARROW);
    }
  }
  return buf;
}

for (const size of [16, 32, 48, 128]) {
  const png = encodePNG(size, size, draw(size));
  writeFileSync(join(outDir, `icon${size}.png`), png);
  console.log(`  ✅ icons/icon${size}.png (${png.length} octets)`);
}
console.log('Icônes générées ✅');
