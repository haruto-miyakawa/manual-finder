// pdf.js の cMaps と standard_fonts を node_modules から public/pdfjs/ へコピーする。
// 目的: 日本語(CIDフォント)PDFの描画に必要な cMap / 標準フォントを「同一オリジンにローカル同梱」し、
//       pdf.js が外部URLを取りに行かないようにする（外部通信ゼロの担保）。
// 依存ゼロ（Node標準のみ）。dev/build 前に自動実行（package.json の prepare-assets）。
import { cp, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const jobs = [
  {
    from: resolve(root, 'node_modules/pdfjs-dist/cmaps'),
    to: resolve(root, 'public/pdfjs/cmaps'),
    label: 'cmaps',
  },
  {
    from: resolve(root, 'node_modules/pdfjs-dist/standard_fonts'),
    to: resolve(root, 'public/pdfjs/standard_fonts'),
    label: 'standard_fonts',
  },
];

for (const job of jobs) {
  if (!existsSync(job.from)) {
    console.error(`[copy-pdfjs-assets] 見つかりません: ${job.from}`);
    console.error('  → `npm install` を先に実行してください。');
    process.exitCode = 1;
    continue;
  }
  await mkdir(dirname(job.to), { recursive: true });
  await cp(job.from, job.to, { recursive: true });
  const s = await stat(job.to);
  console.log(`[copy-pdfjs-assets] ${job.label} → public/pdfjs/${job.label} (${s.isDirectory() ? 'ok' : '?'})`);
}
console.log('[copy-pdfjs-assets] done');
