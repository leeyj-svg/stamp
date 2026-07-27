import { Prisma } from "@prisma/client";
import * as z from "zod";
import { sampleWords } from "./codename-words";
import type { DifficultyFilter } from "./game-difficulty";

// 코드네임 상태/규칙 (서버·클라 공용, 순수 함수)
// DB: GameSession id=2 의 gameState JSON 에 CodenameState 를 저장한다.

export const CODENAME_SESSION_ID = 2;

export const TEAM_COLORS = ["red", "blue", "green", "yellow", "purple"] as const;
export type TeamColor = (typeof TEAM_COLORS)[number];
export type CardColor = TeamColor | "gray" | "black";

export const LIMITS = {
  team: { min: 2, max: 5 },
  cards: { min: 4, max: 10 },
  neutral: { min: 0, max: 15 },
} as const;

const cardColorSchema = z.enum([
  "red", "blue", "green", "yellow", "purple", "gray", "black",
]);

const cardSchema = z.object({
  position: z.number(),
  word: z.string(),
  color: cardColorSchema,
  revealed: z.boolean(),
});

const stateSchema = z.object({
  teamCount: z.number(),
  cardsPerTeam: z.number(),
  neutralCount: z.number(),
  difficulty: z.enum(["all", "easy", "normal", "hard"]).default("all"),
  cards: z.array(cardSchema),
  currentTeam: z.enum(["red", "blue", "green", "yellow", "purple"]),
  status: z.enum(["playing", "won", "over"]),
  winner: z.enum(["red", "blue", "green", "yellow", "purple"]).nullable(),
});

export type CodenameCard = z.infer<typeof cardSchema>;
export type CodenameState = z.infer<typeof stateSchema>;

export type CodenameConfig = {
  teamCount: number;
  cardsPerTeam: number;
  neutralCount: number;
  difficulty?: DifficultyFilter;
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function teamColorsFor(teamCount: number): TeamColor[] {
  return TEAM_COLORS.slice(0, clamp(teamCount, LIMITS.team.min, LIMITS.team.max));
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function createCodenameGame(config: CodenameConfig): CodenameState {
  const teamCount = clamp(config.teamCount, LIMITS.team.min, LIMITS.team.max);
  const cardsPerTeam = clamp(config.cardsPerTeam, LIMITS.cards.min, LIMITS.cards.max);
  const neutralCount = clamp(config.neutralCount, LIMITS.neutral.min, LIMITS.neutral.max);
  const difficulty = config.difficulty ?? "all";

  const teams = teamColorsFor(teamCount);

  const colors: CardColor[] = [];
  for (const team of teams) {
    for (let i = 0; i < cardsPerTeam; i++) colors.push(team);
  }
  for (let i = 0; i < neutralCount; i++) colors.push("gray");
  colors.push("black");

  const shuffledColors = shuffle(colors);
  const words = sampleWords(shuffledColors.length, difficulty);

  const cards: CodenameCard[] = shuffledColors.map((color, index) => ({
    position: index,
    word: words[index] ?? `단어${index + 1}`,
    color,
    revealed: false,
  }));

  const currentTeam = teams[Math.floor(Math.random() * teams.length)];

  return {
    teamCount,
    cardsPerTeam,
    neutralCount,
    difficulty,
    cards,
    currentTeam,
    status: "playing",
    winner: null,
  };
}

// 기본값: 총 25칸 (4팀 × 5 + 중립 4 + 블랙 1). 설정에서 변경 가능.
export const initialCodenameState: CodenameState = createCodenameGame({
  teamCount: 4,
  cardsPerTeam: 5,
  neutralCount: 4,
});

export function parseCodenameState(value: unknown): CodenameState {
  const parsed = stateSchema.safeParse(value);
  return parsed.success ? parsed.data : initialCodenameState;
}

export function toCodenameJson(state: CodenameState): Prisma.InputJsonValue {
  return state as unknown as Prisma.InputJsonValue;
}

function cloneState(state: CodenameState): CodenameState {
  return {
    ...state,
    cards: state.cards.map((card) => ({ ...card })),
  };
}

/** 특정 팀이 아직 못 찾은 카드 수 */
export function teamRemaining(state: CodenameState, color: TeamColor): number {
  return state.cards.filter((card) => card.color === color && !card.revealed).length;
}

function nextTeamColor(state: CodenameState): TeamColor {
  const teams = teamColorsFor(state.teamCount);
  const index = teams.indexOf(state.currentTeam);
  return teams[(index + 1) % teams.length];
}

/** 자기 카드를 전부 찾은 팀이 있으면 그 색, 없으면 null */
function findWinner(state: CodenameState): TeamColor | null {
  for (const team of teamColorsFor(state.teamCount)) {
    if (teamRemaining(state, team) === 0) return team;
  }
  return null;
}

/** 카드 공개 + 턴/승패 규칙 적용 (불변) */
export function revealCard(state: CodenameState, position: number): CodenameState {
  if (state.status !== "playing") return state;

  const card = state.cards.find((item) => item.position === position);
  if (!card || card.revealed) return state;

  const next = cloneState(state);
  const target = next.cards.find((item) => item.position === position)!;
  target.revealed = true;

  // 블랙요원 → 누른 팀 패배, 게임오버
  if (target.color === "black") {
    next.status = "over";
    next.winner = null;
    return next;
  }

  // 자기 카드 전부 찾은 팀이 생기면 승리 (상대 실수로 열린 것 포함)
  const winner = findWinner(next);
  if (winner) {
    next.status = "won";
    next.winner = winner;
    return next;
  }

  // 현재 팀 색이면 턴 유지, 아니면(다른 팀·중립) 턴 넘김
  if (target.color !== next.currentTeam) {
    next.currentTeam = nextTeamColor(next);
  }

  return next;
}

/** 현재 팀이 자발적으로 턴 종료 */
export function endTurn(state: CodenameState): CodenameState {
  if (state.status !== "playing") return state;
  const next = cloneState(state);
  next.currentTeam = nextTeamColor(next);
  return next;
}

/** 격자 열 수 (총 칸 기준) */
export function gridColumns(total: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(total)));
}
