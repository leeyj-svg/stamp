import { type LoaderFunctionArgs, Link, useLoaderData, useRevalidator } from "react-router";
import { useEffect } from "react";
import { Play, Settings } from "lucide-react";
import { db } from "~/lib/db.server";
import {
  CODENAME_SESSION_ID,
  gridColumns,
  initialCodenameState,
  parseCodenameState,
  teamColorsFor,
  teamRemaining,
  toCodenameJson,
} from "~/lib/codename-session";
import {
  COLOR_LABEL,
  KEY_COLOR_CLASS,
  TEAM_DOT_CLASS,
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

export default function CodenameKeyPage() {
  const { state } = useLoaderData<typeof loader>();
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

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-950 p-3 pb-24 text-white">
      <div className="mt-4 flex items-center gap-2 rounded-full bg-red-600/20 px-4 py-1.5 text-sm font-bold text-red-300 ring-1 ring-red-600/50">
        정답판 · 스파이마스터 전용
      </div>

      {/* 점수판 */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {teams.map((team) => (
          <div key={team} className="flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1.5">
            <span className={`h-3 w-3 rounded-full ${TEAM_DOT_CLASS[team]}`} />
            <span className={`text-sm font-bold ${TEAM_TEXT_CLASS[team]}`}>{COLOR_LABEL[team]}</span>
            <span className="text-lg font-extrabold text-white">{teamRemaining(state, team)}</span>
          </div>
        ))}
      </div>

      {/* 전체 색 배치 */}
      <div
        className="mt-4 grid w-full max-w-7xl gap-3 px-1 md:gap-4"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {state.cards.map((card) => (
          <div
            key={card.position}
            className={[
              "flex aspect-[5/4] items-center justify-center rounded-xl border-b-4 p-3 text-center font-extrabold",
              KEY_COLOR_CLASS[card.color],
              card.revealed ? "line-through decoration-2" : "",
            ].join(" ")}
          >
            <span className="text-2xl leading-tight break-keep md:text-4xl">{card.word}</span>
          </div>
        ))}
      </div>

      {/* 하단 링크 */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-3 border-t border-slate-800 bg-slate-950/95 p-4 backdrop-blur-md">
        <Link
          to="/game/codename/play"
          className="flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-5 py-4 font-bold text-slate-200 hover:bg-slate-700"
        >
          <Play className="h-5 w-5" /> 게임판
        </Link>
        <Link
          to="/game/codename/host"
          className="flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-5 py-4 font-bold text-slate-200 hover:bg-slate-700"
        >
          <Settings className="h-5 w-5" /> 설정
        </Link>
      </div>
    </div>
  );
}
