import { type ActionFunctionArgs, type LoaderFunctionArgs, Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import * as z from "zod";
import { Button } from "~/components/ui/button";
import { ClickableQr } from "~/components/game/clickable-qr";
import { db } from "~/lib/db.server";
import {
  createGameTeam,
  initialGameState,
  parseGameState,
  toGameStateJson,
} from "~/lib/game-session";
import { CheckCircle2, Eye, HelpCircle, LayoutGrid, Minus, Plus, RotateCcw } from "lucide-react";

const GAME_SESSION_ID = 1;
const POLLING_INTERVAL = 5000;

export const loader = async (_args: LoaderFunctionArgs) => {
  let session = await db.gameSession.findUnique({
    where: { id: GAME_SESSION_ID },
    select: { isRevealed: true, gameState: true },
  });

  if (!session) {
    session = await db.gameSession.create({
      data: {
        id: GAME_SESSION_ID,
        gameState: toGameStateJson(initialGameState),
        isRevealed: false,
      },
      select: { isRevealed: true, gameState: true },
    });
  }

  const gameState = parseGameState(session.gameState);

  return {
    isRevealed: session.isRevealed,
    teams: gameState.teams,
  };
};

const actionSchema = z.object({
  action: z.enum(["reset", "toggle-reveal", "add-team", "remove-team"]),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const result = actionSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: "잘못된 요청입니다." };
  }

  const { action } = result.data;

  if (action === "reset") {
    await db.gameSession.upsert({
      where: { id: GAME_SESSION_ID },
      create: {
        id: GAME_SESSION_ID,
        gameState: toGameStateJson(initialGameState),
        isRevealed: false,
      },
      update: {
        gameState: toGameStateJson(initialGameState),
        isRevealed: false,
      },
    });
    return { success: true };
  }

  if (action === "toggle-reveal") {
    const session = await db.gameSession.findUnique({
      where: { id: GAME_SESSION_ID },
      select: { isRevealed: true },
    });

    if (session) {
      await db.gameSession.update({
        where: { id: GAME_SESSION_ID },
        data: { isRevealed: !session.isRevealed },
      });
    }

    return { success: true };
  }

  const session = await db.gameSession.findUnique({
    where: { id: GAME_SESSION_ID },
    select: { gameState: true },
  });

  if (!session) {
    return { error: "게임 세션을 찾을 수 없습니다." };
  }

  const gameState = parseGameState(session.gameState);

  if (action === "add-team") {
    const nextTeamId = gameState.teams.length + 1;
    gameState.teams.push(createGameTeam(nextTeamId));

    await db.gameSession.update({
      where: { id: GAME_SESSION_ID },
      data: { gameState: toGameStateJson(gameState) },
    });

    return { success: true };
  }

  if (action === "remove-team" && gameState.teams.length > 1) {
    gameState.teams.pop();

    await db.gameSession.update({
      where: { id: GAME_SESSION_ID },
      data: { gameState: toGameStateJson(gameState) },
    });
  }

  return { success: true };
};

type SecretCardProps = {
  char: string;
  label: string;
  color: string;
  iconColor: string;
  isRevealed: boolean;
  isClaimed: boolean;
  claimerName: string | null;
};

function SecretCard({ char, label, color, iconColor, isRevealed, isClaimed, claimerName }: SecretCardProps) {
  const hasInput = char.length > 0;

  return (
    <div className="flex flex-1 min-w-0 flex-col items-center gap-2">
      <div
        className={[
          "w-full aspect-[2/3] rounded-xl bg-slate-700 border-b-8 shadow-2xl transition-all duration-300",
          "flex flex-col items-center justify-center",
          hasInput ? color : "border-slate-600",
        ].join(" ")}
      >
        {isRevealed ? (
          <span className="text-5xl font-black leading-none text-white md:text-7xl animate-in zoom-in duration-500">
            {char || "?"}
          </span>
        ) : hasInput ? (
          <CheckCircle2 className={`h-10 w-10 animate-pulse md:h-16 md:w-16 ${iconColor}`} />
        ) : isClaimed ? (
          <span className="text-2xl font-medium text-slate-400 md:text-2xl">{claimerName ?? "..."}</span>
        ) : (
          <HelpCircle className="h-8 w-8 text-slate-600 opacity-20 md:h-12 md:w-12" />
        )}
      </div>
      <span className={`text-base font-bold text-center whitespace-nowrap ${hasInput ? "text-white" : "text-slate-500"}`}>
        {label}
      </span>
    </div>
  );
}

