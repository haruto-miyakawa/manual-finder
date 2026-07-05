// 設定タブ。PDFの操作モード・ストレージに加え、旧インフォ画面（ⓘ）の中身をすべてここに集約:
// バージョン/ビルド表示・手動更新・お問い合わせ（別タブ）・変更ログ・診断情報・使い方と注意。
import { useState } from 'react';
import { useSettings, updateSettings } from '../settings';
import { StorageBar } from './StorageBar';
import { TapIcon, ScrollIcon, AppUpdateIcon, MailIcon, DocIcon, ChevronDownIcon, LibraryIcon } from './icons';
import { APP_VERSION, BUILD_LABEL } from '../version';
import { manualUpdate } from '../pwa';
import { ChangelogModal } from './ChangelogModal';
import { Diagnostics } from './Diagnostics';
import { HelpContent } from './HelpContent';

// お問い合わせ先（Googleフォーム）。ボタンをタップしたときだけ別タブで開く（アプリの自動外部通信は無し）。
const CONTACT_FORM_URL = 'https://forms.gle/7dgpxocvz7hHvWFG9';

export function SettingsPanel() {
  const settings = useSettings();
  const [showLog, setShowLog] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [updating, setUpdating] = useState(false);

  return (
    <div className="settings">
      <section className="backupSec">
        <h2 className="secTitle">PDFの操作モード</h2>
        <p className="hint">ビューアでのページの動かし方を選べます（縦向き・横向きどちらでも有効）。</p>
        <div className="segmented">
          <button
            className={`segBtn${settings.navMode === 'scroll' ? ' on' : ''}`}
            onClick={() => void updateSettings({ navMode: 'scroll' })}
          >
            <span className="segTitle">
              <ScrollIcon size={20} />
              スクロール移動（標準）
            </span>
            <span className="segSub">上下にスクロールして連続で読む。</span>
          </button>
          <button
            className={`segBtn${settings.navMode === 'tap' ? ' on' : ''}`}
            onClick={() => void updateSettings({ navMode: 'tap' })}
          >
            <span className="segTitle">
              <TapIcon size={20} />
              タップ移動
            </span>
            <span className="segSub">画面の左右タップでページ送り。1ページずつ表示。</span>
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
        <h2 className="secTitle">アプリ情報・更新</h2>
        <div className="verBox">
          <span>
            バージョン <b>{APP_VERSION}</b>
          </span>
          <span className="verBuild">ビルド {BUILD_LABEL}</span>
          <span className="verNote">※この「ビルド」は更新のたびに変わります。数字が新しくなっていれば更新済みです。</span>
        </div>
        <button
          className="btn big"
          disabled={updating}
          onClick={() => {
            setUpdating(true);
            void manualUpdate();
          }}
        >
          <AppUpdateIcon size={20} />
          {updating ? '更新を確認中…' : 'アプリを更新（最新版を取得）'}
        </button>
        <p className="hint">
          更新は「1日以上空けて起動したとき」に自動でも確認されます（それ以外の日常の起動では通信しません）。
        </p>
      </section>

      <section className="backupSec">
        <h2 className="secTitle">サポート</h2>
        <a className="btn big supportLink" href={CONTACT_FORM_URL} target="_blank" rel="noopener noreferrer">
          <MailIcon size={20} />
          お問い合わせ（別タブで開きます）
        </a>
        <button className="btn big" onClick={() => setShowLog(true)}>
          <DocIcon size={20} />
          変更ログ
        </button>
        <Diagnostics />
      </section>

      <section className="backupSec">
        <h2 className="secTitle">使い方と注意</h2>
        <button className="btn big" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}>
          <LibraryIcon size={20} />
          使い方と注意
          <span className={`chev${showHelp ? ' open' : ''}`}>
            <ChevronDownIcon size={16} />
          </span>
        </button>
        {showHelp && <HelpContent />}
      </section>

      {showLog && <ChangelogModal onClose={() => setShowLog(false)} />}
    </div>
  );
}
