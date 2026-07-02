// バックアップ（中核機能）。ワンタップ・エクスポート / インポート(全置換で完全復元)。
// 任意でパスワード暗号化（安全な接続時のみ有効）。
import { useRef, useState } from 'react';
import {
  exportAll,
  importAllReplace,
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
}

export function BackupPanel({ onChanged }: Props) {
  const importRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
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

  async function doImport(file: File) {
    if (!confirm('現在の全データを、選んだバックアップで置き換えます。よろしいですか？')) return;
    setBusy(true);
    setStatus('インポート中…');
    try {
      let passphrase: string | undefined;
      if (await peekBackupEncrypted(file)) {
        if (!canEncrypt) throw new Error('暗号化バックアップの復号には安全な接続(HTTPS/localhost)が必要です。');
        const pw = window.prompt('このバックアップは暗号化されています。復号パスワードを入力してください。');
        if (pw == null) {
          setStatus('インポートを中止しました。');
          setBusy(false);
          return;
        }
        passphrase = pw;
      }
      const sum = await importAllReplace(
        file,
        (p) => {
          const label: Record<string, string> = {
            read: '読み込み中…',
            parse: p.detail === '復号中' ? '復号中…' : '解析中…',
            write: '書き込み中…',
            index: '検索索引を再構築中…',
            done: '完了',
          };
          setStatus(label[p.phase] ?? '処理中…');
        },
        passphrase,
      );
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
        <h2 className="secTitle">インポート（全置換で復元）</h2>
        <p className="hint">
          バックアップから完全復元します。現在のデータは置き換わります。暗号化ファイルはパスワードを求めます。
        </p>
        <button className="btn big" disabled={busy} onClick={() => importRef.current?.click()}>
          <ImportIcon size={20} />
          バックアップを選んで復元
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".zip,.mfbackup,application/zip,application/octet-stream"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
          }}
        />
      </section>

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
