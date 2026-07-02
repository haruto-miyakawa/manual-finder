// 自作PDFビューア（pdfjs-dist直叩き）。1ページずつ表示・ページ送り・ズーム(ボタン/ダブルタップ/ピンチ)・
// 検索語ハイライト・ページジャンプ。外部通信なし。
import { useCallback, useEffect, useRef, useState } from 'react';
import { TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { loadPdfDocument } from './pdfSetup';
import { getPdfBytes } from '../db/repo';
import { normalize, querySegments } from '../search/tokenizer';

interface Props {
  pdfId: string;
  title: string;
  initialPage?: number;
  highlightQuery?: string;
  onClose: () => void;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

export function PdfViewer({ pdfId, title, initialPage = 1, highlightQuery = '', onClose }: Props) {
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);

  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState(String(initialPage));

  const segs = querySegments(highlightQuery);

  // ---- ドキュメント読み込み ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const bytes = await getPdfBytes(pdfId);
        if (!bytes) throw new Error('PDFデータが見つかりません。');
        const doc = await loadPdfDocument(bytes);
        if (cancelled) {
          await doc.loadingTask.destroy();
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
        const start = Math.min(Math.max(1, initialPage), doc.numPages);
        setPageNum(start);
        setPageInput(String(start));
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      const d = docRef.current;
      docRef.current = null;
      d?.loadingTask.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfId]);

  // ---- ページ描画 ----
  const renderPage = useCallback(async () => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const textDiv = textLayerRef.current;
    const scroll = scrollRef.current;
    if (!doc || !canvas || !wrap || !textDiv || !scroll) return;

    renderTaskRef.current?.cancel();

    let page: PDFPageProxy;
    try {
      page = await doc.getPage(pageNum);
    } catch {
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const base = page.getViewport({ scale: 1 });
    const avail = scroll.clientWidth - 16; // 余白
    const fitScale = avail > 0 ? avail / base.width : 1;
    const effScale = fitScale * zoom;
    const viewport = page.getViewport({ scale: effScale });

    // wrap / canvas サイズ設定
    wrap.style.width = `${viewport.width}px`;
    wrap.style.height = `${viewport.height}px`;
    wrap.style.setProperty('--total-scale-factor', String(effScale));
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    // v6: canvas 要素を渡し、dpr は transform で拡大（canvasContext より推奨）。
    // canvas.width を毎回設定するので前ページの描画はクリアされる。
    const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
    const task = page.render({ canvas, viewport, transform });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch {
      return; // キャンセル等
    }

    // テキストレイヤ
    textDiv.innerHTML = '';
    try {
      const textContent = await page.getTextContent();
      const textLayer = new TextLayer({ textContentSource: textContent, container: textDiv, viewport });
      await textLayer.render();
      const first = highlightSpans(textDiv, segs);
      if (first) first.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {
      /* テキストレイヤ失敗は描画自体は成功しているので無視 */
    }
    page.cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum, zoom, highlightQuery]);

  useEffect(() => {
    if (!loading && !error) void renderPage();
  }, [loading, error, renderPage]);

  // 画面幅変化で再描画（フィット幅維持）
  useEffect(() => {
    const onResize = () => {
      if (!loading && !error) void renderPage();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [loading, error, renderPage]);

  // ---- ページ移動 ----
  const goToPage = useCallback(
    (p: number) => {
      const clamped = Math.min(Math.max(1, p), numPages || 1);
      setPageNum(clamped);
      setPageInput(String(clamped));
      scrollRef.current?.scrollTo({ top: 0 });
    },
    [numPages],
  );
  const prev = () => goToPage(pageNum - 1);
  const next = () => goToPage(pageNum + 1);

  // ---- ズーム ----
  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  const zoomIn = () => setZoom((z) => clampZoom(z * 1.25));
  const zoomOut = () => setZoom((z) => clampZoom(z / 1.25));
  const resetZoom = () => setZoom(1);

  // ダブルタップ / ピンチ
  const lastTapRef = useRef(0);
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);

  const dist = (t: React.TouchList) => {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchRef.current = { startDist: dist(e.touches), startZoom: zoom };
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        setZoom((z) => (z > 1.05 ? 1 : 2.5)); // ダブルタップでトグル
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const p = pinchRef.current;
    if (p && e.touches.length === 2 && wrapRef.current) {
      e.preventDefault();
      const ratio = dist(e.touches) / p.startDist;
      wrapRef.current.style.transform = `scale(${ratio})`;
      wrapRef.current.style.transformOrigin = 'center top';
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const p = pinchRef.current;
    if (p && e.touches.length < 2 && wrapRef.current) {
      const ratioStr = wrapRef.current.style.transform.match(/scale\(([\d.]+)\)/);
      const ratio = ratioStr ? parseFloat(ratioStr[1]) : 1;
      wrapRef.current.style.transform = '';
      pinchRef.current = null;
      setZoom(clampZoom(p.startZoom * ratio));
    }
  };

  // キーボード（デスクトップ検証用）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') next();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum, numPages]);

  return (
    <div className="viewerRoot">
      <header className="viewerBar">
        <button className="btn iconBtn" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
        <div className="viewerTitle" title={title}>
          {title}
        </div>
        <div className="viewerZoom">
          <button className="btn iconBtn" onClick={zoomOut} aria-label="縮小">
            −
          </button>
          <button className="btn iconBtn" onClick={resetZoom} aria-label="等倍">
            {Math.round(zoom * 100)}%
          </button>
          <button className="btn iconBtn" onClick={zoomIn} aria-label="拡大">
            ＋
          </button>
        </div>
      </header>

      <div
        className="viewerScroll"
        ref={scrollRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {loading && <div className="viewerMsg">読み込み中…</div>}
        {error && <div className="viewerMsg error">エラー: {error}</div>}
        <div className="viewerPageWrap" ref={wrapRef} style={{ display: loading || error ? 'none' : 'block' }}>
          <canvas ref={canvasRef} className="viewerCanvas" />
          <div ref={textLayerRef} className="textLayer" />
        </div>
      </div>

      <footer className="viewerNav">
        <button className="btn navBtn" onClick={prev} disabled={pageNum <= 1}>
          ‹ 前
        </button>
        <div className="pageJump">
          <input
            className="pageInput"
            inputMode="numeric"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') goToPage(Number(pageInput) || 1);
            }}
            onBlur={() => goToPage(Number(pageInput) || 1)}
            aria-label="ページ番号"
          />
          <span className="pageTotal">/ {numPages || '—'}</span>
        </div>
        <button className="btn navBtn" onClick={next} disabled={numPages > 0 && pageNum >= numPages}>
          次 ›
        </button>
      </footer>
    </div>
  );
}

/** テキストレイヤ内で検索語を <mark> 強調し、最初の一致 span を返す。 */
function highlightSpans(container: HTMLElement, segs: string[]): HTMLElement | null {
  if (segs.length === 0) return null;
  let first: HTMLElement | null = null;
  const spans = container.querySelectorAll('span');
  spans.forEach((span) => {
    const raw = span.textContent ?? '';
    if (!raw) return;
    const norm = normalize(raw);
    const ranges: Array<[number, number]> = [];
    for (const seg of segs) {
      let from = 0;
      for (;;) {
        const i = norm.indexOf(seg, from);
        if (i < 0) break;
        ranges.push([i, i + seg.length]);
        from = i + seg.length;
      }
    }
    if (ranges.length === 0) return;
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    let html = '';
    let pos = 0;
    for (const [s, e] of merged) {
      html += escapeHtml(raw.slice(pos, s));
      html += '<mark class="hl">' + escapeHtml(raw.slice(s, e)) + '</mark>';
      pos = e;
    }
    html += escapeHtml(raw.slice(pos));
    span.innerHTML = html;
    if (!first) first = span.querySelector('mark');
  });
  return first;
}
