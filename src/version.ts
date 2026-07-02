// アプリのバージョン/ビルド時刻（vite.config の define で注入）。
// 更新が反映されたかを画面で確認するために使う（ビルド時刻はデプロイのたびに変わる）。
export const APP_VERSION = __APP_VERSION__;
export const BUILD_TIME = __BUILD_TIME__;

// "2026-07-02T21:40:00.000Z" -> "2026-07-02 21:40 UTC"
export const BUILD_LABEL = (() => {
  try {
    return new Date(BUILD_TIME).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  } catch {
    return BUILD_TIME;
  }
})();
