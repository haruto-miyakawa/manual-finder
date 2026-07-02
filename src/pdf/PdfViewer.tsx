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
  // 横向き＝没入(全画面)モード。chrome=操作バーの表示。
  const [landscape, setLandscape] = useState(false);
  const [chrome, setChrome] = useState(true);
  const barsVisible = !landscape || chrome;

  const segs = querySegments(highlightQuery);

  // ---- 画面の向き検出（横＝没入・バー非表示 / 縦＝バー表示） ----
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const apply = () => {
      const ls = mq.matches;
      setLandscape(ls);
      setChrome(!ls);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

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
    const base = page.getViewport({ scale: 1 }); // ページの回転も反映済み
    // 「ページ全体が収まる」フィット: 幅・高さ両方を見て小さい方に合わせる。
    // これで縦向きページは従来どおり、横向き（ランドスケープ）ページや横画面でも
    // ページ全体が見える（幅フィットだけだと横向きページが縦にはみ出して下が切れていた）。
    const availW = scroll.clientWidth - 16;
    const availH = scroll.clientHeight - 16;
    const fitW = availW > 0 ? availW / base.width : 1;
    const fitH = availH > 0 ? availH / base.height : fitW;
    const fitScale = Math.min(fitW, fitH);
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

  // バー表示の切替・向き変更で表示領域が変わるので、レイアウト反映後に再フィット
  const renderPageRef = useRef(renderPage);
  renderPageRef.current = renderPage;
  useEffect(() => {
    if (loading || error) return;
    const id = requestAnimationFrame(() => void renderPageRef.current());
    return () => cancelAnimationFrame(id);
  }, [chrome, landscape, loading, error]);

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

  // ジェスチャ: ピンチ(2本)ズーム / 1本タップ(横=左右送り・中央でバー切替 / 縦=ダブルタップズーム) / 下から引き上げでバー表示
  const lastTapRef = useRef(0);
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  const oneRef = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null);

  const dist = (t: React.TouchList) => {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length >= 2) {
      pinchRef.current = { startDist: dist(e.touches), startZoom: zoom };
      oneRef.current = null;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      oneRef.current = { x: t.clientX, y: t.clientY, t: Date.now(), moved: false };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const p = pinchRef.current;
    if (p && e.touches.length >= 2 && wrapRef.current) {
      e.preventDefault();
      const ratio = dist(e.touches) / p.startDist;
      wrapRef.current.style.transform = `scale(${ratio})`;
      wrapRef.current.style.transformOrigin = 'center top';
      return;
    }
    const o = oneRef.current;
    if (o && e.touches.length === 1) {
      const t = e.touches[0];
      if (Math.hypot(t.clientX - o.x, t.clientY - o.y) > 12) o.moved = true;
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const p = pinchRef.current;
    if (p && e.touches.length < 2 && wrapRef.current) {
      const ratioStr = wrapRef.current.style.transform.match(/scale\(([\d.]+)\)/);
      const ratio = ratioStr ? parseFloat(ratioStr[1]) : 1;
      wrapRef.current.style.transform = '';
      pinchRef.current = null;
      oneRef.current = null;
      setZoom(clampZoom(p.startZoom * ratio));
      return;
    }
    const o = oneRef.current;
    oneRef.current = null;
    if (!o) return;
    const endY = e.changedTouches[0]?.clientY ?? o.y;
    const dt = Date.now() - o.t;

    // 横向き: 画面下から上へ引き上げ → 操作バーを表示
    if (landscape) {
      const vh = window.innerHeight;
      if (o.moved && o.y > vh - 96 && o.y - endY > 40) {
        setChrome(true);
        return;
      }
    }
    if (o.moved || dt >= 400) return; // ドラッグ/長押しはタップ扱いにしない

    if (landscape) {
      const w = scrollRef.current?.clientWidth ?? window.innerWidth;
      if (o.x < w * 0.33) prev(); // 左タップ=前へ
      else if (o.x > w * 0.67) next(); // 右タップ=次へ
      else setChrome((c) => !c); // 中央タップ=バー表示切替
    } else {
      // 縦向き: ダブルタップでズームトグル
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        setZoom((z) => (z > 1.05 ? 1 : 2.5));
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
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
    <div className={`viewerRoot${landscape && !chrome ? ' immersive' : ''}`}>
      {barsVisible && (
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
      )}

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

      {barsVisible ? (
        <footer className="viewerNav">
          <button className="btn navBtn" onClick={prev} disabled={pageNum <= 1} aria-label="前のページ">
            ‹
          </button>
          <input
            className="pageSlider"
            type="range"
            min={1}
            max={Math.max(1, numPages)}
            value={Math.min(pageNum, numPages || 1)}
            onChange={(e) => goToPage(Number(e.target.value))}
            aria-label="ページを選択"
          />
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
          <button
            className="btn navBtn"
            onClick={next}
            disabled={numPages > 0 && pageNum >= numPages}
            aria-label="次のページ"
          >
            ›
          </button>
        </footer>
      ) : (
        !loading &&
        !error && (
          <div className="viewerHint" aria-hidden>
            ▲ 下から引き上げて操作　·　左右タップでページ送り　·　{pageNum} / {numPages}
          </div>
        )
      )}
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
