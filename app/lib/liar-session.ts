import { Prisma } from "@prisma/client";
import * as z from "zod";
import { pickFakeWord, pickWord, randomCategory } from "./liar-words";
import type { DifficultyFilter } from "./game-difficulty";

// 라이어 게임 상태/규칙 (서버·클라 공용, 순수 함수)
// DB: GameSession id=3 의 gameState JSON.
// 비밀 역할 게임이므로 클라이언트에는 redaction 된 뷰(toPlayView/toHostView)만 내려준다.

export const LIAR_SESSION_ID = 3;
export const LIAR_LIMITS = {
  liar: { min: 1, max: 3 },
  minPlayers: 3,
} as const;

const roleSchema = z.enum(["citizen", "liar"]);
const modeSchema = z.enum(["none", "fake"]);
const phaseSchema = z.enum(["lobby", "reveal", "voting", "result"]);

const playerSchema = z.object({
  anonId: z.string(),
  name: z.string(),
  role: roleSchema,
  word: z.string(),
  votedFor: z.string().nullable(),
});

const stateSchema = z.object({
  category: z.string(),
  difficulty: z.enum(["all", "easy", "normal", "hard"]).default("all"),
  word: z.string(),
  fakeWord: z.string().nullable(),
  liarMode: modeSchema,
  liarCount: z.number(),
  appVoting: z.boolean(),
  phase: phaseSchema,
  players: z.array(playerSchema),
});

export type LiarRole = z.infer<typeof roleSchema>;
export type LiarMode = z.infer<typeof modeSchema>;
export type LiarPhase = z.infer<typeof phaseSchema>;
export type LiarPlayer = z.infer<typeof playerSchema>;
export type LiarState = z.infer<typeof stateSchema>;

export const initialLiarState: LiarState = {
  category: "",
  difficulty: "all",
  word: "",
  fakeWord: null,
  liarMode: "none",
  liarCount: 1,
  appVoting: true,
  phase: "lobby",
  players: [],
};

export function parseLiarState(value: unknown): LiarState {
  const parsed = stateSchema.safeParse(value);
  return parsed.success ? parsed.data : initialLiarState;
}

export function toLiarJson(state: LiarState): Prisma.InputJsonValue {
  return state as unknown as Prisma.InputJsonValue;
}

function clone(state: LiarState): LiarState {
  return { ...state, players: state.players.map((p) => ({ ...p })) };
}

function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---- mutations (모두 불변) ----

export function joinPlayer(state: LiarState, anonId: string, name: string): LiarState {
  if (state.phase !== "lobby") return state;
  const trimmed = name.trim().slice(0, 12) || "익명";
  const next = clone(state);
  const existing = next.players.find((p) => p.anonId === anonId);
  if (existing) {
    existing.name = trimmed;
  } else {
    next.players.push({ anonId, name: trimmed, role: "citizen", word: "", votedFor: null });
  }
  return next;
}

export function leavePlayer(state: LiarState, anonId: string): LiarState {
  if (state.phase !== "lobby") return state;
  const next = clone(state);
  next.players = next.players.filter((p) => p.anonId !== anonId);
  return next;
}

export type LiarConfigPatch = {
  category?: string;
  difficulty?: DifficultyFilter;
  liarCount?: number;
  liarMode?: LiarMode;
  appVoting?: boolean;
};

export function setConfig(state: LiarState, patch: LiarConfigPatch): LiarState {
  if (state.phase !== "lobby") return state;
  const next = clone(state);
  if (patch.category !== undefined) next.category = patch.category;
  if (patch.difficulty !== undefined) next.difficulty = patch.difficulty;
  if (patch.liarCount !== undefined) next.liarCount = clampInt(patch.liarCount, LIAR_LIMITS.liar.min, LIAR_LIMITS.liar.max);
  if (patch.liarMode !== undefined) next.liarMode = patch.liarMode;
  if (patch.appVoting !== undefined) next.appVoting = patch.appVoting;
  return next;
}

export function canStart(state: LiarState): boolean {
  return (
    state.phase === "lobby" &&
    state.players.length >= LIAR_LIMITS.minPlayers &&
    state.players.length > state.liarCount
  );
}

export function startRound(state: LiarState): LiarState {
  if (!canStart(state)) return state;
  const next = clone(state);

  const category = state.category || randomCategory();
  const word = pickWord(category, state.difficulty);
  const fakeWord = state.liarMode === "fake" ? pickFakeWord(category, state.difficulty, word) : null;

  next.category = category;
  next.word = word;
  next.fakeWord = fakeWord;

  const order = shuffle(next.players.map((_, index) => index));
  const liarIndexes = new Set(order.slice(0, state.liarCount));

  next.players = next.players.map((player, index) => {
    const role: LiarRole = liarIndexes.has(index) ? "liar" : "citizen";
    let assignedWord = word;
    if (role === "liar") {
      assignedWord = state.liarMode === "fake" ? (fakeWord ?? "") : "";
    }
    return { ...player, role, word: assignedWord, votedFor: null };
  });

  next.phase = "reveal";
  return next;
}

