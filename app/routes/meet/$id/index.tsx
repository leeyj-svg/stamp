import { type ActionFunctionArgs, type LoaderFunctionArgs, Form, useActionData, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Link2, Users } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { TimeGrid } from "~/components/meet/time-grid";
import { DateBoard } from "~/components/meet/date-board";
import { getMeetEventWithResponses, respondSchema, upsertMeetResponse } from "~/lib/meet.server";
import { getPublicOrigin, getSpaceShareMeta } from "~/lib/space-meta";
import { formatKoreanDate } from "~/lib/space-date";
import {
  mergeContiguous,
  minuteToLabel,
  parseSlotKey,
  rankSlots,
  respondentCount,
  tallyMap,
  tallySlots,
  type MeetEventView,
  type MeetResponseView,
} from "~/lib/meet";

export function meta({ data }: { data?: { event: MeetEventView; origin: string; shareDescription: string } }) {
  if (!data?.event) return [{ title: "일정 맞추기" }];
  return getSpaceShareMeta({
    origin: data.origin,
    path: `/meet/${data.event.id}`,
    title: data.event.title || "일정 맞추기",
    description: data.shareDescription,
  });
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const data = await getMeetEventWithResponses(params.id!);
  if (!data) throw new Response("Not Found", { status: 404 });
  const origin = getPublicOrigin(request);
  const isDT = data.event.granularity === "DATE_TIME";
  const shareDescription = `후보 ${data.event.candidateDates.length}일 · 되는 ${isDT ? "시간을" : "날짜를"} 표시해 주세요`;
  return { ...data, origin, shareDescription };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const form = await request.formData();
  let availability: unknown = [];
  try {
    availability = JSON.parse(String(form.get("availability") ?? "[]"));
  } catch {
    availability = [];
  }
  const parsed = respondSchema.safeParse({
    name: form.get("name"),
    password: form.get("password"),
    availability,
    responseId: form.get("responseId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력을 확인하세요." };
  const res = await upsertMeetResponse(request, params.id!, parsed.data);
  if (!res) throw new Response("Not Found", { status: 404 });
  return { ok: true as const, responseId: res.responseId };
};

export default function MeetEventPage() {
  const { event, responses } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const revalidator = useRevalidator();

  const [tab, setTab] = useState("input");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [myId, setMyId] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [listView, setListView] = useState<"merged" | "slots">("merged");
  const [visible, setVisible] = useState(10);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const prefilled = useRef(false);

  const isDateTime = event.granularity === "DATE_TIME";
  const submitting = nav.state !== "idle";

  // 8초 폴링
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, 8000);
    return () => window.clearInterval(iv);
  }, [revalidator]);

  // 최초 1회: 내 응답/이름 prefill
  useEffect(() => {
    if (prefilled.current) return;
    prefilled.current = true;
    const rid = localStorage.getItem(`meet:resp:${event.id}`);
    if (rid) {
      const mine = responses.find((r) => r.id === rid);
      if (mine) {
        setName(mine.name);
        setSelected(new Set(mine.availability));
        setMyId(rid);
        return;
      }
    }
    const savedName = localStorage.getItem("meet:name");
    if (savedName) setName(savedName);
  }, [event.id, responses]);

  // 저장 성공 처리
  useEffect(() => {
    if (actionData && "ok" in actionData && actionData.ok) {
      localStorage.setItem(`meet:resp:${event.id}`, actionData.responseId);
      localStorage.setItem("meet:name", name);
      setMyId(actionData.responseId);
      setTab("result");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData]);

  const tallies = useMemo(() => tallySlots(event, responses as MeetResponseView[]), [event, responses]);
  const map = useMemo(() => tallyMap(tallies), [tallies]);
  const maxCount = respondentCount(responses as MeetResponseView[]);
  const ranked = useMemo(() => rankSlots(tallies), [tallies]);
  const merged = useMemo(() => mergeContiguous(event, tallies), [event, tallies]);

  function copyLink() {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  function rangeLabel(date: string, start: number | null, end: number | null) {
    const d = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
    if (start == null) return formatKoreanDate(date);
    return `${d} ${minuteToLabel(start)}~${minuteToLabel(end ?? start)}`;
  }

  // 순위 리스트 행 (구간 묶기 / 슬롯별)
  const rankRows =
    isDateTime && listView === "merged"
      ? merged.map((r) => ({ label: rangeLabel(r.date, r.startMinute, r.endMinute), count: r.count, names: r.names }))
      : ranked.map((t) => ({ label: isDateTime ? rangeLabel(t.date, t.minute, (t.minute ?? 0) + (event.slotMinutes ?? 60)) : formatKoreanDate(t.date), count: t.count, names: t.names }));
  const shownRows = rankRows.slice(0, visible);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-xl">
        {/* 헤더 */}
        <div className="mb-4">
          <h1 className="text-xl font-bold">{event.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={copyLink} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-indigo-600 hover:bg-indigo-50">
              {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />} {copied ? "복사됨" : "링크 공유"}
            </button>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-600">
              <Users className="h-4 w-4" /> {maxCount}명 참여
            </span>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="input">내 입력</TabsTrigger>
            <TabsTrigger value="result">결과</TabsTrigger>
          </TabsList>

          {/* ---- 내 입력 ---- */}
          <TabsContent value="input">
            <Form method="post" className="space-y-4">
              <input type="hidden" name="availability" value={JSON.stringify([...selected])} />
              <input type="hidden" name="responseId" value={myId} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold">이름</label>
                  <Input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required className="bg-white" placeholder="이름" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold">비밀번호</label>
                  <Input name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={64} required className="bg-white" placeholder="수정용 비번" />
                </div>
              </div>
              {myId && <p className="text-xs text-indigo-600">내 응답을 수정 중이에요.</p>}

              {isDateTime ? (
                <div className="rounded-xl border border-slate-200 bg-white p-2">
                  <p className="px-1 pb-2 text-xs text-slate-500">되는 시간을 드래그해서 칠하세요.</p>
                  <TimeGrid mode="input" event={event} selected={selected} onChange={setSelected} />
                </div>
              ) : (
                <div>
                  <p className="pb-2 text-xs text-slate-500">되는 날짜를 눌러 선택하세요.</p>
                  <DateBoard
                    mode="input"
                    candidateDates={event.candidateDates}
                    selected={selected}
                    onToggle={(k) => setSelected((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                  />
                </div>
              )}

              {selected.size === 0 && <p className="text-xs text-slate-400">선택한 시간이 없어요.</p>}
              {actionData && "error" in actionData && actionData.error && <p className="text-sm text-rose-500">{actionData.error}</p>}

              <Button type="submit" disabled={submitting} className="w-full bg-indigo-600 py-6 text-base font-bold hover:bg-indigo-700 disabled:opacity-40">
                {submitting ? "저장 중…" : myId ? "수정 저장" : "저장하기"}
              </Button>
            </Form>
          </TabsContent>

          {/* ---- 결과 ---- */}
          <TabsContent value="result" className="space-y-6">
            {maxCount === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                아직 응답이 없어요. <button onClick={copyLink} className="font-semibold text-indigo-600 underline">링크를 공유</button>해보세요.
              </div>
            ) : (
              <Tabs defaultValue="heatmap" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="heatmap">히트맵</TabsTrigger>
                  <TabsTrigger value="rank">순위 리스트</TabsTrigger>
                </TabsList>

                {/* 순위 리스트 */}
                <TabsContent value="rank">
                  {isDateTime && (
                    <div className="mb-2 flex justify-end gap-1 text-xs">
                      <button onClick={() => { setListView("merged"); setVisible(10); }} className={`rounded-full px-2.5 py-1 font-semibold ${listView === "merged" ? "bg-indigo-500 text-white" : "bg-slate-200 text-slate-600"}`}>구간</button>
                      <button onClick={() => { setListView("slots"); setVisible(10); }} className={`rounded-full px-2.5 py-1 font-semibold ${listView === "slots" ? "bg-indigo-500 text-white" : "bg-slate-200 text-slate-600"}`}>슬롯별</button>
                    </div>
                  )}
                  <div className="space-y-2">
                    {shownRows.map((row, i) => (
                      <div key={i} className={`rounded-xl border bg-white p-3 ${i === 0 ? "border-indigo-300 ring-1 ring-indigo-200" : "border-slate-200"}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{row.label}</span>
                          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700">{row.count}/{maxCount}명</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {row.names.map((n, j) => <span key={j} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{n}</span>)}
                        </div>
                      </div>
                    ))}
                    {rankRows.length === 0 && <p className="text-center text-sm text-slate-400">아직 되는 시간이 없어요.</p>}
                    {rankRows.length > shownRows.length && (
                      <button onClick={() => setVisible((v) => v + 10)} className="w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-indigo-600 hover:bg-indigo-50">
                        더 보기 ({rankRows.length - shownRows.length}개 남음)
                      </button>
                    )}
                    {visible > 10 && rankRows.length <= shownRows.length && (
                      <button onClick={() => setVisible(10)} className="w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50">
                        접기
                      </button>
                    )}
                  </div>
                </TabsContent>

                {/* 히트맵 */}
                <TabsContent value="heatmap">
                  <p className="mb-2 text-xs text-slate-400">진할수록 많이 가능 · 칸을 누르면 누가 되는지 볼 수 있어요</p>
                  {isDateTime ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-2">
                      <TimeGrid mode="result" event={event} tallyMap={map} maxCount={maxCount} onPick={(k) => setPickedKey((p) => (p === k ? null : k))} selectedKey={pickedKey} />
                    </div>
                  ) : (
                    <DateBoard mode="result" candidateDates={event.candidateDates} tallyMap={map} maxCount={maxCount} onPick={(k: string) => setPickedKey((p) => (p === k ? null : k))} selectedKey={pickedKey} />
                  )}
                  {pickedKey && (() => {
                    const t = map.get(pickedKey);
                    const { date, minute } = parseSlotKey(pickedKey);
                    const label = isDateTime ? rangeLabel(date, minute, (minute ?? 0) + (event.slotMinutes ?? 60)) : formatKoreanDate(date);
                    return (
                      <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-indigo-900">{label}</span>
                          <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-indigo-700">{t?.count ?? 0}/{maxCount}명</span>
                        </div>
                        {t && t.count > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {t.names.map((n, j) => <span key={j} className="rounded-md bg-white px-2 py-0.5 text-xs text-slate-600">{n}</span>)}
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-indigo-700/70">되는 사람이 없어요.</p>
                        )}
                      </div>
                    );
                  })()}
                </TabsContent>
              </Tabs>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
