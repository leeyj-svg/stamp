import * as z from "zod";
import { db } from "./db.server";
import { SCOREBOARD_LIMITS, SCOREBOARD_THEMES, type ScoreboardMode } from "./scoreboard";
import { notifyScoreboard } from "./scoreboard-events.server";

// 팀 점수판 DB 로직 (단일 보드 id=1). 점수 증감은 DB increment 로 원자적 처리.

export const SCOREBOARD_ID = 1;

const teamsInclude = { teams: { orderBy: { order: "asc" as const } } };

function clampAmount(v: number): number {
  if (Number.isNaN(v)) return 1;
  return Math.min(SCOREBOARD_LIMITS.amount.max, Math.max(SCOREBOARD_LIMITS.amount.min, Math.round(v)));
}

function clampWidth(w: number): number {
  if (Number.isNaN(w)) return 320;
  return Math.min(SCOREBOARD_LIMITS.width.max, Math.max(SCOREBOARD_LIMITS.width.min, Math.round(w)));
}

function clampHeight(h: number): number {
  if (Number.isNaN(h)) return 200;
  return Math.min(SCOREBOARD_LIMITS.height.max, Math.max(SCOREBOARD_LIMITS.height.min, Math.round(h)));
}

function clampPercent(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

// 기본 4팀 배치 데이터
function defaultTeamsData() {
  const xs = [5, 29, 53, 77];
  return xs.map((x, i) => ({ name: `${i + 1}팀`, order: i, x, y: 16, w: 320, h: 260 }));
}

export async function getScoreboard() {
  const existing = await db.scoreboard.findUnique({ where: { id: SCOREBOARD_ID }, include: teamsInclude });
  if (existing) return existing;

  return db.scoreboard.create({
    data: { id: SCOREBOARD_ID, teams: { create: defaultTeamsData() } },
    include: teamsInclude,
  });
}

export async function addTeam() {
  const count = await db.scoreTeam.count({ where: { boardId: SCOREBOARD_ID } });
  const x = 12 + (count % 3) * 30;
  const y = 20 + Math.floor(count / 3) * 28;
  await db.scoreTeam.create({
    data: {
      boardId: SCOREBOARD_ID,
      name: `${count + 1}팀`,
      order: count,
      x: clampPercent(x),
      y: clampPercent(y),
      w: 320,
      h: 260,
    },
  });
}

export async function removeTeam(teamId: number) {
  await db.scoreTeam.deleteMany({ where: { id: teamId, boardId: SCOREBOARD_ID } });
  // 모두 지워지면 기본 4팀 자동 생성
  const count = await db.scoreTeam.count({ where: { boardId: SCOREBOARD_ID } });
  if (count === 0) {
    await db.scoreTeam.createMany({ data: defaultTeamsData().map((t) => ({ ...t, boardId: SCOREBOARD_ID })) });
  }
}

export async function renameTeam(teamId: number, name: string) {
  const clean = name.trim().slice(0, 16);
  if (!clean) return;
  await db.scoreTeam.updateMany({ where: { id: teamId, boardId: SCOREBOARD_ID }, data: { name: clean } });
}

export async function adjustTeamScore(teamId: number, delta: number) {
  await db.scoreTeam.updateMany({ where: { id: teamId, boardId: SCOREBOARD_ID }, data: { score: { increment: delta } } });
}

export async function setTeamScore(teamId: number, value: number) {
  await db.scoreTeam.updateMany({ where: { id: teamId, boardId: SCOREBOARD_ID }, data: { score: Math.round(value) } });
}

export async function moveTeam(teamId: number, x: number, y: number) {
  await db.scoreTeam.updateMany({
    where: { id: teamId, boardId: SCOREBOARD_ID },
    data: { x: clampPercent(x), y: clampPercent(y) },
  });
}

export async function resizeTeam(teamId: number, w: number, h: number) {
  await db.scoreTeam.updateMany({ where: { id: teamId, boardId: SCOREBOARD_ID }, data: { w: clampWidth(w), h: clampHeight(h) } });
}

export async function setMode(mode: ScoreboardMode) {
  await db.scoreboard.update({ where: { id: SCOREBOARD_ID }, data: { mode } });
}

export async function setAmounts(amount1: number, amount2: number) {
  await db.scoreboard.update({
    where: { id: SCOREBOARD_ID },
    data: { amount1: clampAmount(amount1), amount2: clampAmount(amount2) },
  });
}

export async function setSound(on: boolean) {
  await db.scoreboard.update({ where: { id: SCOREBOARD_ID }, data: { soundOn: on } });
}

export async function setTheme(theme: string) {
  const ok = /^#[0-9a-fA-F]{6}$/.test(theme) || SCOREBOARD_THEMES.some((t) => t.key === theme);
  if (!ok) return;
  await db.scoreboard.update({ where: { id: SCOREBOARD_ID }, data: { theme } });
}

// 카드색 직접 지정. 빈 문자열이면 자동(배경 파생)으로 되돌림.
export async function setCardColor(color: string) {
  const ok = color === "" || /^#[0-9a-fA-F]{6}$/.test(color);
  if (!ok) return;
  await db.scoreboard.update({ where: { id: SCOREBOARD_ID }, data: { cardColor: color } });
}

export async function renameHost(name: string) {
  const clean = name.trim().slice(0, 16) || "사회자";
  await db.scoreboard.update({ where: { id: SCOREBOARD_ID }, data: { hostName: clean } });
}

export async function adjustHostScore(delta: number) {
  await db.scoreboard.update({ where: { id: SCOREBOARD_ID }, data: { hostScore: { increment: delta } } });
}

export async function setHostScore(value: number) {
  await db.scoreboard.update({ where: { id: SCOREBOARD_ID }, data: { hostScore: Math.round(value) } });
}

export async function adjustTeamBonus(delta: number) {
  await db.scoreboard.update({ where: { id: SCOREBOARD_ID }, data: { teamBonus: { increment: delta } } });
}

export async function setTeamBonus(value: number) {
  await db.scoreboard.update({ where: { id: SCOREBOARD_ID }, data: { teamBonus: Math.round(value) } });
}

export async function setHostHidden(hidden: boolean) {
  await db.scoreboard.update({ where: { id: SCOREBOARD_ID }, data: { hostHidden: hidden } });
}

export async function resetScores() {
  await db.scoreTeam.updateMany({ where: { boardId: SCOREBOARD_ID }, data: { score: 0 } });
  await db.scoreboard.update({ where: { id: SCOREBOARD_ID }, data: { hostScore: 0, teamBonus: 0 } });
}

// 공용 액션 핸들러 (display 라우트와 control 라우트가 공유)
const actionSchema = z.object({
  intent: z.enum([
    "add-team", "remove-team", "rename-team", "adjust-team", "set-team", "move-team", "resize-team",
    "set-mode", "set-amounts", "set-sound", "rename-host", "adjust-host", "set-host",
    "adjust-team-bonus", "set-team-bonus", "set-theme", "set-card-color", "reset-scores", "reset-all",
  ]),
  teamId: z.coerce.number().optional(),
  name: z.string().optional(),
  theme: z.string().optional(),
  cardColor: z.string().optional(),
  delta: z.coerce.number().optional(),
  value: z.coerce.number().optional(),
  x: z.coerce.number().optional(),
  y: z.coerce.number().optional(),
  w: z.coerce.number().optional(),
  h: z.coerce.number().optional(),
  mode: z.enum(["teams", "hostSum", "hostEach"]).optional(),
  amount1: z.coerce.number().optional(),
  amount2: z.coerce.number().optional(),
  on: z.enum(["true", "false"]).optional(),
});

export async function handleScoreboardAction(request: Request) {
  const form = await request.formData();
  const parsed = actionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "잘못된 요청입니다." };
  const d = parsed.data;

  switch (d.intent) {
    case "add-team": await addTeam(); break;
    case "remove-team": if (d.teamId != null) await removeTeam(d.teamId); break;
    case "rename-team": if (d.teamId != null && d.name != null) await renameTeam(d.teamId, d.name); break;
    case "adjust-team": if (d.teamId != null && d.delta != null) await adjustTeamScore(d.teamId, d.delta); break;
    case "set-team": if (d.teamId != null && d.value != null) await setTeamScore(d.teamId, d.value); break;
    case "move-team": if (d.teamId != null && d.x != null && d.y != null) await moveTeam(d.teamId, d.x, d.y); break;
    case "resize-team": if (d.teamId != null && d.w != null && d.h != null) await resizeTeam(d.teamId, d.w, d.h); break;
    case "set-mode": if (d.mode) await setMode(d.mode); break;
    case "set-amounts": if (d.amount1 != null && d.amount2 != null) await setAmounts(d.amount1, d.amount2); break;
    case "set-sound": if (d.on) await setSound(d.on === "true"); break;
    case "set-theme": if (d.theme) await setTheme(d.theme); break;
    case "set-card-color": if (d.cardColor != null) await setCardColor(d.cardColor); break;
    case "rename-host": if (d.name != null) await renameHost(d.name); break;
    case "adjust-host": if (d.delta != null) await adjustHostScore(d.delta); break;
    case "set-host": if (d.value != null) await setHostScore(d.value); break;
    case "adjust-team-bonus": if (d.delta != null) await adjustTeamBonus(d.delta); break;
    case "set-team-bonus": if (d.value != null) await setTeamBonus(d.value); break;
    case "reset-scores": await resetScores(); break;
    case "reset-all": await resetAll(); break;
  }
  notifyScoreboard(); // 변경 즉시 다른 화면에 푸시
  return { success: true };
}

export async function resetAll() {
  await db.scoreTeam.deleteMany({ where: { boardId: SCOREBOARD_ID } });
  await db.scoreboard.update({
    where: { id: SCOREBOARD_ID },
    data: {
      mode: "teams",
      amount1: 50,
      amount2: 100,
      soundOn: true,
      hostName: "사회자",
      hostScore: 0,
      hostHidden: true,
      teamBonus: 0,
      theme: "slate",
      cardColor: "",
      teams: { create: defaultTeamsData() },
    },
  });
}
