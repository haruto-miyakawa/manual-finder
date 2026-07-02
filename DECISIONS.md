# DECISIONS.md — manual-finder

> 自律一括実行（依頼者不在）での設計判断・前提・リスク・自己検証の記録。
> 個人用オフラインPDFマニュアル検索PWAの要件に基づく設計判断の記録。要件から外れた判断はすべてここに残す。
> 追記は時系列。上から「着手前の確定判断」→「実装中の判断」→「自己検証結果」。

日付基準: 2026-07-01（この実行日）。

---

## 0. アプリ名・アイデンティティ

- アプリ名（内部/package）: `manual-finder`
- 表示名（manifest name）: **マニュアル検索**、short_name: **マニュアル**
- 用途: 手元のPDFマニュアルをとっさに引く、個人1名・iPad 1台専用の完全オフラインPWA。

---

## 1. 絶対制約の技術的担保（外部通信ゼロ）

要件2・8「ランタイムの外部ネットワーク通信ゼロ」を守るための具体策：

- **CDN参照を一切しない。** すべての依存はローカルに `npm` でバンドルし、ビルド成果物（`dist/`）は完全自己完結。
- **Webフォント禁止。** UIは OS標準フォントのみ（`system-ui, -apple-system, "Hiragana Sans", sans-serif`）。外部フォント取得はゼロ。
- **pdf.js のワーカーをローカル同梱。** Vite の `?worker` インポートで `pdfjs-dist/build/pdf.worker.min.mjs` をバンドル（CDN の `workerSrc` は使わない）。
- **pdf.js の cMaps / standard_fonts をローカル同梱。** 日本語PDF（CIDフォント）の描画には cMaps が要る。未指定だと pdf.js が既定URL（外部）を取りに行く恐れがあるため、
  `node_modules/pdfjs-dist/cmaps` と `standard_fonts` を **ビルド前に `public/pdfjs/` へコピー**（`scripts/copy-pdfjs-assets.mjs`）し、
  `cMapUrl` / `standardFontDataUrl` を **同一オリジンの相対パス**に固定、`cMapPacked: true`。Service Worker で precache するので機内モードでも描画可能。
- **解析・エラー報告・テレメトリのSDKを一切入れない。**
- **Service Worker（vite-plugin-pwa / Workbox generateSW）は precache only。** 外部オリジンへの runtimeCaching ルールを定義しない（定義しなければ外部取得の経路自体が無い）。
- 自己検証: ビルド後に `dist/` を走査し、`http://` / `https://` で始まる外部URL・`fetch(` の外部参照が無いことを grep で確認（結果は本ファイル末尾「自己検証」に記録）。

---

## 2. 技術スタックと依存（すべてライセンス確認済み）

`npm view <pkg> license` で確認（2026-07-01時点）。寛容ライセンスのみ採用。

| 依存 | 用途 | ライセンス | 判定 |
|---|---|---|---|
| react / react-dom 18 | UI | MIT | ○ |
| vite / @vitejs/plugin-react | ビルド | MIT | ○ |
| typescript (strict) | 型 | Apache-2.0 | ○ |
| vite-plugin-pwa | PWA/SW | MIT | ○ |
| pdfjs-dist | PDF描画・テキスト抽出・ビューア基盤 | **Apache-2.0** | ○ |
| minisearch | 全文検索 | MIT | ○ |
| dexie | IndexedDB ラッパ | Apache-2.0 | ○ |
| dexie-react-hooks | `useLiveQuery`（IndexedDB→Reactの反応的購読） | Apache-2.0 | ○ |
| fflate | エクスポート/インポートのzip | MIT | ○ |

追加した非自明な依存の理由:
- **dexie-react-hooks**: IndexedDB の変更を React に反映する定番の最小フック。自前で購読を書くより堅く、依存も小さい（Dexie本体と同作者/同ライセンス）。「依存は最小限」の範囲内と判断。

不採用にした依存と理由:
- **@react-pdf-viewer/\***: `npm view @react-pdf-viewer/core license` → `https://react-pdf-viewer.dev/license`（**寛容ライセンスではない・商用ライセンス**）。仕様書 3./6.5 の指示どおり不採用。
- **react-pdf (wojtekmaj, MIT)**: フォールバック候補だったが**不採用**。理由: (a) 内部で独自バージョンの pdfjs-dist を抱えるため、テキスト抽出に使う `pdfjs-dist` と二重管理になり "API version does not match Worker version" 系の事故が起きやすい。(b) いずれにせよ検索ハイライトは自前実装が必要。→ **`pdfjs-dist` を直接使ってビューアを自作**（canvas描画＋テキストレイヤ＋ハイライト＋ページジャンプ＋ズーム）する方が依存が減り、単一バージョンで完結し、外部通信リスクも最小。**PDFビューアは pdfjs-dist 直叩きの自作**に決定。

