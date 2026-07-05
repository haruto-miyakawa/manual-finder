// リッチメモ（PDF紐付け）: テキストの任意位置に写真を差し込めるブロックエディタ。
// iOS純正メモのイメージで「文章→写真→文章」と縦に混在。追加依存なし（contenteditable不使用）。
// データは MemoBlock[]（text|image）。画像バイトは photos テーブル、参照は photoId。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { addPhoto, deletePhoto, setMemoDoc } from '../db/repo';
import { ocrPhoto } from '../ocr';
import { SearchIcon, CameraIcon } from './icons';
import type { MemoBlock } from '../types';

interface Props {
  pdfId: string;
  initial: MemoBlock[];
  onChanged?: () => void;
}

/** 空textの連続を畳み、末尾に必ず入力用のtextブロックを置く。 */
function normalizeBlocks(blocks: MemoBlock[]): MemoBlock[] {
  const out: MemoBlock[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.type === 'text' && last?.type === 'text') {
      // 隣接textは結合（画像削除後など）。どちらかが空なら改行を挟まない
      // （写真の挿入→削除を繰り返しても余計な空行が蓄積しないように）。
      out[out.length - 1] = {
        type: 'text',
        text: last.text && b.text ? `${last.text}\n${b.text}` : last.text || b.text,
      };
    } else {
      out.push(b);
    }
  }
  if (out.length === 0 || out[out.length - 1].type !== 'text') out.push({ type: 'text', text: '' });
  return out;
}

