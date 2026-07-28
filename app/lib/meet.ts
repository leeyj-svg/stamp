// 지인 시간 맞추기(when2meet 스타일) 공용 타입/헬퍼 (클라이언트 안전 · 서버/브라우저 공용)

export type MeetGranularity = "DATE" | "DATE_TIME";

export type MeetEventView = {
  id: string;
  title: string;
  granularity: MeetGranularity;
  candidateDates: string[]; // "YYYY-MM-DD" (KST)
  slotMinutes: number | null;
  startMinute: number | null;
  endMinute: number | null;
};

export type MeetResponseView = {
  id: string;
  name: string;
  availability: string[]; // 슬롯키
  updatedAt: string;
};

export const MAX_SLOTS = 2000; // days × rows 상한 (과대 그리드 방지)
export const MAX_CANDIDATE_DATES = 60;
export const SLOT_UNIT_OPTIONS = [10, 30, 60] as const;
export const DEFAULT_START_MINUTE = 9 * 60; // 09:00
export const DEFAULT_END_MINUTE = 22 * 60; // 22:00

// ---- 슬롯키 ----
export function makeSlotKey(date: string, minuteOfDay?: number | null): string {
  return minuteOfDay == null ? date : `${date}#${minuteOfDay}`;
}

export function parseSlotKey(key: string): { date: string; minute: number | null } {
  const idx = key.indexOf("#");
  if (idx === -1) return { date: key, minute: null };
  const date = key.slice(0, idx);
  const minute = Number(key.slice(idx + 1));
  return { date, minute: Number.isFinite(minute) ? minute : null };
}

export function minuteToLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---- 열거 ----
// DATE_TIME 그리드의 행(시간 슬롯 시작 분) 목록
export function enumerateDayMinutes(event: MeetEventView): number[] {
  if (event.granularity !== "DATE_TIME") return [];
  const start = event.startMinute ?? DEFAULT_START_MINUTE;
  const end = event.endMinute ?? DEFAULT_END_MINUTE;
  const step = event.slotMinutes ?? 60;
  if (step <= 0 || end <= start) return [];
  const out: number[] = [];
  for (let m = start; m < end; m += step) out.push(m);
  return out;
}

// 이벤트의 전체 슬롯키(정규 순서: 날짜 오름차순, 그다음 분 오름차순)
export function enumerateSlots(event: MeetEventView): string[] {
  const dates = [...event.candidateDates].sort();
  if (event.granularity === "DATE") return dates.map((d) => makeSlotKey(d));
  const minutes = enumerateDayMinutes(event);
  const out: string[] = [];
  for (const d of dates) for (const m of minutes) out.push(makeSlotKey(d, m));
  return out;
}

export function slotCount(event: MeetEventView): number {
  if (event.granularity === "DATE") return event.candidateDates.length;
  return event.candidateDates.length * enumerateDayMinutes(event).length;
}

// ---- 집계 ----
export type SlotTally = { key: string; date: string; minute: number | null; count: number; names: string[] };

// 모든 슬롯(응답 0 포함)에 대해 가능 인원과 이름 집계
export function tallySlots(event: MeetEventView, responses: MeetResponseView[]): SlotTally[] {
  const all = enumerateSlots(event);
  const allSet = new Set(all);
  const byKey = new Map<string, string[]>();
  for (const key of all) byKey.set(key, []);
  for (const r of responses) {
    for (const key of r.availability) {
      if (!allSet.has(key)) continue; // 스테일 키 무시
      byKey.get(key)!.push(r.name);
    }
  }
  return all.map((key) => {
    const { date, minute } = parseSlotKey(key);
    return { key, date, minute, count: byKey.get(key)!.length, names: byKey.get(key)! };
  });
}

// 가능 인원 많은 순 → 같으면 정규 순서(날짜/분)
export function rankSlots(tallies: SlotTally[], opts?: { includeEmpty?: boolean }): SlotTally[] {
  const arr = opts?.includeEmpty ? [...tallies] : tallies.filter((t) => t.count > 0);
  return arr.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.minute ?? 0) - (b.minute ?? 0);
  });
}

export type MergedRange = {
  date: string;
  startMinute: number | null;
  endMinute: number | null; // 마지막 슬롯의 끝(= 마지막 시작 + slotMinutes). DATE면 null
  count: number;
  names: string[];
};

// "구간 묶기" 보기용: 같은 날 연속되고 (count·names 동일)인 슬롯을 하나의 구간으로 병합.
// 병합된 구간을 가능 인원 많은 순으로 반환.
export function mergeContiguous(event: MeetEventView, tallies: SlotTally[]): MergedRange[] {
  const withPeople = tallies.filter((t) => t.count > 0);
  if (event.granularity === "DATE") {
    return rankMerged(
      withPeople.map((t) => ({ date: t.date, startMinute: null, endMinute: null, count: t.count, names: t.names })),
    );
  }
  const step = event.slotMinutes ?? 60;
  // 날짜별 → 분 오름차순 정렬
  const sorted = [...withPeople].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.minute ?? 0) - (b.minute ?? 0)));
  const merged: MergedRange[] = [];
  const sameNames = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
  for (const t of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.date === t.date &&
      last.count === t.count &&
      last.endMinute === t.minute && // 직전 구간 끝이 이번 시작과 맞닿음
      sameNames(last.names, t.names)
    ) {
      last.endMinute = (t.minute ?? 0) + step;
    } else {
      merged.push({ date: t.date, startMinute: t.minute, endMinute: (t.minute ?? 0) + step, count: t.count, names: t.names });
    }
  }
  return rankMerged(merged);
}

function rankMerged(arr: MergedRange[]): MergedRange[] {
  return arr.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.startMinute ?? 0) - (b.startMinute ?? 0);
  });
}

export function tallyMap(tallies: SlotTally[]): Map<string, SlotTally> {
  const map = new Map<string, SlotTally>();
  for (const t of tallies) map.set(t.key, t);
  return map;
}

export function respondentCount(responses: MeetResponseView[]): number {
  return responses.length;
}

// ---- 히트맵 색 ----
export function intensity(count: number, maxCount: number): number {
  if (maxCount <= 0 || count <= 0) return 0;
  return Math.min(1, count / maxCount);
}

// 밝은 화이트 톤에 맞춘 indigo 알파 램프
export function rampColor(t: number): string {
  if (t <= 0) return "transparent";
  return `rgba(79, 70, 229, ${(0.12 + 0.78 * t).toFixed(3)})`; // indigo-600 기반
}
