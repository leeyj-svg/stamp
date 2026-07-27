import { type ActionFunctionArgs, type LoaderFunctionArgs, Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Eye, LayoutGrid, ListChecks, Monitor, Plus, RotateCcw, Settings, Trash2, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ClickableQr } from "~/components/game/clickable-qr";
import { getTopics, getWordSession, handleWordAction } from "~/lib/word-game.server";
import { MAX_STAGE, SCORE_PRESETS, type WordPlayer } from "~/lib/word-game";

const POLLING_INTERVAL = 8000; // SSE 백업용

export const loader = async (_args: LoaderFunctionArgs) => {
  const [state, topics] = await Promise.all([getWordSession(), getTopics()]);
  return { state, topics };
};

export const action = ({ request }: ActionFunctionArgs) => handleWordAction(request);

export default function WordControlPage() {
  const { state, topics } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [origin, setOrigin] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState<{ id: string; value: string } | null>(null);
  const scoreRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    const iv = window.setInterval(() => { if (document.visibilityState === "visible") revalidator.revalidate(); }, POLLING_INTERVAL);
    return () => window.clearInterval(iv);
  }, [revalidator]);

  useEffect(() => {
    const es = new EventSource("/game/word/stream");
    es.onmessage = () => revalidator.revalidate();
    return () => es.close();
  }, [revalidator]);

  const submit = (data: Record<string, string>) => fetcher.submit(data, { method: "post" });
  const busy = fetcher.state !== "idle";
  const currentTopic = topics.find((t) => t.id === state.currentTopicId);
  const inRound = (state.phase === "round" || state.phase === "roundEnd") && !!currentTopic;

  const statusBadge = (p: WordPlayer) => {
    if (p.status === "alive") return <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-bold">생존</span>;
    if (p.status === "stopped") return <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold">Stop {p.stoppedStage}</span>;
    return <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold">Fail</span>;
  };
  const addPlayer = () => { const n = nameRef.current?.value ?? ""; if (n.trim()) { submit({ intent: "add-player", name: n }); if (nameRef.current) nameRef.current.value = ""; } };

  const pending = state.stage >= 1 && state.players.some((p) => p.status === "alive" && p.lastActedStage < state.stage);
  const stage5 = inRound ? (currentTopic!.stages[4] ?? []) : []; // 5단계 후보(미리 선택 가능)

  return (
    <div className="min-h-screen bg-slate-900 p-3 pb-16 text-white">
      <div className="mx-auto flex max-w-md flex-col gap-3">
        {/* 상단 */}
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/game" className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700"><LayoutGrid className="h-4 w-4" /> 목록</Link>
          <Link to="/game/word/host" className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700"><Monitor className="h-4 w-4" /> 큰 화면</Link>
          <Link to="/game/word/topics" className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700"><ListChecks className="h-4 w-4" /> 주제</Link>
          <button onClick={() => setSettingsOpen(true)} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-slate-600 bg-slate-800 hover:bg-slate-700"><Settings className="h-4 w-4" /></button>
        </div>
        <p className="text-center text-xs text-slate-500">관리자 컨트롤러 · 이 화면은 앞에 띄우지 마세요</p>

        {/* 팀/점수 */}
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
          <div className="mb-2 text-sm font-bold text-slate-400">팀 {state.players.length}개 · 점수표 {state.scoreTable.join("/")} · {state.mode === "host" ? "진행자 입력" : "폰 참가"}</div>
          <div className="flex flex-col gap-1">
            {state.players.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                {editName?.id === p.id ? (
                  <input autoFocus value={editName.value} onChange={(e) => setEditName({ id: p.id, value: e.target.value })}
                    onBlur={() => { if (editName.value.trim()) submit({ intent: "rename-player", playerId: p.id, name: editName.value }); setEditName(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { if (editName.value.trim()) submit({ intent: "rename-player", playerId: p.id, name: editName.value }); setEditName(null); } else if (e.key === "Escape") setEditName(null); }}
                    maxLength={12} className="w-24 rounded bg-slate-900 px-1 text-white outline-none ring-2 ring-yellow-400" />
                ) : (
                  <button onClick={() => setEditName({ id: p.id, value: p.name })} className="font-bold underline-offset-2 hover:underline">{p.name}</button>
                )}
                <span className="font-black text-yellow-400">{p.total}</span>
                {statusBadge(p)}
                {!inRound && <button onClick={() => submit({ intent: "remove-player", playerId: p.id })} className="ml-auto text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            ))}
            {state.players.length === 0 && <span className="text-sm text-slate-500">팀이 없습니다.</span>}
          </div>
          <div className="mt-2 flex gap-2">
            <Input ref={nameRef} placeholder="팀 추가" maxLength={12} onKeyDown={(e) => { if (e.key === "Enter") addPlayer(); }} className="bg-slate-700 text-white" />
            <Button onClick={addPlayer} className="bg-slate-600 px-4"><Plus className="h-4 w-4" /></Button>
          </div>
          {state.mode === "phone" && origin && (
            <div className="mt-2 flex justify-center">
              <ClickableQr value={`${origin}/game/word/play`} label="참가자 QR (탭하면 크게)" size={100} />
            </div>
          )}
        </div>

        {/* 라운드 조작 */}
        {inRound && currentTopic && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-3 text-center">
              <span className="text-sm text-slate-400">주제 </span><span className="font-black text-yellow-400">{currentTopic.title}</span>
              <span className="ml-2 text-sm text-slate-500">{state.stage}/{MAX_STAGE}단계</span>
            </div>

            <Button onClick={() => submit({ intent: "reveal-next" })} disabled={busy || state.stage >= MAX_STAGE || pending} className="bg-yellow-400 py-5 text-xl font-extrabold text-black hover:bg-yellow-500 disabled:opacity-40">
              <Eye className="mr-2 h-6 w-6" /> {pending ? "모든 팀 선택 대기 중" : state.stage === 0 ? "1단계 공개" : state.stage >= MAX_STAGE ? "모든 단계 공개됨" : `${state.stage + 1}단계 공개`}
            </Button>

            {/* 5단계 공개 단어 선택 (여기서만 단어 보임 = 몰래, 미리 골라둘 수 있음) */}
            {stage5.length > 1 && (
              <div className="rounded-xl border border-yellow-700/60 bg-slate-800 p-3">
                <p className="mb-1 text-xs font-bold text-yellow-400">5단계 공개 단어 선택 (앞 화면엔 선택된 것만 크게)</p>
                <div className="flex flex-wrap gap-2">
                  {stage5.map((w) => (
                    <Button key={w} onClick={() => submit({ intent: "set-shown-word", stage: "5", word: w })} className={`px-3 py-2 font-bold ${state.shownWords[4] === w ? "bg-yellow-400 text-black" : "bg-slate-700 text-slate-200"}`}>{w}</Button>
                  ))}
                </div>
              </div>
            )}

            {/* 팀 선택 조작 */}
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
              <p className="mb-2 text-sm font-bold text-slate-400">{state.stage === 0 ? "단어를 공개하면 선택할 수 있어요." : "팀별 선택"}</p>
              <div className="flex flex-col gap-2">
                {state.players.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 truncate font-bold">{p.name}</span>
                    {statusBadge(p)}
                    {state.stage >= 1 && (
                      <div className="ml-auto flex gap-1">
                        {p.status === "alive" && p.lastActedStage < state.stage && (
                          <>
                            {state.stage < MAX_STAGE && <Button onClick={() => submit({ intent: "choose", playerId: p.id, choice: "go", host: "1" })} className="bg-green-600 px-2 py-1 text-xs font-bold hover:bg-green-700">Go</Button>}
                            <Button onClick={() => submit({ intent: "choose", playerId: p.id, choice: "stop", host: "1" })} className="bg-blue-600 px-2 py-1 text-xs font-bold hover:bg-blue-700">Stop</Button>
                            <Button onClick={() => submit({ intent: "choose", playerId: p.id, choice: "fail", host: "1" })} className="bg-red-600 px-2 py-1 text-xs font-bold hover:bg-red-700">Fail</Button>
                          </>
                        )}
                        {p.lastActedStage === state.stage && <Button onClick={() => submit({ intent: "cancel-choice", playerId: p.id })} className="bg-slate-600 px-2 py-1 text-xs font-bold hover:bg-slate-500">취소</Button>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {state.phase === "round" ? (
              <Button onClick={() => submit({ intent: "end-round" })} disabled={busy} className="bg-slate-700 py-3 font-bold">라운드 종료</Button>
            ) : (
              <Button onClick={() => submit({ intent: "next-round" })} disabled={busy} className="bg-yellow-400 py-3 font-extrabold text-black hover:bg-yellow-500">다음 라운드</Button>
            )}
          </div>
        )}

        {/* 로비/라운드 종료: 주제 선택 */}
        {!inRound && (
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
            {state.phase === "roundEnd" && <p className="mb-2 rounded bg-slate-700/50 p-2 text-center text-sm text-slate-300">라운드 종료 · 새 주제 선택 시 다음 라운드 시작</p>}
            <p className="mb-2 font-bold text-slate-300">주제 선택</p>
            {topics.length === 0 && <p className="text-sm text-slate-500">주제가 없습니다. <Link to="/game/word/topics" className="text-yellow-400 underline">주제 관리</Link>에서 추가.</p>}
            <div className="mb-2 flex flex-col gap-2">
              {topics.map((topic) => {
                const used = state.usedTopicIds.includes(topic.id);
                const selected = state.selectedTopicId === topic.id;
                return (
                  <Button key={topic.id} disabled={used || busy} onClick={() => submit({ intent: "select-topic", topicId: String(topic.id) })}
                    className={`py-3 font-bold ${used ? "bg-slate-700 text-slate-500 line-through" : selected ? "bg-yellow-400 text-black ring-2 ring-white" : "bg-slate-700 text-slate-200 hover:bg-slate-600"}`}>
                    {topic.title}{used ? " (완료)" : ""}
                  </Button>
                );
              })}
            </div>
            <Button onClick={() => submit({ intent: "start-round" })} disabled={busy || state.selectedTopicId == null || state.players.length === 0} className="w-full bg-yellow-400 py-4 text-lg font-extrabold text-black hover:bg-yellow-500 disabled:opacity-40">시작</Button>
            {state.players.length === 0 && <p className="mt-2 text-xs text-slate-500">팀을 먼저 추가하세요.</p>}
          </div>
        )}
      </div>

      {/* 설정 모달 */}
      {settingsOpen && (
        <div onClick={() => setSettingsOpen(false)} className="fixed inset-0 z-[90] flex justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
          <div onClick={(e) => e.stopPropagation()} className="mt-8 h-fit w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">설정</h2><button onClick={() => setSettingsOpen(false)} className="text-slate-400 hover:text-white"><X className="h-6 w-6" /></button></div>
            <p className="mb-1 text-sm font-bold text-slate-300">점수표 <span className="text-yellow-400">{state.scoreTable.join(" / ")}</span></p>
            <div className="mb-2 flex gap-2">
              <Button onClick={() => submit({ intent: "set-score-table", table: SCORE_PRESETS.basic.join(",") })} className="flex-1 bg-slate-700 hover:bg-slate-600">기본형</Button>
              <Button onClick={() => submit({ intent: "set-score-table", table: SCORE_PRESETS.challenge.join(",") })} className="flex-1 bg-slate-700 hover:bg-slate-600">도전형</Button>
            </div>
            <div className="mb-4 flex items-center gap-1">
              {scoreRefs.map((ref, i) => <input key={i} ref={ref} type="number" defaultValue={state.scoreTable[i]} className="w-full rounded bg-slate-700 px-2 py-1.5 text-center text-white" />)}
              <Button onClick={() => submit({ intent: "set-score-table", table: scoreRefs.map((r) => r.current?.value ?? "0").join(",") })} className="bg-slate-600 px-3">적용</Button>
            </div>
            <p className="mb-1 text-sm font-bold text-slate-300">참가 방식</p>
            <div className="mb-4 flex gap-2">
              <Button onClick={() => submit({ intent: "set-mode", mode: "host" })} className={`flex-1 ${state.mode === "host" ? "bg-yellow-400 text-black" : "bg-slate-700 text-slate-300"}`}>진행자 입력</Button>
              <Button onClick={() => submit({ intent: "set-mode", mode: "phone" })} className={`flex-1 ${state.mode === "phone" ? "bg-yellow-400 text-black" : "bg-slate-700 text-slate-300"}`}>폰으로 참가</Button>
            </div>
            <Button onClick={() => { if (confirm("전체 초기화?")) { submit({ intent: "reset-game" }); setSettingsOpen(false); } }} variant="destructive" className="w-full py-3"><RotateCcw className="mr-1 h-4 w-4" /> 전체 초기화</Button>
          </div>
        </div>
      )}
    </div>
  );
}
