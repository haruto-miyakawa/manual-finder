// 変更ログ画面（ヘルプ内の「変更ログ」ボタンから開く）。データは src/changelog.ts。
import { CHANGELOG } from '../changelog';

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawerHead">
          <div className="drawerTitle">変更ログ</div>
          <button className="btn primary" onClick={onClose}>
            閉じる
          </button>
        </header>
        <div className="drawerBody">
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
      </div>
    </div>
  );
}
