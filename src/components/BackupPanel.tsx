// バックアップ（中核機能）。ワンタップ・エクスポート / インポート。
// インポートは「マージ（追加・既存を消さない）」と「全置換（完全復元）」を選択制にし、
// AirDrop等で受け取った共有zipの追加取り込みと、バックアップからの復元を両立する。
import { useRef, useState } from 'react';
import {
  exportAll,
  importAllReplace,
  importAllMerge,
  downloadBlob,
  backupFileName,
  cryptoAvailable,
  peekBackupEncrypted,
  BackupEncryptedError,
} from '../backup/backup';
import { rebuildSearchIndex, markBackupDone } from '../db/repo';
import { LockIcon, ExportIcon, ImportIcon, RebuildIcon } from './icons';

interface Props {
  onChanged: () => void;
  /** マージで新規PDFが追加されたとき（ライブラリの「未分類」を一時的に開くシグナル） */
  onMerged?: () => void;
}

export function BackupPanel({ onChanged, onMerged }: Props) {
  const importRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null); // モード選択待ちのファイル
  const canEncrypt = cryptoAvailable();
  const [encrypt, setEncrypt] = useState(canEncrypt);
  const [password, setPassword] = useState('');

  async function doExport() {
    if (encrypt && canEncrypt && password.trim().length < 4) {
      alert('暗号化する場合は4文字以上のパスワードを入力してください。');
      return;
    }
    setBusy(true);
    setStatus('エクスポート準備中…');
    try {
      const useEnc = encrypt && canEncrypt && password.trim().length >= 4;
      const blob = await exportAll(
        (p) => setStatus(p.detail ?? '処理中…'),
        useEnc ? password : undefined,
      );
      downloadBlob(blob, backupFileName(useEnc));
      await markBackupDone();
      setStatus(
        `エクスポート完了（${(blob.size / 1024 / 1024).toFixed(1)}MB${useEnc ? '・🔒暗号化' : ''}）。iPadの「ファイル」に保存してください。`,
      );
      onChanged();
    } catch (e) {
      setStatus(`エクスポート失敗: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  async function askPassphrase(file: File): Promise<string | null | undefined> {
    // undefined=不要 / string=入力あり / null=中止
    if (!(await peekBackupEncrypted(file))) return undefined;
    if (!canEncrypt) throw new Error('暗号化ファイルの復号には安全な接続(HTTPS/localhost)が必要です。');
    const pw = window.prompt('このファイルは暗号化されています。復号パスワードを入力してください。');
    return pw == null ? null : pw;
  }

  const progressLabel = (p: { phase: string; detail?: string }) => {
    const label: Record<string, string> = {
      read: '読み込み中…',
      parse: p.detail === '復号中' ? '復号中…' : '解析中…',
      write: p.detail ?? '書き込み中…',
      index: '検索索引を更新中…',
      done: '完了',
    };
    setStatus(label[p.phase] ?? '処理中…');
  };

  /** マージ（追加取り込み・既存は消さない） */
  async function doMerge(file: File) {
    setBusy(true);
    setStatus('追加取り込み中…');
    try {
      const pw = await askPassphrase(file);
      if (pw === null) {
        setStatus('取り込みを中止しました。');
        return;
      }
      const sum = await importAllMerge(file, progressLabel, pw);
      setStatus(
        `追加取り込み完了: 追加 ${sum.added}件${sum.skipped > 0 ? ` / 重複スキップ ${sum.skipped}件` : ''}。追加分は「未分類」に未読マーク付きで入っています。`,
      );
      onChanged();
      if (sum.added > 0) onMerged?.();
    } catch (e) {
      if (e instanceof BackupEncryptedError) {
        setStatus('暗号化ファイルです。パスワードを入力して再度お試しください。');
      } else {
        setStatus(`取り込み失敗: ${e instanceof Error ? e.message : e}`);
      }
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  /** 全置換（バックアップからの完全復元） */
  async function doReplace(file: File) {
    if (!confirm('現在の全データを消して、選んだバックアップの内容に置き換えます。本当によろしいですか？')) return;
    setBusy(true);
    setStatus('インポート中…');
    try {
      const pw = await askPassphrase(file);
      if (pw === null) {
        setStatus('インポートを中止しました。');
        return;
      }
      const sum = await importAllReplace(file, progressLabel, pw);
      setStatus(
        `インポート完了: PDF ${sum.pdfs}件 / ページ ${sum.pages} / 写真 ${sum.photos} / 施策 ${sum.campaigns}`,
      );
      onChanged();
    } catch (e) {
      if (e instanceof BackupEncryptedError) {
        setStatus('暗号化バックアップです。パスワードを入力して再度お試しください。');
      } else {
        setStatus(`インポート失敗: ${e instanceof Error ? e.message : e}`);
      }
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
        <p className="hint">
          全PDF・メモ・写真・施策・タグ/お気に入りを1ファイルに保存します。月1回の退避を推奨。
        </p>

        <label className={`encRow${!canEncrypt ? ' disabled' : ''}`}>
          <input
            type="checkbox"
            checked={encrypt && canEncrypt}
            disabled={!canEncrypt}
            onChange={(e) => setEncrypt(e.target.checked)}
          />
          <span className="encLabel">
            <LockIcon size={18} />
            パスワードで暗号化する（推奨）
          </span>
        </label>
        {canEncrypt ? (
          encrypt && (
            <input
              className="textField"
              type="password"
              placeholder="パスワード（4文字以上・忘れると復元不可）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          )
        ) : (
          <p className="hint warnText">
            この環境では暗号化を使えません（安全な接続=HTTPSまたはlocalhostが必要）。暗号化なしで保存されます。
          </p>
        )}

        <button className="btn primary big" disabled={busy} onClick={() => void doExport()}>
          <ExportIcon size={20} />
          エクスポート（1ファイルに保存）
        </button>
      </section>

      <section className="backupSec">
        <h2 className="secTitle">取り込み（マージ / 復元）</h2>
        <p className="hint">
          AirDrop等で受け取った共有zipや、バックアップのファイルを取り込みます。
          ファイルを選ぶと「追加（マージ）」か「全置換（復元）」かを選べます。
        </p>
        <button className="btn big" disabled={busy} onClick={() => importRef.current?.click()}>
          <ImportIcon size={20} />
          ファイルを選んで取り込む
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".zip,.mfbackup,application/zip,application/octet-stream"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ''; // キャンセル後に同じファイルを選び直せるように即クリア
            if (f) setPendingFile(f);
          }}
        />
      </section>

      {pendingFile && (
        <div className="overlay" onClick={() => setPendingFile(null)}>
          <div className="modalCard importModeCard" onClick={(e) => e.stopPropagation()}>
            <div className="ocrTitle">どう取り込みますか？</div>
            <div className="ocrBody">
              <b>{pendingFile.name}</b>
            </div>
            <button
              className="btn primary big"
              onClick={() => {
                const f = pendingFile;
                setPendingFile(null);
                void doMerge(f);
              }}
            >
              追加で取り込む（マージ・おすすめ）
            </button>
            <p className="hint modeHint">
              既存のデータは消えません。同僚から受け取ったPDFの取り込みはこちら。まったく同じもの（本体もメモも一致）は重複として飛ばします。
            </p>
            <button
              className="btn danger big"
              onClick={() => {
                const f = pendingFile;
                setPendingFile(null);
                void doReplace(f);
              }}
            >
              全置換で復元（既存データは消える）
            </button>
            <p className="hint modeHint">バックアップから丸ごと元に戻すときだけ。現在のデータは置き換わります。</p>
            <button className="btn ghost big" onClick={() => setPendingFile(null)}>
              キャンセル
            </button>
          </div>
        </div>
      )}

      <section className="backupSec">
        <h2 className="secTitle">メンテナンス</h2>
        <p className="hint">
          検索が効かない/結果がおかしいとき、保存済みPDFのテキストから索引を作り直します。
        </p>
        <button className="btn big" disabled={busy} onClick={() => void doRebuild()}>
          <RebuildIcon size={20} />
          検索索引を再構築
        </button>
      </section>

      {status && (
        <div className={`backupStatus${busy ? ' busy' : ''}`}>
          {busy && <span className="spinnerSmall" />}
          {status}
        </div>
      )}
    </div>
  );
}
