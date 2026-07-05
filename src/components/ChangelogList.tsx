// 変更ログの一覧（設定画面のインライン展開セクションに表示）。データは src/changelog.ts。
// 以前はオーバーレイのモーダルだったが、iOS Safariで fixed オーバーレイ内のスクロールが
// 固まる不具合が出たため、設定画面内にそのまま展開する方式に変更した。
import { CHANGELOG } from '../changelog';

export function ChangelogList() {
  return (
    <div className="logInline">
      {CHANGELOG.map((e) => (
        <div key={e.version} className="logEntry">
          <div className="logHead">
            <span className="logVer">v{e.version}</span>
            <span className="logDate">{e.date}</span>
          </div>
          <ul className="logList">
            {e.changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
