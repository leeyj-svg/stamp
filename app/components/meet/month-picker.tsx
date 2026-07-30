import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const WD = ["일", "월", "화", "수", "목", "금", "토"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function keyOf(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}
function todayKey() {
  const t = new Date();
  return keyOf(t.getFullYear(), t.getMonth() + 1, t.getDate());
}
// a~b(문자열 키) 사이 모든 날짜 키 (포함)
function rangeKeys(a: string, b: string): string[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const [y1, m1, d1] = lo.split("-").map(Number);
  const [y2, m2, d2] = hi.split("-").map(Number);
  const out: string[] = [];
  const cur = new Date(y1, m1 - 1, d1);
  const end = new Date(y2, m2 - 1, d2);
  while (cur <= end) {
    out.push(keyOf(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

type Props = {
  mode: "range" | "multiple";
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
};

// 주최자 후보 날짜 선택용 큰 달력 (월 이동 + 범위/개별)
export function MonthPicker({ mode, selected, onChange }: Props) {
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const today = todayKey();

  const startWeekday = new Date(view.y, view.m - 1, 1).getDay();
  const daysInMonth = new Date(view.y, view.m, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  function move(delta: number) {
    setView((v) => {
      const nm = v.m + delta;
      if (nm < 1) return { y: v.y - 1, m: 12 };
      if (nm > 12) return { y: v.y + 1, m: 1 };
      return { y: v.y, m: nm };
    });
  }

  function click(key: string) {
    if (mode === "multiple") {
      const n = new Set(selected);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      onChange(n);
      return;
    }
    // range
    if (rangeStart == null) {
      setRangeStart(key);
      onChange(new Set([key]));
    } else {
      onChange(new Set(rangeKeys(rangeStart, key)));
      setRangeStart(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* 헤더 (월 이동) */}
      <div className="flex items-center justify-between border-b border-slate-200 px-2 py-2">
        <button type="button" onClick={() => move(-1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-5 w-5" /></button>
        <span className="text-base font-bold text-slate-800">{view.y}년 {view.m}월</span>
        <button type="button" onClick={() => move(1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><ChevronRight className="h-5 w-5" /></button>
      </div>
      {/* 요일 */}
      <div className="grid grid-cols-7 border-b border-slate-200 text-center text-xs font-medium">
        {WD.map((w, i) => (
          <div key={w} className={`py-1.5 ${i === 0 ? "text-rose-500" : i === 6 ? "text-sky-500" : "text-slate-400"}`}>{w}</div>
        ))}
      </div>
      {/* 날짜 */}
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const col = i % 7;
          const base = `relative min-h-[3.25rem] border-b border-r border-slate-100 p-1 text-left align-top sm:min-h-[3.75rem] ${col === 0 ? "border-l" : ""}`;
          if (d == null) return <div key={i} className={`${base} bg-slate-50/40`} />;
          const key = keyOf(view.y, view.m, d);
          const past = key < today;
          const on = selected.has(key);
          if (past) {
            return <div key={i} className={`${base} text-slate-300`}><span className="text-xs">{d}</span></div>;
          }
          return (
            <button
              key={i}
              type="button"
              onClick={() => click(key)}
              className={`${base} transition-colors ${on ? "bg-indigo-500" : "hover:bg-indigo-50"}`}
              aria-pressed={on}
            >
              <span className={`text-xs ${on ? "font-bold text-white" : "text-slate-700"}`}>{d}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
