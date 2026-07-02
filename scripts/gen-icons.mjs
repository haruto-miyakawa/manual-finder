// アプリアイコンを Node 標準のみ(zlib)で生成する。外部素材・外部通信・追加依存ゼロ。
// 単色地に虫眼鏡モチーフを描いた PNG(RGBA) を public/icons/ に出力する。
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public', 'icons');

// ---- CRC32 (PNG チャンク用) ----
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
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // raw scanlines: filter byte 0 + row
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- 描画 ----
function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
const BG = hex('#123c5c'); // 濃紺
const FG = hex('#eaf2fb'); // 明色（虫眼鏡）

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// 虫眼鏡: (cx,cy) 半径R のリング + 45°方向のハンドル
function glyphCoverage(x, y, S) {
  const cx = 0.42 * S,
    cy = 0.42 * S,
    R = 0.24 * S,
    ring = 0.072 * S;
  const hStartX = cx + R * Math.SQRT1_2,
    hStartY = cy + R * Math.SQRT1_2;
  const hEndX = 0.8 * S,
    hEndY = 0.8 * S,
    hW = 0.05 * S;
  const SS = 3; // 3x3 スーパーサンプル
  let hit = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS;
      const py = y + (sy + 0.5) / SS;
      const dRing = Math.abs(Math.hypot(px - cx, py - cy) - R);
      const inRing = dRing <= ring;
      const inHandle = distToSegment(px, py, hStartX, hStartY, hEndX, hEndY) <= hW;
      if (inRing || inHandle) hit++;
    }
  }
  return hit / (SS * SS);
}

function renderIcon(S) {
  const rgba = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cov = glyphCoverage(x, y, S);
      const r = Math.round(BG[0] * (1 - cov) + FG[0] * cov);
      const g = Math.round(BG[1] * (1 - cov) + FG[1] * cov);
      const b = Math.round(BG[2] * (1 - cov) + FG[2] * cov);
      const i = (y * S + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return encodePng(S, S, rgba);
}

await mkdir(outDir, { recursive: true });
const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['maskable-512.png', 512],
  ['apple-touch-icon-180.png', 180],
];
for (const [name, size] of targets) {
  const png = renderIcon(size);
  await writeFile(resolve(outDir, name), png);
  console.log(`[gen-icons] ${name} (${size}x${size}, ${png.length} bytes)`);
}
console.log('[gen-icons] done');
