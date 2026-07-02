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

// ---- ReadableStream の非同期反復（for await ... of stream）----
// Safari/WebKit は ReadableStream の async iteration を未実装。
// pdf.js v6 の getTextContent が `for await (const value of readableStream)` を使うため、
// iPad/iPhone(Safari) で「PDF取り込み」時に必ず失敗していた（Chrome/Node は対応済み）。
// getReader() ベースで非同期イテレータを補う（main/worker 両方に効かせる）。
if (typeof ReadableStream !== 'undefined') {
  const rsProto = ReadableStream.prototype as any;
  if (typeof rsProto.values !== 'function') {
    def(rsProto, 'values', function values(this: ReadableStream, opts?: { preventCancel?: boolean }) {
      const preventCancel = !!opts?.preventCancel;
      const reader = this.getReader();
      return {
        async next() {
          try {
            const result = await reader.read();
            if (result.done) reader.releaseLock();
            return result;
          } catch (e) {
            reader.releaseLock();
            throw e;
          }
        },
        async return(value: unknown) {
          if (!preventCancel) {
            const cancelPromise = reader.cancel(value);
            reader.releaseLock();
            await cancelPromise;
          } else {
            reader.releaseLock();
          }
          return { value, done: true };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    });
  }
  if (typeof rsProto[Symbol.asyncIterator] !== 'function') {
    def(rsProto, Symbol.asyncIterator as unknown as string, rsProto.values);
  }
}

// ---- Promise.withResolvers（Safari 17.4+）----
// pdf.js v6 が多用。古いiOS Safariに無いと「PDF取り込み」でエラーになるため補う。
def(Promise, 'withResolvers', function withResolvers(this: PromiseConstructor) {
  let resolve!: (v?: unknown) => void;
  let reject!: (e?: unknown) => void;
  const Ctor = (typeof this === 'function' ? this : Promise) as PromiseConstructor;
  const promise = new Ctor((res: (v?: unknown) => void, rej: (e?: unknown) => void) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
});

// ---- Object.hasOwn（Safari 15.4+）----
def(Object, 'hasOwn', function hasOwn(o: object, p: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(o, p);
});

// ---- Array.prototype.findLast / findLastIndex（Safari 15.4+）----
def(Array.prototype, 'findLast', function findLast(this: any[], cb: (v: any, i: number, a: any[]) => boolean, thisArg?: any) {
  for (let i = this.length - 1; i >= 0; i--) if (cb.call(thisArg, this[i], i, this)) return this[i];
  return undefined;
});
def(Array.prototype, 'findLastIndex', function findLastIndex(this: any[], cb: (v: any, i: number, a: any[]) => boolean, thisArg?: any) {
  for (let i = this.length - 1; i >= 0; i--) if (cb.call(thisArg, this[i], i, this)) return i;
  return -1;
});

// ---- structuredClone（Safari 15.4+）----
// 未実装環境向けの簡易ディープクローン（pdf.js の一般的な用途をカバー。transfer は無視）。
if (typeof (globalThis as any).structuredClone !== 'function') {
  const clone = (val: any, seen: Map<any, any>): any => {
    if (val === null || typeof val !== 'object') return val;
    if (seen.has(val)) return seen.get(val);
    if (val instanceof Date) return new Date(val.getTime());
    if (val instanceof RegExp) return new RegExp(val.source, val.flags);
    if (val instanceof ArrayBuffer) return val.slice(0);
    if (ArrayBuffer.isView(val)) {
      if (val instanceof DataView) return new DataView(val.buffer.slice(0), val.byteOffset, val.byteLength);
      return new (val.constructor as any)(val); // 各TypedArrayをコピー
    }
    if (Array.isArray(val)) {
      const a: any[] = [];
      seen.set(val, a);
      for (let i = 0; i < val.length; i++) a[i] = clone(val[i], seen);
      return a;
    }
    if (val instanceof Map) {
      const m = new Map();
      seen.set(val, m);
      val.forEach((v, k) => m.set(clone(k, seen), clone(v, seen)));
      return m;
    }
    if (val instanceof Set) {
      const s = new Set();
      seen.set(val, s);
      val.forEach((v) => s.add(clone(v, seen)));
      return s;
    }
    const o: Record<string, any> = {};
    seen.set(val, o);
    for (const k of Object.keys(val)) o[k] = clone((val as any)[k], seen);
    return o;
  };
  (globalThis as any).structuredClone = (v: any) => clone(v, new Map());
}
