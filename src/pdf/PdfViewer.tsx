// 自作PDFビューア（pdfjs-dist直叩き）。
//  - 操作モード: tap=左右タップでページ送り（縦横どちらでも・横は全画面）/ scroll=連続スクロール
//  - ズーム(ボタン/ピンチ)、検索語ハイライト、ページジャンプ、PDF内リンク(ページジャンプ注釈)対応
//  外部通信なし。
import { useCallback, useEffect, useRef, useState } from 'react';
import { TextLayer, Util } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { loadPdfDocument } from './pdfSetup';
import { getPdfBytes, getPageNote, setPageNote } from '../db/repo';
import { db } from '../db/db';
import { normalize, querySegments } from '../search/tokenizer';
import type { NavMode } from '../settings';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Props {
  pdfId: string;
  title: string;
  initialPage?: number;
  highlightQuery?: string;
  navMode: NavMode;
  onClose: () => void;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

// Util.applyTransform(p, m, pos) は p を破壊的に変換する（戻り値なし）
const applyTransform = Util.applyTransform as unknown as (p: number[], m: number[], pos?: number) => void;

export function PdfViewer({ pdfId, title, initialPage = 1, highlightQuery = '', navMode, onClose }: Props) {
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const linkLayerRef = useRef<HTMLDivElement | null>(null);

  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState(String(initialPage));
  const [chrome, setChrome] = useState(true);
  const [hintVisible, setHintVisible] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [notedPages, setNotedPages] = useState<Set<number>>(new Set());
  // scroll モード用: 明示ジャンプ（スライダー/前後/リンク）でスクロールさせるトークン
  const [jump, setJump] = useState({ page: initialPage, token: 0 });

  const scrollMode = navMode === 'scroll';
  const barsVisible = scrollMode || chrome;
  const immersive = navMode === 'tap' && !chrome;
  const segs = querySegments(highlightQuery);

  // tap=没入(縦横とも・下部バーは出さない) / scroll=バー表示
  useEffect(() => {
    setChrome(scrollMode);
  }, [scrollMode]);

  // 没入時のヒントは開いてから約3秒で自動的に消す
  useEffect(() => {
    if (loading || !immersive) return;
    setHintVisible(true);
    const t = setTimeout(() => setHintVisible(false), 3000);
    return () => clearTimeout(t);
  }, [immersive, loading]);

  // ---- ドキュメント読み込み ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const bytes = await getPdfBytes(pdfId);
        if (!bytes) throw new Error('PDFデータが見つかりません。');
        const d = await loadPdfDocument(bytes);
        if (cancelled) {
          await d.loadingTask.destroy();
          return;
        }
        docRef.current = d;
        setDoc(d);
        setNumPages(d.numPages);
        const start = Math.min(Math.max(1, initialPage), d.numPages);
        setPageNum(start);
        setPageInput(String(start));
        setJump({ page: start, token: 1 });
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
      setDoc(null);
      d?.loadingTask.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfId]);

  // ---- ページ移動 ----
  const goToPage = useCallback(
    (p: number) => {
      const clamped = Math.min(Math.max(1, p), numPages || 1);
      setPageNum(clamped);
      setPageInput(String(clamped));
      setJump({ page: clamped, token: Date.now() });
      if (!scrollMode) scrollRef.current?.scrollTo({ top: 0 });
    },
    [numPages, scrollMode],
  );
  const prev = useCallback(() => goToPage(pageNum - 1), [goToPage, pageNum]);
  const next = useCallback(() => goToPage(pageNum + 1), [goToPage, pageNum]);
  const onScrollPageChange = useCallback((p: number) => {
    setPageNum(p);
    setPageInput(String(p));
  }, []);

  // ---- ページメモ ----
  useEffect(() => {
    let alive = true;
    getPageNote(pdfId, pageNum).then((t) => {
      if (alive) setNoteText(t);
    });
    return () => {
      alive = false;
    };
  }, [pdfId, pageNum]);
  const reloadNoted = useCallback(async () => {
    const rows = await db.pageNotes.where('pdfId').equals(pdfId).toArray();
    setNotedPages(new Set(rows.map((r) => r.page)));
  }, [pdfId]);
  useEffect(() => {
    void reloadNoted();
  }, [reloadNoted]);
  const saveNote = useCallback(async () => {
    await setPageNote(pdfId, pageNum, noteText);
    await reloadNoted();
    setNoteOpen(false);
  }, [pdfId, pageNum, noteText, reloadNoted]);
  const hasNote = notedPages.has(pageNum) || noteText.trim() !== '';

  // ---- 単ページ描画（tapモード） ----
  const renderPage = useCallback(async () => {
    const d = docRef.current;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const textDiv = textLayerRef.current;
    const linkDiv = linkLayerRef.current;
    const scroll = scrollRef.current;
    if (!d || !canvas || !wrap || !textDiv || !scroll) return;

    renderTaskRef.current?.cancel();
    let page: PDFPageProxy;
    try {
      page = await d.getPage(pageNum);
    } catch {
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const base = page.getViewport({ scale: 1 });
    const availW = scroll.clientWidth - 16;
    const availH = scroll.clientHeight - 16;
    const fitW = availW > 0 ? availW / base.width : 1;
    const fitH = availH > 0 ? availH / base.height : fitW;
    const effScale = Math.min(fitW, fitH) * zoom;
    const viewport = page.getViewport({ scale: effScale });

    wrap.style.width = `${viewport.width}px`;
    wrap.style.height = `${viewport.height}px`;
    wrap.style.setProperty('--total-scale-factor', String(effScale));
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
    const task = page.render({ canvas, viewport, transform });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch {
      return;
    }

    textDiv.innerHTML = '';
    try {
      const textContent = await page.getTextContent();
      const textLayer = new TextLayer({ textContentSource: textContent, container: textDiv, viewport });
      await textLayer.render();
      const first = highlightSpans(textDiv, segs);
      if (first) first.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {
      /* ignore */
    }
    if (linkDiv) await renderLinkLayer(page, viewport, d, linkDiv, goToPage);
    page.cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum, zoom, highlightQuery, goToPage]);

  useEffect(() => {
    if (!scrollMode && !loading && !error) void renderPage();
  }, [scrollMode, loading, error, renderPage]);

  // 画面変化・バー表示切替で再フィット（tapモード）
  const renderPageRef = useRef(renderPage);
  renderPageRef.current = renderPage;
  useEffect(() => {
    if (scrollMode || loading || error) return;
    const onResize = () => void renderPageRef.current();
    const id = requestAnimationFrame(() => void renderPageRef.current());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [scrollMode, chrome, loading, error]);

  // ---- ズーム ----
  const zoomIn = () => setZoom((z) => clampZoom(z * 1.25));
  const zoomOut = () => setZoom((z) => clampZoom(z / 1.25));
  const resetZoom = () => setZoom(1);

  // ---- ジェスチャ ----
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  const oneRef = useRef<{ x: number; y: number; t: number; moved: boolean; target: EventTarget | null } | null>(null);

  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length >= 2) {
      pinchRef.current = { startDist: dist(e.touches), startZoom: zoom };
      oneRef.current = null;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      oneRef.current = { x: t.clientX, y: t.clientY, t: Date.now(), moved: false, target: e.target };
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
      const m = wrapRef.current.style.transform.match(/scale\(([\d.]+)\)/);
      const ratio = m ? parseFloat(m[1]) : 1;
      wrapRef.current.style.transform = '';
      pinchRef.current = null;
      oneRef.current = null;
      setZoom(clampZoom(p.startZoom * ratio));
      return;
    }
    const o = oneRef.current;
    oneRef.current = null;
    if (!o) return;
    // PDF内リンクのタップはリンク側で処理（ページ送りしない）
    if ((o.target as HTMLElement)?.closest?.('.pdfLink')) return;
    const endY = e.changedTouches[0]?.clientY ?? o.y;
    if (navMode === 'tap') {
      if (o.moved && o.y > window.innerHeight - 96 && o.y - endY > 40) {
        setChrome(true); // 下から引き上げでバー表示
        return;
      }
      if (o.moved || Date.now() - o.t >= 400) return;
      const w = scrollRef.current?.clientWidth ?? window.innerWidth;
      if (o.x < w * 0.33) prev();
      else if (o.x > w * 0.67) next();
      else setChrome((c) => !c);
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
  }, [next, prev, onClose]);

  return (
    <div className={`viewerRoot${immersive ? ' immersive' : ''}`}>
      {/* 上バーは常時表示（閉じる/ズーム/メモに常にアクセスできるように）。下バー(スライダー)だけ出し入れする */}
      <header className="viewerBar">
          <button className="btn iconBtn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
          <div className="viewerTitle" title={title}>
            {title}
          </div>
          <button
            className={`memoBtn${hasNote ? ' noted' : ''}`}
            onClick={() => setNoteOpen(true)}
            aria-label="このページのメモ"
          >
            📝
          </button>
          <div className="viewerZoom">
            <button className="zoomBtn" onClick={zoomOut} aria-label="縮小">
              −
            </button>
            <button className="zoomBtn zoomPct" onClick={resetZoom} aria-label="等倍">
              {Math.round(zoom * 100)}%
            </button>
            <button className="zoomBtn" onClick={zoomIn} aria-label="拡大">
              ＋
            </button>
          </div>
      </header>

      {loading ? (
        <div className="viewerScroll">
          <div className="viewerMsg">読み込み中…</div>
        </div>
      ) : error ? (
        <div className="viewerScroll">
          <div className="viewerMsg error">エラー: {error}</div>
        </div>
      ) : scrollMode && doc ? (
        <ScrollPdf
          doc={doc}
          numPages={numPages}
          zoom={zoom}
          segs={segs}
          jump={jump}
          notedPages={notedPages}
          onPageChange={onScrollPageChange}
          onGoto={goToPage}
        />
      ) : (
        <div
          className="viewerScroll"
          ref={scrollRef}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="viewerPageWrap" ref={wrapRef}>
            <canvas ref={canvasRef} className="viewerCanvas" />
            <div ref={textLayerRef} className="textLayer" />
            <div ref={linkLayerRef} className="linkLayer" />
          </div>
        </div>
      )}

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
        hintVisible && (
          <div className="viewerHint" aria-hidden>
            ▲ 下から引き上げて操作　·　左右タップでページ送り　·　{pageNum} / {numPages}
          </div>
        )
      )}

      {noteOpen && (
        <div className="overlay" onClick={() => void saveNote()}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <header className="drawerHead">
              <div className="drawerTitle">P.{pageNum} のメモ</div>
              <button className="btn primary" onClick={() => void saveNote()}>
                保存
              </button>
            </header>
            <div className="drawerBody">
              <textarea
                className="textArea"
                rows={6}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={`${pageNum}ページ目のメモ`}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ スクロールモード（連続表示・仮想化） ============
function ScrollPdf({
  doc,
  numPages,
  zoom,
  segs,
  jump,
  notedPages,
  onPageChange,
  onGoto,
}: {
  doc: PDFDocumentProxy;
  numPages: number;
  zoom: number;
  segs: string[];
  jump: { page: number; token: number };
  notedPages: Set<number>;
  onPageChange: (p: number) => void;
  onGoto: (p: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const slots = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderedZoom = useRef<Map<number, number>>(new Map());
  const tasks = useRef<Map<number, RenderTask>>(new Map());
  const [aspect, setAspect] = useState(1.414);
  const curRef = useRef(0);

  useEffect(() => {
    let alive = true;
    doc.getPage(1).then((p) => {
      if (!alive) return;
      const v = p.getViewport({ scale: 1 });
      setAspect(v.height / v.width);
    });
    return () => {
      alive = false;
    };
  }, [doc]);

  const renderSlot = useCallback(
    async (n: number) => {
      const slot = slots.current.get(n);
      const container = containerRef.current;
      if (!slot || !container) return;
      if (renderedZoom.current.get(n) === zoom) return;
      let page: PDFPageProxy;
      try {
        page = await doc.getPage(n);
      } catch {
        return;
      }
      const base = page.getViewport({ scale: 1 });
      const scale = ((container.clientWidth - 16) / base.width) * zoom;
      const vp = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let canvas = slot.querySelector('canvas') as HTMLCanvasElement | null;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'viewerCanvas';
        slot.appendChild(canvas);
      }
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      slot.style.height = `${vp.height}px`;
      slot.style.setProperty('--total-scale-factor', String(scale));
      tasks.current.get(n)?.cancel();
      const t = page.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      tasks.current.set(n, t);
      try {
        await t.promise;
      } catch {
        return;
      }
      renderedZoom.current.set(n, zoom);
      let tl = slot.querySelector('.textLayer') as HTMLDivElement | null;
      if (!tl) {
        tl = document.createElement('div');
        tl.className = 'textLayer';
        slot.appendChild(tl);
      }
      tl.innerHTML = '';
      try {
        const tc = await page.getTextContent();
        const layer = new TextLayer({ textContentSource: tc, container: tl, viewport: vp });
        await layer.render();
        highlightSpans(tl, segs);
      } catch {
        /* ignore */
      }
      let ll = slot.querySelector('.linkLayer') as HTMLDivElement | null;
      if (!ll) {
        ll = document.createElement('div');
        ll.className = 'linkLayer';
        slot.appendChild(ll);
      }
      await renderLinkLayer(page, vp, doc, ll, onGoto);
      page.cleanup();
    },
    [doc, zoom, segs, onGoto],
  );

  const clearSlot = useCallback((n: number) => {
    const slot = slots.current.get(n);
    if (!slot) return;
    tasks.current.get(n)?.cancel();
    slot.querySelector('canvas')?.remove();
    slot.querySelector('.textLayer')?.remove();
    slot.querySelector('.linkLayer')?.remove();
    renderedZoom.current.delete(n);
  }, []);

  // 可視ページを描画/非可視を破棄
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) void renderSlot(n);
          else clearSlot(n);
        }
      },
      { root: container, rootMargin: '120% 0px' },
    );
    slots.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [renderSlot, clearSlot, numPages]);

  // ズーム/画面変化 → 済みを破棄して可視を再描画
  const rerenderVisible = useCallback(() => {
    renderedZoom.current.clear();
    const container = containerRef.current;
    if (!container) return;
    slots.current.forEach((el, n) => {
      const top = el.offsetTop;
      const bot = top + el.offsetHeight;
      if (bot > container.scrollTop - container.clientHeight && top < container.scrollTop + container.clientHeight * 2)
        void renderSlot(n);
    });
  }, [renderSlot]);
  useEffect(() => {
    rerenderVisible();
  }, [zoom, rerenderVisible]);
  useEffect(() => {
    const onResize = () => rerenderVisible();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [rerenderVisible]);

  // スクロールで現在ページを更新（rAFスロットル）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const mid = container.scrollTop + container.clientHeight / 2;
        let best = curRef.current || 1;
        let bestDist = Infinity;
        slots.current.forEach((el, n) => {
          const c = el.offsetTop + el.offsetHeight / 2;
          const dd = Math.abs(c - mid);
          if (dd < bestDist) {
            bestDist = dd;
            best = n;
          }
        });
        if (best !== curRef.current) {
          curRef.current = best;
          onPageChange(best);
        }
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [onPageChange]);

  // 明示ジャンプ（スライダー/前後/リンク）でスクロール
  useEffect(() => {
    const slot = slots.current.get(jump.page);
    const container = containerRef.current;
    if (slot && container) {
      curRef.current = jump.page;
      container.scrollTo({ top: slot.offsetTop - 6 });
    }
  }, [jump]);

  // ページメモのバッジ表示
  useEffect(() => {
    slots.current.forEach((slot, n) => {
      let badge = slot.querySelector('.pageNoteBadge') as HTMLElement | null;
      if (notedPages.has(n)) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'pageNoteBadge';
          badge.textContent = '📝';
          slot.appendChild(badge);
        }
      } else if (badge) {
        badge.remove();
      }
    });
  }, [notedPages]);

  return (
    <div className="scrollPages" ref={containerRef}>
      {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
        <div
          key={n}
          className="scrollPage"
          data-page={n}
          ref={(el) => {
            if (el) slots.current.set(n, el);
            else slots.current.delete(n);
          }}
          style={{ height: `calc((100vw - 16px) * ${aspect} / ${1 / zoom})` }}
        />
      ))}
    </div>
  );
}

