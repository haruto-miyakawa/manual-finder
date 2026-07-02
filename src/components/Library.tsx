// PDFライブラリ。お気に入りは最上部に大きめタイル。取り込み・タグ絞り込み・詳細/ビューア導線。
import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { importPdfFile, setFavorite, type ImportProgress } from '../db/repo';
import type { PdfMeta } from '../types';

interface Props {
  onOpenViewer: (pdfId: string, page: number, query: string) => void;
  onOpenDetail: (pdfId: string) => void;
  onChanged: () => void;
}

export function Library({ onOpenViewer, onOpenDetail, onChanged }: Props) {
  const pdfs = useLiveQuery(() => db.pdfs.orderBy('createdAt').reverse().toArray(), [], []);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState<{ name: string; page: number; total: number; idx: number; count: number } | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    pdfs.forEach((p) => p.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [pdfs]);

  const favorites = pdfs.filter((p) => p.favorite);
  const listed = pdfs.filter((p) => (tagFilter ? p.tags.includes(tagFilter) : true));

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files).filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      setImporting({ name: f.name, page: 0, total: 0, idx: i + 1, count: list.length });
      try {
        await importPdfFile(f, (p: ImportProgress) => {
          if (p.phase === 'extract') {
            setImporting((cur) => (cur ? { ...cur, page: p.page ?? 0, total: p.total ?? 0 } : cur));
          }
        });
      } catch (e) {
        alert(`取り込み失敗: ${f.name}\n${e instanceof Error ? e.message : e}`);
      }
    }
    setImporting(null);
    onChanged();
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="library">
      <div className="libActions">
        <button className="btn primary big" onClick={() => fileRef.current?.click()}>
          ＋ PDFを取り込む
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>

      {favorites.length > 0 && (
        <section>
          <h2 className="secTitle">★ お気に入り</h2>
          <div className="favGrid">
            {favorites.map((p) => (
              <button key={p.id} className="favTile" onClick={() => onOpenViewer(p.id, 1, '')}>
                <span className="favTileTitle">{p.title}</span>
                <span className="favTileMeta">{p.pageCount}p</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {allTags.length > 0 && (
        <div className="tagChips">
          <button className={`chip${tagFilter === null ? ' on' : ''}`} onClick={() => setTagFilter(null)}>
            すべて
          </button>
          {allTags.map((t) => (
            <button key={t} className={`chip${tagFilter === t ? ' on' : ''}`} onClick={() => setTagFilter(t)}>
              {t}
            </button>
          ))}
        </div>
      )}

      <section>
        <h2 className="secTitle">
          マニュアル一覧 <span className="count">{listed.length}</span>
        </h2>
        {pdfs.length === 0 && <div className="empty">まだPDFがありません。「＋ PDFを取り込む」から追加してください。</div>}
        <ul className="pdfList">
          {listed.map((p) => (
            <PdfRow
              key={p.id}
              pdf={p}
              onOpen={() => onOpenViewer(p.id, 1, '')}
              onDetail={() => onOpenDetail(p.id)}
              onToggleFav={() => void setFavorite(p.id, !p.favorite)}
            />
          ))}
        </ul>
      </section>

      {importing && (
        <div className="overlay">
          <div className="modalCard">
            <div className="spinnerBig" />
            <div className="importText">
              取り込み中 ({importing.idx}/{importing.count})
              <br />
              <b>{importing.name}</b>
              <br />
              {importing.total > 0 ? `テキスト抽出 ${importing.page}/${importing.total}p` : '準備中…'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PdfRow({
  pdf,
  onOpen,
  onDetail,
  onToggleFav,
}: {
  pdf: PdfMeta;
  onOpen: () => void;
  onDetail: () => void;
  onToggleFav: () => void;
}) {
  return (
    <li className="pdfRow">
      <button className={`starBtn${pdf.favorite ? ' on' : ''}`} onClick={onToggleFav} aria-label="お気に入り">
        {pdf.favorite ? '★' : '☆'}
      </button>
      <button className="pdfMain" onClick={onOpen}>
        <span className="pdfTitle">{pdf.title}</span>
        <span className="pdfMeta">
          {pdf.pageCount}p{pdf.tags.length > 0 ? ` ・ ${pdf.tags.join(' / ')}` : ''}
          {!pdf.hasText ? ' ・ テキスト無(検索不可)' : ''}
        </span>
      </button>
      <button className="detailBtn" onClick={onDetail} aria-label="詳細">
        ⋯
      </button>
    </li>
  );
}
