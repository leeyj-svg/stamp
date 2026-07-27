import * as z from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db.server";
import { MAX_STAGE, initialWordState, parseStages, parseWordState, type WordState } from "./word-game";
import { notifyWord } from "./word-game-events.server";

export const WORD_SESSION_ID = 1;

function toJson(v: unknown) {
  return v as unknown as Prisma.InputJsonValue;
}

function clone(state: WordState): WordState {
  return { ...state, scoreTable: [...state.scoreTable], usedTopicIds: [...state.usedTopicIds], shownWords: [...state.shownWords], players: state.players.map((p) => ({ ...p })) };
}

async function getState(): Promise<WordState> {
  const session = await db.wordGameSession.upsert({
    where: { id: WORD_SESSION_ID },
    create: { id: WORD_SESSION_ID, gameState: toJson(initialWordState) },
    update: {},
    select: { gameState: true },
  });
  return parseWordState(session.gameState);
}

async function saveState(state: WordState) {
  await db.wordGameSession.upsert({
    where: { id: WORD_SESSION_ID },
    create: { id: WORD_SESSION_ID, gameState: toJson(state) },
    update: { gameState: toJson(state) },
  });
  notifyWord(); // 변경 즉시 다른 화면에 푸시
}

// 로더용
export async function getWordSession() {
  return getState();
}
export async function getTopics() {
  const rows = await db.wordGameTopic.findMany({ orderBy: { id: "asc" } });
  return rows.map((t) => ({ id: t.id, title: t.title, stages: parseStages(t.stages), createdAt: t.createdAt }));
}

function aliveCount(state: WordState) {
  return state.players.filter((p) => p.status === "alive").length;
}

function markTopicUsed(state: WordState) {
  if (state.currentTopicId != null && !state.usedTopicIds.includes(state.currentTopicId)) {
    state.usedTopicIds.push(state.currentTopicId);
  }
}

// ---- 액션 스키마 ----
const schema = z.object({
  intent: z.enum([
    "set-score-table", "set-mode", "add-player", "join-player", "claim-slot", "rename-player", "remove-player",
    "select-topic", "start-round", "reveal-next", "set-shown-word", "choose", "cancel-choice", "end-round", "next-round", "reset-game",
    "create-topic", "update-topic", "delete-topic",
  ]),
  table: z.string().optional(), // "1,2,3,5,10"
  mode: z.enum(["host", "phone"]).optional(),
  name: z.string().optional(),
  anonId: z.string().optional(),
  playerId: z.string().optional(),
  topicId: z.coerce.number().optional(),
  stage: z.coerce.number().optional(),
  word: z.string().optional(),
  choice: z.enum(["go", "stop", "fail"]).optional(),
  host: z.string().optional(), // "1"이면 진행자 조작(폰 모드에서도 허용)
  title: z.string().optional(),
  s1: z.string().optional(),
  s2: z.string().optional(),
  s3: z.string().optional(),
  s4: z.string().optional(),
  s5: z.string().optional(),
});

function parseStageInputs(d: z.infer<typeof schema>): string[][] {
  const raw = [d.s1, d.s2, d.s3, d.s4, d.s5];
  return raw.map((s) => (s ?? "").split(/[,\n]/).map((w) => w.trim()).filter(Boolean));
}

