// 統一アイコンセット（線ベース / stroke=currentColor / 1.75 / round）。
// 色は親要素の color を継承するので、状態別の色分けは文字色を変えるだけでよい。
// 出典: 依頼者提供の manual-finder-icons.jsx（README のUI対応表どおりに割り当て）。
import type { ReactNode, SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
}

function Icon({ children, size = 24, strokeWidth = 1.75, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** 検索（虫眼鏡）— 検索バー */
export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20.5 20.5-3.6-3.6" />
  </Icon>
);

/** ライブラリ（見開きの本）— 下タブ */
export const LibraryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 6.2C10.4 5.2 7.8 4.7 4.8 4.7v13c3 0 5.6.5 7.2 1.5" />
    <path d="M12 6.2c1.6-1 4.2-1.5 7.2-1.5v13c-3 0-5.6.5-7.2 1.5" />
  </Icon>
);

/** 施策（タグ）— 下タブ */
export const CampaignIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11.6 2.6H4.6a2 2 0 0 0-2 2v7a2 2 0 0 0 .6 1.4l7.8 7.8a2 2 0 0 0 2.8 0l6.2-6.2a2 2 0 0 0 0-2.8L13 3.2a2 2 0 0 0-1.4-.6Z" />
    <circle cx="7.6" cy="7.6" r="1.3" />
  </Icon>
);

/** バックアップ（アーカイブ箱）— 下タブ */
export const BackupIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="4.5" rx="1.5" />
    <path d="M4.8 8.5v9.7a2 2 0 0 0 2 2h10.4a2 2 0 0 0 2-2V8.5" />
    <path d="M9.8 12.2h4.4" />
  </Icon>
);

/** 設定（ギア）— 下タブ */
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

/** タップ移動（ポインタ）— 操作モード */
export const TapIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M22 14a8 8 0 0 1-8 8" />
    <path d="M18 11v-1a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
    <path d="M14 10V9a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1" />
    <path d="M10 9.5V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v10" />
    <path d="M18 11a2 2 0 0 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </Icon>
);

/** スクロール移動（上下）— 操作モード */
export const ScrollIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4.5v15" />
    <path d="m7.5 9 4.5-4.5L16.5 9" />
    <path d="m7.5 15 4.5 4.5 4.5-4.5" />
  </Icon>
);

/** 暗号化（ロック） */
export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    <path d="M12 14.6v2.4" />
  </Icon>
);

/** エクスポート（ダウンロード） */
export const ExportIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5v11.5" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4.5 20h15" />
  </Icon>
);

/** 復元（アップロード） */
export const ImportIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 15V3.5" />
    <path d="m7.5 8 4.5-4.5L16.5 8" />
    <path d="M4.5 20h15" />
  </Icon>
);

/** 索引再構築（リフレッシュ） */
export const RebuildIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </Icon>
);

/** アプリを更新（単線のリロード矢印）— 設定「アプリを更新（最新版を取得）」 */
export const AppUpdateIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
);

/** お問い合わせ（メール） */
export const MailIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7.5 6.6 4.7a2.4 2.4 0 0 0 2.8 0L20 7.5" />
  </Icon>
);

/** ドキュメント（行あり）— 変更ログ / PDFファイル一般 */
export const DocIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
    <path d="M10 9H8" />
  </Icon>
);

/** 診断情報（パルス） */
export const DiagnosticsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </Icon>
);

/** 開閉マーク（▼）。開いた状態は CSS で180度回転させる */
export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
