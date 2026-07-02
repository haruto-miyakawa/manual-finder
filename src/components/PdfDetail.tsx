// PDF詳細ドロワー: タイトル/お気に入り/タグ/メモ編集、写真の追加・削除、ビューア起動、削除。
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import {
  addPhoto,
  deletePdf,
  deletePhoto,
  setCategory,
  setFavorite,
  setMemo,
  setTags,
  setTitle,
} from '../db/repo';
import { ocrPdfPages, ocrPhoto, terminateOcr } from '../ocr';

interface Props {
  pdfId: string;
  onClose: () => void;
  onOpenViewer: (pdfId: string, page: number, query: string) => void;
  onChanged: () => void;
}

export function PdfDetail({ pdfId, onClose, onOpenViewer, onChanged }: Props) {
  const pdf = useLiveQuery(() => db.pdfs.get(pdfId), [pdfId]);
  const photos = useLiveQuery(
    () => db.photos.where('pdfId').equals(pdfId).sortBy('createdAt'),
    [pdfId],
    [],
  );
  const pageNotes = useLiveQuery(
    () => db.pageNotes.where('pdfId').equals(pdfId).sortBy('page'),
    [pdfId],
    [],
  );
  const photoInput = useRef<HTMLInputElement | null>(null);
  const [title, setTitleLocal] = useState('');
  const [memo, setMemoLocal] = useState('');
  const [tagText, setTagText] = useState('');
  const [category, setCategoryLocal] = useState('');
  const [photoOcrBusy, setPhotoOcrBusy] = useState<string | null>(null);
  const [pdfOcr, setPdfOcr] = useState<{ page: number; total: number } | null>(null);

  // 既存カテゴリ（候補として datalist に出す）
  const allCats = useLiveQuery(
    async () => {
      const all = await db.pdfs.toArray();
      return Array.from(new Set(all.map((p) => (p.category || '').trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b, 'ja'),
      );
    },
    [],
    [],
  );

  useEffect(() => {
    if (pdf) {
      setTitleLocal(pdf.title);
      setMemoLocal(pdf.memo);
      setCategoryLocal(pdf.category || '');
    }
  }, [pdf?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 写真の object URL 管理
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const map: Record<string, string> = {};
    photos.forEach((p) => {
      map[p.id] = URL.createObjectURL(p.blob);
    });
    setUrls(map);
    return () => Object.values(map).forEach((u) => URL.revokeObjectURL(u));
  }, [photos]);

  if (!pdf) return null;

  async function onAddPhotos(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/')) await addPhoto(pdfId, f);
    }
    onChanged();
    if (photoInput.current) photoInput.current.value = '';
  }

  function addTag() {
    const t = tagText.trim();
    if (!t || !pdf) return;
    if (!pdf.tags.includes(t)) void setTags(pdfId, [...pdf.tags, t]);
    setTagText('');
  }

  async function onOcrPhoto(id: string) {
    setPhotoOcrBusy(id);
    try {
      const t = await ocrPhoto(id);
      if (!t.trim()) alert('文字を認識できませんでした（画像が不鮮明・文字が無い等）。');
    } catch (e) {
      alert(`OCR失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPhotoOcrBusy(null);
      onChanged();
    }
  }

  async function onOcrPdf() {
    if (!pdf) return;
    if (!confirm('端末内で文字認識(OCR)します。外部送信はありません。1ページ数秒かかります。実行しますか？')) return;
    setPdfOcr({ page: 0, total: pdf.pageCount });
    try {
      const n = await ocrPdfPages(pdfId, ({ page, total }) => setPdfOcr({ page, total }));
      alert(n > 0 ? `${n}ページ分の文字を認識しました。検索できるようになりました。` : '文字を認識できませんでした。');
    } catch (e) {
      alert(`OCR失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await terminateOcr(); // ワーカー(モデル)のメモリを解放
      setPdfOcr(null);
      onChanged();
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawerHead">
          <button className="btn iconBtn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
          <button className={`starBtn big${pdf.favorite ? ' on' : ''}`} onClick={() => void setFavorite(pdfId, !pdf.favorite)}>
            {pdf.favorite ? '★' : '☆'}
          </button>
          <button className="btn primary" onClick={() => onOpenViewer(pdfId, 1, '')}>
            開く
          </button>
        </header>

        <div className="drawerBody">
          <label className="fieldLabel">タイトル</label>
          <input
            className="textField"
            value={title}
            onChange={(e) => setTitleLocal(e.target.value)}
            onBlur={() => void setTitle(pdfId, title)}
          />

          <div className="metaLine">
            {pdf.pageCount}ページ ・ {(pdf.byteSize / 1024 / 1024).toFixed(1)}MB
            {!pdf.hasText && ' ・ 本文テキスト無し（検索対象外）'}
          </div>
          {!pdf.hasText && (
            <button className="btn wide ocrPdfBtn" onClick={() => void onOcrPdf()}>
              🔎 OCR（文字認識）で検索対象にする
            </button>
          )}

          <label className="fieldLabel">カテゴリ（分類・1つ）</label>
          <input
            className="textField"
            list="cat-suggestions"
            value={category}
            onChange={(e) => setCategoryLocal(e.target.value)}
            onBlur={() => void setCategory(pdfId, category)}
            placeholder="例: エアコン / 冷蔵庫 / レジ・接客（未入力＝未分類）"
          />
          <datalist id="cat-suggestions">
            {allCats.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <label className="fieldLabel">タグ</label>
          <div className="tagEditRow">
            {pdf.tags.map((t) => (
              <span key={t} className="tagPill">
                {t}
                <button className="tagX" onClick={() => void setTags(pdfId, pdf.tags.filter((x) => x !== t))} aria-label="タグ削除">
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="tagAddRow">
            <input
              className="textField"
              placeholder="タグを追加"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTag();
              }}
            />
            <button className="btn" onClick={addTag}>
              追加
            </button>
          </div>

          <label className="fieldLabel">メモ</label>
          <textarea
            className="textArea"
            rows={4}
            value={memo}
            onChange={(e) => setMemoLocal(e.target.value)}
            onBlur={() => void setMemo(pdfId, memo)}
            placeholder="このマニュアルのメモ"
          />

          <label className="fieldLabel">ページメモ（{pageNotes.length}）</label>
          {pageNotes.length === 0 ? (
            <div className="hint">ビューアで各ページの「📝」から、ページごとにメモを残せます。</div>
          ) : (
            <ul className="pageNoteList">
              {pageNotes.map((n) => (
                <li key={n.id}>
                  <button className="pageNoteItem" onClick={() => onOpenViewer(pdfId, n.page, '')}>
                    <span className="pageNoteP">P.{n.page}</span>
                    <span className="pageNoteText">{n.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="fieldLabel">写真（{photos.length}）</label>
          <div className="hint">虫めがねで写真内の文字を認識（OCR）→ 検索できます。✓＝認識済み。</div>
          <div className="photoGrid">
            {photos.map((p) => (
              <div key={p.id} className="photoItem">
                {urls[p.id] && <img src={urls[p.id]} alt={p.name} />}
                <button className="photoDel" onClick={() => void deletePhoto(p.id)} aria-label="写真削除">
                  ✕
                </button>
                <button
                  className="photoOcr"
                  onClick={() => void onOcrPhoto(p.id)}
                  disabled={photoOcrBusy === p.id}
                  aria-label="文字認識"
                >
                  {photoOcrBusy === p.id ? '…' : '🔎'}
                </button>
                {p.ocrText && p.ocrText.trim() && <span className="photoOcrBadge" aria-label="認識済み">✓</span>}
              </div>
            ))}
            <button className="photoAdd" onClick={() => photoInput.current?.click()}>
              ＋
            </button>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => void onAddPhotos(e.target.files)}
            />
          </div>

          <button
            className="btn danger wide"
            onClick={() => {
              if (confirm(`「${pdf.title}」を削除しますか？（元に戻せません）`)) {
                void deletePdf(pdfId).then(() => {
                  onChanged();
                  onClose();
                });
              }
            }}
          >
            このPDFを削除
          </button>
        </div>
      </div>

      {pdfOcr && (
        <div className="overlay" onClick={(e) => e.stopPropagation()}>
          <div className="modalCard">
            <div className="spinnerBig" />
            <div className="importText">
              文字認識中
              <br />
              {pdfOcr.page > 0 ? `ページ ${pdfOcr.page}/${pdfOcr.total}` : '認識データ読み込み中…'}
              <br />
              <span className="ocrHintSmall">画面はこのままお待ちください</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
