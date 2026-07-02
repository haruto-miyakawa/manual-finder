// ストレージ使用量/クォータと永続化状態の表示。上限接近を警告。
import { useEffect, useState } from 'react';
import { getStorageInfo, type StorageInfo } from '../db/repo';

function fmt(bytes: number): string {
  if (bytes <= 0) return '0';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)}${u[i]}`;
}

export function StorageBar({ refreshKey }: { refreshKey?: number }) {
  const [info, setInfo] = useState<StorageInfo | null>(null);

  useEffect(() => {
    let alive = true;
    getStorageInfo().then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (!info || info.quota === 0) return null;
  const ratio = info.usage / info.quota;
  const warn = ratio > 0.8;

  return (
    <div className={`storageBar${warn ? ' warn' : ''}`} title={info.persisted ? '永続化 ON' : '永続化 未確定'}>
      <div className="storageTrack">
        <div className="storageFill" style={{ width: `${Math.min(100, ratio * 100).toFixed(1)}%` }} />
      </div>
      <span className="storageText">
        <span className="storageNums">
          {fmt(info.usage)} / {fmt(info.quota)}
        </span>
        {info.persisted ? <span className="storageSuffix"> ・保存保護</span> : null}
        {warn ? <span className="storageSuffix"> ・容量注意</span> : null}
      </span>
    </div>
  );
}