export function openVote(state: LiarState): LiarState {
  if (state.phase !== "reveal" || !state.appVoting) return state;
  return { ...clone(state), phase: "voting" };
}

export function castVote(state: LiarState, anonId: string, targetAnonId: string): LiarState {
  if (state.phase !== "voting") return state;
  const next = clone(state);
  const voter = next.players.find((p) => p.anonId === anonId);
  const target = next.players.find((p) => p.anonId === targetAnonId);
  if (!voter || !target || voter.anonId === target.anonId) return state;
  voter.votedFor = targetAnonId;
  return next;
}

export function showResult(state: LiarState): LiarState {
  if (state.phase === "lobby") return state;
  return { ...clone(state), phase: "result" };
}

/** 참가자 유지한 채 다음 라운드 준비 (역할/투표 초기화) */
export function newRound(state: LiarState): LiarState {
  const next = clone(state);
  next.players = next.players.map((p) => ({ ...p, role: "citizen", word: "", votedFor: null }));
  next.word = "";
  next.fakeWord = null;
  next.phase = "lobby";
  return next;
}

export function resetGame(): LiarState {
  return { ...initialLiarState };
}

// ---- 파생 ----

export function voteTally(state: LiarState): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const player of state.players) {
    if (player.votedFor) tally[player.votedFor] = (tally[player.votedFor] ?? 0) + 1;
  }
  return tally;
}

export function liarAnonIds(state: LiarState): string[] {
  return state.players.filter((p) => p.role === "liar").map((p) => p.anonId);
}

// ---- redaction 뷰 ----

export type PublicPlayer = { anonId: string; name: string; hasVoted: boolean };

export type PlayView = {
  phase: LiarPhase;
  category: string;
  liarMode: LiarMode;
  liarCount: number;
  appVoting: boolean;
  minPlayers: number;
  playerCount: number;
  players: PublicPlayer[];
  you: {
    joined: boolean;
    name: string | null;
    role: LiarRole | null; // fake 모드에선 결과 전까지 숨김
    word: string | null;
    votedFor: string | null;
  };
  result: null | {
    word: string;
    fakeWord: string | null;
    liarAnonIds: string[];
    liarNames: string[];
    tally: Record<string, number>;
  };
};

function publicPlayers(state: LiarState): PublicPlayer[] {
  return state.players.map((p) => ({ anonId: p.anonId, name: p.name, hasVoted: p.votedFor != null }));
}

function resultView(state: LiarState): PlayView["result"] {
  if (state.phase !== "result") return null;
  const ids = liarAnonIds(state);
  return {
    word: state.word,
    fakeWord: state.fakeWord,
    liarAnonIds: ids,
    liarNames: state.players.filter((p) => ids.includes(p.anonId)).map((p) => p.name),
    tally: voteTally(state),
  };
}

export function toPlayView(state: LiarState, meAnonId: string | null): PlayView {
  const me = meAnonId ? state.players.find((p) => p.anonId === meAnonId) : undefined;

  const afterLobby = state.phase !== "lobby";
  const wordVisible = state.phase === "reveal" || state.phase === "voting" || state.phase === "result";
  // fake 모드는 결과 전까지 본인 역할도 숨긴다(스파이가 자기가 라이어인지 모름).
  const roleVisible = afterLobby && (state.liarMode === "none" || state.phase === "result");

  return {
    phase: state.phase,
    category: state.category,
    liarMode: state.liarMode,
    liarCount: state.liarCount,
    appVoting: state.appVoting,
    minPlayers: LIAR_LIMITS.minPlayers,
    playerCount: state.players.length,
    players: publicPlayers(state),
    you: {
      joined: !!me,
      name: me?.name ?? null,
      role: me && roleVisible ? me.role : null,
      word: me && wordVisible ? me.word : null,
      votedFor: me?.votedFor ?? null,
    },
    result: resultView(state),
  };
}

export type HostView = {
  phase: LiarPhase;
  category: string;
  difficulty: DifficultyFilter;
  liarMode: LiarMode;
  liarCount: number;
  appVoting: boolean;
  minPlayers: number;
  canStart: boolean;
  players: PublicPlayer[];
  result: PlayView["result"];
};

export function toHostView(state: LiarState): HostView {
  return {
    phase: state.phase,
    category: state.category,
    difficulty: state.difficulty,
    liarMode: state.liarMode,
    liarCount: state.liarCount,
    appVoting: state.appVoting,
    minPlayers: LIAR_LIMITS.minPlayers,
    canStart: canStart(state),
    players: publicPlayers(state),
    result: resultView(state),
  };
}
