// 検索ヒットのスニペット生成（一致位置の前後約60字＋一致語を <mark> 強調）。
// normalize は長さ保存なので、正規化文字列上のインデックスを原文にそのまま適用できる。
import { normalize, querySegments } from './tokenizer';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @returns 一致語を <mark> で包んだ安全なHTML断片（テキストはすべてエスケープ済み）。
 */
export function buildSnippet(rawText: string, query: string, radius = 60): string {
  const segs = querySegments(query);
  if (rawText.length === 0) return '';
  const normText = normalize(rawText);

  // アンカー（最初に見つかる一致位置）を決める
  let anchor = -1;
  let anchorLen = 0;
  for (const seg of segs) {
    const i = normText.indexOf(seg);
    if (i >= 0 && (anchor < 0 || i < anchor)) {
      anchor = i;
      anchorLen = seg.length;
    }
  }
  // フォールバック: どのセグメントも完全一致しない → 最長セグメントの先頭2文字で探す
  if (anchor < 0) {
    for (const seg of segs) {
      if (seg.length >= 2) {
        const bg = seg.slice(0, 2);
        const i = normText.indexOf(bg);
        if (i >= 0) {
          anchor = i;
          anchorLen = bg.length;
          break;
        }
      }
    }
  }
  if (anchor < 0) anchor = 0;

  const start = Math.max(0, anchor - radius);
  const end = Math.min(rawText.length, anchor + anchorLen + radius);
  const rawWindow = rawText.slice(start, end);
  const normWindow = normText.slice(start, end);

  // ウィンドウ内の全一致範囲を収集
  const ranges: Array<[number, number]> = [];
  for (const seg of segs) {
    if (!seg) continue;
    let from = 0;
    for (;;) {
      const i = normWindow.indexOf(seg, from);
      if (i < 0) break;
      ranges.push([i, i + seg.length]);
      from = i + seg.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const prefix = start > 0 ? '…' : '';
  const suffix = end < rawText.length ? '…' : '';
  let html = escapeHtml(prefix);
  let pos = 0;
  for (const [s, e] of merged) {
    html += escapeHtml(rawWindow.slice(pos, s));
    html += '<mark>' + escapeHtml(rawWindow.slice(s, e)) + '</mark>';
    pos = e;
  }
  html += escapeHtml(rawWindow.slice(pos));
  html += escapeHtml(suffix);
  return html;
}