---

## 3. PDFビューア（自作）の設計

- 各ページを `page.render()` で `<canvas>` に描画（`devicePixelRatio` 対応で高精細）。
- テキストレイヤは `getTextContent()` の各 item の `transform/width/height/str` と `viewport.transform` から `pdfjsLib.Util.transform()` で位置を出して透明 `<span>` を重ねる（pdf.js 標準アルゴリズムの簡易版）。この低レベルAPIはバージョン間で安定しており、v6 の `TextLayer` クラスAPIの揺れに依存しない。
- **検索ハイライト**: 開いたページのテキストレイヤ span 内で、検索語（正規化後）に一致する部分文字列を `<mark>` で包み、最初の一致へスクロール。型番・短語は概ね単一 item 内に収まるため実用十分。
- **ページジャンプ**: 目的ページ番号を指定して開き、そのページをレンダー＆スクロール。検索カードからの遷移で使用。
- **ズーム**: フィット幅を基準に、＋/− ボタン・ダブルタップ・iOS の `gesture*` イベント（ピンチ）で scale を変更、確定時に再レンダーで再クリア。片手・薄暗い前提で操作ターゲットは大きめ。

---

## 4. 全文検索（本要件の核）

- **ページ単位インデックス**: doc = `{ id: "<pdfId>#<page>", pdfId, page }`（本文 text はインデックスに入れるがストア無しにしトークンのみ保持、スニペット用の原文は `pages` テーブルに別保存）。
- **二系統トークナイザ（自作 `tokenize`）**:
  - 文字列を「CJK連なり」と「英数字連なり」に分割。
  - CJK は **bigram（2-gram）**。英数字（型番等）は **単語単位のまま**保持（bigramに混ぜない）。
  - 検索時も同じ `tokenize` を適用（MiniSearch は index/query 双方で同関数を使う）。
  - `prefix: true` を有効化 → 型番の前方一致（"RAS-X28R" の途中入力でヒット）。
  - `combineWith: 'AND'` → bigram 全一致要求で近似フレーズ検索、助詞ノイズによる誤ヒットを抑制（再現率より適合率を優先。型番・品番・固有名の到達速度を重視）。
- **正規化 `normalize`（長さ保存）**: 全角ASCII→半角、英字小文字化、全角スペース→半角。**NFKCは使わない**（濁点合成等で文字数が変わりスニペットの一致位置マッピングが崩れるため）。1文字=1文字の対応を保ち、正規化後インデックス位置を原文にそのまま使える。
- **スニペット**: `pages` に保存した原文から、一致位置の前後約60字を切り出し、一致語を強調。
- **永続化と再構築**: `MiniSearch` を `JSON.stringify`（大きければ将来 `loadJSONAsync`）で `meta` テーブルに保存し、起動時 `loadJSON` で復元 → 起動毎の全再パース回避。インデックス消失/破損時は `pages` テーブルの保存済みテキストから**再構築ボタン**で復旧（PDF再パース不要）。さらに万一 `pages` も無ければ保存済みPDFバイトから再抽出して復旧可能。

---

## 5. 永続化（IndexedDB / Dexie）スキーマ

```
db.version(1).stores({
  pdfs:      'id, title, favorite, createdAt, *tags',  // メタ + memo(テキストメモ) を同レコードに保持
  blobs:     'id',                                      // id=pdfId, PDFバイト(Blob)
  pages:     'id, pdfId',                               // id="<pdfId>#<page>", {pdfId,page,text} スニペット/再構築用原文
  photos:    'id, pdfId, createdAt',                    // 写真Blob(PDFへの注釈)
  campaigns: 'id, deadline, pdfId',                     // 施策
  meta:      'key',                                     // 検索インデックスJSON・設定・バックアップ促し状態など
})
```

- **メモは PDF レコードの `memo` フィールド**（単独メモ・エンティティは作らない。仕様C「PDF単位に紐付く注釈」に一致）。
- **写真は PDF への注釈**として `photos` に Blob 保存、`pdfId` で紐付け。
- PDFバイトは `blobs` に Blob（`application/pdf`）で保存。pdf.js には `blob.arrayBuffer()` を渡す。
- 起動時に `navigator.storage.persist()` を要求、`navigator.storage.estimate()` で使用量/クォータをUI表示、取り込み時に上限接近を警告。

