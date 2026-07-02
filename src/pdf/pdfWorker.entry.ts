// カスタムPDFワーカーエントリ。ワーカー内で pdf.js より前にポリフィルを適用してから
// pdf.js のワーカー本体を読み込む（fingerprint の toHex 等が古い環境でも動くように）。
// Vite の ?worker でバンドルされ、外部通信は発生しない。
import './polyfills';
// TEMP（原因調査）: worker側のエラー箇所を読めるよう非圧縮ワーカーを使用。特定後 min に戻す。
import 'pdfjs-dist/build/pdf.worker.mjs';
