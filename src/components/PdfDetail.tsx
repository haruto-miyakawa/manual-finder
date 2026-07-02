// PDF詳細ドロワー: タイトル/お気に入り/タグ/メモ編集、写真の追加・削除、ビューア起動、削除。
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import {
  addPhoto,
  deletePdf,
  deletePhoto,
  setFavorite,
  setMemo,
  setTags,
  setTitle,
} from '../db/repo';

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
  const photoInput = useRef<HTMLInputElement | null>(null);
  const [title, setTitleLocal] = useState('');
  const [memo, setMemoLocal] = useState('');
  const [tagText, setTagText] = useState('');

  useEffect(() => {
    if (pdf) {
      setTitleLocal(pdf.title);
      setMemoLocal(pdf.memo);
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

          <label className="fieldLabel">写真（{photos.length}）</label>
          <div className="photoGrid">
            {photos.map((p) => (
              <div key={p.id} className="photoItem">
                {urls[p.id] && <img src={urls[p.id]} alt={p.name} />}
                <button className="photoDel" onClick={() => void deletePhoto(p.id)} aria-label="写真削除">
                  ✕
                </button>
              </div>
            ))}
            <button className="photoAdd" onClick={() => photoInput.current?.click()}>
              ＋
            </button>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
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
    </div>
  );
}