---

## 6. エクスポート/インポート（中核・後付け不可）

- **形式**: 単一 zip（fflate）。base64でJSONに埋めない（サイズ肥大回避、仕様どおり）。
- **zip 構造**:
  - `manifest.json`: `{ app, version, exportedAt, pdfs:[{id,title,tags,favorite,memo,createdAt,pageCount}], campaigns:[...], photos:[{id,pdfId,name,type,createdAt}] }`
  - `pdfs/<id>.pdf`: PDF生バイト（**STORE / 無圧縮**。PDFは既に圧縮済のため level 0 で高速・低負荷）
  - `photos/<id>`: 写真生バイト（STORE）
  - `pages/<id>.json`: ページ本文（軽く圧縮）。インポート時に再パース不要で復元＆索引再構築できる。
- **インポート**: 既定は**全置換で完全復元**（要件7）。DBを全消去→manifestに従い書き戻し→索引再構築。将来のマージは任意。
- **運用UI**: 初回起動・データ増加時に「バックアップを取って」と促すバナー（要件6.1のリスク緩和）。
- 非同期版（`fflate.zip`/`unzip`）でUIをブロックしないよう Promise ラップ。

---

## 7. PWA / Service Worker

- `vite-plugin-pwa`（`generateSW`/Workbox）。`registerType: 'autoUpdate'`。
- `globPatterns` に `js,css,html,ico,png,svg,mjs,wasm,bcmap,pfb,ttf,otf` 等を含め、**pdf.worker・cmaps・standard_fonts をすべて precache**（機内モードで描画まで完動）。
- `maximumFileSizeToCacheInBytes` を引き上げ（pdf.worker が2MB既定を超える場合に precache から漏れないように）。
- `runtimeCaching` は**定義しない**（外部取得経路を作らない）。
- manifest: `display: standalone`, `orientation: portrait`, アイコン 192/512/maskable、`theme_color`/`background_color`、`apple-touch-icon`。
- **iOS スプラッシュ（apple-touch-startup-image）は端末解像度別に多数必要**で、対象端末の実解像度が不明なため**個別生成は省略**し、`background_color`/`theme_color` による起動画面に留める（機能優先。単一端末運用のため実害小）。この省略を明示的に記録。
- アイコンは `brand/manual-icon.svg`（マニュアル/本モチーフ）を Chromium で各サイズPNGにラスタライズし `brand/*.png` としてコミット。ビルド時に `scripts/gen-icons.mjs` が `public/icons/` へ**コピーするだけ**（外部通信なし・ランタイム依存なし。ラスタライズは初回/変更時のみ、フチなし化のためタイルと同じグラデ背景を敷く）。

---

## 8. UI/UX 方針（機能優先・とっさ性重視）

- 上部固定の検索バー（デバウンス250ms、検索中ローディング）。
- タブ: 「検索」「ライブラリ」「施策」「バックアップ」。
- お気に入りPDFはライブラリ最上部に**大きめタイル**で即到達。
- タップターゲット48px以上、要素間8〜12px、上下端に余白、高コントラストのダークUI（薄暗い環境でも見やすい前提）。
- 凝ったデザインはしない（仕様5）。

---

## 9. 既知リスクと緩和（仕様6に対応）

1. iOSのストレージ退避 → エクスポート/インポートを中核化＋バックアップ促しUI＋索引再構築導線。
2. 容量上限 → アプリに固定上限は設けず、`navigator.storage.estimate()` の割当量（端末依存・可変）に従う。使用量/割当量を上部に表示し、約8割で警告。設計の想定は約100枚（数百MB）だが、これは上限ではなく目安。全マニュアル一式（数GB〜）の一括投入は想定外（重さ・iOS退避リスクのため）。
3. 日本語検索精度 → bigram+prefixの二系統。将来 bigram/trigram・AND/OR 配分を再調整できる構造（`tokenizer.ts`/`searchIndex.ts` に集約）。
4. スキャンPDF（テキストレイヤ無し）→ 取り込み時にページ本文が空なら「テキスト無し（検索不可）」と表示、タグ/ファイル名で引く運用。OCRはスコープ外。
5. ビューアのライセンス → 上記2で解決（pdfjs-dist直叩き自作）。

---

## 10. 実装中の判断（時系列で追記）

