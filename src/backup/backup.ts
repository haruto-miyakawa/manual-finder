// エクスポート/インポート（中核機能）。全データ(PDFバイト含む)を単一ファイルに。
// PDF/写真は STORE(無圧縮=level0、既に圧縮済のため高速)、JSONは軽く圧縮。
// 任意でパスワード暗号化（WebCrypto: PBKDF2→AES-GCM）。外部通信・追加依存なし。
import { zip, unzip, type AsyncZippable, type Unzipped } from 'fflate';
import { db } from '../db/db';
import type { PdfMeta, PhotoRow, Campaign, PageRow, PdfBlobRow } from '../types';
import { rebuildFromPages, clearIndex } from '../search/searchIndex';

const FORMAT_VERSION = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();

interface Manifest {
  app: 'manual-finder';
  formatVersion: number;
  exportedAt: number;
  pdfs: PdfMeta[];
  photos: Array<Omit<PhotoRow, 'blob'>>;
  campaigns: Campaign[];
}

function zipAsync(data: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(data, { consume: true }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}
function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

// ================= 暗号化（任意） =================
// 暗号化バックアップのコンテナ: MAGIC(8) + salt(16) + iv(12) + AES-GCM暗号文
const ENC_MAGIC = new Uint8Array([0x4d, 0x46, 0x45, 0x4e, 0x43, 0x31, 0x00, 0x00]); // "MFENC1\0\0"
const PBKDF2_ITER = 210000;

/** WebCrypto(SubtleCrypto)が使えるか（＝安全なコンテキスト: HTTPS または localhost）。 */
export function cryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

function isEncrypted(bytes: Uint8Array): boolean {
  if (bytes.length < ENC_MAGIC.length) return false;
  return ENC_MAGIC.every((b, i) => bytes[i] === b);
}

/** ファイル先頭だけ読んで暗号化バックアップか判定（インポートUIの事前判定用）。 */
export async function peekBackupEncrypted(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, ENC_MAGIC.length).arrayBuffer());
  return isEncrypted(head);
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptBytes(data: Uint8Array, passphrase: string): Promise<Uint8Array> {
  if (!cryptoAvailable()) throw new Error('この環境では暗号化を利用できません（安全な接続が必要）。');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(ENC_MAGIC.length + salt.length + iv.length + ct.length);
  out.set(ENC_MAGIC, 0);
  out.set(salt, ENC_MAGIC.length);
  out.set(iv, ENC_MAGIC.length + salt.length);
  out.set(ct, ENC_MAGIC.length + salt.length + iv.length);
  return out;
}

async function decryptBytes(bytes: Uint8Array, passphrase: string): Promise<Uint8Array> {
  if (!cryptoAvailable()) throw new Error('この環境では復号を利用できません（安全な接続が必要）。');
  const salt = bytes.slice(ENC_MAGIC.length, ENC_MAGIC.length + 16);
  const iv = bytes.slice(ENC_MAGIC.length + 16, ENC_MAGIC.length + 28);
  const ct = bytes.slice(ENC_MAGIC.length + 28);
  const key = await deriveKey(passphrase, salt);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  } catch {
    throw new Error('パスワードが違うか、ファイルが壊れています。');
  }
}

// ================= エクスポート =================
export interface ExportProgress {
  phase: 'collect' | 'zip' | 'encrypt' | 'done';
  detail?: string;
}

/**
 * 全データを1ファイルに書き出す。passphrase を渡すと AES-GCM で暗号化する。
 */
export async function exportAll(
  onProgress?: (p: ExportProgress) => void,
  passphrase?: string,
): Promise<Blob> {
  onProgress?.({ phase: 'collect', detail: 'データ収集中' });
  const [pdfs, blobs, pages, photos, campaigns] = await Promise.all([
    db.pdfs.toArray(),
    db.blobs.toArray(),
    db.pages.toArray(),
    db.photos.toArray(),
    db.campaigns.toArray(),
  ]);

  const blobById = new Map<string, PdfBlobRow>(blobs.map((b) => [b.id, b]));
  const pagesByPdf = new Map<string, PageRow[]>();
  for (const pg of pages) {
    const arr = pagesByPdf.get(pg.pdfId) ?? [];
    arr.push(pg);
    pagesByPdf.set(pg.pdfId, arr);
  }

  const manifest: Manifest = {
    app: 'manual-finder',
    formatVersion: FORMAT_VERSION,
    exportedAt: Date.now(),
    pdfs,
    photos: photos.map(({ blob: _blob, ...rest }) => rest),
    campaigns,
  };

  const zippable: AsyncZippable = {};
  zippable['manifest.json'] = [enc.encode(JSON.stringify(manifest)), { level: 6 }];

  for (const meta of pdfs) {
    const row = blobById.get(meta.id);
    if (row) {
      const buf = new Uint8Array(await row.blob.arrayBuffer());
      zippable[`pdfs/${meta.id}.pdf`] = [buf, { level: 0 }]; // STORE
    }
    const pageRows = (pagesByPdf.get(meta.id) ?? []).sort((a, b) => a.page - b.page);
    const pageJson = JSON.stringify(pageRows.map((p) => ({ page: p.page, text: p.text })));
    zippable[`pages/${meta.id}.json`] = [enc.encode(pageJson), { level: 6 }];
  }

  for (const ph of photos) {
    const buf = new Uint8Array(await ph.blob.arrayBuffer());
    zippable[`photos/${ph.id}`] = [buf, { level: 0 }]; // STORE
  }

  onProgress?.({ phase: 'zip', detail: '1ファイルに書き出し中' });
  let out = await zipAsync(zippable);

  if (passphrase) {
    onProgress?.({ phase: 'encrypt', detail: '暗号化中' });
    out = await encryptBytes(out, passphrase);
    onProgress?.({ phase: 'done' });
    return new Blob([out.slice()], { type: 'application/octet-stream' });
  }
  onProgress?.({ phase: 'done' });
  return new Blob([out.slice()], { type: 'application/zip' });
}

