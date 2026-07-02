// カスタムPDFワーカーエントリ。ワーカー内で pdf.js より前にポリフィルを適用してから
// pdf.js のワーカー本体を読み込む（fingerprint の toHex 等が古い環境でも動くように）。
// Vite の ?worker でバンドルされ、外部通信は発生しない。
import './polyfills';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
