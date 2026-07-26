import { type ActionFunctionArgs, type LoaderFunctionArgs, Link, useFetcher, useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import * as z from "zod";
import { Eye, Minus, Play, Plus, Shuffle } from "lucide-react";
import { Button } from "~/components/ui/button";
import { db } from "~/lib/db.server";
import {
  CODENAME_SESSION_ID,
  LIMITS,
  createCodenameGame,
  initialCodenameState,
  parseCodenameState,
  toCodenameJson,
} from "~/lib/codename-session";

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

  const state = parseCodenameState(session.gameState);

  return {
    teamCount: state.teamCount,
    cardsPerTeam: state.cardsPerTeam,
    neutralCount: state.neutralCount,
    status: state.status,
  };
};

const actionSchema = z.object({
  intent: z.literal("new-game"),
  teamCount: z.coerce.number(),
  cardsPerTeam: z.coerce.number(),
  neutralCount: z.coerce.number(),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const result = actionSchema.safeParse(Object.fromEntries(formData));

  if (!result.success) {
    return { error: "잘못된 요청입니다." };
  }

  const state = createCodenameGame(result.data);

  await db.gameSession.upsert({
    where: { id: CODENAME_SESSION_ID },
    create: {
      id: CODENAME_SESSION_ID,
      gameState: toCodenameJson(state),
      isRevealed: false,
    },
    update: {
      gameState: toCodenameJson(state),
      isRevealed: false,
    },
  });

  return { success: true };
};

type StepperProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

function Stepper({ label, value, min, max, onChange }: StepperProps) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800 p-4">
      <span className="text-lg font-bold text-slate-200">{label}</span>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="h-10 w-10 rounded-full bg-slate-700 p-0 text-white hover:bg-slate-600 disabled:opacity-30"
        >
          <Minus className="h-5 w-5" />
        </Button>
        <span className="w-10 text-center text-2xl font-extrabold text-white">{value}</span>
        <Button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="h-10 w-10 rounded-full bg-slate-700 p-0 text-white hover:bg-slate-600 disabled:opacity-30"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

export default function CodenameHostPage() {
  const loaded = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [origin, setOrigin] = useState("");

  const [teamCount, setTeamCount] = useState(loaded.teamCount);
  const [cardsPerTeam, setCardsPerTeam] = useState(loaded.cardsPerTeam);
  const [neutralCount, setNeutralCount] = useState(loaded.neutralCount);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const total = teamCount * cardsPerTeam + neutralCount + 1;

  // 팀 수를 바꾸면 총 카드 수를 최대한 유지하도록 팀당 카드·중립을 자동 재분배한다.
  const clampRange = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

  const handleTeamChange = (nextTeam: number) => {
    const area = total - 1; // 블랙 1장 제외한 (팀 카드 + 중립) 칸 수 유지
    const cards = clampRange(Math.floor(area / nextTeam), LIMITS.cards.min, LIMITS.cards.max);
    const neutral = clampRange(area - nextTeam * cards, LIMITS.neutral.min, LIMITS.neutral.max);
    setTeamCount(nextTeam);
    setCardsPerTeam(cards);
    setNeutralCount(neutral);
  };

  const playUrl = `${origin}/game/codename/play`;
  const keyUrl = `${origin}/game/codename/key`;
  const isSubmitting = fetcher.state !== "idle";

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-900 p-4 pb-16 text-white">
      <h1 className="mt-10 mb-2 text-3xl font-bold uppercase tracking-widest text-slate-300">코드네임</h1>
      <p className="mb-8 text-sm text-slate-500">설정을 정하고 새 게임을 시작하세요.</p>

      <div className="flex w-full max-w-lg flex-col gap-4">
        <Stepper label="팀 수" value={teamCount} min={LIMITS.team.min} max={LIMITS.team.max} onChange={handleTeamChange} />
        <Stepper label="팀당 카드" value={cardsPerTeam} min={LIMITS.cards.min} max={LIMITS.cards.max} onChange={setCardsPerTeam} />
        <Stepper label="중립 카드" value={neutralCount} min={LIMITS.neutral.min} max={LIMITS.neutral.max} onChange={setNeutralCount} />

        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 text-center text-slate-300">
          총 카드 <span className="text-xl font-extrabold text-white">{total}</span>칸
          <span className="text-slate-500"> (팀 {teamCount * cardsPerTeam} + 중립 {neutralCount} + 블랙 1)</span>
        </div>

        <Button
          onClick={() =>
            fetcher.submit(
              {
                intent: "new-game",
                teamCount: String(teamCount),
                cardsPerTeam: String(cardsPerTeam),
                neutralCount: String(neutralCount),
              },
              { method: "post" },
            )
          }
          disabled={isSubmitting}
          className="bg-yellow-400 py-7 text-xl font-extrabold text-black hover:bg-yellow-500"
        >
          <Shuffle className="mr-2 h-6 w-6" /> 새 게임 시작
        </Button>

        <div className="mt-2 flex gap-3">
          <Link
            to="/game/codename/play"
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-700 py-4 font-bold text-slate-100 hover:bg-slate-600"
          >
            <Play className="h-5 w-5" /> 게임판 열기
          </Link>
          <Link
            to="/game/codename/key"
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-700 py-4 font-bold text-slate-100 hover:bg-slate-600"
          >
            <Eye className="h-5 w-5" /> 정답판 열기
          </Link>
        </div>

        {origin && (
          <div className="mt-4 flex justify-around gap-4">
            <div className="flex flex-col items-center rounded-lg bg-white p-3">
              <QRCodeSVG value={playUrl} size={110} level="H" />
              <span className="mt-2 text-xs font-bold text-black">게임판 접속</span>
            </div>
            <div className="flex flex-col items-center rounded-lg bg-white p-3">
              <QRCodeSVG value={keyUrl} size={110} level="H" />
              <span className="mt-2 text-xs font-bold text-black">정답판(스파이마스터)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
