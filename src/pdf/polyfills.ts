// pdf.js v6 が使う新しめの標準APIのポリフィル。古い実行環境でも「確実に動く」ようにする。
// 対象:
//   - Uint8Array.prototype.toHex / toBase64, Uint8Array.fromHex / fromBase64 / setFromHex
//     （例: ドキュメント fingerprint の toHex は読み込み毎に呼ばれる）
//   - Map/WeakMap.prototype.getOrInsertComputed / getOrInsert
//     （TextLayer 等で使用。未実装だとハイライト描画が失敗する）
// いずれも feature-detect し、未実装のときだけ純JSで補う。外部依存・外部通信なし。
// main と worker の両方で pdf.js より前に読み込む。標準アルファベット(base64)のみ対応（pdf.jsはこれを使用）。

/* eslint-disable @typescript-eslint/no-explicit-any */
function def(target: any, name: string, fn: (...a: any[]) => any): void {
  if (typeof target[name] !== 'function') {
    Object.defineProperty(target, name, { value: fn, writable: true, configurable: true, enumerable: false });
  }
}

// ---- Uint8Array hex ----
def(Uint8Array.prototype, 'toHex', function toHex(this: Uint8Array): string {
  let s = '';
  for (let i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, '0');
  return s;
});
def(Uint8Array, 'fromHex', function fromHex(hex: string): Uint8Array {
  const clean = hex.length % 2 ? hex.slice(0, -1) : hex;
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
});
def(Uint8Array.prototype, 'setFromHex', function setFromHex(this: Uint8Array, hex: string) {
  const bytes: Uint8Array = (Uint8Array as any).fromHex(hex);
  const written = Math.min(bytes.length, this.length);
  this.set(bytes.subarray(0, written));
  return { read: written * 2, written };
});

// ---- Uint8Array base64（標準アルファベット） ----
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
def(Uint8Array.prototype, 'toBase64', function toBase64(this: Uint8Array): string {
  let out = '';
  const n = this.length;
  for (let i = 0; i < n; i += 3) {
    const b0 = this[i];
    const b1 = i + 1 < n ? this[i + 1] : 0;
    const b2 = i + 2 < n ? this[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < n ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < n ? B64[b2 & 63] : '=';
  }
  return out;
});
def(Uint8Array, 'fromBase64', function fromBase64(str: string): Uint8Array {
  const clean = str.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n0 = B64.indexOf(clean[i]);
    const n1 = B64.indexOf(clean[i + 1]);
    const c2 = clean[i + 2];
    const c3 = clean[i + 3];
    const n2 = c2 ? B64.indexOf(c2) : -1;
    const n3 = c3 ? B64.indexOf(c3) : -1;
    if (p < out.length) out[p++] = (n0 << 2) | (n1 >> 4);
    if (n2 >= 0 && p < out.length) out[p++] = ((n1 & 15) << 4) | (n2 >> 2);
    if (n3 >= 0 && p < out.length) out[p++] = ((n2 & 3) << 6) | n3;
  }
  return out;
});

// ---- Map / WeakMap getOrInsertComputed / getOrInsert ----
function getOrInsertComputed(this: Map<any, any> | WeakMap<any, any>, key: any, callbackFn: (k: any) => any) {
  if (this.has(key)) return this.get(key);
  const v = callbackFn(key);
  this.set(key, v);
  return v;
}
function getOrInsert(this: Map<any, any> | WeakMap<any, any>, key: any, value: any) {
  if (this.has(key)) return this.get(key);
  this.set(key, value);
  return value;
}
def(Map.prototype, 'getOrInsertComputed', getOrInsertComputed);
def(Map.prototype, 'getOrInsert', getOrInsert);
def(WeakMap.prototype, 'getOrInsertComputed', getOrInsertComputed);
def(WeakMap.prototype, 'getOrInsert', getOrInsert);
