// MiniSearch を用いたページ単位・全文検索インデックスの管理。
// 永続化: meta['searchIndex'] に JSON で保存 → 起動時に loadJSON で復元（全再パース回避）。
// 破損/消失時は pages テーブルから再構築できる。
import MiniSearch from 'minisearch';
import { tokenize } from './tokenizer';
import { db, getMeta, setMeta } from '../db/db';
import type { PageRow } from '../types';

interface IndexDoc {
  id: string; // `${pdfId}#${page}`
  text: string;
}

const INDEX_META_KEY = 'searchIndex';
const INDEX_VER_KEY = 'searchIndexVer';
const INDEX_VER = 4; // 4: 写真OCR(o:)も索引に含む / 3: メモ/ページメモ/ファイル名も

// index/query 双方で同一トークナイザ。processTerm は tokenize 内で正規化済みなので恒等。
const OPTIONS = {
  idField: 'id',
  fields: ['text'],
  storeFields: [] as string[], // 本文はインデックスに保存しない（pages テーブルに原文がある）
  tokenize,
  processTerm: (term: string) => term,
  searchOptions: {
    prefix: true, // 型番の前方一致
    combineWith: 'AND' as const, // bigram全一致で近似フレーズ検索（適合率優先）
  },
};

let mini: MiniSearch<IndexDoc> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function create(): MiniSearch<IndexDoc> {
  return new MiniSearch<IndexDoc>(OPTIONS);
}

export function getIndex(): MiniSearch<IndexDoc> {
  if (!mini) mini = create();
  return mini;
}

export type HitKind = 'page' | 'note' | 'memo' | 'file' | 'photo';

// 索引の doc id 規約:
//   ページ本文: `${pdfId}#${page}`
//   ページメモ: `n:${pdfId}#${page}`
//   PDFメモ:    `m:${pdfId}`
//   ファイル名/タイトル: `f:${pdfId}`
//   写真OCR:    `o:${pdfId}#${photoId}`
export function parseDocId(id: string): {
  kind: HitKind;
  pdfId: string;
  page: number;
  photoId?: string;
} {
  if (id.startsWith('f:')) return { kind: 'file', pdfId: id.slice(2), page: 1 };
  if (id.startsWith('m:')) return { kind: 'memo', pdfId: id.slice(2), page: 1 };
  if (id.startsWith('o:')) {
    const rest = id.slice(2);
    const i = rest.indexOf('#');
    return { kind: 'photo', pdfId: rest.slice(0, i), page: 1, photoId: rest.slice(i + 1) };
  }
  const isNote = id.startsWith('n:');
  const rest = isNote ? id.slice(2) : id;
  const i = rest.lastIndexOf('#');
  return { kind: isNote ? 'note' : 'page', pdfId: rest.slice(0, i), page: Number(rest.slice(i + 1)) };
}

export function makeDocId(pdfId: string, page: number): string {
  return `${pdfId}#${page}`;
}

/** 起動時: 保存済みインデックスを復元。無ければ pages から再構築。 */
export async function initSearchIndex(): Promise<void> {
  const ver = await getMeta<number>(INDEX_VER_KEY);
  const json = await getMeta<string>(INDEX_META_KEY);
  if (json && ver === INDEX_VER) {
    try {
      mini = MiniSearch.loadJSON<IndexDoc>(json, OPTIONS);
      return;
    } catch {
      // 破損時は再構築にフォールバック
      mini = null;
    }
  }
  // 索引が無い/古い（メモ未収録）なら作り直す（PDF再パース不要・高速）
  await rebuildFromPages();
}

/** ページ本文＋PDFメモ＋ページメモから索引を作り直す（PDF再パース不要の復旧導線）。 */
export async function rebuildFromPages(): Promise<number> {
  const fresh = create();
  const [pages, pdfs, notes, photos] = await Promise.all([
    db.pages.toArray(),
    db.pdfs.toArray(),
    db.pageNotes.toArray(),
    db.photos.toArray(),
  ]);
  const docs: IndexDoc[] = [];
  for (const r of pages) docs.push({ id: r.id, text: r.text });
  for (const p of pdfs) {
    if (p.memo && p.memo.trim()) docs.push({ id: `m:${p.id}`, text: p.memo });
    const f = `${p.title ?? ''} ${p.fileName ?? ''}`.trim();
    if (f) docs.push({ id: `f:${p.id}`, text: f });
  }
  for (const n of notes) if (n.text && n.text.trim()) docs.push({ id: `n:${n.id}`, text: n.text });
  for (const ph of photos)
    if (ph.ocrText && ph.ocrText.trim()) docs.push({ id: `o:${ph.pdfId}#${ph.id}`, text: ph.ocrText });
  fresh.addAll(docs);
  mini = fresh;
  await persistNow();
  await setMeta(INDEX_VER_KEY, INDEX_VER);
  return docs.length;
}

/** PDF追加時: そのPDFのページ群を索引へ。 */
export function addPages(pages: PageRow[]): void {
  const idx = getIndex();
  idx.addAll(pages.map((p) => ({ id: p.id, text: p.text })));
  scheduleSave();
}

/** PDF削除時: id 群を索引から破棄。 */
export function removeDocIds(ids: string[]): void {
  const idx = getIndex();
  idx.discardAll(ids);
  scheduleSave();
}

/** メモ/ページメモ等の任意テキスト文書を索引に追加/更新/削除（空なら削除）。 */
export function upsertTextDoc(id: string, text: string): void {
  const idx = getIndex();
  const t = (text || '').trim();
  if (idx.has(id)) {
    if (t) idx.replace({ id, text: t });
    else idx.discard(id);
  } else if (t) {
    idx.add({ id, text: t });
  }
  scheduleSave();
}

export function removeTextDoc(id: string): void {
  const idx = getIndex();
  if (idx.has(id)) idx.discard(id);
  scheduleSave();
}

export interface RawHit {
  id: string;
  kind: HitKind;
  pdfId: string;
  page: number;
  photoId?: string;
  score: number;
}

/** 検索（ページ本文・メモ・ページメモ横断）。空クエリは空配列。 */
export function searchPages(query: string, limit = 200): RawHit[] {
  const q = query.trim();
  if (!q) return [];
  const idx = getIndex();
  const results = idx.search(q);
  const hits: RawHit[] = [];
  for (const r of results) {
    const { kind, pdfId, page, photoId } = parseDocId(r.id as string);
    hits.push({ id: r.id as string, kind, pdfId, page, photoId, score: r.score });
    if (hits.length >= limit) break;
  }
  return hits;
}

// ---- 永続化（デバウンス保存） ----
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persistNow();
  }, 800);
}

export async function persistNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!mini) return;
  await setMeta(INDEX_META_KEY, JSON.stringify(mini));
}

/** 全消去（インポートの全置換で使用）。 */
export async function clearIndex(): Promise<void> {
  mini = create();
  await persistNow();
}
