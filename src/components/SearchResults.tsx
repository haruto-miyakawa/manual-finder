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
      // 種別ごとに本文/メモ/ページメモ＋タイトルをまとめて取得
      const pdfIds = Array.from(new Set(top.map((h) => h.pdfId)));
      const pageKeys = top.filter((h) => h.kind === 'page').map((h) => `${h.pdfId}#${h.page}`);
      const noteKeys = top.filter((h) => h.kind === 'note').map((h) => `${h.pdfId}#${h.page}`);
      const photoIds = top.filter((h) => h.kind === 'photo' && h.photoId).map((h) => h.photoId!);
      const [pdfRows, pageRows, noteRows, photoRows] = await Promise.all([
        db.pdfs.bulkGet(pdfIds),
        db.pages.bulkGet(pageKeys),
        db.pageNotes.bulkGet(noteKeys),
        db.photos.bulkGet(photoIds),
      ]);
      if (cancelled) return;
      const pdfById = new Map(pdfRows.filter(Boolean).map((p) => [p!.id, p!] as const));
      const pageTextByKey = new Map(pageKeys.map((k, i) => [k, pageRows[i]?.text ?? ''] as const));
      const noteTextByKey = new Map(noteKeys.map((k, i) => [k, noteRows[i]?.text ?? ''] as const));
      const photoTextById = new Map(photoIds.map((id, i) => [id, photoRows[i]?.ocrText ?? ''] as const));

      const built: SearchHit[] = top.map((h) => {
        const pdf = pdfById.get(h.pdfId);
        const key = `${h.pdfId}#${h.page}`;
        const text =
          h.kind === 'page'
            ? pageTextByKey.get(key) ?? ''
            : h.kind === 'note'
              ? noteTextByKey.get(key) ?? ''
              : h.kind === 'photo'
                ? photoTextById.get(h.photoId ?? '') ?? ''
                : h.kind === 'file'
                  ? `${pdf?.title ?? ''} ／ ${pdf?.fileName ?? ''}`
                  : pdf?.memo ?? '';
        return {
          pdfId: h.pdfId,
          page: h.page,
          kind: h.kind,
          title: pdf?.title ?? '(削除済み)',
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
          該当なし。型番は途中まで、キーワードは短めが当たりやすいです（スキャンPDF・写真はOCR（文字認識）すると検索できます）。
        </div>
      )}
      <ul className="resultList">
        {hits.map((h, i) => (
          <li key={`${i}:${h.kind}:${h.pdfId}#${h.page}`}>
            <button className="hitCard" onClick={() => onOpen(h.pdfId, h.page, query)}>
              <div className="hitTop">
                <span className="hitTitle">{h.title}</span>
                <span className="hitPage">
                  {h.kind === 'memo'
                    ? '📝 メモ'
                    : h.kind === 'file'
                      ? '📄 ファイル名'
                      : h.kind === 'photo'
                        ? '📷 写真'
                        : h.kind === 'note'
                          ? `p.${h.page} 📝メモ`
                          : `p.${h.page}`}
                </span>
              </div>
              <div className="hitSnippet" dangerouslySetInnerHTML={{ __html: h.snippetHtml }} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
