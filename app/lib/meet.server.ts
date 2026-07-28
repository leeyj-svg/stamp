import * as z from "zod";
import { Prisma } from "@prisma/client";
import { db } from "./db.server";
import { getSession } from "./auth.server";
import {
  MAX_CANDIDATE_DATES,
  MAX_SLOTS,
  enumerateSlots,
  slotCount,
  type MeetEventView,
  type MeetResponseView,
} from "./meet";

function toJson(v: unknown) {
  return v as unknown as Prisma.InputJsonValue;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// ---- zod 스키마 ----
export const createEventSchema = z
  .object({
    title: z.string().trim().min(1, "제목을 입력하세요.").max(100),
    granularity: z.enum(["DATE", "DATE_TIME"]),
    candidateDates: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .min(1, "후보 날짜를 하나 이상 선택하세요.")
      .max(MAX_CANDIDATE_DATES, `날짜는 최대 ${MAX_CANDIDATE_DATES}일까지 가능합니다.`),
    slotMinutes: z.coerce.number().int().optional(),
    startMinute: z.coerce.number().int().min(0).max(1439).optional(),
    endMinute: z.coerce.number().int().min(1).max(1440).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.granularity !== "DATE_TIME") return;
    if (!v.slotMinutes || ![10, 30, 60].includes(v.slotMinutes)) {
      ctx.addIssue({ code: "custom", message: "슬롯 단위를 선택하세요.", path: ["slotMinutes"] });
      return;
    }
    if (v.startMinute == null || v.endMinute == null || v.endMinute <= v.startMinute) {
      ctx.addIssue({ code: "custom", message: "시간대(시작~끝)를 올바르게 설정하세요.", path: ["endMinute"] });
      return;
    }
    const rows = Math.floor((v.endMinute - v.startMinute) / v.slotMinutes);
    if (v.candidateDates.length * rows > MAX_SLOTS) {
      ctx.addIssue({ code: "custom", message: `칸이 너무 많습니다. (최대 ${MAX_SLOTS}칸) 날짜나 시간 범위를 줄이세요.`, path: ["endMinute"] });
    }
  });

export const respondSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요.").max(40),
  password: z.string().min(1, "비밀번호를 입력하세요.").max(64),
  availability: z.array(z.string()).max(MAX_SLOTS + 100),
  responseId: z.string().optional(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type RespondInput = z.infer<typeof respondSchema>;

// ---- 매핑 ----
function toEventView(e: {
  id: string;
  title: string;
  granularity: "DATE" | "DATE_TIME";
  candidateDates: unknown;
  slotMinutes: number | null;
  startMinute: number | null;
  endMinute: number | null;
}): MeetEventView {
  return {
    id: e.id,
    title: e.title,
    granularity: e.granularity,
    candidateDates: asStringArray(e.candidateDates).slice().sort(),
    slotMinutes: e.slotMinutes,
    startMinute: e.startMinute,
    endMinute: e.endMinute,
  };
}

// ---- 읽기 ----
export async function getMeetEventWithResponses(
  id: string,
): Promise<{ event: MeetEventView; responses: MeetResponseView[] } | null> {
  const e = await db.meetEvent.findUnique({
    where: { id },
    include: { responses: { orderBy: { createdAt: "asc" } } },
  });
  if (!e) return null;
  return {
    event: toEventView(e),
    responses: e.responses.map((r) => ({
      id: r.id,
      name: r.name,
      availability: asStringArray(r.availability),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

// ---- 쓰기 ----
export async function createMeetEvent(request: Request, input: CreateEventInput): Promise<string> {
  const { user } = await getSession(request);
  const isDateTime = input.granularity === "DATE_TIME";
  const dates = Array.from(new Set(input.candidateDates)).sort();
  const created = await db.meetEvent.create({
    data: {
      title: input.title,
      granularity: input.granularity,
      candidateDates: toJson(dates),
      slotMinutes: isDateTime ? input.slotMinutes! : null,
      startMinute: isDateTime ? input.startMinute! : null,
      endMinute: isDateTime ? input.endMinute! : null,
      // writerId 컬럼은 없으나(이벤트엔 불필요) 로그인 여부는 무시 — 링크로 공유되는 익명 도구
    },
  });
  void user; // (이벤트에는 소유자 정보를 저장하지 않음 — 공개 링크 도구)
  return created.id;
}

export type UpsertResult = { ok: true; responseId: string };

export async function upsertMeetResponse(
  request: Request,
  eventId: string,
  input: RespondInput,
): Promise<UpsertResult | null> {
  const e = await db.meetEvent.findUnique({ where: { id: eventId } });
  if (!e) return null;
  const view = toEventView(e);
  const valid = new Set(enumerateSlots(view));
  const availability = Array.from(new Set(input.availability)).filter((k) => valid.has(k));

  const { user } = await getSession(request);
  const name = input.name.trim();

  // 1) 본인 기기(responseId) 편집
  if (input.responseId) {
    const own = await db.meetResponse.findUnique({ where: { id: input.responseId } });
    if (own && own.eventId === eventId) {
      const updated = await db.meetResponse.update({
        where: { id: own.id },
        data: { name, password: input.password, availability: toJson(availability), writerId: user?.id ?? null },
      });
      return { ok: true, responseId: updated.id };
    }
  }

  // 2) (name, password) 일치 행이 있으면 수정, 없으면 신규 (동명이인은 비번 다르면 별도 행)
  const match = await db.meetResponse.findFirst({ where: { eventId, name, password: input.password } });
  if (match) {
    const updated = await db.meetResponse.update({
      where: { id: match.id },
      data: { availability: toJson(availability), writerId: user?.id ?? null },
    });
    return { ok: true, responseId: updated.id };
  }

  const created = await db.meetResponse.create({
    data: { eventId, name, password: input.password, availability: toJson(availability), writerId: user?.id ?? null },
  });
  return { ok: true, responseId: created.id };
}

export { slotCount };
