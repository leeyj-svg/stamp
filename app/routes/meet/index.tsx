import { type ActionFunctionArgs, Form, redirect, useActionData, useNavigation } from "react-router";
import { useMemo, useState } from "react";
import { ko } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { CalendarDays, Clock, Sparkles } from "lucide-react";
import { Calendar } from "~/components/ui/calendar";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { createEventSchema, createMeetEvent } from "~/lib/meet.server";
import {
  DEFAULT_END_MINUTE,
  DEFAULT_START_MINUTE,
  MAX_SLOTS,
  SLOT_UNIT_OPTIONS,
  minuteToLabel,
} from "~/lib/meet";

export function meta() {
  return [{ title: "일정 맞추기 만들기" }];
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  let candidateDates: unknown = [];
  try {
    candidateDates = JSON.parse(String(form.get("candidateDates") ?? "[]"));
  } catch {
    candidateDates = [];
  }
  const parsed = createEventSchema.safeParse({
    title: form.get("title"),
    granularity: form.get("granularity"),
    candidateDates,
    slotMinutes: form.get("slotMinutes") || undefined,
    startMinute: form.get("startMinute") || undefined,
    endMinute: form.get("endMinute") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  }
  const id = await createMeetEvent(request, parsed.data);
  return redirect(`/meet/${id}`);
};

function dateToKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function eachDayKey(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cur <= end) {
    out.push(dateToKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const HOURS = Array.from({ length: 25 }, (_, i) => i); // 0..24

export default function MeetCreatePage() {
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submitting = nav.state !== "idle";

  const [granularity, setGranularity] = useState<"DATE" | "DATE_TIME">("DATE");
  const [pickMode, setPickMode] = useState<"range" | "multiple">("range");
  const [range, setRange] = useState<DateRange | undefined>();
  const [days, setDays] = useState<Date[]>([]);
  const [slotMinutes, setSlotMinutes] = useState<number>(30);
  const [startHour, setStartHour] = useState<number>(DEFAULT_START_MINUTE / 60);
  const [endHour, setEndHour] = useState<number>(DEFAULT_END_MINUTE / 60);

  const candidateDates = useMemo(() => {
    if (pickMode === "range") {
      if (range?.from && range?.to) return eachDayKey(range.from, range.to);
      if (range?.from) return [dateToKey(range.from)];
      return [];
    }
    return days.map(dateToKey).sort();
  }, [pickMode, range, days]);

  const startMinute = startHour * 60;
  const endMinute = endHour * 60;
  const rows = granularity === "DATE_TIME" && endMinute > startMinute ? Math.floor((endMinute - startMinute) / slotMinutes) : 0;
  const totalSlots = candidateDates.length * (granularity === "DATE_TIME" ? rows : 1);
  const overCap = granularity === "DATE_TIME" && totalSlots > MAX_SLOTS;

  const canSubmit =
    candidateDates.length > 0 &&
    !overCap &&
    !(granularity === "DATE_TIME" && endMinute <= startMinute);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
          <Sparkles className="h-6 w-6 text-indigo-500" /> 일정 맞추기 만들기
        </h1>
        <p className="mb-6 text-sm text-slate-500">후보 날짜를 고르고 링크를 공유하면, 친구들이 각자 되는 시간을 표시해요.</p>

        <Form method="post" className="space-y-6">
          <input type="hidden" name="granularity" value={granularity} />
          <input type="hidden" name="candidateDates" value={JSON.stringify(candidateDates)} />
          {granularity === "DATE_TIME" && (
            <>
              <input type="hidden" name="slotMinutes" value={slotMinutes} />
              <input type="hidden" name="startMinute" value={startMinute} />
              <input type="hidden" name="endMinute" value={endMinute} />
            </>
          )}

          {/* 제목 */}
          <div>
            <label className="mb-1.5 block text-sm font-semibold">제목</label>
            <Input name="title" placeholder="예: 이번 주 저녁 모임" maxLength={100} required className="bg-white" />
          </div>

          {/* 단위 */}
          <div>
            <label className="mb-1.5 block text-sm font-semibold">무엇으로 정할까요?</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setGranularity("DATE")} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold ${granularity === "DATE" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-500"}`}>
                <CalendarDays className="h-4 w-4" /> 날짜만
              </button>
              <button type="button" onClick={() => setGranularity("DATE_TIME")} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold ${granularity === "DATE_TIME" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-500"}`}>
                <Clock className="h-4 w-4" /> 날짜+시간
              </button>
            </div>
          </div>

          {/* 날짜 선택 */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-semibold">후보 날짜</label>
              <div className="flex gap-1 text-xs">
                <button type="button" onClick={() => setPickMode("range")} className={`rounded-full px-2.5 py-1 font-semibold ${pickMode === "range" ? "bg-indigo-500 text-white" : "bg-slate-200 text-slate-600"}`}>범위</button>
                <button type="button" onClick={() => setPickMode("multiple")} className={`rounded-full px-2.5 py-1 font-semibold ${pickMode === "multiple" ? "bg-indigo-500 text-white" : "bg-slate-200 text-slate-600"}`}>개별</button>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-2">
              {pickMode === "range" ? (
                <Calendar mode="range" locale={ko} numberOfMonths={1} selected={range} onSelect={setRange} disabled={{ before: new Date() }} className="mx-auto" />
              ) : (
                <Calendar mode="multiple" locale={ko} numberOfMonths={1} selected={days} onSelect={(d) => setDays(d ?? [])} disabled={{ before: new Date() }} className="mx-auto" />
              )}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">{candidateDates.length}일 선택됨</p>
          </div>

          {/* 시간 옵션 */}
          {granularity === "DATE_TIME" && (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold">시간 단위</label>
                <div className="grid grid-cols-3 gap-2">
                  {SLOT_UNIT_OPTIONS.map((u) => (
                    <button key={u} type="button" onClick={() => setSlotMinutes(u)} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${slotMinutes === u ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500"}`}>{u}분</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold">시작 시각</label>
                  <select value={startHour} onChange={(e) => setStartHour(Number(e.target.value))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{minuteToLabel(h * 60)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold">끝 시각</label>
                  <select value={endHour} onChange={(e) => setEndHour(Number(e.target.value))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                    {HOURS.slice(1).map((h) => <option key={h} value={h}>{minuteToLabel(h * 60)}</option>)}
                  </select>
                </div>
              </div>
              {endMinute <= startMinute ? (
                <p className="text-xs text-rose-500">끝 시각은 시작 시각보다 뒤여야 해요.</p>
              ) : (
                <p className={`text-xs ${overCap ? "text-rose-500" : "text-slate-500"}`}>총 {totalSlots}칸{overCap ? ` · 너무 많아요 (최대 ${MAX_SLOTS}). 날짜나 시간 범위를 줄이세요.` : ""}</p>
              )}
            </div>
          )}

          {actionData?.error && <p className="text-sm text-rose-500">{actionData.error}</p>}

          <Button type="submit" disabled={!canSubmit || submitting} className="w-full bg-indigo-600 py-6 text-base font-bold hover:bg-indigo-700 disabled:opacity-40">
            {submitting ? "만드는 중…" : "만들고 링크 받기"}
          </Button>
        </Form>
      </div>
    </div>
  );
}
