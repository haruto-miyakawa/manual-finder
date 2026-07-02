// アプリのデータ操作をまとめた層（UIはここだけ呼ぶ）。DB・抽出・検索索引を協調させる。
import { db, setMeta } from './db';
import { extractPdfText } from '../pdf/extract';
import { ensureThumb } from '../pdf/thumb';
import {
  addPages,
  makeDocId,
  removeDocIds,
  removeTextDoc,
  upsertTextDoc,
  persistNow,
  rebuildFromPages,
} from '../search/searchIndex';
import type { PdfMeta, PageRow, PhotoRow, Campaign } from '../types';

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${rand}`;
}

export interface ImportProgress {
  phase: 'extract' | 'store' | 'done';
  page?: number;
  total?: number;
}

/** PDFファイルを取り込む: テキスト抽出 → バイト/メタ/ページ保存 → 索引追加。 */
export async function importPdfFile(
  file: File,
  onProgress?: (p: ImportProgress) => void,
): Promise<PdfMeta> {
  const id = newId('pdf');
  const now = Date.now();
  const bytes = await file.arrayBuffer(); // 抽出用（pdf.jsで消費される）

  onProgress?.({ phase: 'extract', page: 0, total: 0 });
  const { pageCount, pages, hasText } = await extractPdfText(bytes, (page, total) =>
    onProgress?.({ phase: 'extract', page, total }),
  );

  const title = file.name.replace(/\.pdf$/i, '');
  const meta: PdfMeta = {
    id,
    title,
    fileName: file.name,
    pageCount,
    byteSize: file.size,
    hasText,
    favorite: false,
    category: '',
    tags: [],
    memo: '',
    createdAt: now,
    updatedAt: now,
  };

  const pageRows: PageRow[] = pages.map((p) => ({
    id: makeDocId(id, p.page),
    pdfId: id,
    page: p.page,
    text: p.text,
  }));

  onProgress?.({ phase: 'store' });
  await db.transaction('rw', db.pdfs, db.blobs, db.pages, async () => {
    await db.pdfs.put(meta);
    // File は Blob。そのまま保存し、読み出しは blob.arrayBuffer() で行う。
    await db.blobs.put({ id, blob: file });
    await db.pages.bulkPut(pageRows);
  });

  // 索引へ（本文が空のスキャンPDFでもページ行は入れる＝存在は検索対象外だが一覧には出る）
  addPages(pageRows);
  upsertTextDoc(`f:${id}`, `${title} ${file.name}`); // ファイル名/タイトルも検索対象に
  await persistNow();

  void ensureThumb(id); // サムネイル生成（非同期・失敗しても取り込みは成功）

  onProgress?.({ phase: 'done' });
  return meta;
}

/** PDFを完全削除（メタ・バイト・ページ・写真・索引・紐付け施策の解除）。 */
export async function deletePdf(id: string): Promise<void> {
  const pageRows = await db.pages.where('pdfId').equals(id).primaryKeys();
  const noteIds = (await db.pageNotes.where('pdfId').equals(id).primaryKeys()) as string[];
  await db.transaction(
    'rw',
    [db.pdfs, db.blobs, db.pages, db.photos, db.campaigns, db.thumbs, db.pageNotes],
    async () => {
      await db.pdfs.delete(id);
      await db.blobs.delete(id);
      await db.pages.where('pdfId').equals(id).delete();
      await db.photos.where('pdfId').equals(id).delete();
      await db.thumbs.delete(id);
      await db.pageNotes.where('pdfId').equals(id).delete();
      // 紐付け施策は PDF参照を外す（施策自体は残す）
      await db.campaigns.where('pdfId').equals(id).modify({ pdfId: null });
    },
  );
  removeDocIds(pageRows as string[]);
  removeTextDoc(`m:${id}`);
  removeTextDoc(`f:${id}`);
  for (const nid of noteIds) removeTextDoc(`n:${nid}`);
  await persistNow();
}

export async function getPdfBytes(id: string): Promise<ArrayBuffer | null> {
  const row = await db.blobs.get(id);
  if (!row) return null;
  return await row.blob.arrayBuffer();
}

// ---- PDFメタ更新 ----
export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  await db.pdfs.update(id, { favorite, updatedAt: Date.now() });
}
export async function setTitle(id: string, title: string): Promise<void> {
  const t = title.trim() || '(無題)';
  const cur = await db.pdfs.get(id);
  await db.pdfs.update(id, { title: t, updatedAt: Date.now() });
  upsertTextDoc(`f:${id}`, `${t} ${cur?.fileName ?? ''}`);
}
export async function setMemo(id: string, memo: string): Promise<void> {
  await db.pdfs.update(id, { memo, updatedAt: Date.now() });
  upsertTextDoc(`m:${id}`, memo); // メモも検索対象に
}
export async function setTags(id: string, tags: string[]): Promise<void> {
  const clean = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
  await db.pdfs.update(id, { tags: clean, updatedAt: Date.now() });
}
export async function setCategory(id: string, category: string): Promise<void> {
  await db.pdfs.update(id, { category: category.trim(), updatedAt: Date.now() });
}

// ---- ページ単位メモ ----
export async function getPageNote(pdfId: string, page: number): Promise<string> {
  const row = await db.pageNotes.get(`${pdfId}#${page}`);
  return row?.text ?? '';
}
export async function setPageNote(pdfId: string, page: number, text: string): Promise<void> {
  const id = `${pdfId}#${page}`;
  const t = text.trim();
  if (!t) await db.pageNotes.delete(id);
  else await db.pageNotes.put({ id, pdfId, page, text: t, updatedAt: Date.now() });
  upsertTextDoc(`n:${id}`, t); // ページメモも検索対象に
}