/** PDF内リンク注釈を描画（内部リンク=ページジャンプ / 外部URL=別タブ）。 */
async function renderLinkLayer(
  page: PDFPageProxy,
  viewport: any,
  doc: PDFDocumentProxy,
  container: HTMLElement,
  goToPage: (p: number) => void,
): Promise<void> {
  container.innerHTML = '';
  let annots: any[];
  try {
    annots = await page.getAnnotations({ intent: 'display' });
  } catch {
    return;
  }
  for (const a of annots) {
    if (a.subtype !== 'Link') continue;
    const hasDest = a.dest != null;
    const url: string | null = a.url ?? null;
    if (!hasDest && !url) continue;
    const c1 = [a.rect[0], a.rect[1]];
    const c2 = [a.rect[2], a.rect[3]];
    applyTransform(c1, viewport.transform);
    applyTransform(c2, viewport.transform);
    const left = Math.min(c1[0], c2[0]);
    const top = Math.min(c1[1], c2[1]);
    const width = Math.abs(c2[0] - c1[0]);
    const height = Math.abs(c2[1] - c1[1]);
    if (width < 2 || height < 2) continue;
    if (url) {
      const link = document.createElement('a');
      link.className = 'pdfLink';
      link.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      container.appendChild(link);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pdfLink';
      btn.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void (async () => {
          try {
            const dest = typeof a.dest === 'string' ? await doc.getDestination(a.dest) : a.dest;
            const ref = Array.isArray(dest) ? dest[0] : null;
            if (ref) {
              const idx = await doc.getPageIndex(ref);
              goToPage(idx + 1);
            }
          } catch {
            /* ignore */
          }
        })();
      });
      container.appendChild(btn);
    }
  }
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
