// 検索結果（ページ単位のヒットカード）。カードのタップで該当ページを開く。
import { useEffect, useState } from 'react';
import { searchPages } from '../search/searchIndex';
import { buildSnippet } from '../search/snippet';
import { db } from '../db/db';
import type { SearchHit } from '../types';

interface Props {
  query: string; // デバウンス済み
  onOpen: (pdfId: string, page: number, query: string) => void;
  onSearchingChange?: (searching: boolean) => void;
}

const MAX_CARDS = 100;

export function SearchResults({ query, onOpen, onSearchingChange }: Props) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setTotal(0);
      onSearchingChange?.(false);
      return;
    }
    setBusy(true);
    onSearchingChange?.(true);
    (async () => {
      const raw = searchPages(q, 400);
      setTotal(raw.length);
      const top = raw.slice(0, MAX_CARDS);
      // ページ本文とPDFタイトルをまとめて取得
      const pageIds = top.map((h) => h.id);
      const pdfIds = Array.from(new Set(top.map((h) => h.pdfId)));
      const [pageRows, pdfRows] = await Promise.all([
        db.pages.bulkGet(pageIds),
        db.pdfs.bulkGet(pdfIds),
      ]);
      if (cancelled) return;
      const titleById = new Map<string, string>();
      pdfRows.forEach((p) => p && titleById.set(p.id, p.title));

      const built: SearchHit[] = top.map((h, i) => {
        const text = pageRows[i]?.text ?? '';
        return {
          pdfId: h.pdfId,
          page: h.page,
          title: titleById.get(h.pdfId) ?? '(削除済み)',
          snippetHtml: buildSnippet(text, q),
          score: h.score,
        };
      });
      if (cancelled) return;
      setHits(built);
      setBusy(false);
      onSearchingChange?.(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (!query.trim()) return null;

  return (
    <div className="results">
      <div className="resultsHead">
        {busy ? '検索中…' : `${total} 件ヒット${total > MAX_CARDS ? `（上位${MAX_CARDS}件表示）` : ''}`}
      </div>
      {!busy && hits.length === 0 && (
        <div className="empty">
          該当なし。型番は途中まで、キーワードは短めが当たりやすいです（本文にテキストが無いスキャンPDFは検索対象外）。
        </div>
      )}
      <ul className="resultList">
        {hits.map((h) => (
          <li key={`${h.pdfId}#${h.page}`}>
            <button className="hitCard" onClick={() => onOpen(h.pdfId, h.page, query)}>
              <div className="hitTop">
                <span className="hitTitle">{h.title}</span>
                <span className="hitPage">p.{h.page}</span>
              </div>
              <div className="hitSnippet" dangerouslySetInnerHTML={{ __html: h.snippetHtml }} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