- **依存バージョン確定**（`npm view` で最新確認・全て寛容ライセンス）: pdfjs-dist 6.1.200(Apache-2.0) / minisearch 7.2.0(MIT) / dexie 4.4.4(Apache-2.0) / dexie-react-hooks 4.4.0(Apache-2.0) / fflate 0.8.3(MIT) / vite-plugin-pwa 1.3.0(MIT) / React 18.3。`@react-pdf-viewer/core` は `npm view` の license が `https://react-pdf-viewer.dev/license`（**非寛容・商用**）と確認できたため不採用。
- **vite を 6.0.7 → 6.4.3 へ更新**: 初期 install で `esbuild <=0.24.2`（dev serverが任意サイトからアクセスされうる）の脆弱性が出た。これは**開発サーバのみ**の問題で配布物(オフライン)には無関係だが、衛生上パッチ版へ更新し `npm audit` を 0 件にした。
- **PDFビューアは pdfjs-dist を直接使って自作**（react-pdf も不採用）。react-pdf は内部で別バージョンの pdfjs を抱え "API/Worker version mismatch" 事故を招きやすく、いずれにせよハイライトは自作が必要なため、単一バージョンで完結する自作を選択。テキストレイヤは v6 の `TextLayer` クラス（`--total-scale-factor` を設定）で描画し、その span を走査して一致語を `<mark>` 化。
- **pdf.js v6 API 差分に対応**: (a) ドキュメント破棄は `PDFDocumentProxy.destroy()` ではなく `doc.loadingTask.destroy()`。(b) `page.render()` は `canvas` 要素必須で、dpr 拡大は `transform:[dpr,0,0,dpr,0,0]` を渡す（`canvasContext` を使う場合は `canvas:null` が必要という v6 仕様のため、`canvas` 要素方式を採用）。(c) `isEvalSupported` は v6 の DocumentInitParameters に無いため指定しない。
- **【重要】新しめ標準APIのポリフィルを追加**（`src/pdf/polyfills.ts`）: pdf.js v6 は `Uint8Array.prototype.toHex`/`toBase64`・`Uint8Array.fromBase64`（fingerprint計算等で読み込み毎に `toHex` を使用）と、`Map`/`WeakMap.prototype.getOrInsertComputed`（TextLayose 等）を使う。これらは 2025 年前後の新API（Safari 18.2 / Chrome 133–140 以降）で、環境によっては未実装。未実装だと「取り込みが全失敗」「ハイライトが描画されない」。仕様の「約100枚で確実に動かす／漏洩時に弁解の余地がない固さ」を満たすため、**feature-detect して未実装時のみ純JSで補うポリフィルをバンドル**し、main と worker の両方で pdf.js より前に読み込む（外部依存・外部通信なし）。worker へ注入するためカスタムワーカーエントリ `src/pdf/pdfWorker.entry.ts`（ポリフィル→pdf.jsワーカー本体をimport）を `?worker` でバンドル。
  - 副次事項: `vite dev` の初回だけ Vite の依存最適化(optimizeDeps)に時間がかかり、最初のワーカー生成が遅延することがある（cold-start のみ。2回目以降は即時）。プレビュー/本番ビルドには影響なし。
- **お問い合わせ（Googleフォーム）＝唯一の意図的な外部リンク**: ヘルプ内に `https://forms.gle/...` への `<a target="_blank">` を設置。これは**ユーザーがタップした時だけ別タブで開く外部リンク**であり、アプリの自動外部通信（fetch/XHR/font/script）は依然ゼロ（＝マニュアルデータは一切外部に出ない）という保証は不変。メアドを公開しないための選択（mailto直載は迷惑メール収集リスクのため不採用）。ビルド成果物の外部URL走査では、この forms.gle が唯一ヒットする想定。
- **変更ログ**: `src/changelog.ts` を単一の元データとし、アプリ内「変更ログ」画面と `CHANGELOG.md` に反映。バージョンは `package.json` → vite define(`__APP_VERSION__`)、ビルド時刻は `__BUILD_TIME__` で注入し、更新反映の確認に使う。
- **ポリフィル拡張（古いiPad対応）**: iPad(homescreen PWA)で「PDF取り込み直後にエラー」報告。原因は pdf.js v6 が `Promise.withResolvers`（**Safari 17.4+**／worker13・main27箇所）・`Object.hasOwn`・`structuredClone`・`Array.findLast/findLastIndex`（いずれも Safari 15.4+）を使用し、古いiOSに無いため。`src/pdf/polyfills.ts` にこれらを feature-detect で追加（main/worker 両方に適用）。ネイティブ無効化下でユニット検証（7/7 pass）。iPadを最新iOSに更新するのが本筋だが、更新できない端末でも「確実に動く」ようにするための保険（仕様の趣旨）。開発者はMac非所持でSafari Web Inspectorが使えないため、原因はUAではなく **pdf.jsの使用API×Safari対応バージョン** から特定した。
- **状態管理は React state + Dexie `useLiveQuery`** のみ（Zustand等の追加ライブラリなし）。IndexedDB の変更が反応的にUIへ反映される。
- **検索の既定は `combineWith:'AND' + prefix:true`**: bigram全一致でフレーズ精度を上げ、型番は前方一致でヒット。実データで弱ければ `src/search/{tokenizer,searchIndex}.ts` の1箇所で再調整可能。
- **エクスポートzip**: PDF/写真は STORE(level0)、JSON は level6。`fflate` の非同期 `zip`/`unzip`（内部Worker, blob URL・外部通信なし）でUIブロックを回避。インポートは全置換で完全復元し、索引は pages から再構築。
- **iOSスプラッシュ画像は個別生成せず**、manifest の `background_color`/`theme_color` に留めた（対象端末の実解像度が不明で多数の画像が必要になるため。単一端末運用で実害小・機能優先）。DECISIONS 7 の判断どおり。

