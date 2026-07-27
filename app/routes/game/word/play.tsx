import { type ActionFunctionArgs, type LoaderFunctionArgs, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { useEffect } from "react";
import { Button } from "~/components/ui/button";
import { getTopics, getWordSession, handleWordAction } from "~/lib/word-game.server";
import { MAX_STAGE } from "~/lib/word-game";

const POLLING_INTERVAL = 8000; // SSE 백업용

export const loader = async (_args: LoaderFunctionArgs) => {
  const state = await getWordSession();
  const topics = await getTopics();
  const topicTitle = topics.find((t) => t.id === state.currentTopicId)?.title ?? null;
  return { state, topicTitle };
};

export const action = ({ request }: ActionFunctionArgs) => handleWordAction(request);

export default function WordPlayPage() {
  const { state, topicTitle } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const me = searchParams.get("me");

  useEffect(() => {
    if (me) return;
    let id = localStorage.getItem("word_anon");
    if (!id) { id = `w-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`; localStorage.setItem("word_anon", id); }
    setSearchParams((prev) => { prev.set("me", id as string); return prev; }, { replace: true });
  }, [me, setSearchParams]);

  useEffect(() => {
    const iv = window.setInterval(() => { if (document.visibilityState === "visible") revalidator.revalidate(); }, POLLING_INTERVAL);
    return () => window.clearInterval(iv);
  }, [revalidator]);

  useEffect(() => {
    const es = new EventSource("/game/word/stream");
    es.onmessage = () => revalidator.revalidate();
    return () => es.close();
  }, [revalidator]);

  const busy = fetcher.state !== "idle";
  if (!me) return <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">불러오는 중...</div>;

  const myPlayer = state.players.find((p) => p.claimedBy === me);
  const revealedWords = state.shownWords.slice(0, state.stage).map((w, i) => ({ stage: i + 1, word: w, score: state.scoreTable[i] }));
  const canChoose = myPlayer?.status === "alive" && state.phase === "round" && state.stage >= 1 && myPlayer.lastActedStage < state.stage;

  const wordsBlock = (
    <>
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 text-center">
        <p className="text-sm text-slate-400">주제</p>
        <p className="text-xl font-black text-yellow-400">{topicTitle ?? "-"}</p>
      </div>
      <div className="flex flex-col gap-2">
        {revealedWords.length === 0 && <p className="text-center text-slate-500">단어 공개를 기다리는 중...</p>}
        {revealedWords.map((r) => (
          <div key={r.stage} className="flex items-center gap-3 rounded-lg border border-slate-600 bg-slate-800 p-3">
            <span className="w-12 shrink-0 text-sm font-bold text-slate-400">{r.stage}단계</span>
            <span className="text-2xl font-black text-white">{r.word || "-"}</span>
            <span className="ml-auto text-sm text-slate-500">{r.score}점</span>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-900 p-4 text-white">
      <h1 className="mt-6 mb-4 text-2xl font-bold uppercase tracking-widest text-slate-400">단어게임</h1>
      <div className="flex w-full max-w-md flex-1 flex-col gap-4">
        {state.mode === "host" ? (
          // 진행자 진행 모드: 보기 전용
          <>
            <p className="rounded-lg bg-slate-800 p-2 text-center text-sm text-slate-400">진행자가 진행하는 모드입니다.</p>
            {(state.phase === "round" || state.phase === "roundEnd") && wordsBlock}
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
              <p className="mb-2 text-sm font-bold text-slate-400">점수</p>
              {state.players.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-0.5">
                  <span className="font-bold">{p.name}</span>
                  <span className="text-lg font-black text-yellow-400">{p.total}</span>
                </div>
              ))}
            </div>
          </>
        ) : !myPlayer ? (
          // 폰 모드: 팀 선택
          <div className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-800 p-5">
            <p className="font-bold text-slate-200">참가할 팀을 선택하세요</p>
            {state.players.length === 0 && <p className="text-sm text-slate-500">진행자가 팀을 만들면 선택할 수 있어요.</p>}
            <div className="flex flex-col gap-2">
              {state.players.map((p) => {
                const taken = !!p.claimedBy && p.claimedBy !== me;
                return (
                  <Button key={p.id} disabled={busy || taken} onClick={() => fetcher.submit({ intent: "claim-slot", anonId: me, playerId: p.id }, { method: "post" })}
                    className={taken ? "bg-slate-700 text-slate-500" : "bg-yellow-400 py-4 text-lg font-extrabold text-black hover:bg-yellow-500"}>
                    {p.name}{taken ? " (참가중)" : ""}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : (
          // 폰 모드: 내 팀
          <>
            <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800 p-4">
              <span className="font-bold text-white">{myPlayer.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-2xl font-black text-yellow-400">{myPlayer.total}</span>
                {myPlayer.status === "alive" ? <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-bold">생존</span>
                  : myPlayer.status === "stopped" ? <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold">Stop {myPlayer.stoppedStage}단계</span>
                  : <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold">Fail</span>}
              </span>
            </div>

            {state.phase === "lobby" && <div className="rounded-xl border border-slate-700 bg-slate-800 p-6 text-center text-slate-400">시작을 기다리는 중...</div>}

            {(state.phase === "round" || state.phase === "roundEnd") && (
              <>
                {wordsBlock}
                {canChoose && (
                  <div className="flex gap-2">
                    {state.stage < MAX_STAGE && <Button onClick={() => fetcher.submit({ intent: "choose", playerId: myPlayer.id, anonId: me, choice: "go" }, { method: "post" })} disabled={busy} className="flex-1 bg-green-600 py-6 text-xl font-extrabold hover:bg-green-700">Go</Button>}
                    <Button onClick={() => fetcher.submit({ intent: "choose", playerId: myPlayer.id, anonId: me, choice: "stop" }, { method: "post" })} disabled={busy} className="flex-1 bg-blue-600 py-6 text-xl font-extrabold hover:bg-blue-700">Stop</Button>
                    <Button onClick={() => fetcher.submit({ intent: "choose", playerId: myPlayer.id, anonId: me, choice: "fail" }, { method: "post" })} disabled={busy} className="flex-1 bg-red-600 py-6 text-xl font-extrabold hover:bg-red-700">Fail</Button>
                  </div>
                )}
                {state.stage >= 1 && myPlayer.lastActedStage === state.stage && (
                  <div className="flex flex-col items-center gap-2">
                    {myPlayer.status === "alive" && <p className="text-green-400">선택 완료 · 다음 단계 대기 중</p>}
                    <Button onClick={() => fetcher.submit({ intent: "cancel-choice", playerId: myPlayer.id, anonId: me }, { method: "post" })} disabled={busy} className="bg-slate-600 px-6 py-2 font-bold hover:bg-slate-500">선택 취소</Button>
                  </div>
                )}
                {state.phase === "roundEnd" && <p className="text-center text-slate-400">라운드 종료 · 다음 라운드 대기</p>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
