import { type ActionFunctionArgs, type LoaderFunctionArgs, Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import * as z from "zod";
import { Eye, LayoutGrid, Minus, Play, Plus, RotateCcw, Users, Vote } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ClickableQr } from "~/components/game/clickable-qr";
import { db } from "~/lib/db.server";
import { CATEGORY_NAMES } from "~/lib/liar-words";
import { DIFFICULTY_LABEL, DIFFICULTY_OPTIONS } from "~/lib/game-difficulty";
import {
  LIAR_LIMITS,
  LIAR_SESSION_ID,
  initialLiarState,
  newRound,
  openVote,
  parseLiarState,
  resetGame,
  setConfig,
  showResult,
  startRound,
  toHostView,
  toLiarJson,
} from "~/lib/liar-session";

const POLLING_INTERVAL = 3000;

export const loader = async (_args: LoaderFunctionArgs) => {
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
  return { view: toHostView(parseLiarState(session.gameState)) };
};

const actionSchema = z.object({
  intent: z.enum(["set-config", "start-round", "open-vote", "show-result", "new-round", "reset"]),
  category: z.string().optional(),
  difficulty: z.enum(["all", "easy", "normal", "hard"]).optional(),
  liarCount: z.coerce.number().optional(),
  liarMode: z.enum(["none", "fake"]).optional(),
  appVoting: z.enum(["true", "false"]).optional(),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const result = actionSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) return { error: "잘못된 요청입니다." };

  const { intent } = result.data;

  if (intent === "reset") {
    await db.gameSession.upsert({
      where: { id: LIAR_SESSION_ID },
      create: { id: LIAR_SESSION_ID, gameState: toLiarJson(resetGame()), isRevealed: false },
      update: { gameState: toLiarJson(resetGame()) },
    });
    return { success: true };
  }

  const session = await db.gameSession.findUnique({
    where: { id: LIAR_SESSION_ID },
    select: { gameState: true },
  });
  if (!session) return { error: "세션을 찾을 수 없습니다." };

  const state = parseLiarState(session.gameState);
  let next = state;

  if (intent === "set-config") {
    next = setConfig(state, {
      category: result.data.category,
      difficulty: result.data.difficulty,
      liarCount: result.data.liarCount,
      liarMode: result.data.liarMode,
      appVoting: result.data.appVoting ? result.data.appVoting === "true" : undefined,
    });
  } else if (intent === "start-round") {
    next = startRound(state);
  } else if (intent === "open-vote") {
    next = openVote(state);
  } else if (intent === "show-result") {
    next = showResult(state);
  } else if (intent === "new-round") {
    next = newRound(state);
  }

  await db.gameSession.update({
    where: { id: LIAR_SESSION_ID },
    data: { gameState: toLiarJson(next) },
  });
  return { success: true };
};

