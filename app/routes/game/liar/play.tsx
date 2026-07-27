import { type ActionFunctionArgs, type LoaderFunctionArgs, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import * as z from "zod";
import { Skull, UserPlus, Vote } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { db } from "~/lib/db.server";
import {
  LIAR_SESSION_ID,
  castVote,
  initialLiarState,
  joinPlayer,
  parseLiarState,
  toLiarJson,
  toPlayView,
} from "~/lib/liar-session";

const POLLING_INTERVAL = 3000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const me = new URL(request.url).searchParams.get("me");

  let session = await db.gameSession.findUnique({
    where: { id: LIAR_SESSION_ID },
    select: { gameState: true },
  });
  if (!session) {
    session = await db.gameSession.create({
      data: { id: LIAR_SESSION_ID, gameState: toLiarJson(initialLiarState), isRevealed: false },
      select: { gameState: true },
    });
  }

  return { view: toPlayView(parseLiarState(session.gameState), me) };
};

const actionSchema = z.object({
  intent: z.enum(["join", "vote"]),
  anonId: z.string().min(1),
  name: z.string().optional(),
  targetAnonId: z.string().optional(),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const result = actionSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return { error: "잘못된 요청입니다." };

  const session = await db.gameSession.findUnique({
    where: { id: LIAR_SESSION_ID },
    select: { gameState: true },
  });
  if (!session) return { error: "세션을 찾을 수 없습니다." };

  const state = parseLiarState(session.gameState);
  let next = state;

  if (result.data.intent === "join") {
    next = joinPlayer(state, result.data.anonId, result.data.name ?? "");
  } else if (result.data.intent === "vote" && result.data.targetAnonId) {
    next = castVote(state, result.data.anonId, result.data.targetAnonId);
  }

  await db.gameSession.update({
    where: { id: LIAR_SESSION_ID },
    data: { gameState: toLiarJson(next) },
  });
  return { success: true };
};

export default function LiarPlayPage() {
  const { view } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const [name, setName] = useState("");
  const me = searchParams.get("me");

  // 기기별 anonId 확보 (URL ?me= 에 고정)
  useEffect(() => {
    if (me) return;
    let id = localStorage.getItem("liar_anon");
    if (!id) {
      id = `anon-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
      localStorage.setItem("liar_anon", id);
    }
    setSearchParams(
      (prev) => {
        prev.set("me", id as string);
        return prev;
      },
      { replace: true },
    );
  }, [me, setSearchParams]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, POLLING_INTERVAL);
    return () => window.clearInterval(interval);
  }, [revalidator]);

  const busy = fetcher.state !== "idle";

  if (!me) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-400">불러오는 중...</div>;
  }

  const you = view.you;

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-900 p-4 text-white">
      <h1 className="mt-8 mb-6 text-2xl font-bold uppercase tracking-widest text-slate-400">라이어 게임</h1>

      <div className="flex w-full max-w-md flex-1 flex-col gap-4">
        {/* 참가 전 */}
        {!you.joined && view.phase === "lobby" && (
          <div className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-800 p-5">
            <p className="font-bold text-slate-200">이름을 입력하고 참가하세요</p>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={12}
              placeholder="닉네임"
              className="bg-slate-700 text-white"
            />
            <Button
              onClick={() => fetcher.submit({ intent: "join", anonId: me, name }, { method: "post" })}
              disabled={busy || name.trim().length === 0}
              className="bg-yellow-400 py-5 text-lg font-extrabold text-black hover:bg-yellow-500 disabled:opacity-40"
            >
              <UserPlus className="mr-2 h-5 w-5" /> 참가하기
            </Button>
          </div>
        )}

        {!you.joined && view.phase !== "lobby" && (
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-6 text-center text-slate-400">
            이미 라운드가 시작됐어요. 다음 라운드를 기다려주세요.
          </div>
        )}

        {/* 대기 중 */}
        {you.joined && view.phase === "lobby" && (
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-6 text-center">
            <p className="text-lg font-bold text-white">{you.name}님, 참가 완료!</p>
            <p className="mt-2 text-slate-400">시작을 기다리는 중... ({view.playerCount}명)</p>
          </div>
        )}

        {/* 카드 확인 */}
        {you.joined && (view.phase === "reveal" || view.phase === "voting") && (
          <div className="flex flex-col items-center gap-3">
            {you.role === "liar" ? (
              <div className="flex w-full flex-col items-center gap-3 rounded-2xl border-b-8 border-red-800 bg-red-600 p-8 text-center shadow-2xl">
                <Skull className="h-14 w-14" />
                <p className="text-3xl font-black">당신은 라이어!</p>
                <p className="text-red-100">제시어를 모릅니다. 들키지 마세요.</p>
                <p className="mt-1 text-sm text-red-200">카테고리: {view.category}</p>
              </div>
            ) : (
              <div className="flex w-full flex-col items-center gap-2 rounded-2xl border-b-8 border-slate-600 bg-slate-100 p-8 text-center text-slate-900 shadow-2xl">
                <p className="text-sm font-bold text-slate-500">카테고리: {view.category}</p>
                <p className="text-4xl font-black">{you.word}</p>
              </div>
            )}
          </div>
        )}

        {/* 투표 */}
        {you.joined && view.phase === "voting" && view.appVoting && (
          <div className="flex flex-col gap-2 rounded-xl border border-slate-700 bg-slate-800 p-4">
            <p className="flex items-center gap-2 font-bold text-slate-200">
              <Vote className="h-5 w-5" /> 라이어로 의심되는 사람은?
            </p>
            {you.votedFor ? (
              <p className="py-2 text-center text-green-400">투표 완료 ✓</p>
            ) : (
              view.players
                .filter((p) => p.anonId !== me)
                .map((p) => (
                  <Button
                    key={p.anonId}
                    onClick={() => fetcher.submit({ intent: "vote", anonId: me, targetAnonId: p.anonId }, { method: "post" })}
                    disabled={busy}
                    className="justify-start bg-slate-700 py-4 text-base font-bold hover:bg-slate-600"
                  >
                    {p.name}
                  </Button>
                ))
            )}
          </div>
        )}

        {/* 결과 */}
        {view.phase === "result" && view.result && (
          <div className="flex flex-col gap-3 rounded-xl border border-red-700 bg-slate-800 p-6 text-center">
            {you.joined && (
              <p className={`text-lg font-extrabold ${you.role === "liar" ? "text-red-400" : "text-green-400"}`}>
                {you.role === "liar" ? "당신은 라이어였습니다 🤥" : "당신은 시민이었습니다"}
              </p>
            )}
            <p className="mt-1 text-slate-400">제시어</p>
            <p className="text-3xl font-black text-white">{view.result.word}</p>
            {view.result.fakeWord && (
              <p className="text-sm text-slate-400">가짜 단어: {view.result.fakeWord}</p>
            )}
            <p className="mt-2 text-slate-400">라이어</p>
            <p className="text-2xl font-extrabold text-red-400">{view.result.liarNames.join(", ") || "-"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
