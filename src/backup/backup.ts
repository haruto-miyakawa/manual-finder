// エクスポート/インポート（中核機能）。全データ(PDFバイト含む)を単一zipに。
// PDF/写真は STORE(無圧縮=level0、既に圧縮済のため高速)、JSONは軽く圧縮。
import { zip, unzip, type AsyncZippable, type Unzipped } from 'fflate';
import { db } from '../db/db';
import type { PdfMeta, PhotoRow, Campaign, PageRow, PdfBlobRow } from '../types';
import { rebuildFromPages, clearIndex } from '../search/searchIndex';

const FORMAT_VERSION = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();

interface Manifest {
  app: 'manual-finder';
  formatVersion: number;
  exportedAt: number;
  pdfs: PdfMeta[];
  photos: Array<Omit<PhotoRow, 'blob'>>;
  campaigns: Campaign[];
}

function zipAsync(data: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(data, { consume: true }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}
function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

export interface ExportProgress {
  phase: 'collect' | 'zip' | 'done';
  detail?: string;
}

/** 全データを1つのzip(Uint8Array)に書き出す。 */
export async function exportAll(onProgress?: (p: ExportProgress) => void): Promise<Blob> {
  onProgress?.({ phase: 'collect', detail: 'データ収集中' });
  const [pdfs, blobs, pages, photos, campaigns] = await Promise.all([
    db.pdfs.toArray(),
    db.blobs.toArray(),
    db.pages.toArray(),
    db.photos.toArray(),
    db.campaigns.toArray(),
  ]);

  const blobById = new Map<string, PdfBlobRow>(blobs.map((b) => [b.id, b]));
  const pagesByPdf = new Map<string, PageRow[]>();
  for (const pg of pages) {
    const arr = pagesByPdf.get(pg.pdfId) ?? [];
    arr.push(pg);
    pagesByPdf.set(pg.pdfId, arr);
  }

  const manifest: Manifest = {
    app: 'manual-finder',
    formatVersion: FORMAT_VERSION,
    exportedAt: Date.now(),
    pdfs,
    photos: photos.map(({ blob: _blob, ...rest }) => rest),
    campaigns,
  };

  const zippable: AsyncZippable = {};
  zippable['manifest.json'] = [enc.encode(JSON.stringify(manifest)), { level: 6 }];

  for (const meta of pdfs) {
    const row = blobById.get(meta.id);
    if (row) {
      const buf = new Uint8Array(await row.blob.arrayBuffer());
      zippable[`pdfs/${meta.id}.pdf`] = [buf, { level: 0 }]; // STORE
    }
    const pageRows = (pagesByPdf.get(meta.id) ?? []).sort((a, b) => a.page - b.page);
    const pageJson = JSON.stringify(pageRows.map((p) => ({ page: p.page, text: p.text })));
    zippable[`pages/${meta.id}.json`] = [enc.encode(pageJson), { level: 6 }];
  }

  for (const ph of photos) {
    const buf = new Uint8Array(await ph.blob.arrayBuffer());
    zippable[`photos/${ph.id}`] = [buf, { level: 0 }]; // STORE
  }

  onProgress?.({ phase: 'zip', detail: '圧縮中' });
  const out = await zipAsync(zippable);
  onProgress?.({ phase: 'done' });
  // slice でこの Uint8Array 部分だけの ArrayBuffer を確実に得る
  return new Blob([out.slice()], { type: 'application/zip' });
}

export interface ImportSummary {
  pdfs: number;
  pages: number;
  photos: number;
  campaigns: number;
}

/** zipから全置換で完全復元。既存データは全消去される。 */
export async function importAllReplace(
  file: Blob,
  onProgress?: (p: { phase: 'read' | 'parse' | 'write' | 'index' | 'done'; detail?: string }) => void,
): Promise<ImportSummary> {
  onProgress?.({ phase: 'read', detail: '読み込み中' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files = await unzipAsync(bytes);

  onProgress?.({ phase: 'parse', detail: '解析中' });
  const manifestRaw = files['manifest.json'];
  if (!manifestRaw) throw new Error('manifest.json が見つかりません（不正なバックアップ）。');
  const manifest = JSON.parse(dec.decode(manifestRaw)) as Manifest;
  if (manifest.app !== 'manual-finder') {
    throw new Error('このアプリのバックアップではありません。');
  }

  onProgress?.({ phase: 'write', detail: '書き込み中' });
  await db.transaction(
    'rw',
    db.pdfs,
    db.blobs,
    db.pages,
    db.photos,
    db.campaigns,
    async () => {
      await Promise.all([
        db.pdfs.clear(),
        db.blobs.clear(),
        db.pages.clear(),
        db.photos.clear(),
        db.campaigns.clear(),
      ]);

      let pageCount = 0;
      for (const meta of manifest.pdfs) {
        await db.pdfs.put(meta);
        const pdfBytes = files[`pdfs/${meta.id}.pdf`];
        if (pdfBytes) {
          await db.blobs.put({
            id: meta.id,
            blob: new Blob([pdfBytes.slice()], { type: 'application/pdf' }),
          });
        }
        const pagesRaw = files[`pages/${meta.id}.json`];
        if (pagesRaw) {
          const arr = JSON.parse(dec.decode(pagesRaw)) as Array<{ page: number; text: string }>;
          const rows: PageRow[] = arr.map((p) => ({
            id: `${meta.id}#${p.page}`,
            pdfId: meta.id,
            page: p.page,
            text: p.text,
          }));
          await db.pages.bulkPut(rows);
          pageCount += rows.length;
        }
      }

      for (const ph of manifest.photos) {
        const buf = files[`photos/${ph.id}`];
        if (buf) {
          const row: PhotoRow = {
            ...ph,
            blob: new Blob([buf.slice()], { type: ph.type || 'image/jpeg' }),
          };
          await db.photos.put(row);
        }
      }

      for (const c of manifest.campaigns) await db.campaigns.put(c);
    },
  );

  onProgress?.({ phase: 'index', detail: '索引再構築中' });
  await clearIndex();
  const pages = await rebuildFromPages();

  onProgress?.({ phase: 'done' });
  return {
    pdfs: manifest.pdfs.length,
    pages,
    photos: manifest.photos.length,
    campaigns: manifest.campaigns.length,
  };
}

/** ブラウザでBlobをファイルとして保存させる。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function backupFileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `manual-finder-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
}
