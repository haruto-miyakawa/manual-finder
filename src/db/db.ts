// IndexedDB スキーマ（Dexie）。PDFメタ・バイト・ページ本文・写真・施策・meta を保持。
import Dexie, { type Table } from 'dexie';
import type { PdfMeta, PdfBlobRow, PageRow, PhotoRow, Campaign, MetaRow } from '../types';

export interface ThumbRow {
  id: string; // = PdfMeta.id
  blob: Blob; // 1ページ目のサムネイル(JPEG)
}

export interface PageNoteRow {
  id: string; // `${pdfId}#${page}`
  pdfId: string;
  page: number;
  text: string;
  updatedAt: number;
}

export class ManualDB extends Dexie {
  pdfs!: Table<PdfMeta, string>;
  blobs!: Table<PdfBlobRow, string>;
  pages!: Table<PageRow, string>;
  photos!: Table<PhotoRow, string>;
  campaigns!: Table<Campaign, string>;
  meta!: Table<MetaRow, string>;
  thumbs!: Table<ThumbRow, string>;
  pageNotes!: Table<PageNoteRow, string>;

  constructor() {
    super('manual-finder');
    // インデックス設計:
    //  pdfs: favorite/createdAt/*tags で並び・絞り込み
    //  pages: pdfId で PDF 単位の一括削除
    //  photos: pdfId で紐付け取得
    //  campaigns: deadline で締切順
    this.version(1).stores({
      pdfs: 'id, title, favorite, createdAt, *tags',
      blobs: 'id',
      pages: 'id, pdfId',
      photos: 'id, pdfId, createdAt',
      campaigns: 'id, deadline, pdfId',
      meta: 'key',
    });
    // v2: サムネイル用ストアを追加（既存データはそのまま引き継がれる）
    this.version(2).stores({
      thumbs: 'id',
    });
    // v3: ページ単位メモ
    this.version(3).stores({
      pageNotes: 'id, pdfId',
    });
  }
}

export const db = new ManualDB();

// ---- meta 汎用アクセサ ----
export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
