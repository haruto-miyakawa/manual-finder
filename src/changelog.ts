// アプリの変更ログ（アプリ内の「変更ログ」画面に表示）。新しい版を上に追記する。
export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.2.2',
    date: '2026-07-02',
    changes: [
      'アプリ更新が反映されにくい問題に対応（ⓘに「アプリを更新」ボタンを追加、配信のキャッシュ設定を最適化）',
      'Vercel配信に対応（vercel.json）',
    ],
  },
  {
    version: '1.2.1',
    date: '2026-07-02',
    changes: [
      '不具合調査用に「診断情報」（対応機能の一覧）と画面内エラー表示を追加',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-07-02',
    changes: [
      'お問い合わせ（Googleフォーム）をヘルプ内に追加',
      '変更ログ（この画面）を追加',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-07-02',
    changes: [
      '古いiPad(iOS)でPDF取り込みが失敗する問題を修正（新しめのJS機能のポリフィルを追加）',
      'バックアップのパスワード暗号化に対応（.mfbackup）',
      'ⓘヘルプ（使い方・注意）と専門用語の注釈を追加',
      'アプリ/ホーム画面アイコンを刷新',
      'バージョン・ビルド時刻の表示を追加',
      '独自ドメイン（manual-finder.haruto-miyakawa.dev）に対応',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-07-01',
    changes: [
      '初版: ページ単位の全文検索、PDFビューア（検索ハイライト）、メモ・写真、施策、バックアップ（エクスポート/インポート）、PWA（オフライン動作）',
    ],
  },
];
