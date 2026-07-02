/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// ビルド時に vite.config.ts の define で注入
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
