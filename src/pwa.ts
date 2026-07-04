// アプリ更新の制御（差分仕様⑥）。
// 方針: 日常はオフライン＝通信ゼロ。最後の更新確認から24時間以上空いた起動時のみ
// SW登録（=sw.js の取得確認）を行い、新版があれば「起動直後・未操作」のときだけ即適用する。
// 操作後に見つかった新版は適用せず待機（workbox skipWaiting:false）→ アプリを閉じた次の起動で
// 自動的に有効化される（作業中に足元のキャッシュが差し替わらない）。
import { registerSW } from 'virtual:pwa-register';

const LAST_CHECK_KEY = 'mf:lastUpdateCheckAt';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1日

// 「起動直後・ユーザー未操作」判定。最初の操作でフラグが立つ。
let interacted = false;
if (typeof window !== 'undefined') {
  const mark = () => {
    interacted = true;
  };
  window.addEventListener('pointerdown', mark, { once: true, capture: true });
  window.addEventListener('keydown', mark, { once: true, capture: true });
  window.addEventListener('touchstart', mark, { once: true, capture: true });
  window.addEventListener('wheel', mark, { once: true, capture: true, passive: true });
}

let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null;

function markChecked(): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    /* noop */
  }
}

/** 起動時に呼ぶ。1日以内の再起動では register() 自体を呼ばない＝ネットワーク要求ゼロ。 */
export function initPwa(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  let last = 0;
  try {
    last = Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
  } catch {
    /* noop */
  }
  const firstInstall = !navigator.serviceWorker.controller; // 未制御＝初回（または失敗後）
  const due = Date.now() - last >= CHECK_INTERVAL_MS;
  if (!firstInstall && !due) return; // ← 通信なしで終了。既存SWがオフライン動作を提供
  updateSWFn = registerSW({
    immediate: true,
    onRegisteredSW() {
      markChecked();
    },
    onNeedRefresh() {
      // 新版が待機状態になった。未操作の起動直後だけ即適用（適用＝リロード）。
      // 操作済みなら何もしない → 次回起動時に自動で有効化される。
      if (!interacted) void updateSWFn?.(true);
    },
  });
}

function waitForInstalled(reg: ServiceWorkerRegistration, timeoutMs: number): Promise<ServiceWorker | null> {
  if (reg.waiting) return Promise.resolve(reg.waiting);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(reg.waiting ?? null), timeoutMs);
    const watch = (sw: ServiceWorker | null) => {
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed') {
          clearTimeout(timer);
          resolve(reg.waiting ?? sw);
        } else if (sw.state === 'activated' || sw.state === 'redundant') {
          clearTimeout(timer);
          resolve(reg.waiting ?? null);
        }
      });
    };
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
  });
}

/**
 * 設定画面の「アプリを更新」ボタン（手動更新の保険）。
 * 最新の sw.js を取りに行き、新版が待機したら即適用して再読込。無ければ再読込のみ。
 */
export async function manualUpdate(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        // 未登録（初回・非対応環境など）: 登録を試みてから再読込
        registerSW({ immediate: true });
        markChecked();
        setTimeout(() => location.reload(), 1200);
        return;
      }
      await reg.update();
      markChecked();
      const waiting = await waitForInstalled(reg, 8000);
      if (waiting) {
        // 切替完了（controllerchange）でリロード。保険として4秒後にも強制リロード。
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        waiting.postMessage({ type: 'SKIP_WAITING' });
        setTimeout(() => location.reload(), 4000);
        return;
      }
    }
  } catch {
    /* noop */
  }
  location.reload();
}
