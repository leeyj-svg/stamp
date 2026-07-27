import * as z from "zod";

// 단어게임 공용 타입/상수 (클라이언트 안전)

export type WordMode = "host" | "phone";
export type WordPhase = "lobby" | "round" | "roundEnd";
export type WordPlayerStatus = "alive" | "stopped" | "failed";

export const MAX_STAGE = 5;

export const SCORE_PRESETS: Record<string, number[]> = {
  basic: [1, 2, 3, 4, 5], // 기본형
  challenge: [1, 2, 3, 5, 10], // 도전형
};

const playerSchema = z.object({
  id: z.string(),
  name: z.string(),
  total: z.number(),
  status: z.enum(["alive", "stopped", "failed"]),
  stoppedStage: z.number(),
  lastActedStage: z.number().default(0), // 이번 라운드에서 마지막으로 선택한 단계(중복 선택 방지)
  claimedBy: z.string().nullable().default(null), // 폰 모드에서 이 팀을 잡은 기기(anonId)
});

const stateSchema = z.object({
  mode: z.enum(["host", "phone"]),
  scoreTable: z.array(z.number()),
  phase: z.enum(["lobby", "round", "roundEnd"]),
  stage: z.number(), // 0=미공개, 1~5
  currentTopicId: z.number().nullable(),
  selectedTopicId: z.number().nullable().default(null), // 로비에서 고른(아직 시작 전) 주제
  usedTopicIds: z.array(z.number()),
  shownWords: z.array(z.string().nullable()), // 길이 5, 각 단계에 공개된 단어(없으면 null)
  players: z.array(playerSchema),
});

export type WordPlayer = z.infer<typeof playerSchema>;
export type WordState = z.infer<typeof stateSchema>;

export const initialWordState: WordState = {
  mode: "host",
  scoreTable: [1, 2, 3, 5, 10],
  phase: "lobby",
  stage: 0,
  currentTopicId: null,
  selectedTopicId: null,
  usedTopicIds: [],
  shownWords: [null, null, null, null, null],
  players: [],
};

export function parseWordState(value: unknown): WordState {
  const parsed = stateSchema.safeParse(value);
  return parsed.success ? parsed.data : initialWordState;
}

// 주제 stages(Json) 파싱: string[][] 길이 5 보장
export function parseStages(value: unknown): string[][] {
  const parsed = z.array(z.array(z.string())).safeParse(value);
  const arr = parsed.success ? parsed.data : [];
  const out: string[][] = [];
  for (let i = 0; i < MAX_STAGE; i++) out.push((arr[i] ?? []).filter((w) => w.trim() !== ""));
  return out;
}

export function aliveCount(state: WordState): number {
  return state.players.filter((p) => p.status === "alive").length;
}
