// バックアップ（中核機能）。ワンタップ・エクスポート / インポート(全置換で完全復元)。
import { useRef, useState } from 'react';
import { exportAll, importAllReplace, downloadBlob, backupFileName } from '../backup/backup';
import { rebuildSearchIndex, markBackupDone } from '../db/repo';

interface Props {
  onChanged: () => void;
}

export function BackupPanel({ onChanged }: Props) {
  const importRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function doExport() {
    setBusy(true);
    setStatus('エクスポート準備中…');
    try {
      const blob = await exportAll((p) => setStatus(p.phase === 'collect' ? 'データ収集中…' : p.phase === 'zip' ? '1ファイルに書き出し中…' : '完了'));
      downloadBlob(blob, backupFileName());
      await markBackupDone();
      setStatus(`エクスポート完了（${(blob.size / 1024 / 1024).toFixed(1)}MB）。iPadの「ファイル」に保存してください。`);
      onChanged();
    } catch (e) {
      setStatus(`エクスポート失敗: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  async function doImport(file: File) {
    if (!confirm('現在の全データを、選んだバックアップで置き換えます。よろしいですか？')) return;
    setBusy(true);
    setStatus('インポート中…');
    try {
      const sum = await importAllReplace(file, (p) => {
        const label: Record<string, string> = {
          read: '読み込み中…',
          parse: '解析中…',
          write: '書き込み中…',
          index: '検索索引を再構築中…',
          done: '完了',
        };
        setStatus(label[p.phase] ?? '処理中…');
      });
      setStatus(`インポート完了: PDF ${sum.pdfs}件 / ページ ${sum.pages} / 写真 ${sum.photos} / 施策 ${sum.campaigns}`);
      onChanged();
    } catch (e) {
      setStatus(`インポート失敗: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  async function doRebuild() {
    setBusy(true);
    setStatus('検索索引を再構築中…');
    try {
      const n = await rebuildSearchIndex();
      setStatus(`索引を再構築しました（${n}ページ）。`);
    } catch (e) {
      setStatus(`再構築失敗: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="backup">
      <section className="backupSec">
        <h2 className="secTitle">エクスポート</h2>
        <p className="hint">全PDF・メモ・写真・施策・タグ/お気に入りを1ファイル(zip)に保存します。月1回の退避を推奨。</p>
        <button className="btn primary big" disabled={busy} onClick={() => void doExport()}>
          ⬇ エクスポート（1ファイルに保存）
        </button>
      </section>

      <section className="backupSec">
        <h2 className="secTitle">インポート（全置換で復元）</h2>
        <p className="hint">バックアップzipから完全復元します。現在のデータは置き換わります。</p>
        <button className="btn big" disabled={busy} onClick={() => importRef.current?.click()}>
          ⬆ バックアップを選んで復元
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
          }}
        />
      </section>

      <section className="backupSec">
        <h2 className="secTitle">メンテナンス</h2>
        <p className="hint">検索が効かない/結果がおかしいとき、保存済みPDFのテキストから索引を作り直します。</p>
        <button className="btn big" disabled={busy} onClick={() => void doRebuild()}>
          ↻ 検索索引を再構築
        </button>
      </section>

      {status && <div className={`backupStatus${busy ? ' busy' : ''}`}>{busy && <span className="spinnerSmall" />}{status}</div>}
    </div>
  );
}
