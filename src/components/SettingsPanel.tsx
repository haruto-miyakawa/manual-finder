// 設定タブ。PDFの操作モード（タップ/スクロール）などをまとめて変更できる。
import { useSettings, updateSettings } from '../settings';
import { StorageBar } from './StorageBar';

export function SettingsPanel({ onOpenHelp }: { onOpenHelp: () => void }) {
  const settings = useSettings();
  return (
    <div className="settings">
      <section className="backupSec">
        <h2 className="secTitle">PDFの操作モード</h2>
        <p className="hint">ビューアでのページの動かし方を選べます（縦向き・横向きどちらでも有効）。</p>
        <div className="segmented">
          <button
            className={`segBtn${settings.navMode === 'tap' ? ' on' : ''}`}
            onClick={() => void updateSettings({ navMode: 'tap' })}
          >
            <span className="segTitle">👆 タップ移動</span>
            <span className="segSub">画面の左右タップでページ送り。横向きは全画面。</span>
          </button>
          <button
            className={`segBtn${settings.navMode === 'scroll' ? ' on' : ''}`}
            onClick={() => void updateSettings({ navMode: 'scroll' })}
          >
            <span className="segTitle">📜 スクロール移動</span>
            <span className="segSub">上下にスクロールして連続で読む。</span>
          </button>
        </div>
      </section>

      <section className="backupSec">
        <h2 className="secTitle">ストレージ</h2>
        <p className="hint">この端末での使用量。上限が近いとバックアップを促します。</p>
        <div className="settingStorage">
          <StorageBar />
        </div>
      </section>

      <section className="backupSec">
        <h2 className="secTitle">ヘルプ・情報</h2>
        <button className="btn big" onClick={onOpenHelp}>
          ⓘ 使い方 / 注意 / バージョン / 変更ログ
        </button>
      </section>
    </div>
  );
}
