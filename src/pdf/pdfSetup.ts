// pdf.js の初期化。外部通信ゼロのため:
//  - ワーカーは Vite の ?worker でローカルバンドル（CDN workerSrc を使わない）
//  - cMap / standard_fonts は同一オリジンのローカルパス（copy-pdfjs-assets.mjs で public/pdfjs へ配置）
import './polyfills'; // pdf.js より前に（main スレッド用）
import { getDocument, GlobalWorkerOptions, version } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
// Vite: ?worker でカスタムワーカーエントリ（ポリフィル→pdf.jsワーカー本体）をバンドル
import PdfjsWorker from './pdfWorker.entry?worker';

// ワーカーをローカルの Worker インスタンスに固定（外部フェッチを発生させない）
GlobalWorkerOptions.workerPort = new PdfjsWorker();

// base（サブパス配信でも壊れないよう BASE_URL から解決）
const BASE = import.meta.env.BASE_URL;
const CMAP_URL = `${BASE}pdfjs/cmaps/`;
const STANDARD_FONT_URL = `${BASE}pdfjs/standard_fonts/`;

export const pdfjsVersion = version;

/**
 * PDFバイトからドキュメントを開く。日本語(CIDフォント)描画のため cMap/標準フォントは
 * すべてローカル参照。cleanup は doc.loadingTask.destroy() で行う。
 * 注意: data に渡した ArrayBuffer は pdf.js に転送され detach され得るので、呼び出し側は使い回さない。
 */
export function loadPdfDocument(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({
    data,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_URL,
    // useSystemFonts はローカルのシステムフォント参照のみ（ネットワークは発生しない）
  }).promise;
}
