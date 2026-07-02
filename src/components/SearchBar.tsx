// 上部固定の検索バー。入力はデバウンスして親(App)へ。検索中はスピナー表示。
import { SearchIcon } from './icons';

interface Props {
  value: string;
  onChange: (v: string) => void;
  searching: boolean;
}

export function SearchBar({ value, onChange, searching }: Props) {
  return (
    <div className="searchBar">
      <span className="searchIcon" aria-hidden>
        <SearchIcon size={22} />
      </span>
      <input
        className="searchInput"
        type="search"
        inputMode="search"
        placeholder="マニュアル本文を検索（型番・キーワード）"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {searching && <span className="searchSpinner" aria-label="検索中" />}
      {value && !searching && (
        <button className="searchClear" onClick={() => onChange('')} aria-label="クリア">
          ✕
        </button>
      )}
    </div>
  );
}
