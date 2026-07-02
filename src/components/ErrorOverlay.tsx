// 画面内エラー表示。Macが無くてもiPad上でエラー内容(スタックを含む)を読めるようにする。
// window の error / unhandledrejection を捕捉し、下部に表示（コピー可）。
import { useEffect, useState } from 'react';

interface CapturedError {
  msg: string;
  stack: string;
}

export function ErrorOverlay() {
  const [errs, setErrs] = useState<CapturedError[]>([]);

  useEffect(() => {
    const push = (e: CapturedError) => setErrs((prev) => [...prev, e].slice(-4));
    const onErr = (e: ErrorEvent) => {
      const where = e.filename ? ` @ ${e.filename.split('/').pop()}:${e.lineno}:${e.colno}` : '';
      push({ msg: `${e.message}${where}`, stack: e.error?.stack ? String(e.error.stack) : '' });
    };
    const onRej = (e: PromiseRejectionEvent) => {
      const r: unknown = e.reason;
      const msg = r instanceof Error ? `${r.name}: ${r.message}` : String(r);
      const stack = r instanceof Error && r.stack ? r.stack : '';
      push({ msg: `Promise: ${msg}`, stack });
    };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);

  if (errs.length === 0) return null;

  const text = errs.map((e) => `${e.msg}\n${e.stack}`).join('\n---\n');
  return (
    <div className="errOverlay" role="alert">
      <div className="errHead">
        <span>⚠ エラー（この内容を開発者に伝えてください）</span>
        <div className="errBtns">
          <button
            className="btn small"
            onClick={() => {
              navigator.clipboard?.writeText(text).catch(() => {});
            }}
          >
            コピー
          </button>
          <button className="btn small" onClick={() => setErrs([])}>
            ✕
          </button>
        </div>
      </div>
      {errs.map((e, i) => (
        <div key={i} className="errItem">
          <div className="errLine">{e.msg}</div>
          {e.stack && <pre className="errStack">{e.stack}</pre>}
        </div>
      ))}
    </div>
  );
}
