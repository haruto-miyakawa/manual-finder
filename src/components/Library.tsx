// PDFライブラリ。お気に入りは最上部に大きめタイル。取り込み・タグ絞り込み・詳細/ビューア導線。
// 共有: 選択モードでPDFを選び、その分だけをzipに書き出せる（AirDrop等のローカル受け渡し用）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setMeta } from '../db/db';
import { importPdfFile, setFavorite, type ImportProgress } from '../db/repo';
import { ensureThumb } from '../pdf/thumb';
import { ocrPdfPages, terminateOcr } from '../ocr';
import { exportPartial, downloadBlob, shareFileName } from '../backup/backup';
import { ExportIcon } from './icons';
import type { PdfMeta } from '../types';

interface Props {
  onOpenViewer: (pdfId: string, page: number, query: string) => void;
  onOpenDetail: (pdfId: string) => void;
  onChanged: () => void;
  /** 取り込み直後に「未分類」を一時的に開く状態（App保持・セッション内のみ。手動で閉じたら解除） */
  uncatOpenOnce: boolean;
  setUncatOpenOnce: (v: boolean) => void;
}

export function Library({ onOpenViewer, onOpenDetail, onChanged, uncatOpenOnce, setUncatOpenOnce }: Props) {
  const pdfs = useLiveQuery(() => db.pdfs.orderBy('createdAt').reverse().toArray(), [], []);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState<{ name: string; page: number; total: number; idx: number; count: number } | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  // カテゴリ開閉: 規定は全部閉。開いているカテゴリ名を meta に保存し次回起動時に復元。
  const openCatsRow = useLiveQuery(() => db.meta.get('libCatOpen'), [], undefined);
  const openCats = new Set((openCatsRow?.value as string[] | undefined) ?? []);
  // 共有用の選択モード
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  // スキャンPDFのOCR: 取り込み後に確認 → 実行中の進捗
  const [ocrPrompt, setOcrPrompt] = useState<{ items: PdfMeta[] } | null>(null);
  const [ocrRunning, setOcrRunning] = useState<{ name: string; page: number; total: number; idx: number; count: number } | null>(null);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    pdfs.forEach((p) => p.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [pdfs]);

  const favorites = pdfs.filter((p) => p.favorite);
  const listed = pdfs.filter((p) => (tagFilter ? p.tags.includes(tagFilter) : true));

  const UNCAT = '未分類';
  // カテゴリ別にグループ化（名前は五十音/アルファベット順、未分類は最後）
  const groups = useMemo(() => {
    const map = new Map<string, PdfMeta[]>();
    for (const p of listed) {
      const cat = (p.category && p.category.trim()) || UNCAT;
      const arr = map.get(cat) ?? [];
      arr.push(p);
      map.set(cat, arr);
    }
    const names = Array.from(map.keys()).sort((a, b) => {
      if (a === UNCAT) return 1;
      if (b === UNCAT) return -1;
      return a.localeCompare(b, 'ja');
    });
    return names.map((name) => ({ name, items: map.get(name)! }));
  }, [listed]);

  /** 表示上の開閉（保存状態 ∪ 未分類の一時オープン） */
  const isCatOpen = (name: string) => openCats.has(name) || (name === UNCAT && uncatOpenOnce);

  const toggleCat = (name: string) => {
    if (selectMode) return; // 選択モード中は全展開表示なので、裏で開閉状態を変えない
    const effOpen = isCatOpen(name);
    if (name === UNCAT) setUncatOpenOnce(false); // 手動操作したら一時オープンは解除し保存状態に従う
    const next = new Set(openCats);
    if (effOpen) next.delete(name);
    else next.add(name);
    void setMeta('libCatOpen', Array.from(next));
  };

  // ---- 共有（部分エクスポート） ----
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function doShare() {
    if (selected.size === 0) return;
    setSharing(true);
    try {
      const blob = await exportPartial(Array.from(selected));
      downloadBlob(blob, shareFileName(selected.size));
      setSelectMode(false);
      setSelected(new Set());
      alert(
        `${selected.size}件を書き出しました（${(blob.size / 1024 / 1024).toFixed(1)}MB）。\n「ファイル」に保存されるので、AirDrop等で同僚に渡せます。受け取った側は「バックアップ」タブ →「ファイルを選んで取り込む」→「追加で取り込む」です。`,
      );
    } catch (e) {
      alert(`書き出し失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSharing(false);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files).filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    const imported: PdfMeta[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      setImporting({ name: f.name, page: 0, total: 0, idx: i + 1, count: list.length });
      try {
        const meta = await importPdfFile(f, (p: ImportProgress) => {
          if (p.phase === 'extract') {
            setImporting((cur) => (cur ? { ...cur, page: p.page ?? 0, total: p.total ?? 0 } : cur));
          }
        });
        imported.push(meta);
      } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        alert(`取り込み失敗: ${f.name}\n${msg}`);
        // 画面内エラー表示(ErrorOverlay)にも出す（コピー可・後から確認できる）
        setTimeout(() => {
          throw e instanceof Error ? e : new Error(msg);
        });
      }
    }
    setImporting(null);
    onChanged();
    if (fileRef.current) fileRef.current.value = '';
    // 取り込み直後は「未分類」を開いて、新着（未読マーク付き）がすぐ見えるように
    if (imported.length > 0) setUncatOpenOnce(true);
    // 本文テキストの無いスキャンPDFがあれば、OCR（端末内・外部送信なし）を確認
    const scanned = imported.filter((m) => !m.hasText);
    if (scanned.length > 0) setOcrPrompt({ items: scanned });
  }

  async function runOcr(items: PdfMeta[]) {
    setOcrPrompt(null);
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      setOcrRunning({ name: m.title, page: 0, total: m.pageCount, idx: i + 1, count: items.length });
      try {
        await ocrPdfPages(m.id, ({ page, total }) =>
          setOcrRunning((cur) => (cur ? { ...cur, page, total } : cur)),
        );
      } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        alert(`OCR失敗: ${m.title}\n${msg}`);
      }
    }
    await terminateOcr(); // ワーカー(モデル)のメモリを解放
    setOcrRunning(null);
    onChanged();
  }

  return (
    <div className="library">
      <div className="libActions">
        {!selectMode ? (
          <div className="libActionRow">
            <button className="btn primary big libImportBtn" onClick={() => fileRef.current?.click()}>
              ＋ PDFを取り込む
            </button>
            <button
              className="btn shareBtn"
              onClick={() => {
                setSelected(new Set());
                setSelectMode(true);
              }}
              disabled={pdfs.length === 0}
              title="選んだPDFだけをzipに書き出して同僚に渡す"
            >
              <ExportIcon size={18} />
              共有
            </button>
          </div>
        ) : (
          <div className="shareBar">
            <span className="shareCount">
              共有するPDFを選択 <b>{selected.size}</b> 件
            </span>
            <button className="btn small" onClick={() => setSelectMode(false)}>
              キャンセル
            </button>
            <button className="btn primary small" disabled={selected.size === 0} onClick={() => void doShare()}>
              書き出す
            </button>
          </div>
        )}
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
                <span className="favTileTitle">
                  {p.unread && <span className="unreadBadge">未読</span>}
                  {p.title}
                </span>
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
          マニュアル <span className="count">{listed.length}</span>
        </h2>
        {pdfs.length === 0 && <div className="empty">まだPDFがありません。「＋ PDFを取り込む」から追加してください。</div>}
        {tagFilter && listed.length === 0 && <div className="empty">「{tagFilter}」に該当なし。</div>}

        {groups.map((g) => {
          // 選択モード中は全カテゴリを開く（どのPDFも選べるように）
          const isOpen = selectMode || isCatOpen(g.name);
          return (
            <div key={g.name} className="catSection">
              <button
                className={`catHeader${g.name === UNCAT ? ' uncat' : ''}`}
                onClick={() => toggleCat(g.name)}
                aria-expanded={isOpen}
              >
                <span className="catCaret">{isOpen ? '▾' : '▸'}</span>
                <span className="catName">{g.name}</span>
                {g.items.some((p) => p.unread) && <span className="catUnreadDot" aria-label="未読あり" />}
                <span className="catCount">{g.items.length}</span>
              </button>
              {isOpen && (
                <ul className="pdfList">
                  {g.items.map((p) => (
                    <PdfRow
                      key={p.id}
                      pdf={p}
                      selectMode={selectMode}
                      selected={selected.has(p.id)}
                      onToggleSelect={() => toggleSelect(p.id)}
                      onOpen={() => onOpenViewer(p.id, 1, '')}
                      onDetail={() => onOpenDetail(p.id)}
                      onToggleFav={() => void setFavorite(p.id, !p.favorite)}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
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

      {sharing && (
        <div className="overlay">
          <div className="modalCard">
            <div className="spinnerBig" />
            <div className="importText">共有用に書き出し中…</div>
          </div>
        </div>
      )}

      {ocrPrompt && (
        <div className="overlay">
          <div className="modalCard ocrCard">
            <div className="ocrTitle">文字認識（OCR）しますか？</div>
            <div className="ocrBody">
              本文テキストの無いスキャンPDFが <b>{ocrPrompt.items.length}</b> 件あります。
              このままでは検索に引っかかりません。
              <br />
              端末内で文字認識すると、検索できるようになります（結果は保存され、再スキャン不要）。
              <ul className="ocrNotes">
                <li>すべて端末内で処理・外部送信は一切ありません</li>
                <li>1ページ数秒かかります（枚数が多いと時間がかかります）</li>
                <li>初回のみ認識データ(約20MB)を読み込みます</li>
              </ul>
            </div>
            <div className="ocrBtns">
              <button className="btn" onClick={() => setOcrPrompt(null)}>
                後で
              </button>
              <button className="btn primary" onClick={() => void runOcr(ocrPrompt.items)}>
                OCRする
              </button>
            </div>
          </div>
        </div>
      )}

      {ocrRunning && (
        <div className="overlay">
          <div className="modalCard">
            <div className="spinnerBig" />
            <div className="importText">
              文字認識中 ({ocrRunning.idx}/{ocrRunning.count})
              <br />
              <b>{ocrRunning.name}</b>
              <br />
              {ocrRunning.page > 0 ? `ページ ${ocrRunning.page}/${ocrRunning.total}` : '認識データ読み込み中…'}
              <br />
              <span className="ocrHintSmall">画面はこのままお待ちください</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PdfRow({
  pdf,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  onDetail,
  onToggleFav,
}: {
  pdf: PdfMeta;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onDetail: () => void;
  onToggleFav: () => void;
}) {
  return (
    <li className={`pdfRow${selectMode && selected ? ' selected' : ''}`}>
      {selectMode ? (
        <span className={`selBox${selected ? ' on' : ''}`} aria-hidden>
          {selected ? '✓' : ''}
        </span>
      ) : (
        <button className={`starBtn${pdf.favorite ? ' on' : ''}`} onClick={onToggleFav} aria-label="お気に入り">
          {pdf.favorite ? '★' : '☆'}
        </button>
      )}
      <button className="pdfMain" onClick={selectMode ? onToggleSelect : onOpen}>
        <PdfThumb pdfId={pdf.id} />
        <span className="pdfInfo">
          <span className="pdfTitle">
            {pdf.unread && <span className="unreadBadge">未読</span>}
            {pdf.title}
          </span>
          <span className="pdfMeta">
            {pdf.pageCount}p{pdf.tags.length > 0 ? ` ・ ${pdf.tags.join(' / ')}` : ''}
            {!pdf.hasText ? ' ・ テキスト無(検索不可)' : ''}
          </span>
        </span>
      </button>
      {!selectMode && (
        <button className="detailBtn" onClick={onDetail} aria-label="詳細">
          ⋯
        </button>
      )}
    </li>
  );
}

/** PDF 1ページ目のサムネイル。未生成なら生成をトリガーし、できたら表示。 */
function PdfThumb({ pdfId }: { pdfId: string }) {
  const thumb = useLiveQuery(() => db.thumbs.get(pdfId), [pdfId]);
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!thumb) {
      void ensureThumb(pdfId);
      setUrl('');
      return;
    }
    const u = URL.createObjectURL(thumb.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [thumb, pdfId]);
  return (
    <span className="pdfThumb">
      {url ? <img src={url} alt="" /> : <span className="pdfThumbIcon">📄</span>}
    </span>
  );
}
