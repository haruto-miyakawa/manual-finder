// エクスポート/インポート（中核機能）。全データ(PDFバイト含む)を単一ファイルに。
// PDF/写真は STORE(無圧縮=level0、既に圧縮済のため高速)、JSONは軽く圧縮。
// 任意でパスワード暗号化（WebCrypto: PBKDF2→AES-GCM）。外部通信・追加依存なし。
import { zip, unzip, type AsyncZippable, type Unzipped } from 'fflate';
import { db, type PageNoteRow } from '../db/db';
import type { PdfMeta, PhotoRow, Campaign, PageRow, PdfBlobRow, MemoBlock } from '../types';
import { rebuildFromPages, clearIndex, addPages, upsertTextDoc, persistNow } from '../search/searchIndex';
import { migrateMemoDocs, memoDocText, newId } from '../db/repo';
import { ensureThumb } from '../pdf/thumb';

const FORMAT_VERSION = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();

interface Manifest {
  app: 'manual-finder';
  formatVersion: number;
  exportedAt: number;
  partial?: boolean; // true = 部分エクスポート（共有用。カテゴリ/タグ/施策を含まない）
  pdfs: PdfMeta[];
  photos: Array<Omit<PhotoRow, 'blob'>>;
  campaigns: Campaign[];
  pageNotes: PageNoteRow[];
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
  const [pdfs, blobs, pages, photos, campaigns, pageNotes] = await Promise.all([
    db.pdfs.toArray(),
    db.blobs.toArray(),
    db.pages.toArray(),
    db.photos.toArray(),
    db.campaigns.toArray(),
    db.pageNotes.toArray(),
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
    pageNotes,
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

// ================= 部分エクスポート（選択したPDFだけを共有用に） =================
/**
 * 選択したPDFだけを1つのzipに書き出す（AirDrop等のローカル受け渡し用）。
 * 含む: PDF本体 / ページ本文（OCR結果含む）/ リッチメモ＋インライン画像 / ページメモ。
 * 含まない: カテゴリ・タグ・お気に入り・未読・施策・サムネイル（受信側の分類体系を汚さない）。
 */
export async function exportPartial(
  pdfIds: string[],
  onProgress?: (p: ExportProgress) => void,
): Promise<Blob> {
  onProgress?.({ phase: 'collect', detail: 'データ収集中' });
  const idSet = new Set(pdfIds);
  const [pdfsAll, photosAll, pageNotesAll] = await Promise.all([
    db.pdfs.toArray(),
    db.photos.toArray(),
    db.pageNotes.toArray(),
  ]);
  const pdfs = pdfsAll.filter((p) => idSet.has(p.id));
  const photos = photosAll.filter((p) => idSet.has(p.pdfId));
  const pageNotes = pageNotesAll.filter((n) => idSet.has(n.pdfId));

  const manifest: Manifest = {
    app: 'manual-finder',
    formatVersion: FORMAT_VERSION,
    exportedAt: Date.now(),
    partial: true,
    // カテゴリ/タグ/お気に入り/未読は共有に含めない（受信側で自分の分類・状態を持つ）
    pdfs: pdfs.map((p) => ({ ...p, category: '', tags: [], favorite: false, unread: false })),
    photos: photos.map(({ blob: _blob, ...rest }) => rest),
    campaigns: [], // 施策は部分エクスポートの対象外
    pageNotes,
  };

  const zippable: AsyncZippable = {};
  zippable['manifest.json'] = [enc.encode(JSON.stringify(manifest)), { level: 6 }];
  for (const meta of pdfs) {
    const row = await db.blobs.get(meta.id);
    if (row) {
      zippable[`pdfs/${meta.id}.pdf`] = [new Uint8Array(await row.blob.arrayBuffer()), { level: 0 }];
    }
    const pageRows = (await db.pages.where('pdfId').equals(meta.id).toArray()).sort((a, b) => a.page - b.page);
    const pageJson = JSON.stringify(pageRows.map((p) => ({ page: p.page, text: p.text })));
    zippable[`pages/${meta.id}.json`] = [enc.encode(pageJson), { level: 6 }];
  }
  for (const ph of photos) {
    zippable[`photos/${ph.id}`] = [new Uint8Array(await ph.blob.arrayBuffer()), { level: 0 }];
  }

  onProgress?.({ phase: 'zip', detail: '1ファイルに書き出し中' });
  const out = await zipAsync(zippable);
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
    [db.pdfs, db.blobs, db.pages, db.photos, db.campaigns, db.thumbs, db.pageNotes],
    async () => {
      await Promise.all([
        db.pdfs.clear(),
        db.blobs.clear(),
        db.pages.clear(),
        db.photos.clear(),
        db.campaigns.clear(),
        db.thumbs.clear(),
        db.pageNotes.clear(),
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
      for (const nrow of manifest.pageNotes ?? []) await db.pageNotes.put(nrow);
    },
  );

  // 旧形式バックアップ（memoDoc無し）はリッチメモへ移行（新形式はそのまま素通り・冪等）
  await migrateMemoDocs();

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

// ================= マージインポート（既存を消さず追加） =================
export interface MergeSummary {
  added: number; // 新規追加（重複でなかった、または注釈が異なり両方残した）
  skipped: number; // 完全に同一でスキップ
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** メモのプレーンテキスト（memoDoc優先・無ければ旧memo文字列）。 */
function memoTextOf(meta: PdfMeta): string {
  if (meta.memoDoc) return memoDocText(meta.memoDoc);
  return (meta.memo || '').trim();
}

/**
 * 既存PDF（バイト一致済み）と、取り込み候補の注釈（メモ/写真/ページメモ）が完全に一致するか。
 * 一致＝「完全に同一」としてスキップ対象。1つでも違えば両方残す（仕様v4-2）。
 */
async function annotationsEqual(
  existing: PdfMeta,
  incoming: PdfMeta,
  incomingPhotos: Array<{ meta: Omit<PhotoRow, 'blob'>; bytes: Uint8Array }>,
  incomingNotes: Array<{ page: number; text: string }>,
): Promise<boolean> {
  if (memoTextOf(existing) !== memoTextOf(incoming)) return false;
  // ページメモ: {page: text} 集合の一致
  const exNotes = await db.pageNotes.where('pdfId').equals(existing.id).toArray();
  if (exNotes.length !== incomingNotes.length) return false;
  const exNoteMap = new Map(exNotes.map((n) => [n.page, n.text.trim()]));
  for (const n of incomingNotes) {
    if (exNoteMap.get(n.page) !== n.text.trim()) return false;
  }
  // 写真: バイト集合の一致（サイズで前置チェックしてからバイト比較）
  const exPhotos = await db.photos.where('pdfId').equals(existing.id).toArray();
  if (exPhotos.length !== incomingPhotos.length) return false;
  const remaining = [...exPhotos];
  for (const inc of incomingPhotos) {
    let matched = -1;
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].blob.size !== inc.bytes.length) continue;
      const exBytes = new Uint8Array(await remaining[i].blob.arrayBuffer());
      if (bytesEqual(exBytes, inc.bytes)) {
        matched = i;
        break;
      }
    }
    if (matched < 0) return false;
    remaining.splice(matched, 1);
  }
  return true;
}

/**
 * zip（共有用の部分エクスポート／全データバックアップのどちらでも）を、
 * **既存データを一切消さずに**追加取り込みする。
 *  - 重複判定: PDF本体のバイト完全一致 かつ メモ/写真/ページメモも一致 → スキップ。
 *    それ以外（バイト不一致・注釈が異なる）はIDを再発行して両方残す。
 *  - 追加分は カテゴリ=未分類 / タグなし / 未読 / createdAt=今 で入れる（受信側の分類体系を汚さない）。
 *  - zip内の施策・カテゴリ情報は無視する（共有の目的外）。
 */
export async function importAllMerge(
  file: Blob,
  onProgress?: (p: { phase: 'read' | 'parse' | 'write' | 'index' | 'done'; detail?: string }) => void,
  passphrase?: string,
): Promise<MergeSummary> {
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
  if (!manifestRaw) throw new Error('manifest.json が見つかりません（不正なファイル）。');
  const manifest = JSON.parse(dec.decode(manifestRaw)) as Manifest;
  if (manifest.app !== 'manual-finder') throw new Error('このアプリのファイルではありません。');

  const summary: MergeSummary = { added: 0, skipped: 0 };
  const existingAll = await db.pdfs.toArray();
  const now = Date.now();

  for (const [idx, meta] of manifest.pdfs.entries()) {
    onProgress?.({ phase: 'write', detail: `取り込み中 ${idx + 1}/${manifest.pdfs.length}` });
    const pdfBytesRaw = files[`pdfs/${meta.id}.pdf`];
    if (!pdfBytesRaw) continue; // 本体なしはスキップ

    // 付随データ（写真・ページメモ）を先に集める
    const incomingPhotoMetas = manifest.photos.filter((p) => p.pdfId === meta.id);
    const incomingPhotos = incomingPhotoMetas
      .map((pm) => ({ meta: pm, bytes: files[`photos/${pm.id}`] }))
      .filter((x): x is { meta: Omit<PhotoRow, 'blob'>; bytes: Uint8Array } => !!x.bytes);
    const incomingNotes = (manifest.pageNotes ?? [])
      .filter((n) => n.pdfId === meta.id)
      .map((n) => ({ page: n.page, text: n.text }));

    // 重複判定: バイト完全一致（byteSize で候補を絞ってから全バイト比較）
    let duplicate = false;
    for (const ex of existingAll) {
      if (ex.byteSize !== pdfBytesRaw.length) continue;
      const exRow = await db.blobs.get(ex.id);
      if (!exRow) continue;
      const exBytes = new Uint8Array(await exRow.blob.arrayBuffer());
      if (!bytesEqual(exBytes, pdfBytesRaw)) continue;
      // 本体が同一 → 注釈も同一なら「完全に同一」としてスキップ
      if (await annotationsEqual(ex, meta, incomingPhotos, incomingNotes)) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) {
      summary.skipped++;
      continue;
    }

    // 追加: IDを全て再発行（既存とのID衝突を避ける）
    const newPdfId = newId('pdf');
    const photoIdMap = new Map<string, string>();
    for (const p of incomingPhotos) photoIdMap.set(p.meta.id, newId('photo'));
    // 旧形式（memoDoc無し）は移行と同じ規則で組み立てる: 旧memo→先頭text、写真→createdAt順のimage
    const baseDoc: MemoBlock[] =
      meta.memoDoc ??
      ([
        ...(meta.memo?.trim() ? [{ type: 'text' as const, text: meta.memo }] : []),
        ...[...incomingPhotos]
          .sort((a, b) => (a.meta.createdAt ?? 0) - (b.meta.createdAt ?? 0))
          .map((p) => ({ type: 'image' as const, photoId: p.meta.id })),
      ] satisfies MemoBlock[]);
    const memoDoc: MemoBlock[] = baseDoc
      .map((b) => (b.type === 'image' ? { type: 'image' as const, photoId: photoIdMap.get(b.photoId) ?? b.photoId } : b))
      // 参照先の写真がzipに無い image ブロックは落とす（壊れ参照を持ち込まない）
      .filter((b) => b.type === 'text' || incomingPhotos.some((p) => photoIdMap.get(p.meta.id) === b.photoId));
    const memo = memoDocText(memoDoc);

    const pagesRaw = files[`pages/${meta.id}.json`];
    const pageArr = pagesRaw ? (JSON.parse(dec.decode(pagesRaw)) as Array<{ page: number; text: string }>) : [];
    const pageRows: PageRow[] = pageArr.map((p) => ({
      id: `${newPdfId}#${p.page}`,
      pdfId: newPdfId,
      page: p.page,
      text: p.text,
    }));
    const noteRows: PageNoteRow[] = incomingNotes.map((n) => ({
      id: `${newPdfId}#${n.page}`,
      pdfId: newPdfId,
      page: n.page,
      text: n.text,
      updatedAt: now,
    }));

    const newMeta: PdfMeta = {
      ...meta,
      id: newPdfId,
      category: '', // 一律「未分類」（受信側が自分で分類し直す）
      tags: [],
      favorite: false,
      memoDoc,
      memo,
      unread: true, // 追加された全PDFに未読マーク
      createdAt: now, // 受け取った時刻＝新着順で上に来る
      updatedAt: now,
    };

    await db.transaction('rw', [db.pdfs, db.blobs, db.pages, db.photos, db.pageNotes], async () => {
      await db.pdfs.put(newMeta);
      await db.blobs.put({ id: newPdfId, blob: new Blob([pdfBytesRaw.slice()], { type: 'application/pdf' }) });
      await db.pages.bulkPut(pageRows);
      for (const p of incomingPhotos) {
        const row: PhotoRow = {
          ...p.meta,
          id: photoIdMap.get(p.meta.id)!,
          pdfId: newPdfId,
          blob: new Blob([p.bytes.slice()], { type: p.meta.type || 'image/jpeg' }),
        };
        await db.photos.put(row);
      }
      await db.pageNotes.bulkPut(noteRows);
    });

    // 索引へ増分登録（全再構築はしない）
    addPages(pageRows);
    upsertTextDoc(`f:${newPdfId}`, `${newMeta.title} ${newMeta.fileName}`.trim());
    if (memo) upsertTextDoc(`m:${newPdfId}`, memo);
    for (const n of noteRows) upsertTextDoc(`n:${n.id}`, n.text);
    for (const p of incomingPhotos) {
      const ocr = (p.meta as { ocrText?: string }).ocrText;
      if (ocr && ocr.trim()) upsertTextDoc(`o:${newPdfId}#${photoIdMap.get(p.meta.id)}`, ocr);
    }
    void ensureThumb(newPdfId);
    summary.added++;
  }

  onProgress?.({ phase: 'index', detail: '索引を保存中' });
  await persistNow();
  onProgress?.({ phase: 'done' });
  return summary;
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

export function shareFileName(count: number): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  return `manual-share-${stamp}-${count}pdf.zip`;
}