export async function handleWordAction(request: Request) {
  const form = await request.formData();
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "잘못된 요청입니다." };
  const d = parsed.data;

  // 주제 CRUD (상태와 무관)
  if (d.intent === "create-topic") {
    const stages = parseStageInputs(d);
    if ((d.title ?? "").trim() === "") return { error: "주제를 입력하세요." };
    await db.wordGameTopic.create({ data: { title: d.title!.trim(), stages: toJson(stages) } });
    notifyWord();
    return { success: true };
  }
  if (d.intent === "update-topic" && d.topicId != null) {
    const stages = parseStageInputs(d);
    await db.wordGameTopic.update({ where: { id: d.topicId }, data: { title: (d.title ?? "").trim() || "주제", stages: toJson(stages) } });
    notifyWord();
    return { success: true };
  }
  if (d.intent === "delete-topic" && d.topicId != null) {
    await db.wordGameTopic.delete({ where: { id: d.topicId } }).catch(() => {});
    notifyWord();
    return { success: true };
  }
  if (d.intent === "reset-game") {
    await saveState({ ...initialWordState });
    return { success: true };
  }

  const state = clone(await getState());

  switch (d.intent) {
    case "set-score-table": {
      if (d.table) {
        const nums = d.table.split(",").map((n) => Number(n.trim()));
        if (nums.length === MAX_STAGE && nums.every((n) => !Number.isNaN(n))) state.scoreTable = nums;
      }
      break;
    }
    case "set-mode":
      if (d.mode && state.phase === "lobby") state.mode = d.mode;
      break;
    case "add-player":
      if (state.phase === "lobby" && (d.name ?? "").trim()) {
        state.players.push({ id: `p${Date.now().toString(36)}${state.players.length}`, name: d.name!.trim().slice(0, 12), total: 0, status: "alive", stoppedStage: 0, lastActedStage: 0, claimedBy: null });
      }
      break;
    case "join-player":
      if (d.anonId && (d.name ?? "").trim()) {
        const exist = state.players.find((p) => p.id === d.anonId);
        if (exist) exist.name = d.name!.trim().slice(0, 12);
        else if (state.phase === "lobby") state.players.push({ id: d.anonId, name: d.name!.trim().slice(0, 12), total: 0, status: "alive", stoppedStage: 0, lastActedStage: 0, claimedBy: d.anonId });
      }
      break;
    case "claim-slot": {
      if (d.anonId && d.playerId) {
        const target = state.players.find((p) => p.id === d.playerId);
        if (target && (!target.claimedBy || target.claimedBy === d.anonId)) {
          state.players.forEach((p) => { if (p.claimedBy === d.anonId) p.claimedBy = null; }); // 이전 팀 해제
          target.claimedBy = d.anonId;
        }
      }
      break;
    }
    case "rename-player":
      if (d.playerId && (d.name ?? "").trim()) {
        const p = state.players.find((x) => x.id === d.playerId);
        if (p) p.name = d.name!.trim().slice(0, 12);
      }
      break;
    case "remove-player":
      if (d.playerId) state.players = state.players.filter((p) => p.id !== d.playerId);
      break;
    case "select-topic":
      if ((state.phase === "lobby" || state.phase === "roundEnd") && d.topicId != null && !state.usedTopicIds.includes(d.topicId)) {
        state.selectedTopicId = d.topicId;
      }
      break;
    case "start-round": {
      const topicId = d.topicId ?? state.selectedTopicId ?? undefined;
      if (topicId != null && !state.usedTopicIds.includes(topicId)) {
        state.currentTopicId = topicId;
        state.selectedTopicId = null;
        state.stage = 0;
        state.shownWords = [null, null, null, null, null];
        state.players = state.players.map((p) => ({ ...p, status: "alive", stoppedStage: 0, lastActedStage: 0 }));
        state.phase = "round";
      }
      break;
    }
    case "reveal-next": {
      const pending = state.stage >= 1 && state.players.some((p) => p.status === "alive" && p.lastActedStage < state.stage);
      // 라운드 종료(전원 Stop/Fail) 후에도 남은 단어는 끝까지 공개 가능
      if ((state.phase === "round" || state.phase === "roundEnd") && state.stage < MAX_STAGE && !pending) {
        const topic = state.currentTopicId != null ? await db.wordGameTopic.findUnique({ where: { id: state.currentTopicId } }) : null;
        const stages = parseStages(topic?.stages);
        state.stage += 1;
        const candidates = stages[state.stage - 1] ?? [];
        if (!state.shownWords[state.stage - 1]) state.shownWords[state.stage - 1] = candidates[0] ?? ""; // 미리 고른 단어는 유지
      }
      break;
    }
    case "set-shown-word":
      if (d.stage != null && d.stage >= 1 && d.stage <= MAX_STAGE && d.word != null) {
        state.shownWords[d.stage - 1] = d.word;
      }
      break;
    case "choose": {
      const player = state.players.find((p) => p.id === d.playerId);
      const claimOk = state.mode !== "phone" || d.host === "1" || player?.claimedBy === d.anonId; // 폰 모드는 잡은 팀만(진행자는 예외)
      if (player && claimOk && player.status === "alive" && state.phase === "round" && state.stage >= 1 && player.lastActedStage < state.stage) {
        player.lastActedStage = state.stage;
        if (d.choice === "stop") {
          player.total += state.scoreTable[state.stage - 1] ?? 0;
          player.status = "stopped";
          player.stoppedStage = state.stage;
        } else if (d.choice === "fail") {
          player.status = "failed";
        } else if (d.choice === "go" && state.stage < MAX_STAGE) {
          // 생존 유지 (5단계에선 Go 불가)
        }
        if (aliveCount(state) === 0) {
          markTopicUsed(state);
          state.phase = "roundEnd";
        }
      }
      break;
    }
    case "cancel-choice": {
      const p = state.players.find((x) => x.id === d.playerId);
      if (p && state.stage >= 1 && p.lastActedStage === state.stage) {
        if (p.status === "stopped") p.total -= state.scoreTable[state.stage - 1] ?? 0;
        p.status = "alive";
        p.stoppedStage = 0;
        p.lastActedStage = state.stage - 1; // 이번 단계 재선택 가능
        if (state.phase === "roundEnd") {
          state.phase = "round"; // 다시 생존자 생김 → 라운드 복귀
          state.usedTopicIds = state.usedTopicIds.filter((id) => id !== state.currentTopicId);
        }
      }
      break;
    }
    case "end-round":
      if (state.phase === "round") {
        markTopicUsed(state);
        state.phase = "roundEnd";
      }
      break;
    case "next-round":
      markTopicUsed(state);
      state.currentTopicId = null;
      state.selectedTopicId = null;
      state.stage = 0;
      state.shownWords = [null, null, null, null, null];
      state.players = state.players.map((p) => ({ ...p, status: "alive", stoppedStage: 0, lastActedStage: 0 }));
      state.phase = "lobby";
      break;
  }

  await saveState(state);
  return { success: true };
}
