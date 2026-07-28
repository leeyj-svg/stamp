import { useRef } from "react";
import {
  enumerateDayMinutes,
  makeSlotKey,
  minuteToLabel,
  rampColor,
  type MeetEventView,
  type SlotTally,
} from "~/lib/meet";

const KST = "Asia/Seoul";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dateParts(dateKey: string) {
  // 정오 파싱으로 KST off-by-one 방지
  const d = new Date(`${dateKey}T12:00:00+09:00`);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: KST, weekday: "short" }).format(d);
  const dayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  const [, m, day] = dateKey.split("-");
  return { md: `${Number(m)}/${Number(day)}`, weekday: WEEKDAYS[dayIdx] ?? "", dayIdx };
}

type InputProps = {
  mode: "input";
  event: MeetEventView;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
};

type ResultProps = {
  mode: "result";
  event: MeetEventView;
  tallyMap: Map<string, SlotTally>;
  maxCount: number;
  onPick?: (key: string) => void;
  selectedKey?: string | null;
};

export function TimeGrid(props: InputProps | ResultProps) {
  const { event } = props;
  const dates = [...event.candidateDates].sort();
  const minutes = enumerateDayMinutes(event);
  const paintRef = useRef<{ active: boolean; value: boolean }>({ active: false, value: true });

  const isInput = props.mode === "input";

  function applyPaint(key: string) {
    if (!isInput) return;
    const p = props as InputProps;
    const has = p.selected.has(key);
    if (paintRef.current.value === has) return; // 이미 원하는 상태
    const next = new Set(p.selected);
    if (paintRef.current.value) next.add(key);
    else next.delete(key);
    p.onChange(next);
  }

  function onPointerDownCell(key: string, e: React.PointerEvent) {
    if (!isInput) return;
    e.preventDefault();
    const p = props as InputProps;
    paintRef.current = { active: true, value: !p.selected.has(key) };
    applyPaint(key);
  }

  function onContainerPointerMove(e: React.PointerEvent) {
    if (!isInput || !paintRef.current.active) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const key = el?.getAttribute?.("data-slot-key");
    if (key) applyPaint(key);
  }

  function endPaint() {
    paintRef.current.active = false;
  }

  return (
    <div
      className="overflow-x-auto"
      onPointerMove={onContainerPointerMove}
      onPointerUp={endPaint}
      onPointerLeave={endPaint}
      onPointerCancel={endPaint}
    >
      <div className="inline-grid select-none" style={{ gridTemplateColumns: `auto repeat(${dates.length}, minmax(48px, 1fr))` }}>
        {/* 헤더 행 */}
        <div className="sticky left-0 z-10 bg-white" />
        {dates.map((d) => {
          const { md, weekday, dayIdx } = dateParts(d);
          const weekend = dayIdx === 0 || dayIdx === 6;
          return (
            <div key={`h-${d}`} className={`px-1 pb-1 text-center text-xs font-semibold ${weekend ? "text-rose-500" : "text-slate-600"}`}>
              <div>{md}</div>
              <div className="text-[10px] font-normal">{weekday}</div>
            </div>
          );
        })}

        {/* 시간 행들 */}
        {minutes.map((m) => (
          <div key={`row-${m}`} className="contents">
            <div className="sticky left-0 z-10 -mt-2 bg-white pr-2 text-right text-[10px] tabular-nums text-slate-400">
              {m % 60 === 0 ? minuteToLabel(m) : ""}
            </div>
            {dates.map((d) => {
              const key = makeSlotKey(d, m);
              if (isInput) {
                const p = props as InputProps;
                const on = p.selected.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    data-slot-key={key}
                    onPointerDown={(e) => onPointerDownCell(key, e)}
                    className={`h-6 border border-slate-100 transition-colors ${on ? "bg-indigo-500" : "bg-white hover:bg-indigo-50"}`}
                    style={{ touchAction: "none" }}
                    aria-pressed={on}
                    aria-label={`${d} ${minuteToLabel(m)}`}
                  />
                );
              }
              const p = props as ResultProps;
              const t = p.tallyMap.get(key);
              const count = t?.count ?? 0;
              const ratio = p.maxCount > 0 ? count / p.maxCount : 0;
              const picked = p.selectedKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => p.onPick?.(key)}
                  className={`h-6 border transition-colors ${picked ? "border-2 border-indigo-600" : "border-slate-100 hover:border-indigo-300"}`}
                  style={{ backgroundColor: rampColor(ratio) }}
                  title={count > 0 ? `${d} ${minuteToLabel(m)} · ${count}명: ${t!.names.join(", ")}` : `${d} ${minuteToLabel(m)} · 0명`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
