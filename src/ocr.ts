// 端末内OCR（Tesseract.js）。worker/core/言語データは全て同一オリジンのローカル資産を使い、
// 外部通信は発生しない（初回ロード分は SW の runtimeCaching で保持）。
// スキャンPDF（本文テキスト無し）ページと写真を文字化して検索対象にする。
import { createWorker, type Worker } from 'tesseract.js';
import { loadPdfDocument } from './pdf/pdfSetup';
import { db } from './db/db';
import { upsertTextDoc, persistNow } from './search/searchIndex';

const BASE = import.meta.env.BASE_URL;
let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('jpn+eng', 1, {
      workerPath: `${BASE}tesseract/worker.min.js`,
      corePath: `${BASE}tesseract/core/tesseract-core-simd-lstm.wasm.js`,
      langPath: `${BASE}tesseract/lang`,
      gzip: true,
    });
  }
  return workerPromise;
}

export type OcrSource = HTMLCanvasElement | Blob | string;

/** 画像1枚をOCRしてテキストを返す。 */
export async function ocrImage(image: OcrSource): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  return (data.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** OCRワーカーを終了（メモリ解放）。 */
export async function terminateOcr(): Promise<void> {
  const wp = workerPromise;
  workerPromise = null;
  if (wp) {
    const w = await wp.catch(() => null);
    if (w) await w.terminate();
  }
}

export interface OcrPdfProgress {
  page: number;
  total: number;
}

/**
 * PDFの「本文テキストが無いページ」をOCRして pages テーブル＋検索索引を更新する。
 * @returns 文字が取れたページ数
 */
export async function ocrPdfPages(pdfId: string, onProgress?: (p: OcrPdfProgress) => void): Promise<number> {
  const row = await db.blobs.get(pdfId);
  if (!row) return 0;
  const doc = await loadPdfDocument(await row.blob.arrayBuffer());
  let done = 0;
  try {
    const total = doc.numPages;
    for (let n = 1; n <= total; n++) {
      const id = `${pdfId}#${n}`;
      const existing = await db.pages.get(id);
      if (existing && existing.text && existing.text.trim()) continue; // 既に文字あり
      onProgress?.({ page: n, total });
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 2 }); // OCR精度のため高解像度
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      await page.render({ canvas, viewport: vp }).promise;
      const text = await ocrImage(canvas);
      page.cleanup();
      if (text.trim()) {
        await db.pages.put({ id, pdfId, page: n, text });
        upsertTextDoc(id, text); // 本文ページとして索引へ
        done++;
      }
    }
    if (done > 0) await db.pdfs.update(pdfId, { hasText: true });
    await persistNow();
  } finally {
    await doc.loadingTask.destroy();
  }
  return done;
}

/** 写真をOCRし、テキストを PhotoRow に保存＋索引へ。 */
export async function ocrPhoto(photoId: string): Promise<string> {
  const photo = await db.photos.get(photoId);
  if (!photo) return '';
  const text = await ocrImage(photo.blob);
  await db.photos.update(photoId, { ocrText: text });
  upsertTextDoc(`o:${photo.pdfId}#${photoId}`, text);
  await persistNow();
  return text;
}
