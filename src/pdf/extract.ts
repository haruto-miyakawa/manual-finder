// PDFからページ単位でテキストを抽出する（取り込み時に実行し、検索インデックスと pages テーブルへ）。
import { loadPdfDocument } from './pdfSetup';

export interface ExtractedPage {
  page: number; // 1始まり
  text: string;
}

export interface ExtractResult {
  pageCount: number;
  pages: ExtractedPage[];
  hasText: boolean; // 全ページ通してテキストが1文字でもあれば true（スキャンPDF検出）
}

/**
 * @param bytes PDF生バイト（この関数内で消費される）
 * @param onProgress 進捗コールバック（page, total）
 */
export async function extractPdfText(
  bytes: ArrayBuffer,
  onProgress?: (page: number, total: number) => void,
): Promise<ExtractResult> {
  const doc = await loadPdfDocument(bytes);
  try {
    const pageCount = doc.numPages;
    const pages: ExtractedPage[] = [];
    let hasText = false;
    for (let p = 1; p <= pageCount; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // 仕様どおり items の str を連結。過剰な空白は畳む。
      const text = content.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
        .replace(/[ \t ]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim();
      if (text.length > 0) hasText = true;
      pages.push({ page: p, text });
      page.cleanup();
      onProgress?.(p, pageCount);
    }
    return { pageCount, pages, hasText };
  } finally {
    await doc.loadingTask.destroy();
  }
}