function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(44, el.scrollHeight)}px`;
}

export function MemoEditor({ pdfId, initial, onChanged }: Props) {
  const [blocks, setBlocks] = useState<MemoBlock[]>(() => normalizeBlocks(initial));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // カーソル位置（どのtextブロックの何文字目か）。写真挿入位置に使う。
  const cursorRef = useRef<{ idx: number; pos: number } | null>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const dirtyRef = useRef(false);
  const editGen = useRef(0); // 編集世代。保存中に入った編集を dirty のまま残すために使う
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ocrBusy, setOcrBusy] = useState<string | null>(null);

  // PDF切替時に再初期化
  useEffect(() => {
    setBlocks(normalizeBlocks(initial));
    cursorRef.current = null;
    dirtyRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfId]);

  // ブロック構造の変化（写真の挿入/削除でtextareaが結合・分割される）後に高さを再計算する。
  // DOM再利用でマウント時のautoGrowが再実行されず、結合後のテキストが古い高さで隠れるのを防ぐ。
  useEffect(() => {
    rootRef.current?.querySelectorAll<HTMLTextAreaElement>('textarea.memoText').forEach(autoGrow);
  }, [blocks]);

  // 画像（ocrText の ✓ 表示・object URL）
  const photos = useLiveQuery(() => db.photos.where('pdfId').equals(pdfId).toArray(), [pdfId], []);
  const photoById = new Map(photos.map((p) => [p.id, p] as const));
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const map: Record<string, string> = {};
    photos.forEach((p) => {
      map[p.id] = URL.createObjectURL(p.blob);
    });
    setUrls(map);
    return () => Object.values(map).forEach((u) => URL.revokeObjectURL(u));
  }, [photos]);

  const persist = useCallback(
    async (next: MemoBlock[]) => {
      const gen = editGen.current;
      await setMemoDoc(pdfId, next);
      // 保存中に新しい編集が入っていたら dirty を残す（lost-update 防止）
      if (editGen.current === gen) dirtyRef.current = false;
      onChanged?.();
    },
    [pdfId, onChanged],
  );

  // テキスト編集はデバウンス保存、構造変更（写真の挿入/削除）は即時保存
  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    editGen.current++;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(blocksRef.current), 600);
  }, [persist]);

  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (dirtyRef.current) void persist(blocksRef.current);
  }, [persist]);

  // アンマウント時に未保存分をフラッシュ
  useEffect(() => {
    return () => flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfId]);

  // リロード/PWAタスクキル/バックグラウンド化でも未保存分を落とさない保険
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
    };
  }, [flush]);

  function setText(idx: number, text: string) {
    setBlocks((prev) => prev.map((b, i) => (i === idx ? { type: 'text', text } : b)));
    scheduleSave();
  }

  async function insertPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const rows = [];
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/')) rows.push(await addPhoto(pdfId, f));
    }
    if (fileRef.current) fileRef.current.value = '';
    if (rows.length === 0) return;
    const imgs: MemoBlock[] = rows.map((r) => ({ type: 'image', photoId: r.id }));
    const cur = blocksRef.current;
    const c = cursorRef.current;
    let next: MemoBlock[];
    if (c && cur[c.idx]?.type === 'text') {
      // カーソル位置でtextブロックを分割して間に挿入
      const t = cur[c.idx] as { type: 'text'; text: string };
      const before = t.text.slice(0, c.pos);
      const after = t.text.slice(c.pos);
      next = [
        ...cur.slice(0, c.idx),
        { type: 'text', text: before },
        ...imgs,
        { type: 'text', text: after },
        ...cur.slice(c.idx + 1),
      ];
    } else {
      next = [...cur, ...imgs];
    }
    next = normalizeBlocks(next);
    cursorRef.current = null; // 構造が変わったので古いカーソル位置は無効
    setBlocks(next);
    await persist(next);
  }

  async function removeImage(idx: number) {
    const b = blocksRef.current[idx];
    if (b?.type !== 'image') return;
    if (!confirm('この写真をメモから削除しますか？')) return;
    const next = normalizeBlocks(blocksRef.current.filter((_, i) => i !== idx));
    cursorRef.current = null; // インデックスがシフトするので古いカーソル位置は無効
    setBlocks(next);
    await deletePhoto(b.photoId); // 画像バイト＋OCR索引も削除
    await persist(next);
  }

  async function runOcr(photoId: string) {
    setOcrBusy(photoId);
    try {
      const t = await ocrPhoto(photoId);
      if (!t.trim()) alert('文字を認識できませんでした（画像が不鮮明・文字が無い等）。');
    } catch (e) {
      alert(`OCR失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcrBusy(null);
      onChanged?.();
    }
  }

  return (
    <div className="memoEditor" ref={rootRef}>
      {blocks.map((b, idx) =>
        b.type === 'text' ? (
          <textarea
            key={`t${idx}`}
            className="memoText"
            value={b.text}
            rows={1}
            ref={autoGrow}
            onInput={(e) => autoGrow(e.currentTarget)}
            onChange={(e) => setText(idx, e.target.value)}
            onFocus={(e) => (cursorRef.current = { idx, pos: e.currentTarget.selectionStart ?? 0 })}
            onSelect={(e) => (cursorRef.current = { idx, pos: e.currentTarget.selectionStart ?? 0 })}
            onBlur={flush}
            placeholder={idx === 0 ? 'このマニュアルのメモ（下のボタンで写真も差し込めます）' : ''}
          />
        ) : (
          <div key={b.photoId} className="memoImage">
            {urls[b.photoId] ? (
              <img src={urls[b.photoId]} alt="メモ内の写真" />
            ) : (
              <div className="memoImageMissing">（写真が見つかりません）</div>
            )}
            <button className="photoDel" onClick={() => void removeImage(idx)} aria-label="写真を削除">
              ✕
            </button>
            <button
              className="photoOcr"
              onClick={() => void runOcr(b.photoId)}
              disabled={ocrBusy === b.photoId}
              aria-label="文字認識"
            >
              {ocrBusy === b.photoId ? '…' : <SearchIcon size={14} />}
            </button>
            {photoById.get(b.photoId)?.ocrText?.trim() && (
              <span className="photoOcrBadge" aria-label="認識済み">
                ✓
              </span>
            )}
          </div>
        ),
      )}
      <div className="memoTools">
        <button className="btn small" onClick={() => fileRef.current?.click()}>
          <CameraIcon size={17} />
          写真を挿入（カーソル位置）
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void insertPhotos(e.target.files)}
        />
      </div>
    </div>
  );
}
