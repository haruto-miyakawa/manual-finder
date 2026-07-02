// Tesseract.js（端末内OCR）のアセットをローカルに用意する。
//  - worker/core は node_modules からコピー
//  - 言語データ(jpn 標準 / eng 高速)はビルド時にダウンロード（キャッシュ有り）
// ランタイムは全て同一オリジンから読むので外部通信ゼロ（初回OCR時に runtimeCaching でキャッシュ）。
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outT = resolve(root, 'public/tesseract');
const outCore = resolve(outT, 'core');
const outLang = resolve(outT, 'lang');

await mkdir(outCore, { recursive: true });
await mkdir(outLang, { recursive: true });

// worker
await copyFile(
  resolve(root, 'node_modules/tesseract.js/dist/worker.min.js'),
  resolve(outT, 'worker.min.js'),
);
// core（SIMD+LSTM）
for (const f of ['tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm.js']) {
  await copyFile(resolve(root, 'node_modules/tesseract.js-core', f), resolve(outCore, f));
}
console.log('[copy-ocr-assets] worker/core copied');

// 言語データ（gzip）: jpn は精度重視で標準、eng は型番用に高速版
const langs = [
  ['jpn', 'https://tessdata.projectnaptha.com/4.0.0/jpn.traineddata.gz'],
  ['eng', 'https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz'],
];
for (const [name, url] of langs) {
  const dest = resolve(outLang, `${name}.traineddata.gz`);
  if (existsSync(dest)) {
    console.log(`[copy-ocr-assets] lang cached: ${name}`);
    continue;
  }
  console.log(`[copy-ocr-assets] downloading ${name} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`lang download failed ${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`[copy-ocr-assets] saved ${name} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
}
console.log('[copy-ocr-assets] done');
