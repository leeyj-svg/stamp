import { type ActionFunctionArgs, type LoaderFunctionArgs, Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Eye, LayoutGrid, ListChecks, Plus, RotateCcw, Settings, Trash2, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ClickableQr } from "~/components/game/clickable-qr";
import { getTopics, getWordSession, handleWordAction } from "~/lib/word-game.server";
import { MAX_STAGE, SCORE_PRESETS, type WordPlayer } from "~/lib/word-game";

const POLLING_INTERVAL = 8000; // SSE 백업용

export const loader = async (_args: LoaderFunctionArgs) => {
  const [state, topics] = await Promise.all([getWordSession(), getTopics()]);
  const topicTitle = topics.find((t) => t.id === state.currentTopicId)?.title ?? null;
  return { state, topics, topicTitle };
};

export const action = ({ request }: ActionFunctionArgs) => handleWordAction(request);

export default function WordHostPage() {
  const { state, topics, topicTitle } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [origin, setOrigin] = useState("");
  const submit = (data: Record<string, string>) => fetcher.submit(data, { method: "post" });
  const busy = fetcher.state !== "idle";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scoreRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const nameRef = useRef<HTMLInputElement>(null);
  const [editName, setEditName] = useState<{ id: string; value: string } | null>(null);
  const addPlayer = () => { const n = nameRef.current?.value ?? ""; if (n.trim()) { submit({ intent: "add-player", name: n }); if (nameRef.current) nameRef.current.value = ""; } };

  const SettingsModal = () => (
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
        {state.phase !== "lobby" && <p className="mb-4 text-xs text-slate-500">참가 방식은 로비에서만 바뀝니다.</p>}

        <p className="mb-1 text-sm font-bold text-slate-300">진행자 컨트롤러</p>
        {origin && (
          <div className="mb-4 flex flex-col items-center gap-2">
            <ClickableQr value={`${origin}/game/word/control`} label="진행자 컨트롤러 (탭하면 크게)" size={120} />
            <Link to="/game/word/control" className="text-sm font-bold text-blue-400 underline">이 기기에서 열기</Link>
          </div>
        )}

        <Button onClick={() => { if (confirm("전체 초기화?")) { submit({ intent: "reset-game" }); setSettingsOpen(false); } }} variant="destructive" className="w-full py-3"><RotateCcw className="mr-1 h-4 w-4" /> 전체 초기화</Button>
      </div>
    </div>
  );

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

  const inRound = (state.phase === "round" || state.phase === "roundEnd") && topicTitle;

  const statusBadge = (p: WordPlayer) => {
    if (p.status === "alive") return <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-bold">생존</span>;
    if (p.status === "stopped") return <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold">Stop {p.stoppedStage}</span>;
    return <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold">Fail</span>;
  };
  const teamCard = (p: WordPlayer) => (
    <div key={p.id} className="rounded-xl border border-slate-700 bg-slate-800 p-3 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xl font-bold">{p.name}</span>
        <span className="text-3xl font-black text-yellow-400">{p.total}</span>
      </div>
      <div className="mt-1">{statusBadge(p)}</div>
      {state.stage >= 1 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.status === "alive" && p.lastActedStage < state.stage && (
            <>
              {state.stage < MAX_STAGE && <Button onClick={() => submit({ intent: "choose", playerId: p.id, choice: "go", host: "1" })} disabled={busy} className="min-w-0 flex-1 bg-green-600 px-0 py-1 text-xs font-bold hover:bg-green-700">Go</Button>}
              <Button onClick={() => submit({ intent: "choose", playerId: p.id, choice: "stop", host: "1" })} disabled={busy} className="min-w-0 flex-1 bg-blue-600 px-0 py-1 text-xs font-bold hover:bg-blue-700">Stop</Button>
              <Button onClick={() => submit({ intent: "choose", playerId: p.id, choice: "fail", host: "1" })} disabled={busy} className="min-w-0 flex-1 bg-red-600 px-0 py-1 text-xs font-bold hover:bg-red-700">Fail</Button>
            </>
          )}
          {p.lastActedStage === state.stage && <Button onClick={() => submit({ intent: "cancel-choice", playerId: p.id })} disabled={busy} className="min-w-0 flex-1 bg-slate-600 px-0 py-1 text-xs font-bold hover:bg-slate-500">취소</Button>}
        </div>
      )}
    </div>
  );

  // 라운드: 전체 화면 디스플레이
  if (inRound) {
    const half = Math.ceil(state.players.length / 2);
    const left = state.players.slice(0, half);
    const right = state.players.slice(half);
    const currentWord = state.stage >= 1 ? (state.shownWords[state.stage - 1] || "") : "";
    const pending = state.stage >= 1 && state.players.some((p) => p.status === "alive" && p.lastActedStage < state.stage);
    return (
      <div className="flex min-h-screen flex-col bg-slate-900 p-3 text-white">
        <div className="flex items-center gap-2">
          <Link to="/game" className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700"><LayoutGrid className="h-4 w-4" /> 목록</Link>
          <span className="text-lg font-bold text-slate-300">주제 <span className="text-yellow-400">{topicTitle}</span></span>
          <button onClick={() => setSettingsOpen(true)} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-slate-600 bg-slate-800 hover:bg-slate-700"><Settings className="h-4 w-4" /></button>
        </div>

        {/* 이전 단어 작게 */}
        <div className="mt-2 flex flex-wrap justify-center gap-4 text-slate-400">
          {state.shownWords.slice(0, Math.max(0, state.stage - 1)).map((w, i) => (
            <span key={i} className="text-lg"><span className="text-slate-500">{i + 1}단계</span> <span className="font-bold text-slate-200">{w || "-"}</span></span>
          ))}
        </div>

        <div className="flex flex-1 items-stretch gap-3 py-2">
          <div className="flex w-1/5 min-w-[130px] flex-col justify-center gap-2 overflow-auto">{left.map(teamCard)}</div>
          <div className="flex flex-1 flex-col items-center justify-center">
            {state.stage === 0 ? (
              <p className="text-3xl font-bold text-slate-500">곧 시작합니다</p>
            ) : (
              <>
                <span className="text-2xl font-bold text-slate-400">{state.stage}단계 · {state.scoreTable[state.stage - 1]}점</span>
                <span className="break-keep text-center font-black leading-none text-white text-[14vw]">{currentWord || "-"}</span>
              </>
            )}
          </div>
          <div className="flex w-1/5 min-w-[130px] flex-col justify-center gap-2 overflow-auto">{right.map(teamCard)}</div>
        </div>

        <div className="flex items-center justify-center gap-2">
          <Button onClick={() => submit({ intent: "reveal-next" })} disabled={busy || state.stage >= MAX_STAGE || pending} className="w-full max-w-xl bg-yellow-400 py-6 text-2xl font-extrabold text-black hover:bg-yellow-500 disabled:opacity-40">
            <Eye className="mr-2 h-7 w-7" /> {pending ? "모든 팀 선택 대기 중" : state.stage === 0 ? "1단계 공개" : state.stage >= MAX_STAGE ? "모든 단계 공개됨" : `${state.stage + 1}단계 공개`}
          </Button>
          {state.phase === "round" ? (
            <Button onClick={() => submit({ intent: "end-round" })} disabled={busy} className="bg-slate-700 px-5 py-6 text-lg font-bold">라운드 종료</Button>
          ) : (
            <Button onClick={() => submit({ intent: "next-round" })} disabled={busy} className="bg-yellow-400 px-5 py-6 text-lg font-extrabold text-black hover:bg-yellow-500">다음 라운드</Button>
          )}
        </div>
        {settingsOpen && SettingsModal()}
      </div>
    );
  }

  // 로비 / 라운드 종료
  const lobbyHalf = Math.ceil(state.players.length / 2);
  const lobbyCard = (p: WordPlayer) => (
    <div key={p.id} className="rounded-xl border border-slate-700 bg-slate-800 p-3 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        {editName?.id === p.id ? (
          <input autoFocus value={editName.value} onChange={(e) => setEditName({ id: p.id, value: e.target.value })}
            onBlur={() => { if (editName.value.trim()) submit({ intent: "rename-player", playerId: p.id, name: editName.value }); setEditName(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { if (editName.value.trim()) submit({ intent: "rename-player", playerId: p.id, name: editName.value }); setEditName(null); } else if (e.key === "Escape") setEditName(null); }}
            maxLength={12} className="w-full rounded bg-slate-900 px-1 text-white outline-none ring-2 ring-yellow-400" />
        ) : (
          <button onClick={() => setEditName({ id: p.id, value: p.name })} className="truncate text-lg font-bold underline-offset-2 hover:underline">{p.name}</button>
        )}
        <button onClick={() => submit({ intent: "remove-player", playerId: p.id })} className="shrink-0 text-red-400"><Trash2 className="h-4 w-4" /></button>
      </div>
      <span className="text-3xl font-black text-yellow-400">{p.total}</span>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 p-3 text-white">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/game" className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700"><LayoutGrid className="h-4 w-4" /> 목록</Link>
        <Link to="/game/word/topics" className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-bold hover:bg-slate-700"><ListChecks className="h-4 w-4" /> 주제 관리</Link>
        <span className="text-lg font-bold text-slate-300">단어게임</span>
        <button onClick={() => setSettingsOpen(true)} className="ml-auto flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-bold hover:bg-slate-700"><Settings className="h-4 w-4" /> 설정</button>
      </div>

      <div className="flex flex-1 items-stretch gap-3 py-3">
        {/* 좌 팀 */}
        <div className="flex w-1/5 min-w-[130px] flex-col justify-center gap-2 overflow-auto">{state.players.slice(0, lobbyHalf).map(lobbyCard)}</div>

        {/* 가운데: 팀 추가 + 주제 선택 + 시작 */}
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="flex w-full max-w-md gap-2">
            <Input ref={nameRef} placeholder="팀 이름 추가" maxLength={12} onKeyDown={(e) => { if (e.key === "Enter") addPlayer(); }} className="bg-slate-800 text-white" />
            <Button onClick={addPlayer} className="bg-slate-700 px-4"><Plus className="h-4 w-4" /></Button>
          </div>

          {state.mode === "phone" && origin && (
            <ClickableQr value={`${origin}/game/word/play`} label="참가자 QR (탭하면 크게)" size={110} />
          )}

          {state.phase === "roundEnd" && <p className="rounded-lg bg-slate-700/50 px-3 py-2 text-center text-sm text-slate-300">지난 라운드 종료 · 새 주제 선택</p>}
          <p className="text-lg font-bold text-slate-300">주제 선택</p>
          {topics.length === 0 && <p className="text-sm text-slate-500">주제 없음. <Link to="/game/word/topics" className="text-yellow-400 underline">주제 관리</Link>에서 추가.</p>}
          <div className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3">
            {topics.map((topic) => {
              const used = state.usedTopicIds.includes(topic.id);
              const selected = state.selectedTopicId === topic.id;
              return (
                <Button key={topic.id} disabled={used || busy} onClick={() => submit({ intent: "select-topic", topicId: String(topic.id) })}
                  className={`h-auto py-5 text-xl font-black ${used ? "bg-slate-700 text-slate-500 line-through" : selected ? "bg-yellow-400 text-black ring-4 ring-white" : "bg-slate-700 text-slate-200 hover:bg-slate-600"}`}>
                  {topic.title}{used ? " (완료)" : ""}
                </Button>
              );
            })}
          </div>

          <Button onClick={() => submit({ intent: "start-round" })} disabled={busy || state.selectedTopicId == null || state.players.length === 0}
            className="w-full max-w-md bg-yellow-400 py-6 text-2xl font-extrabold text-black hover:bg-yellow-500 disabled:opacity-40">
            시작
          </Button>
          {state.players.length === 0 && <p className="text-xs text-slate-500">팀을 먼저 추가하세요.</p>}
        </div>

        {/* 우 팀 */}
        <div className="flex w-1/5 min-w-[130px] flex-col justify-center gap-2 overflow-auto">{state.players.slice(lobbyHalf).map(lobbyCard)}</div>
      </div>

      {settingsOpen && SettingsModal()}
    </div>
  );
}
