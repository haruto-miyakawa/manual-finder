// 画面内エラー表示。Macが無くてもiPad上でエラー内容を読めるようにする。
// window の error / unhandledrejection を捕捉し、下部に表示（コピー可）。
import { useEffect, useState } from 'react';

export function ErrorOverlay() {
  const [errs, setErrs] = useState<string[]>([]);

  useEffect(() => {
    const push = (msg: string) => setErrs((prev) => [...prev, msg].slice(-6));
    const onErr = (e: ErrorEvent) => {
      const where = e.filename ? ` @ ${e.filename.split('/').pop()}:${e.lineno}:${e.colno}` : '';
      push(`${e.message}${where}`);
    };
    const onRej = (e: PromiseRejectionEvent) => {
      const r: unknown = e.reason;
      const m = r instanceof Error ? `${r.name}: ${r.message}` : String(r);
      push(`Promise: ${m}`);
    };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);

  if (errs.length === 0) return null;

  const text = errs.join('\n');
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
      {errs.map((m, i) => (
        <div key={i} className="errLine">
          {m}
        </div>
      ))}
    </div>
  );
}