---

## 11. 自己検証結果（完了条件1〜8）

検証日 2026-07-01〜02。ビルド環境 Node 24.15 / npm 11.12 / Vite 6.4.3 / TypeScript 5.6(strict)。

**A. ビルド/型（要件1）** ✅
- `npm run build`（`tsc -b && vite build`）成功。TypeScript strict でエラー0。`npm audit` 0件。
- `npm run dev`（96msでready・HTTP200）/ `npm run preview`（index/manifest/sw.js/icons/cmap すべて 200）ともにエラーなく起動。

**B. 中核ロジックの単体検証（Node, esbuildでバンドル実行）** ✅ 18/18 passed
- normalize は長さ保存・全角→半角・小文字化。tokenize は CJK=bigram / 英数字=単語（型番はbigram化しない）。
- MiniSearch でページ単位検索: 「エラー」→該当2ページ・無関係ページ除外、型番「X28R」→p.2 かつ **X40Rページに誤マッチしない（適合率）**、「RAS-X2」で前方一致。
- snippet は前後スニペット＋`<mark>`強調、**HTMLエスケープでXSS無し**、長文で省略記号。
- fflate zip 往復で PDFバイトが**完全一致で復元**。

**C. 実ブラウザE2E（Playwright/Chromium, 本番ビルドをpreview配信）** ✅ 27/27 passed
- 要件3: PDF取り込み→**リロード後もPDF/メモ/写真/施策が残存**（IndexedDB永続化）。
- 要件4: 全文検索でpage単位ヒット→スニペット`<mark>`→カードタップで**該当ページ(p.1)を開いた状態＋テキストレイヤに一致語ハイライト(`mark.hl`)**。別クエリ「error」は別ページ(p.2)にヒット。
- 要件5: メモを保存→リロード後も保持。写真(PNG)を添付→表示→**リロード後も保持**。
- 要件6: 施策登録→締切近い順・残り日数表示・締切間近を色強調(class `soon`)→リロード後も残存。
- 要件7: **エクスポート(1ファイルzip)→PDF削除→インポートで PDF/メモ/写真/施策/検索索引を完全復元**。
- 要件2: `context.setOffline(true)` で**オフライン起動・オフライン検索・オフラインPDF描画**（SWが worker/cmap/font をプリキャッシュ）。
- 要件8: 実行中の**外部リクエスト0件**（localhost/blob/data 以外への request をブラウザで監視して0を確認）。

**D. 静的解析（要件8の担保）** ✅
- ビルド成果物 `dist/` に `@font-face`/外部 `url()`/外部 `fetch`/XHR/外部 `<script>`/`<link>` は**無し**（grep確認）。
- 残る `http(s)://` 文字列は**すべて非通信の文字列**: pdf.jsのXML名前空間(`xfa.org`,`ns.adobe.com`)、Dexie/Reactのエラーメッセージ内ドキュメントリンク（`tinyurl`/`bit.ly`/`reactjs.org`）のみ。ネットワークは発生しない。
- SW precache 197エントリ(約3.86MiB)に pdf.worker・cmaps(168)・standard_fonts(14)・アイコンを含む＝機内モードで描画まで完動。

**結論: 完了条件1〜8はすべて充足。** 検証に用いた一時ファイル（サンプルPDF生成器・Playwrightスクリプト等）はリポジトリに残していない（`node_modules` のPlaywrightは `--no-save` で package.json 非汚染）。
