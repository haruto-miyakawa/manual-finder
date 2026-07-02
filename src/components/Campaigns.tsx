// 施策（締切つき）。締切の近い順・残り日数・締切超過/間近を色で強調。紐付けPDFをワンタップで開く。
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { deleteCampaign, upsertCampaign } from '../db/repo';
import type { Campaign } from '../types';

interface Props {
  onOpenViewer: (pdfId: string, page: number, query: string) => void;
}

/** 締切日(YYYY-MM-DD)までの残り日数（今日基準・ローカル）。 */
function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  const due = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function urgencyClass(days: number): string {
  if (Number.isNaN(days)) return '';
  if (days < 0) return 'overdue'; // 赤
  if (days <= 3) return 'soon'; // 橙
  return '';
}
function remainLabel(days: number): string {
  if (Number.isNaN(days)) return '';
  if (days < 0) return `${-days}日超過`;
  if (days === 0) return '本日締切';
  return `あと${days}日`;
}

const EMPTY: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  startDate: '',
  deadline: '',
  memo: '',
  pdfId: null,
};

export function Campaigns({ onOpenViewer }: Props) {
  const campaigns = useLiveQuery(() => db.campaigns.toArray(), [], []);
  const pdfs = useLiveQuery(() => db.pdfs.orderBy('title').toArray(), [], []);
  const [form, setForm] = useState<(typeof EMPTY) & { id?: string }>(EMPTY);
  const [editing, setEditing] = useState(false);

  const titleById = new Map(pdfs.map((p) => [p.id, p.title] as const));
  const sorted = [...campaigns].sort((a, b) => a.deadline.localeCompare(b.deadline));

  function startNew() {
    setForm(EMPTY);
    setEditing(true);
  }
  function startEdit(c: Campaign) {
    setForm({ id: c.id, name: c.name, startDate: c.startDate ?? '', deadline: c.deadline, memo: c.memo, pdfId: c.pdfId });
    setEditing(true);
  }
  async function save() {
    if (!form.name.trim()) return alert('施策名を入力してください。');
    if (!form.deadline) return alert('締切日を入力してください。');
    await upsertCampaign({
      id: form.id,
      name: form.name.trim(),
      startDate: form.startDate || undefined,
      deadline: form.deadline,
      memo: form.memo,
      pdfId: form.pdfId || null,
    });
    setEditing(false);
    setForm(EMPTY);
  }

  return (
    <div className="campaigns">
      <div className="libActions">
        <button className="btn primary big" onClick={startNew}>
          ＋ 施策を登録
        </button>
      </div>

      {sorted.length === 0 && <div className="empty">施策はまだありません。</div>}

      <ul className="campList">
        {sorted.map((c) => {
          const days = daysUntil(c.deadline);
          return (
            <li key={c.id} className={`campItem ${urgencyClass(days)}`}>
              <div className="campMain">
                <div className="campTop">
                  <span className="campName">{c.name}</span>
                  <span className="campRemain">{remainLabel(days)}</span>
                </div>
                <div className="campMeta">
                  締切 {c.deadline}
                  {c.startDate ? `（開始 ${c.startDate}）` : ''}
                </div>
                {c.memo && <div className="campMemo">{c.memo}</div>}
              </div>
              <div className="campActions">
                {c.pdfId && titleById.has(c.pdfId) && (
                  <button className="btn small" onClick={() => onOpenViewer(c.pdfId as string, 1, '')}>
                    PDF
                  </button>
                )}
                <button className="btn small" onClick={() => startEdit(c)}>
                  編集
                </button>
                <button
                  className="btn small danger"
                  onClick={() => {
                    if (confirm(`施策「${c.name}」を削除しますか？`)) void deleteCampaign(c.id);
                  }}
                >
                  削除
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {editing && (
        <div className="overlay" onClick={() => setEditing(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <header className="drawerHead">
              <button className="btn iconBtn" onClick={() => setEditing(false)} aria-label="閉じる">
                ✕
              </button>
              <div className="drawerTitle">{form.id ? '施策を編集' : '施策を登録'}</div>
              <button className="btn primary" onClick={() => void save()}>
                保存
              </button>
            </header>
            <div className="drawerBody">
              <label className="fieldLabel">施策名 *</label>
              <input className="textField" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

              <label className="fieldLabel">開始日（任意）</label>
              <input
                className="textField"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />

              <label className="fieldLabel">締切日 *</label>
              <input
                className="textField"
                type="date"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              />

              <label className="fieldLabel">メモ</label>
              <textarea className="textArea" rows={3} value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />

              <label className="fieldLabel">紐付けPDF（1つ・任意）</label>
              <select className="textField" value={form.pdfId ?? ''} onChange={(e) => setForm({ ...form, pdfId: e.target.value || null })}>
                <option value="">（なし）</option>
                {pdfs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
