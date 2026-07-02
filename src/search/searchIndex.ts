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

/** id 文字列を pdfId/page に分解（pdfId に '#' は含まれない前提で最後の '#' で分割）。 */
export function splitDocId(id: string): { pdfId: string; page: number } {
  const i = id.lastIndexOf('#');
  return { pdfId: id.slice(0, i), page: Number(id.slice(i + 1)) };
}

export function makeDocId(pdfId: string, page: number): string {
  return `${pdfId}#${page}`;
}

/** 起動時: 保存済みインデックスを復元。無ければ pages から再構築。 */
export async function initSearchIndex(): Promise<void> {
  const json = await getMeta<string>(INDEX_META_KEY);
  if (json) {
    try {
      mini = MiniSearch.loadJSON<IndexDoc>(json, OPTIONS);
      return;
    } catch {
      // 破損時は再構築にフォールバック
      mini = null;
    }
  }
  await rebuildFromPages();
}

/** pages テーブルの全ページ本文から索引を作り直す（PDF再パース不要の復旧導線）。 */
export async function rebuildFromPages(): Promise<number> {
  const fresh = create();
  const rows = await db.pages.toArray();
  fresh.addAll(rows.map((r) => ({ id: r.id, text: r.text })));
  mini = fresh;
  await persistNow();
  return rows.length;
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

export interface RawHit {
  id: string;
  pdfId: string;
  page: number;
  score: number;
}

/** ページ単位の検索。空クエリは空配列。 */
export function searchPages(query: string, limit = 200): RawHit[] {
  const q = query.trim();
  if (!q) return [];
  const idx = getIndex();
  const results = idx.search(q);
  const hits: RawHit[] = [];
  for (const r of results) {
    const { pdfId, page } = splitDocId(r.id as string);
    hits.push({ id: r.id as string, pdfId, page, score: r.score });
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
