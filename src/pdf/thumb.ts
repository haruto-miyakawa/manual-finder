// PDFの1ページ目からサムネイル(JPEG)を生成してキャッシュ(db.thumbs)する。
// 一覧表示で使う。生成は同時実行を絞る（pdf.jsワーカー負荷を抑制）。外部通信なし。
import { db } from '../db/db';
import { loadPdfDocument } from './pdfSetup';

const THUMB_W = 160; // サムネイル幅(px)
const MAX_CONCURRENT = 2;

let active = 0;
const waiters: Array<() => void> = [];
const inFlight = new Set<string>();

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((res) => waiters.push(res));
}
function release(): void {
  active--;
  const next = waiters.shift();
  if (next) {
    active++;
    next();
  }
}

/** サムネイルが無ければ生成してキャッシュ。既にあれば何もしない（冪等）。 */
export async function ensureThumb(pdfId: string): Promise<void> {
  if (inFlight.has(pdfId)) return;
  if (await db.thumbs.get(pdfId)) return;
  inFlight.add(pdfId);
  await acquire();
  try {
    if (await db.thumbs.get(pdfId)) return; // 待機中に生成済みかも
    const row = await db.blobs.get(pdfId);
    if (!row) return;
    const doc = await loadPdfDocument(await row.blob.arrayBuffer());
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = THUMB_W / base.width;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      await page.render({ canvas, viewport: vp }).promise;
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob((b) => res(b), 'image/jpeg', 0.72),
      );
      if (blob) await db.thumbs.put({ id: pdfId, blob });
      page.cleanup();
    } finally {
      await doc.loadingTask.destroy();
    }
  } catch {
    /* サムネ生成失敗は無視（アイコン表示のまま） */
  } finally {
    release();
    inFlight.delete(pdfId);
  }
}