// ---- 写真（PDFへの注釈） ----
export async function addPhoto(pdfId: string, file: File): Promise<PhotoRow> {
  const row: PhotoRow = {
    id: newId('photo'),
    pdfId,
    blob: file,
    name: file.name || 'photo',
    type: file.type || 'image/jpeg',
    createdAt: Date.now(),
  };
  await db.photos.put(row);
  return row;
}
export async function deletePhoto(id: string): Promise<void> {
  await db.photos.delete(id);
}

// ---- 施策 ----
export async function upsertCampaign(
  input: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<Campaign> {
  const now = Date.now();
  if (input.id) {
    const existing = await db.campaigns.get(input.id);
    const merged: Campaign = {
      ...(existing as Campaign),
      ...input,
      id: input.id,
      updatedAt: now,
    };
    await db.campaigns.put(merged);
    return merged;
  }
  const camp: Campaign = {
    id: newId('camp'),
    name: input.name,
    startDate: input.startDate,
    deadline: input.deadline,
    memo: input.memo,
    pdfId: input.pdfId,
    createdAt: now,
    updatedAt: now,
  };
  await db.campaigns.put(camp);
  return camp;
}
export async function deleteCampaign(id: string): Promise<void> {
  await db.campaigns.delete(id);
}

// ---- 索引再構築（消失/破損時の復旧導線） ----
export async function rebuildSearchIndex(): Promise<number> {
  return await rebuildFromPages();
}

// ---- ストレージ（永続化要求・使用量） ----
export interface StorageInfo {
  persisted: boolean;
  usage: number;
  quota: number;
}
export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage?.persist) {
    const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    if (already) return true;
    return await navigator.storage.persist();
  }
  return false;
}
export async function getStorageInfo(): Promise<StorageInfo> {
  let persisted = false;
  let usage = 0;
  let quota = 0;
  if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    usage = est.usage ?? 0;
    quota = est.quota ?? 0;
  }
  return { persisted, usage, quota };
}

// ---- バックアップ促し状態 ----
export async function markBackupDone(): Promise<void> {
  await setMeta('lastBackupAt', Date.now());
}
