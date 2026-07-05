import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta } from './db/db';
import { initSearchIndex } from './search/searchIndex';
import { requestPersistentStorage, migrateMemoDocs, markRead } from './db/repo';
import { SearchBar } from './components/SearchBar';
import { SearchResults } from './components/SearchResults';
import { Library } from './components/Library';
import { PdfDetail } from './components/PdfDetail';
import { Campaigns } from './components/Campaigns';
import { BackupPanel } from './components/BackupPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { StorageBar } from './components/StorageBar';
import { ErrorOverlay } from './components/ErrorOverlay';
import { PdfViewer } from './pdf/PdfViewer';
import { APP_VERSION } from './version';
import { useSettings } from './settings';
import { SearchIcon, LibraryIcon, CampaignIcon, BackupIcon, SettingsIcon } from './components/icons';


type Tab = 'library' | 'campaigns' | 'backup' | 'settings';
interface ViewerTarget {
  pdfId: string;
  page: number;
  query: string;
  title: string;
}

const BACKUP_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30日

export default function App() {
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [resultsBusy, setResultsBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('library');
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [storageKey, setStorageKey] = useState(0);
  const [dismissBanner, setDismissBanner] = useState(false);
  // 新規取り込み/マージ受信直後だけ「未分類」を開く一時状態（セッション内のみ・保存しない）。
  // Libraryはタブ切替でアンマウントされるためAppが保持し、手動で閉じたら解除する。
  const [uncatOpenOnce, setUncatOpenOnce] = useState(false);
  const settings = useSettings();

  const pdfCount = useLiveQuery(() => db.pdfs.count(), [], 0);
  const lastBackup = useLiveQuery(() => getMeta<number>('lastBackupAt'), [storageKey], undefined);

  // 初期化: 検索索引の復元 + 旧メモ形式の移行 + 永続化要求
  useEffect(() => {
    (async () => {
      await initSearchIndex();
      await migrateMemoDocs(); // 旧: プレーンmemo＋別枠写真 → リッチメモ（memoDoc未設定行のみ・冪等）
      void requestPersistentStorage().finally(() => setStorageKey((k) => k + 1));
      setReady(true);
    })();
  }, []);

  // 検索クエリのデバウンス（250ms）
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const searching = query.trim() !== '' && (query !== debounced || resultsBusy);
  const showResults = query.trim() !== '';

  async function openViewer(pdfId: string, page: number, q: string) {
    const meta = await db.pdfs.get(pdfId);
    setViewer({ pdfId, page, query: q, title: meta?.title ?? '' });
    void markRead(pdfId); // 開いたら既読（未読マークを消す）
  }

  const backupNeeded =
    !dismissBanner &&
    pdfCount > 0 &&
    (lastBackup === undefined || Date.now() - lastBackup > BACKUP_INTERVAL_MS);

  if (!ready) {
    return (
      <div className="bootSplash">
        <div className="spinnerBig" />
        <div>起動中…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="appHeader">
        <div className="appTitleRow">
          <span className="appLogo">
            <SearchIcon size={20} />
          </span>
          <span className="appName">マニュアル検索</span>
          <span className="appVer">v{APP_VERSION}</span>
          <StorageBar refreshKey={storageKey} />
        </div>
        <SearchBar value={query} onChange={setQuery} searching={searching} />
      </header>

      {backupNeeded && (
        <div className="banner">
          <span className="bannerMsg">
            <BackupIcon size={18} />
            データが増えています。定期的にバックアップ（エクスポート）を。
          </span>
          <div className="bannerBtns">
            <button className="btn small" onClick={() => setTab('backup')}>
              バックアップへ
            </button>
            <button className="btn small ghost" onClick={() => setDismissBanner(true)}>
              あとで
            </button>
          </div>
        </div>
      )}

      <main className="appMain">
        {showResults ? (
          <SearchResults query={debounced} onOpen={openViewer} onSearchingChange={setResultsBusy} />
        ) : (
          <>
            {tab === 'library' && (
              <Library
                onOpenViewer={openViewer}
                onOpenDetail={(id) => setDetailId(id)}
                onChanged={() => setStorageKey((k) => k + 1)}
                uncatOpenOnce={uncatOpenOnce}
                setUncatOpenOnce={setUncatOpenOnce}
              />
            )}
            {tab === 'campaigns' && <Campaigns onOpenViewer={openViewer} />}
            {tab === 'backup' && (
              <BackupPanel
                onChanged={() => setStorageKey((k) => k + 1)}
                onMerged={() => setUncatOpenOnce(true)}
              />
            )}
            {tab === 'settings' && <SettingsPanel />}
          </>
        )}
      </main>

      {!showResults && (
        <nav className="tabBar">
          <button className={`tabBtn${tab === 'library' ? ' on' : ''}`} onClick={() => setTab('library')}>
            <span className="tabIcon">
              <LibraryIcon size={23} />
            </span>
            ライブラリ
          </button>
          <button className={`tabBtn${tab === 'campaigns' ? ' on' : ''}`} onClick={() => setTab('campaigns')}>
            <span className="tabIcon">
              <CampaignIcon size={23} />
            </span>
            施策
          </button>
          <button className={`tabBtn${tab === 'backup' ? ' on' : ''}`} onClick={() => setTab('backup')}>
            <span className="tabIcon">
              <BackupIcon size={23} />
            </span>
            バックアップ
          </button>
          <button className={`tabBtn${tab === 'settings' ? ' on' : ''}`} onClick={() => setTab('settings')}>
            <span className="tabIcon">
              <SettingsIcon size={23} />
            </span>
            設定
          </button>
        </nav>
      )}

      {detailId && (
        <PdfDetail
          pdfId={detailId}
          onClose={() => setDetailId(null)}
          onOpenViewer={(id, page, q) => {
            setDetailId(null);
            void openViewer(id, page, q);
          }}
          onChanged={() => setStorageKey((k) => k + 1)}
        />
      )}

      {viewer && (
        <PdfViewer
          pdfId={viewer.pdfId}
          title={viewer.title}
          initialPage={viewer.page}
          highlightQuery={viewer.query}
          navMode={settings.navMode}
          onClose={() => setViewer(null)}
        />
      )}

      <ErrorOverlay />
    </div>
  );
}