export default function GameHostPage() {
  const { isRevealed, teams } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        revalidator.revalidate();
      }
    }, POLLING_INTERVAL);

    return () => window.clearInterval(interval);
  }, [revalidator]);

  const playUrl = `${origin}/game/telepathy/play`;
  const isSubmitting = fetcher.state !== "idle";

  let gridClass = "grid w-full max-w-7xl gap-8 px-4 ";
  if (teams.length === 1) {
    gridClass += "grid-cols-1 max-w-2xl";
  } else if (teams.length <= 4) {
    gridClass += "grid-cols-1 md:grid-cols-2";
  } else {
    gridClass += "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-start bg-slate-900 p-4 pb-40 text-white">
      <Link
        to="/game"
        className="absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700"
      >
        <LayoutGrid className="h-4 w-4" /> 게임 목록
      </Link>

      <div className="absolute right-4 top-4 z-10">
        {origin && <ClickableQr value={playUrl} label="참가자 접속" size={140} />}
      </div>

      <h1 className="mt-16 mb-8 text-3xl font-bold uppercase tracking-widest text-slate-400 md:mt-10">텔레파시 팀 배틀</h1>

      <div
        className={[
          "mb-8 w-full max-w-xl rounded-lg p-3 text-center text-lg font-bold shadow-lg",
          isRevealed ? "bg-red-600 text-white shadow-red-800/50" : "bg-blue-600 text-white shadow-blue-800/50",
        ].join(" ")}
      >
        현재 상태: {isRevealed ? "글자 공개됨" : "글자 비공개 상태"}
      </div>

      <div className={gridClass}>
        {teams.map((team, index) => {
          const colors = [
            { border: "border-red-500", text: "text-red-500", title: "text-red-500" },
            { border: "border-blue-500", text: "text-blue-500", title: "text-blue-500" },
            { border: "border-green-500", text: "text-green-500", title: "text-green-500" },
            { border: "border-yellow-500", text: "text-yellow-500", title: "text-yellow-500" },
            { border: "border-purple-500", text: "text-purple-500", title: "text-purple-500" },
          ];
          const theme = colors[index % colors.length];

          return (
            <div key={team.id} className="flex flex-col items-center rounded-xl border-b-4 border-slate-700 bg-slate-800 p-4 shadow-2xl">
              <h2 className={`mb-4 text-2xl font-extrabold ${theme.title}`}>{team.name}</h2>
              <div className="flex w-full justify-center gap-3">
                {team.entries.map((entry) => (
                  <SecretCard
                    key={entry.position}
                    char={entry.char}
                    label={`${entry.position}번`}
                    color={theme.border}
                    iconColor={theme.text}
                    isRevealed={isRevealed}
                    isClaimed={Boolean(entry.claimerId)}
                    claimerName={entry.claimerName}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-4 border-t border-slate-700 bg-slate-900/95 p-4 backdrop-blur-md">
        <div className="flex w-full max-w-lg gap-4">
          <Button
            onClick={() => fetcher.submit({ action: "add-team" }, { method: "post" })}
            disabled={isSubmitting}
            className="flex-1 border border-slate-600 bg-slate-800 py-6 text-lg font-bold text-slate-300 hover:bg-slate-700"
          >
            <Plus className="mr-2 h-5 w-5" /> 팀 추가
          </Button>
          <Button
            onClick={() => {
              if (teams.length > 1 && confirm(`마지막 팀(${teams.length}팀)을 삭제하시겠습니까?`)) {
                fetcher.submit({ action: "remove-team" }, { method: "post" });
              }
            }}
            disabled={isSubmitting || teams.length <= 1}
            className="flex-1 border border-slate-600 bg-slate-800 py-6 text-lg font-bold text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-30"
          >
            <Minus className="mr-2 h-5 w-5" /> 팀 삭제
          </Button>
        </div>

        <div className="flex w-full max-w-lg gap-4">
          <Button
            onClick={() => fetcher.submit({ action: "toggle-reveal" }, { method: "post" })}
            size="lg"
            variant={isRevealed ? "secondary" : undefined}
            className={isRevealed ? "flex-1 py-8 text-xl" : "flex-1 bg-yellow-400 py-8 text-2xl font-extrabold text-black shadow-[0_0_20px_rgba(250,204,21,0.5)] hover:bg-yellow-500"}
          >
            <Eye className="mr-3 h-8 w-8" /> {isRevealed ? "다시 가리기" : "정답 공개"}
          </Button>
          <Button
            onClick={() => {
              if (confirm("정말 초기화하시겠습니까? 팀은 1개로 돌아가고 모든 입력이 사라집니다.")) {
                fetcher.submit({ action: "reset" }, { method: "post" });
              }
            }}
            size="lg"
            variant="destructive"
            className="px-8 py-8 text-xl shadow-md"
          >
            <RotateCcw className="mr-2 h-6 w-6" /> 초기화
          </Button>
        </div>
      </div>
    </div>
  );
}

