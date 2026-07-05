// アプリ全体のデータ型。永続化(Dexie)・エクスポート(zip)・UI で共有する。

/** リッチメモのブロック（テキストと写真が縦に混在）。画像バイトは photos テーブルに置き、ここは参照のみ。 */
export type MemoBlock = { type: 'text'; text: string } | { type: 'image'; photoId: string };

/** マニュアルPDFのメタデータ。メモ(memoDoc)は仕様C「PDF単位の注釈」としてここに持つ。 */
export interface PdfMeta {
  id: string; // 例: "pdf_<timestamp>_<rand>"
  title: string; // 表示名（既定はファイル名から拡張子除去）
  fileName: string; // 取り込み元ファイル名
  pageCount: number;
  byteSize: number; // PDFバイト長
  hasText: boolean; // テキストレイヤ有無（スキャンPDF検出用）
  favorite: boolean;
  category?: string; // 分類（1つ）。未設定/空は「未分類」扱い
  tags: string[];
  memo: string; // memoDoc のテキスト部分を連結した派生値（検索索引・後方互換用）
  memoDoc?: MemoBlock[]; // リッチメモ本体（v1.6.0〜）。旧データは起動時に memo/写真から移行
  unread?: boolean; // 未読マーク（v1.7.0〜）。新規追加時 true、開いたら false
  createdAt: number; // 取り込み時刻(ms)
  updatedAt: number;
}

/** PDFの生バイト（別テーブルに分離してメタ読み込みを軽くする）。 */
export interface PdfBlobRow {
  id: string; // = PdfMeta.id
  blob: Blob; // application/pdf
}

/** ページ本文（スニペット表示・索引再構築用）。id = `${pdfId}#${page}` */
export interface PageRow {
  id: string;
  pdfId: string;
  page: number; // 1始まり
  text: string; // 原文（正規化前）
}

/** PDFに紐づく写真注釈。 */
export interface PhotoRow {
  id: string; // "photo_..."
  pdfId: string;
  blob: Blob;
  name: string;
  type: string; // MIME
  ocrText?: string; // OCRで抽出した文字（検索対象）。未実行は undefined
  createdAt: number;
}

/** 施策（締切つき・PDF 1つに紐付け）。日付は "YYYY-MM-DD"。 */
export interface Campaign {
  id: string; // "camp_..."
  name: string;
  startDate?: string; // 任意
  deadline: string; // 必須 "YYYY-MM-DD"
  memo: string;
  pdfId: string | null; // 紐付けPDF（1つ／未設定可）
  createdAt: number;
  updatedAt: number;
}

/** meta テーブルの汎用キー値（検索インデックスJSON・設定など）。 */
export interface MetaRow {
  key: string;
  value: unknown;
}

/** 検索ヒット（ページ本文 / PDFメモ / ページメモ / ファイル名 / 写真OCR）。 */
export interface SearchHit {
  pdfId: string;
  page: number;
  kind: 'page' | 'note' | 'memo' | 'file' | 'photo';
  title: string;
  snippetHtml: string; // 一致語を <mark> で強調済みHTML（サニタイズ済みテキストのみ）
  score: number;
}
