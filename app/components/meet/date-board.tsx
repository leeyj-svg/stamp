import { useMemo } from "react";
import { intensity, rampColor, type SlotTally } from "~/lib/meet";

const WD = ["일", "월", "화", "수", "목", "금", "토"];

type BaseProps = { candidateDates: string[] };
type InputProps = BaseProps & { mode: "input"; selected: Set<string>; onToggle: (key: string) => void };
type ResultProps = BaseProps & { mode: "result"; tallyMap: Map<string, SlotTally>; maxCount: number; onPick?: (key: string) => void; selectedKey?: string | null };

// 입력(선택)·결과(히트맵) 공용 벽걸이 달력
export function DateBoard(props: InputProps | ResultProps) {
  const { candidateDates } = props;
  const months = useMemo(() => [...new Set(candidateDates.map((d) => d.slice(0, 7)))].sort(), [candidateDates]);
  const candidateSet = useMemo(() => new Set(candidateDates), [candidateDates]);
  const isInput = props.mode === "input";

  return (
    <div className="space-y-5">
      {months.map((ym) => {
        const [y, m] = ym.split("-").map(Number);
        const startWeekday = new Date(y, m - 1, 1).getDay();
        const daysInMonth = new Date(y, m, 0).getDate();
        const cells: (number | null)[] = [];
        for (let i = 0; i < startWeekday; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push(d);
        while (cells.length % 7 !== 0) cells.push(null);
        return (
          <div key={ym} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <p className="border-b border-slate-200 py-2.5 text-center text-base font-bold text-slate-800">{y}년 {m}월</p>
            <div className="grid grid-cols-7 border-b border-slate-200 text-center text-xs font-medium">
              {WD.map((w, i) => (
                <div key={w} className={`py-1.5 ${i === 0 ? "text-rose-500" : i === 6 ? "text-sky-500" : "text-slate-400"}`}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((d, i) => {
                const key = d == null ? null : `${ym}-${String(d).padStart(2, "0")}`;
                const isCandidate = key != null && candidateSet.has(key);
                const col = i % 7;
                const base = `relative min-h-[3.5rem] border-b border-r border-slate-100 p-1 text-left align-top sm:min-h-[4.25rem] ${col === 0 ? "border-l" : ""}`;

                if (d == null) return <div key={i} className={`${base} bg-slate-50/40`} />;
                if (!isCandidate) {
                  return <div key={i} className={`${base} text-slate-300`}><span className="text-xs">{d}</span></div>;
                }

                if (isInput) {
                  const p = props as InputProps;
                  const on = p.selected.has(key!);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => p.onToggle(key!)}
                      className={`${base} transition-colors ${on ? "bg-indigo-500" : "hover:bg-indigo-50"}`}
                      aria-pressed={on}
                    >
                      <span className={`text-xs ${on ? "font-bold text-white" : "text-slate-600"}`}>{d}</span>
                      {on && <span className="absolute inset-x-0 bottom-1 text-center text-xs font-bold text-white">✓</span>}
                    </button>
                  );
                }

                const p = props as ResultProps;
                const t = p.tallyMap.get(key!);
                const count = t?.count ?? 0;
                const picked = p.selectedKey != null && p.selectedKey === key;
                const strong = count > 0 && intensity(count, p.maxCount) > 0.5;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => p.onPick?.(key!)}
                    className={`${base} transition-colors hover:ring-2 hover:ring-inset hover:ring-indigo-300 ${picked ? "ring-2 ring-inset ring-indigo-600" : ""}`}
                    style={{ backgroundColor: rampColor(intensity(count, p.maxCount)) }}
                    title={`${key} · ${count}명${count ? ": " + t!.names.join(", ") : ""}`}
                  >
                    <span className={`text-xs ${strong ? "font-bold text-white" : "text-slate-600"}`}>{d}</span>
                    {count > 0 && <span className={`absolute inset-x-0 bottom-1 text-center text-sm font-bold ${strong ? "text-white" : "text-indigo-700"}`}>{count}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
