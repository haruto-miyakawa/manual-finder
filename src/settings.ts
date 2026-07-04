// アプリ設定（meta テーブルに保存・useLiveQuery で反応的に取得）。
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from './db/db';

/** PDFの操作モード: tap=左右タップでページ送り / scroll=連続スクロール */
export type NavMode = 'tap' | 'scroll';

export interface Settings {
  navMode: NavMode;
}

export const DEFAULT_SETTINGS: Settings = {
  // v1.6.0: 規定を連続スクロールに（開いた瞬間から縦スクロールで読める）。
  // ユーザーが明示的に選んだモードは meta 側の値が勝つので保持される。
  navMode: 'scroll',
};

export function useSettings(): Settings {
  const row = useLiveQuery(() => db.meta.get('settings'), [], undefined);
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) || {}) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const cur = (await getMeta<Settings>('settings')) || {};
  await setMeta('settings', { ...DEFAULT_SETTINGS, ...cur, ...patch });
}
