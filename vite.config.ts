import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Node の process を最小宣言（@types/node を足さずに型を通す。ビルド時のみ使用）
declare const process: { env: Record<string, string | undefined> };

// アプリのバージョン表示用（更新が反映されたかを画面で確認できるように）
const APP_VERSION = process.env.npm_package_version ?? '0.0.0';
const BUILD_TIME = new Date().toISOString();

// 原因調査時のみ true にすると非圧縮＋sourcemap（通常は false）。
const DEBUG_UNMIN = false;

// 完全オフラインSPA。外部通信ゼロが最優先のため runtimeCaching は一切定義せず
// （外部オリジンへ取りに行く経路そのものを作らない）、全アセットを precache する。
export default defineConfig({
  // 既定 base '/'。GitHub Pages 等のサブパス配信では VITE_BASE=/manual-finder/ を渡す。
  // pdf.js の cMap/font パスは実行時に import.meta.env.BASE_URL から解決するのでサブパスでも壊れない。
  base: process.env.VITE_BASE ?? '/',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // 開発時もSWを有効化してオフライン動作を早期検証できるようにする
      devOptions: { enabled: false },
      includeAssets: [
        'icons/apple-touch-icon-180.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/maskable-512.png',
      ],
      manifest: {
        name: 'マニュアル検索',
        short_name: 'マニュアル',
        description: 'PDFマニュアルをとっさに引く・完全オフライン・外部通信ゼロ',
        lang: 'ja',
        dir: 'ltr',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0f14',
        theme_color: '#0b0f14',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // pdf.js worker / cmaps(.bcmap) / standard_fonts / アイコン をすべて precache し
        // 機内モードでもPDF描画まで完全動作させる。
        globPatterns: [
          '**/*.{js,mjs,css,html,ico,png,svg,webmanifest,bcmap,pfb,ttf,otf,cff,wasm,json}',
        ],
        // pdf.worker が既定上限(2MiB)を超えても precache から漏れないよう引き上げ
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // 外部オリジンのランタイムキャッシュは定義しない（＝外部取得経路なし）
        navigateFallback: 'index.html',
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2021',
    minify: DEBUG_UNMIN ? false : 'esbuild',
    sourcemap: DEBUG_UNMIN,
    // pdf.js は大きいのでチャンク警告閾値を上げておく（挙動には影響しない）
    chunkSizeWarningLimit: 4096,
  },
});