export default function LiarHostPage() {
  const { view } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, POLLING_INTERVAL);
    return () => window.clearInterval(interval);
  }, [revalidator]);

  const playUrl = `${origin}/game/liar/play`;
  const busy = fetcher.state !== "idle";
  const submit = (data: Record<string, string>) => fetcher.submit(data, { method: "post" });

  return (
    <div className="relative flex min-h-screen flex-col items-center bg-slate-900 p-4 pb-16 text-white">
      <Link
        to="/game"
        className="absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700"
      >
        <LayoutGrid className="h-4 w-4" /> 게임 목록
      </Link>

      <h1 className="mt-16 mb-1 text-3xl font-bold uppercase tracking-widest text-slate-300 md:mt-8">라이어 게임</h1>
      <p className="mb-6 text-sm text-slate-500">진행자 화면</p>

      <div className="flex w-full max-w-lg flex-col gap-4">
        {/* 참가자 */}
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-300">
            <Users className="h-5 w-5" /> 참가자 <span className="font-extrabold text-white">{view.players.length}</span>명
          </div>
          {view.players.length === 0 ? (
            <p className="text-sm text-slate-500">QR로 접속해 참가하세요.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {view.players.map((p) => (
                <span
                  key={p.anonId}
                  className={[
                    "rounded-full px-3 py-1 text-sm font-bold",
                    p.hasVoted ? "bg-green-600 text-white" : "bg-slate-700 text-slate-200",
                  ].join(" ")}
                >
                  {p.name}{view.phase === "voting" && p.hasVoted ? " ✓" : ""}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 설정 (로비에서만) */}
        {view.phase === "lobby" && (
          <div className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-800 p-4">
            <label className="flex items-center justify-between">
              <span className="font-bold text-slate-200">카테고리</span>
              <select
                value={view.category}
                onChange={(e) => submit({ intent: "set-config", category: e.target.value })}
                className="rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              >
                <option value="">랜덤</option>
                {CATEGORY_NAMES.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>

            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">난이도</span>
              <div className="flex gap-1.5">
                {DIFFICULTY_OPTIONS.map((option) => (
                  <Button
                    key={option}
                    onClick={() => submit({ intent: "set-config", difficulty: option })}
                    disabled={busy}
                    className={
                      view.difficulty === option
                        ? "bg-yellow-400 px-3 font-bold text-black"
                        : "bg-slate-700 px-3 text-slate-300 hover:bg-slate-600"
                    }
                  >
                    {DIFFICULTY_LABEL[option]}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">라이어 수</span>
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => submit({ intent: "set-config", liarCount: String(Math.max(LIAR_LIMITS.liar.min, view.liarCount - 1)) })}
                  disabled={busy || view.liarCount <= LIAR_LIMITS.liar.min}
                  className="h-9 w-9 rounded-full bg-slate-700 p-0"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-8 text-center text-xl font-extrabold">{view.liarCount}</span>
                <Button
                  onClick={() => submit({ intent: "set-config", liarCount: String(Math.min(LIAR_LIMITS.liar.max, view.liarCount + 1)) })}
                  disabled={busy || view.liarCount >= LIAR_LIMITS.liar.max}
                  className="h-9 w-9 rounded-full bg-slate-700 p-0"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">라이어 방식</span>
              <div className="flex gap-2">
                <Button
                  onClick={() => submit({ intent: "set-config", liarMode: "none" })}
                  className={view.liarMode === "none" ? "bg-yellow-400 text-black" : "bg-slate-700 text-slate-300"}
                >
                  제시어 모름
                </Button>
                <Button
                  onClick={() => submit({ intent: "set-config", liarMode: "fake" })}
                  className={view.liarMode === "fake" ? "bg-yellow-400 text-black" : "bg-slate-700 text-slate-300"}
                >
                  가짜 단어
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">앱에서 투표</span>
              <Button
                onClick={() => submit({ intent: "set-config", appVoting: view.appVoting ? "false" : "true" })}
                className={view.appVoting ? "bg-green-600 text-white" : "bg-slate-700 text-slate-300"}
              >
                {view.appVoting ? "켜짐" : "꺼짐"}
              </Button>
            </div>

            <Button
              onClick={() => submit({ intent: "start-round" })}
              disabled={busy || !view.canStart}
              className="mt-2 bg-yellow-400 py-6 text-xl font-extrabold text-black hover:bg-yellow-500 disabled:opacity-40"
            >
              <Play className="mr-2 h-6 w-6" /> 라운드 시작
            </Button>
            {!view.canStart && (
              <p className="text-center text-xs text-slate-500">
                최소 {view.minPlayers}명 &amp; 라이어 수보다 많은 인원이 필요합니다.
              </p>
            )}
          </div>
        )}

        {/* 진행 중 컨트롤 */}
        {(view.phase === "reveal" || view.phase === "voting") && (
          <div className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-800 p-4">
            <p className="text-center text-slate-300">
              {view.phase === "reveal" ? "각자 폰에서 카드를 확인하세요." : "투표 진행 중..."}
            </p>
            {view.phase === "reveal" && view.appVoting && (
              <Button onClick={() => submit({ intent: "open-vote" })} disabled={busy} className="bg-blue-600 py-5 text-lg font-bold hover:bg-blue-700">
                <Vote className="mr-2 h-5 w-5" /> 투표 시작
              </Button>
            )}
            <Button onClick={() => submit({ intent: "show-result" })} disabled={busy} className="bg-yellow-400 py-5 text-lg font-extrabold text-black hover:bg-yellow-500">
              <Eye className="mr-2 h-5 w-5" /> 정답 공개
            </Button>
          </div>
        )}

        {/* 결과 */}
        {view.phase === "result" && view.result && (
          <div className="flex flex-col gap-3 rounded-xl border border-red-700 bg-slate-800 p-5 text-center">
            <p className="text-slate-400">제시어</p>
            <p className="text-3xl font-black text-white">{view.result.word}</p>
            {view.result.fakeWord && (
              <p className="text-sm text-slate-400">가짜 단어: <span className="font-bold text-slate-200">{view.result.fakeWord}</span></p>
            )}
            <p className="mt-2 text-slate-400">라이어</p>
            <p className="text-2xl font-extrabold text-red-400">{view.result.liarNames.join(", ") || "-"}</p>
            {Object.keys(view.result.tally).length > 0 && (
              <div className="mt-2 text-sm text-slate-400">
                득표: {view.players.map((p) => `${p.name} ${view.result?.tally[p.anonId] ?? 0}`).join(" · ")}
              </div>
            )}
            <div className="mt-3 flex gap-3">
              <Button onClick={() => submit({ intent: "new-round" })} disabled={busy} className="flex-1 bg-yellow-400 py-5 font-extrabold text-black hover:bg-yellow-500">
                <RotateCcw className="mr-2 h-5 w-5" /> 새 라운드
              </Button>
              <Button onClick={() => submit({ intent: "reset" })} disabled={busy} variant="destructive" className="py-5">
                초기화
              </Button>
            </div>
          </div>
        )}

        {/* QR */}
        {origin && view.phase === "lobby" && (
          <div className="mt-2 flex justify-center">
            <ClickableQr value={playUrl} label="참가자 접속" size={160} />
          </div>
        )}
      </div>
    </div>
  );
}
