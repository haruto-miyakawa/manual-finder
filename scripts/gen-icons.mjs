// アプリアイコンを brand/ の確定PNGから public/icons/ へコピーする。
// アイコンの元は brand/manual-icon.svg（マニュアル/本モチーフ）を Chromium でラスタライズしたもので、
// brand/*.png としてコミット済み。ビルド時に外部通信・追加依存なしでコピーするだけ。
// アイコンを変えたいとき: brand/manual-icon.svg を差し替え、再ラスタライズ（担当に依頼/スクリプト実行）して
// brand/*.png を更新する。
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const srcDir = resolve(root, 'brand');
const outDir = resolve(root, 'public', 'icons');

const files = ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon-180.png'];

await mkdir(outDir, { recursive: true });
let missing = 0;
for (const f of files) {
  const src = resolve(srcDir, f);
  if (!existsSync(src)) {
    console.error(`[gen-icons] 見つかりません: brand/${f}`);
    missing++;
    continue;
  }
  await copyFile(src, resolve(outDir, f));
  console.log(`[gen-icons] brand/${f} → public/icons/${f}`);
}
if (missing) {
  console.error('[gen-icons] brand/ のアイコンが不足しています。');
  process.exitCode = 1;
} else {
  console.log('[gen-icons] done');
}
