import { type ActionFunctionArgs, type LoaderFunctionArgs, Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect } from "react";
import * as z from "zod";
import { Settings, Skull, SkipForward, Trophy } from "lucide-react";
import { Button } from "~/components/ui/button";
import { db } from "~/lib/db.server";
import {
  CODENAME_SESSION_ID,
  endTurn,
  gridColumns,
  initialCodenameState,
  parseCodenameState,
  revealCard,
  teamColorsFor,
  teamRemaining,
  toCodenameJson,
} from "~/lib/codename-session";
import {
  CARD_REVEALED_CLASS,
  COLOR_LABEL,
  TEAM_DOT_CLASS,
  TEAM_RING_CLASS,
  TEAM_TEXT_CLASS,
} from "~/lib/codename-ui";

const POLLING_INTERVAL = 3000;

export const loader = async (_args: LoaderFunctionArgs) => {
  let session = await db.gameSession.findUnique({
    where: { id: CODENAME_SESSION_ID },
    select: { gameState: true },
  });

  if (!session) {
    session = await db.gameSession.create({
      data: {
        id: CODENAME_SESSION_ID,
        gameState: toCodenameJson(initialCodenameState),
        isRevealed: false,
      },
      select: { gameState: true },
    });
  }

  return { state: parseCodenameState(session.gameState) };
};

const actionSchema = z.object({
  intent: z.enum(["reveal", "end-turn"]),
  position: z.coerce.number().optional(),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const result = actionSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: "잘못된 요청입니다." };
  }

  const session = await db.gameSession.findUnique({
    where: { id: CODENAME_SESSION_ID },
    select: { gameState: true },
  });

  if (!session) {
    return { error: "게임 세션을 찾을 수 없습니다." };
  }

  const state = parseCodenameState(session.gameState);

  let nextState = state;
  if (result.data.intent === "reveal" && result.data.position != null) {
    nextState = revealCard(state, result.data.position);
  } else if (result.data.intent === "end-turn") {
    nextState = endTurn(state);
  }

  await db.gameSession.update({
    where: { id: CODENAME_SESSION_ID },
    data: { gameState: toCodenameJson(nextState) },
  });

  return { success: true };
};

export default function CodenamePlayPage() {
  const { state } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        revalidator.revalidate();
      }
    }, POLLING_INTERVAL);
    return () => window.clearInterval(interval);
  }, [revalidator]);

  const teams = teamColorsFor(state.teamCount);
  const cols = gridColumns(state.cards.length);
  const playable = state.status === "playing";

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-900 p-3 pb-24 text-white">
      {/* 점수판 */}
      <div className="mt-4 flex w-full max-w-4xl flex-wrap items-center justify-center gap-2">
        {teams.map((team) => {
          const remaining = teamRemaining(state, team);
          const isTurn = playable && state.currentTeam === team;
          return (
            <div
              key={team}
              className={[
                "flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1.5 transition",
                isTurn ? `ring-2 ${TEAM_RING_CLASS[team]}` : "bg-slate-800",
              ].join(" ")}
            >
              <span className={`h-3 w-3 rounded-full ${TEAM_DOT_CLASS[team]}`} />
              <span className={`text-sm font-bold ${TEAM_TEXT_CLASS[team]}`}>{COLOR_LABEL[team]}</span>
              <span className="text-lg font-extrabold text-white">{remaining}</span>
            </div>
          );
        })}
      </div>

      {/* 상태 배너 */}
      {state.status === "won" && state.winner && (
        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-yellow-400 px-8 py-5 text-3xl font-black text-black shadow-2xl animate-in zoom-in duration-500 md:px-12 md:py-6 md:text-5xl">
          <Trophy className="h-10 w-10 md:h-14 md:w-14" /> {COLOR_LABEL[state.winner]}팀 승리!
        </div>
      )}
      {state.status === "over" && (
        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-black px-8 py-5 text-2xl font-black text-white ring-4 ring-red-600 shadow-2xl animate-in zoom-in duration-500 md:px-12 md:py-6 md:text-4xl">
          <Skull className="h-10 w-10 md:h-14 md:w-14" /> 블랙요원 적중! 게임 오버
        </div>
      )}
      {playable && (
        <p className="mt-3 text-sm text-slate-400">
          현재 턴: <span className={`font-bold ${TEAM_TEXT_CLASS[state.currentTeam]}`}>{COLOR_LABEL[state.currentTeam]}팀</span>
        </p>
      )}

      {/* 카드 격자 */}
      <div
        className="mt-4 grid w-full max-w-6xl gap-2.5 px-1 md:gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {state.cards.map((card) => {
          if (card.revealed) {
            return (
              <div
                key={card.position}
                className={[
                  "flex aspect-[4/3] items-center justify-center rounded-xl border-b-4 p-2 text-center",
                  CARD_REVEALED_CLASS[card.color],
                ].join(" ")}
              >
                {card.color === "black" ? (
                  <Skull className="h-9 w-9 md:h-12 md:w-12" />
                ) : (
                  <span className="text-xl font-extrabold leading-tight break-keep md:text-3xl">{card.word}</span>
                )}
              </div>
            );
          }

          return (
            <button
              key={card.position}
              type="button"
              disabled={!playable || fetcher.state !== "idle"}
              onClick={() => fetcher.submit({ intent: "reveal", position: card.position }, { method: "post" })}
              className="flex aspect-[4/3] items-center justify-center rounded-xl border border-slate-600 bg-slate-200 p-2 text-center text-slate-900 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="text-xl font-extrabold leading-tight break-keep md:text-3xl">{card.word}</span>
            </button>
          );
        })}
      </div>

      {/* 하단 컨트롤 */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-3 border-t border-slate-700 bg-slate-900/95 p-4 backdrop-blur-md">
        <Button
          onClick={() => fetcher.submit({ intent: "end-turn" }, { method: "post" })}
          disabled={!playable || fetcher.state !== "idle"}
          className="flex-1 max-w-xs border border-slate-600 bg-slate-800 py-6 text-lg font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
        >
          <SkipForward className="mr-2 h-5 w-5" /> 턴 종료
        </Button>
        <Link
          to="/game/codename/host"
          className="flex items-center justify-center gap-2 rounded-md border border-slate-600 bg-slate-800 px-5 py-6 text-lg font-bold text-slate-200 hover:bg-slate-700"
        >
          <Settings className="h-5 w-5" /> 설정
        </Link>
      </div>
    </div>
  );
}
