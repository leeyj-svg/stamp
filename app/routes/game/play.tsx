import { useEffect, useState, type FormEvent } from "react";
import { type ActionFunctionArgs, type LoaderFunctionArgs, useFetcher, useLoaderData, useRevalidator } from "react-router";
import * as z from "zod";
import { ArrowLeft, Edit, Save, Users } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { db } from "~/lib/db.server";
import {
  cloneGameState,
  initialGameState,
  parseGameState,
  toGameStateJson,
  type GameEntry,
  type GameState,
  type GameTeam,
} from "~/lib/game-session";

const GAME_SESSION_ID = 1;
const POLLING_INTERVAL = 3000;

const actionSchema = z.object({
  intent: z.enum(["occupy", "input", "release"]),
  anonId: z.string().min(1),
  claimerName: z.string().optional(),
  teamId: z.coerce.number().optional(),
  position: z.coerce.number().optional(),
  char: z.string().max(1).optional(),
  sessionId: z.coerce.number(),
});

const generateAnonId = () => {
  if (typeof window === "undefined") {
    return "";
  }

  return `anon-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
};

function findTeam(teams: GameTeam[], teamId: number | null | undefined) {
  return teamId == null ? undefined : teams.find((team) => team.id === teamId);
}

function findEntry(teams: GameTeam[], teamId: number | null | undefined, position: number | null | undefined) {
  if (teamId == null || position == null) {
    return undefined;
  }

  return findTeam(teams, teamId)?.entries.find((entry) => entry.position === position);
}

export const loader = async (_args: LoaderFunctionArgs) => {
  let session = await db.gameSession.findUnique({ where: { id: GAME_SESSION_ID } });

  if (!session) {
    session = await db.gameSession.create({
      data: {
        id: GAME_SESSION_ID,
        gameState: toGameStateJson(initialGameState),
        isRevealed: false,
      },
    });
  }

  return {
    sessionId: session.id,
    isRevealed: session.isRevealed,
    gameState: parseGameState(session.gameState),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  formData.set("sessionId", String(GAME_SESSION_ID));
  const result = actionSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: "잘못된 요청 데이터입니다." };
  }

  const { intent, teamId, position, char, anonId, claimerName } = result.data;
  const finalClaimerName = claimerName?.trim() || "익명";

  if (teamId == null || position == null) {
    return { error: "팀과 자리를 선택해 주세요." };
  }

  try {
    return await db.$transaction(async (prisma) => {
      const session = await prisma.gameSession.findUnique({
        where: { id: GAME_SESSION_ID },
        select: { gameState: true },
      });

      if (!session) {
        throw new Error("Game session not found.");
      }

      const currentGameState = parseGameState(session.gameState);
      const updatedGameState = cloneGameState(currentGameState);
      const team = findTeam(updatedGameState.teams, teamId);
      const entry = findEntry(updatedGameState.teams, teamId, position);

      if (!team || !entry) {
        throw new Error("유효하지 않은 팀 또는 자리입니다.");
      }

      let responseMessage = "";
      let shouldPersist = false;

      if (intent === "occupy") {
        if (entry.claimerId && entry.claimerId !== anonId) {
          return { success: false, message: "이미 다른 사용자가 선택했습니다." };
        }

        entry.claimerId = anonId;
        entry.claimerName = finalClaimerName;
        responseMessage = "자리를 선택했습니다.";
        shouldPersist = true;
      }

      if (intent === "input") {
        if (entry.claimerId !== anonId) {
          return { success: false, message: "자리 선점 권한이 없습니다." };
        }

        entry.char = char ?? "";
        responseMessage = "글자를 저장했습니다.";
        shouldPersist = true;
      }

      if (intent === "release") {
        if (entry.claimerId !== anonId) {
          return { success: false, message: "자리 해제 권한이 없습니다." };
        }

        entry.claimerId = null;
        entry.claimerName = null;
        entry.char = "";
        responseMessage = "자리를 해제했습니다.";
        shouldPersist = true;
      }

      if (shouldPersist) {
        await prisma.gameSession.update({
          where: { id: GAME_SESSION_ID },
          data: { gameState: toGameStateJson(updatedGameState) },
        });
      }

      return { success: true, message: responseMessage };
    });
  } catch (error) {
    console.error("Game Action Failed:", error);
    return { error: "서버 처리 중 오류가 발생했습니다." };
  }
};

function UserHeader({ claimerName, onEditName }: { claimerName: string; onEditName: () => void }) {
  return (
    <div className="mb-4 flex w-full justify-end px-2">
      <button
        type="button"
        onClick={onEditName}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500 shadow-sm transition-colors hover:text-indigo-600"
      >
        <span className="font-bold text-slate-800">{claimerName}</span>
        님
        <Edit className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function GamePlayPage() {
  const { isRevealed, gameState } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();

  const [anonId, setAnonId] = useState("");
  const [claimerName, setClaimerName] = useState("");
  const [inputName, setInputName] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [myPosition, setMyPosition] = useState<number | null>(null);
  const [myChar, setMyChar] = useState("");

  useEffect(() => {
    let currentAnonId = localStorage.getItem("myAnonId");
    if (!currentAnonId) {
      currentAnonId = generateAnonId();
      localStorage.setItem("myAnonId", currentAnonId);
    }
    setAnonId(currentAnonId);

    const savedName = localStorage.getItem("myClaimerName");
    if (savedName) {
      setClaimerName(savedName);
      setInputName(savedName);
    }

    const savedTeamId = localStorage.getItem("myGameTeamId");
    const savedPosition = localStorage.getItem("myGamePosition");

    if (savedTeamId) {
      const parsedTeamId = Number(savedTeamId);
      setSelectedTeamId(parsedTeamId);

      if (savedPosition) {
        const parsedPosition = Number(savedPosition);
        setMyPosition(parsedPosition);
        const currentEntry = findEntry(gameState.teams, parsedTeamId, parsedPosition);
        if (currentEntry) {
          setMyChar(currentEntry.char);
        }
      }
    }
  }, [gameState.teams]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        revalidator.revalidate();
      }
    }, POLLING_INTERVAL);

    return () => window.clearInterval(interval);
  }, [revalidator]);

  useEffect(() => {
    if (!selectedTeamId || !myPosition || !anonId) {
      return;
    }

    const currentEntry = findEntry(gameState.teams, selectedTeamId, myPosition);
    if (!currentEntry) {
      return;
    }

    if (currentEntry.claimerId && currentEntry.claimerId !== anonId) {
      setMyPosition(null);
      setMyChar("");
      localStorage.removeItem("myGamePosition");
      alert("다른 사용자가 먼저 선점했습니다.");
    }
  }, [anonId, gameState.teams, myPosition, selectedTeamId]);

  const currentTeam = findTeam(gameState.teams, selectedTeamId);
  const currentEntryState = findEntry(gameState.teams, selectedTeamId, myPosition);
  const activeTeam = currentTeam ?? gameState.teams[0];
  const isSaved = currentEntryState?.char === myChar && myChar !== "";

  const handleConfirmName = (event?: FormEvent) => {
    event?.preventDefault();

    if (!inputName.trim()) {
      return;
    }

    setClaimerName(inputName.trim());
    localStorage.setItem("myClaimerName", inputName.trim());
  };

  const handleEditName = () => {
    setInputName(claimerName);
    setClaimerName("");
  };

  const handleSelectTeam = (teamId: number) => {
    setSelectedTeamId(teamId);
    localStorage.setItem("myGameTeamId", String(teamId));
  };

  const handleSelectPosition = (position: number) => {
    if (!anonId) {
      return;
    }

    const targetTeamId = selectedTeamId ?? gameState.teams[0]?.id;
    if (!targetTeamId) {
      return;
    }

    if (!selectedTeamId) {
      setSelectedTeamId(targetTeamId);
    }

    fetcher.submit(
      {
        intent: "occupy",
        teamId: String(targetTeamId),
        position: String(position),
        anonId,
        claimerName,
      },
      { method: "post" }
    );

    setMyPosition(position);
    localStorage.setItem("myGameTeamId", String(targetTeamId));
    localStorage.setItem("myGamePosition", String(position));
    localStorage.setItem("myClaimerName", claimerName);

    const currentEntry = findEntry(gameState.teams, targetTeamId, position);
    setMyChar(currentEntry?.char ?? "");
  };

  const handleBackToPositions = () => {
    if (selectedTeamId && myPosition) {
      fetcher.submit(
        {
          intent: "release",
          teamId: String(selectedTeamId),
          position: String(myPosition),
          anonId,
        },
        { method: "post" }
      );
    }

    setMyPosition(null);
    setMyChar("");
    localStorage.removeItem("myGamePosition");
  };

  const handleBackToTeams = () => {
    setSelectedTeamId(null);
    localStorage.removeItem("myGameTeamId");
  };

  const handleSave = () => {
    const finalChar = myChar.trim().slice(-1);
    if (!selectedTeamId || !myPosition || !anonId || !finalChar) {
      return;
    }

    fetcher.submit(
      {
        intent: "input",
        teamId: String(selectedTeamId),
        position: String(myPosition),
        char: finalChar,
        anonId,
      },
      { method: "post" }
    );

    setMyChar(finalChar);
  };

  if (!claimerName) {
    return (
      <div className="container mx-auto flex min-h-screen max-w-md flex-col justify-center bg-slate-50 px-4">
        <Card className="w-full shadow-lg">
          <CardHeader>
            <CardTitle className="text-center">이름을 입력해 주세요</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleConfirmName} className="flex flex-col gap-4">
              <Input
                autoFocus
                placeholder="표시될 이름"
                value={inputName}
                onChange={(event) => setInputName(event.target.value)}
                className="h-12 text-center text-lg"
              />
              <Button
                type="submit"
                className="h-12 w-full bg-indigo-600 text-lg font-bold hover:bg-indigo-700"
                disabled={!inputName.trim()}
              >
                시작하기
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const showTeamSelect = !selectedTeamId && gameState.teams.length > 1;

  if (showTeamSelect) {
    return (
      <div className="container mx-auto flex min-h-screen max-w-md flex-col items-center bg-slate-50 px-4 py-8">
        <UserHeader claimerName={claimerName} onEditName={handleEditName} />
        <h1 className="mb-8 text-2xl font-bold text-slate-800">팀을 선택해 주세요</h1>
        <div className="w-full space-y-4">
          {gameState.teams.map((team) => (
            <Button
              key={team.id}
              onClick={() => handleSelectTeam(team.id)}
              className="flex h-20 w-full justify-between border-2 border-slate-200 bg-white px-8 text-2xl font-bold text-slate-800 shadow-sm hover:border-indigo-500 hover:bg-slate-100"
            >
              <span>{team.name}</span>
              <Users className="h-6 w-6 text-slate-400" />
            </Button>
          ))}
        </div>
      </div>
    );
  }

  if (!myPosition) {
    return (
      <div className="container mx-auto flex min-h-screen max-w-md flex-col items-center bg-slate-50 px-4 py-8">
        <UserHeader claimerName={claimerName} onEditName={handleEditName} />

        <div className="relative mb-8 flex w-full items-center justify-center">
          {gameState.teams.length > 1 && (
            <Button variant="ghost" size="icon" className="absolute left-0" onClick={handleBackToTeams}>
              <ArrowLeft className="h-6 w-6" />
            </Button>
          )}
          <h1 className="text-2xl font-bold text-slate-800">{activeTeam?.name} 자리 선택</h1>
        </div>

        <div className="grid w-full grid-cols-1 gap-4">
          {activeTeam?.entries.map((entry) => {
            const isTaken = entry.claimerId !== null;
            const isMySpot = entry.claimerId === anonId;

            return (
              <Button
                key={entry.position}
                disabled={isTaken && !isMySpot}
                onClick={() => handleSelectPosition(entry.position)}
                className={[
                  "h-24 border-2 text-2xl font-black shadow-md transition-all",
                  isMySpot
                    ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700"
                    : isTaken
                      ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                      : "border-slate-200 bg-white text-slate-800 hover:border-indigo-400 hover:bg-indigo-50",
                ].join(" ")}
              >
                <div className="flex flex-col items-center">
                  <span className="text-3xl">{entry.position}</span>
                  <span className="text-sm font-normal opacity-80">
                    {isTaken ? (isMySpot ? "나의 선택" : entry.claimerName || "선점됨") : "선택 가능"}
                  </span>
                </div>
              </Button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto flex min-h-screen max-w-md flex-col items-center bg-slate-50 px-4 py-6">
      <div className="mb-6 flex w-full items-center justify-between">
        <Button variant="ghost" onClick={handleBackToPositions} className="text-slate-500">
          <ArrowLeft className="mr-2 h-5 w-5" /> 자리 변경
        </Button>
        <Badge className="bg-indigo-600 px-4 py-1 text-lg text-white">
          {activeTeam?.name} - {myPosition}번
        </Badge>
      </div>

      {isRevealed ? (
        <div className="flex flex-1 w-full items-center justify-center">
          <div className="w-full rounded-xl border-2 border-red-300 bg-red-50 p-8 text-center text-red-600 shadow-lg">
            <p className="mb-2 text-3xl font-bold">공개되었습니다</p>
            <p className="text-lg">메인 화면을 확인해 주세요</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 w-full flex-col items-center gap-6">
          <div className="relative aspect-square w-full max-w-[300px]">
            <Input
              type="text"
              value={myChar}
              onChange={(event) => setMyChar(event.target.value)}
              className={[
                "h-full w-full rounded-[2.5rem] border-4 p-0 text-center text-[140px] font-black leading-none shadow-2xl caret-transparent transition-all duration-300",
                "focus:ring-8 focus:ring-indigo-100",
                isSaved ? "border-green-500 bg-green-50 text-green-600" : "border-slate-300 bg-white text-slate-800",
              ].join(" ")}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              autoCapitalize="off"
              autoFocus
              placeholder="?"
            />
          </div>

          <div className="h-8">
            {isSaved ? (
              <span className="flex items-center gap-2 text-lg font-bold text-green-600">
                <Save className="h-5 w-5" /> 서버에 저장됨
              </span>
            ) : (
              <span className="animate-pulse font-medium text-slate-400">입력 후 저장 버튼을 눌러 주세요</span>
            )}
          </div>

          <Button
            onClick={handleSave}
            disabled={isSaved || myChar === ""}
            className={[
              "h-20 w-full max-w-[300px] rounded-2xl text-2xl font-bold shadow-xl transition-all",
              isSaved ? "bg-slate-200 text-slate-400 hover:bg-slate-200" : "bg-indigo-600 text-white hover:scale-105 hover:bg-indigo-700",
            ].join(" ")}
          >
            {isSaved ? "저장 완료" : "저장하기"}
          </Button>
        </div>
      )}
    </div>
  );
}