// ================= インポート（全置換で完全復元） =================
export interface ImportSummary {
  pdfs: number;
  pages: number;
  photos: number;
  campaigns: number;
}

/** インポートが暗号化されておりパスワード未指定のとき投げるエラー（UIでパスワード入力を促す）。 */
export class BackupEncryptedError extends Error {
  constructor() {
    super('暗号化されたバックアップです。パスワードが必要です。');
    this.name = 'BackupEncryptedError';
  }
}

/** zip/暗号化zipから全置換で完全復元。既存データは全消去される。 */
export async function importAllReplace(
  file: Blob,
  onProgress?: (p: { phase: 'read' | 'parse' | 'write' | 'index' | 'done'; detail?: string }) => void,
  passphrase?: string,
): Promise<ImportSummary> {
  onProgress?.({ phase: 'read', detail: '読み込み中' });
  let bytes = new Uint8Array(await file.arrayBuffer());

  if (isEncrypted(bytes)) {
    if (!passphrase) throw new BackupEncryptedError();
    onProgress?.({ phase: 'parse', detail: '復号中' });
    bytes = await decryptBytes(bytes, passphrase);
  }

  onProgress?.({ phase: 'parse', detail: '解析中' });
  const files = await unzipAsync(bytes);

  const manifestRaw = files['manifest.json'];
  if (!manifestRaw) throw new Error('manifest.json が見つかりません（不正なバックアップ）。');
  const manifest = JSON.parse(dec.decode(manifestRaw)) as Manifest;
  if (manifest.app !== 'manual-finder') {
    throw new Error('このアプリのバックアップではありません。');
  }

  onProgress?.({ phase: 'write', detail: '書き込み中' });
  await db.transaction(
    'rw',
    db.pdfs,
    db.blobs,
    db.pages,
    db.photos,
    db.campaigns,
    async () => {
      await Promise.all([
        db.pdfs.clear(),
        db.blobs.clear(),
        db.pages.clear(),
        db.photos.clear(),
        db.campaigns.clear(),
      ]);

      for (const meta of manifest.pdfs) {
        await db.pdfs.put(meta);
        const pdfBytes = files[`pdfs/${meta.id}.pdf`];
        if (pdfBytes) {
          await db.blobs.put({
            id: meta.id,
            blob: new Blob([pdfBytes.slice()], { type: 'application/pdf' }),
          });
        }
        const pagesRaw = files[`pages/${meta.id}.json`];
        if (pagesRaw) {
          const arr = JSON.parse(dec.decode(pagesRaw)) as Array<{ page: number; text: string }>;
          const rows: PageRow[] = arr.map((p) => ({
            id: `${meta.id}#${p.page}`,
            pdfId: meta.id,
            page: p.page,
            text: p.text,
          }));
          await db.pages.bulkPut(rows);
        }
      }

      for (const ph of manifest.photos) {
        const buf = files[`photos/${ph.id}`];
        if (buf) {
          const row: PhotoRow = {
            ...ph,
            blob: new Blob([buf.slice()], { type: ph.type || 'image/jpeg' }),
          };
          await db.photos.put(row);
        }
      }

      for (const c of manifest.campaigns) await db.campaigns.put(c);
    },
  );

  onProgress?.({ phase: 'index', detail: '索引再構築中' });
  await clearIndex();
  const pages = await rebuildFromPages();

  onProgress?.({ phase: 'done' });
  return {
    pdfs: manifest.pdfs.length,
    pages,
    photos: manifest.photos.length,
    campaigns: manifest.campaigns.length,
  };
}

// ================= ダウンロード / ファイル名 =================
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function backupFileName(encrypted = false): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `manual-finder-backup-${stamp}.${encrypted ? 'mfbackup' : 'zip'}`;
}
