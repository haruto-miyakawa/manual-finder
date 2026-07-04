// 施策: 月カレンダー上に開始〜締切の期間帯（バー）で表示。
// 同時期の施策はレーン方式で行を分けて積み、週をまたぐ帯は週境界で折り返す。
// 帯タップ→詳細シート（編集・削除・紐付けPDFをワンタップで開く）。前月/翌月/今日ナビ。
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { deleteCampaign, upsertCampaign } from '../db/repo';
import type { Campaign } from '../types';

interface Props {
  onOpenViewer: (pdfId: string, page: number, query: string) => void;
}

const DAY_MS = 86400000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// 日付はすべて「ローカル正午」基準で持つ。深夜0時をスキップする夏時間(DST)のタイムゾーンでも
// setDate で日付がズレたり週が欠落したりしないため（日本では影響ないが防御的に）。
/** 'YYYY-MM-DD' → ローカル正午の Date（不正なら null）。 */
function parseDay(s: string | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12);
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dayDiff(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

/** 締切日(YYYY-MM-DD)までの残り日数（今日基準・ローカル）。 */
function daysUntil(dateStr: string): number {
  const due = parseDay(dateStr);
  if (!due) return NaN;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return dayDiff(due, today);
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

/** その月を含む週の配列（日曜はじまり・月末の週まで）。全要素ローカル正午。 */
function monthWeeks(year: number, month: number): Date[][] {
  const lastOfMonth = new Date(year, month + 1, 0, 12);
  const first = new Date(year, month, 1, 12);
  const cur = new Date(year, month, 1 - first.getDay(), 12);
  const weeks: Date[][] = [];
  while (cur <= lastOfMonth) {
    const w: Date[] = [];
    for (let i = 0; i < 7; i++) {
      w.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
      cur.setHours(12, 0, 0, 0); // DSTで時刻がずれても正午に戻す
    }
    weeks.push(w);
  }
  return weeks;
}

interface Seg {
  camp: Campaign;
  col: number; // 0-6
  span: number; // 1-7
  contLeft: boolean; // 前週から継続（左端が切れている）
  contRight: boolean; // 翌週へ継続
  cls: string;
}

/** 週内の施策セグメントを作り、重ならないようレーンに詰める（貪欲法）。 */
function weekLanes(week: Date[], camps: Campaign[]): Seg[][] {
  const ws = week[0];
  const we = week[6];
  const segs: Seg[] = [];
  for (const c of camps) {
    const end = parseDay(c.deadline);
    if (!end) continue;
    // 開始日未入力/不正のフォールバック: 開始日=締切日（1日幅の帯）
    let start = parseDay(c.startDate ?? '') ?? end;
    if (start > end) start = end; // 逆転データ防御
    if (end < ws || start > we) continue;
    const s = start < ws ? ws : start;
    const e = end > we ? we : end;
    segs.push({
      camp: c,
      col: dayDiff(s, ws),
      span: dayDiff(e, s) + 1,
      contLeft: start < ws,
      contRight: end > we,
      cls: urgencyClass(daysUntil(c.deadline)),
    });
  }
  // 開始位置→長い順で安定して積む
  segs.sort((a, b) => a.col - b.col || b.span - a.span || a.camp.id.localeCompare(b.camp.id));
  const lanes: Seg[][] = [];
  for (const sg of segs) {
    const lane = lanes.find((l) => l.every((o) => sg.col >= o.col + o.span || o.col >= sg.col + sg.span));
    if (lane) lane.push(sg);
    else lanes.push([sg]);
  }
  return lanes;
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
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [form, setForm] = useState<(typeof EMPTY) & { id?: string }>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const titleById = new Map(pdfs.map((p) => [p.id, p.title] as const));
  const weeks = useMemo(() => monthWeeks(ym.y, ym.m), [ym]);
  const lanesByWeek = useMemo(() => weeks.map((w) => weekLanes(w, campaigns)), [weeks, campaigns]);
  const monthHasCamp = lanesByWeek.some((l) => l.length > 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const detail = detailId ? campaigns.find((c) => c.id === detailId) : undefined;

  function moveMonth(delta: number) {
    setYm(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  function startNew() {
    setForm(EMPTY);
    setEditing(true);
  }
  function startEdit(c: Campaign) {
    setForm({ id: c.id, name: c.name, startDate: c.startDate ?? '', deadline: c.deadline, memo: c.memo, pdfId: c.pdfId });
    setDetailId(null);
    setEditing(true);
  }
  async function save() {
    if (!form.name.trim()) return alert('施策名を入力してください。');
    if (!form.deadline) return alert('締切日を入力してください。');
    if (form.startDate && form.startDate > form.deadline) return alert('開始日が締切日より後になっています。');
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

      <div className="calHead">
        <button className="btn small" onClick={() => moveMonth(-1)} aria-label="前月">
          ‹
        </button>
        <div className="calTitle">
          {ym.y}年{ym.m + 1}月
        </div>
        <button
          className="btn small ghost calToday"
          onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}
        >
          今日
        </button>
        <button className="btn small" onClick={() => moveMonth(1)} aria-label="翌月">
          ›
        </button>
      </div>

      <div className="calendar">
        <div className="calWeekdays">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`calWd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>
              {w}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="calWeek">
            <div className="calDays">
              {week.map((d) => (
                <div
                  key={d.getTime()}
                  className={`calDay${d.getMonth() !== ym.m ? ' out' : ''}${sameDay(d, today) ? ' today' : ''}`}
                >
                  <span className="calDayNum">{d.getDate()}</span>
                </div>
              ))}
            </div>
            {lanesByWeek[wi].map((lane, li) => (
              <div key={li} className="calLane">
                {lane.map((sg) => (
                  <button
                    key={sg.camp.id}
                    className={`calBand ${sg.cls}${sg.contLeft ? ' contL' : ''}${sg.contRight ? ' contR' : ''}`}
                    style={{ gridColumn: `${sg.col + 1} / span ${sg.span}`, gridRow: 1 }}
                    onClick={() => setDetailId(sg.camp.id)}
                    title={sg.camp.name}
                  >
                    {sg.camp.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="calLegend">
        <span className="lg normal">通常</span>
        <span className="lg soon">締切3日以内</span>
        <span className="lg overdue">締切超過</span>
      </div>

      {campaigns.length === 0 && <div className="empty">施策はまだありません。「＋ 施策を登録」から追加してください。</div>}
      {campaigns.length > 0 && !monthHasCamp && <div className="empty">この月に施策はありません（‹ › で月を移動）。</div>}

      {detail && (
        <div className="overlay" onClick={() => setDetailId(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <header className="drawerHead">
              <button className="btn iconBtn" onClick={() => setDetailId(null)} aria-label="閉じる">
                ✕
              </button>
              <div className="drawerTitle">{detail.name}</div>
              <button className="btn" onClick={() => startEdit(detail)}>
                編集
              </button>
            </header>
            <div className="drawerBody">
              <div className={`campDetailRemain ${urgencyClass(daysUntil(detail.deadline))}`}>
                {remainLabel(daysUntil(detail.deadline))}
              </div>
              <div className="metaLine">
                期間: {detail.startDate ? `${detail.startDate} 〜 ` : ''}
                {detail.deadline}（締切）
              </div>
              {detail.memo && <div className="campMemo">{detail.memo}</div>}
              {detail.pdfId && titleById.has(detail.pdfId) && (
                <button
                  className="btn primary big"
                  onClick={() => {
                    setDetailId(null);
                    onOpenViewer(detail.pdfId as string, 1, '');
                  }}
                >
                  📄 {titleById.get(detail.pdfId)} を開く
                </button>
              )}
              <button
                className="btn danger wide"
                onClick={() => {
                  if (confirm(`施策「${detail.name}」を削除しますか？`)) {
                    setDetailId(null);
                    void deleteCampaign(detail.id);
                  }
                }}
              >
                この施策を削除
              </button>
            </div>
          </div>
        </div>
      )}

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

              <label className="fieldLabel">開始日（カレンダーの帯の起点。未入力は締切日と同じ扱い）</label>
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
