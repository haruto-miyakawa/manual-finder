// 診断情報: 端末のUA（＝iOS/Safariバージョン）と、JS機能の有無を一覧表示。
// 「取り込めない」等の原因（＝古いSafariに無い機能）を、Mac無しでも特定するためのもの。
// 注意: ポリフィル適用後の状態を見るので、当アプリで補った機能は ✓ になる。✗ が残っていれば未対応の穴。
import { useState } from 'react';
import { APP_VERSION, BUILD_LABEL } from '../version';

function featureChecks(): Array<{ name: string; ok: boolean }> {
  const P = Promise as unknown as Record<string, unknown>;
  const O = Object as unknown as Record<string, unknown>;
  const AProto = Array.prototype as unknown as Record<string, unknown>;
  const AArr = Array as unknown as Record<string, unknown>;
  const U = Uint8Array.prototype as unknown as Record<string, unknown>;
  const M = Map.prototype as unknown as Record<string, unknown>;
  const S = String.prototype as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  const fn = (v: unknown) => typeof v === 'function';
  return [
    { name: 'Promise.withResolvers', ok: fn(P.withResolvers) },
    { name: 'structuredClone', ok: fn(g.structuredClone) },
    { name: 'Object.hasOwn', ok: fn(O.hasOwn) },
    { name: 'Object.groupBy', ok: fn(O.groupBy) },
    { name: 'Array.at', ok: fn(AProto.at) },
    { name: 'Array.findLast', ok: fn(AProto.findLast) },
    { name: 'Array.flatMap', ok: fn(AProto.flatMap) },
    { name: 'Array.fromAsync', ok: fn(AArr.fromAsync) },
    { name: 'String.replaceAll', ok: fn(S.replaceAll) },
    { name: 'Uint8Array.toHex', ok: fn(U.toHex) },
    { name: 'Uint8Array.toBase64', ok: fn(U.toBase64) },
    { name: 'Map.getOrInsertComputed', ok: fn(M.getOrInsertComputed) },
    {
      name: 'ReadableStream.asyncIterator',
      ok:
        typeof ReadableStream !== 'undefined' &&
        typeof (ReadableStream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] === 'function',
    },
    { name: 'crypto.subtle', ok: !!(g.crypto && (g.crypto as { subtle?: unknown }).subtle) },
    { name: 'IndexedDB', ok: typeof indexedDB !== 'undefined' },
    { name: 'WeakRef', ok: fn(g.WeakRef) },
    { name: 'Intl.Segmenter', ok: !!(g.Intl && (g.Intl as { Segmenter?: unknown }).Segmenter) },
  ];
}

export function Diagnostics() {
  const [open, setOpen] = useState(false);
  const checks = featureChecks();
  const ua = navigator.userAgent;
  const ng = checks.filter((c) => !c.ok).map((c) => c.name);
  const text =
    `manual-finder v${APP_VERSION} / build ${BUILD_LABEL}\n` +
    `UA: ${ua}\n` +
    `未対応(NG): ${ng.length ? ng.join(', ') : 'なし'}\n` +
    checks.map((c) => `${c.ok ? 'OK' : 'NG'} ${c.name}`).join('\n');

  return (
    <div className="diag">
      <button className="btn wide" onClick={() => setOpen((v) => !v)}>
        🩺 診断情報 {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="diagBody">
          <div className="diagUA">{ua}</div>
          <div className="diagNg">未対応: {ng.length ? ng.join(', ') : 'なし'}</div>
          <ul className="diagList">
            {checks.map((c) => (
              <li key={c.name} className={c.ok ? 'ok' : 'ng'}>
                {c.ok ? '✓' : '✗'} {c.name}
              </li>
            ))}
          </ul>
          <button
            className="btn small"
            onClick={() => {
              navigator.clipboard?.writeText(text).catch(() => {});
            }}
          >
            診断情報をコピー
          </button>
        </div>
      )}
    </div>
  );
}
