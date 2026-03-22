import { Prisma, type PrismaClient } from "@prisma/client";
import * as z from "zod";

import { deleteImage, processAndUploadImage } from "~/lib/upload.server";

type RoutineDbClient = PrismaClient | Prisma.TransactionClient;

function getRoutineDb(db: RoutineDbClient) {
  return db as RoutineDbClient & {
    routineType: PrismaClient["$extends"] extends never ? never : any;
    routineRecord: any;
    routineDayNote: any;
  };
}

const ROUTINE_TYPE_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const ROUTINE_STATUSES = ["SUCCESS", "FAIL", "SKIPPED"] as const;

export type RoutineRecordStatusValue = (typeof ROUTINE_STATUSES)[number];

const createRoutineTypeSchema = z.object({
  intent: z.literal("create_routine_type"),
  name: z.string().trim().min(1).max(30),
  color: z
    .string()
    .trim()
    .optional()
    .refine((value) => value === undefined || ROUTINE_TYPE_COLOR_PATTERN.test(value), "루틴 색상을 다시 확인해 주세요."),
  weeklyGoalCount: z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    return Number(value);
  }, z.number().int().min(1).max(14).nullable()),
});

const updateRoutineTypeSchema = z.object({
  intent: z.literal("update_routine_type"),
  typeId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(30),
  color: z
    .string()
    .trim()
    .optional()
    .refine((value) => value === undefined || ROUTINE_TYPE_COLOR_PATTERN.test(value), "루틴 색상을 다시 확인해 주세요."),
  weeklyGoalCount: z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    return Number(value);
  }, z.number().int().min(1).max(14).nullable()),
});

const saveRoutineNoteSchema = z.object({
  intent: z.literal("save_routine_day_note"),
  memo: z.string().trim().max(1000).optional(),
});

const saveRoutineRecordSchema = z.object({
  intent: z.literal("save_routine_record"),
  typeId: z.coerce.number().int().positive(),
  recordId: z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    return Number(value);
  }, z.number().int().positive().nullable()),
  status: z.enum(ROUTINE_STATUSES),
  performedTime: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || /^\d{2}:\d{2}$/.test(value), "기록 시간을 다시 확인해 주세요."),
  memo: z.string().trim().max(300).optional(),
});

const deleteRoutineRecordSchema = z.object({
  intent: z.literal("delete_routine_record"),
  recordId: z.coerce.number().int().positive(),
});

function getDayStart(referenceDate: Date) {
  return new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), 0, 0, 0, 0);
}

function getNextDayStart(referenceDate: Date) {
  return new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate() + 1, 0, 0, 0, 0);
}

function combineDateAndTime(referenceDate: Date, timeValue?: string) {
  if (!timeValue) {
    return null;
  }

  const [hour, minute] = timeValue.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }

  return new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    hour,
    minute,
    0,
    0,
  );
}

function isFileLike(value: FormDataEntryValue | null): value is File {
  return typeof File !== "undefined" && value instanceof File && value.size > 0;
}

async function uploadRoutineImage(fileValue: FormDataEntryValue | null, currentUrl: string | null) {
  if (!isFileLike(fileValue)) {
    return currentUrl;
  }

  const uploaded = await processAndUploadImage(fileValue);
  if (!uploaded?.url) {
    return currentUrl;
  }

  if (currentUrl && currentUrl !== uploaded.url) {
    await deleteImage(currentUrl);
  }

  return uploaded.url;
}

export function formatRoutineTimeValue(value: string | null) {
  if (!value) {
    return "";
  }

  const performedAt = new Date(value);
  const hours = String(performedAt.getHours()).padStart(2, "0");
  const minutes = String(performedAt.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function getRoutineStatusLabel(status: RoutineRecordStatusValue) {
  if (status === "SUCCESS") return "성공";
  if (status === "FAIL") return "실패";
  return "건너뜀";
}

export async function loadRoutineTypes(db: RoutineDbClient, userId: string) {
  const routineDb = getRoutineDb(db);
  return routineDb.routineType.findMany({
    where: {
      userId,
      isActive: true,
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      color: true,
      weeklyGoalCount: true,
      sortOrder: true,
    },
  });
}

export async function loadRoutineDateSnapshot(db: RoutineDbClient, userId: string, referenceDate: Date) {
  const routineDb = getRoutineDb(db);
  const dayStart = getDayStart(referenceDate);
  const nextDayStart = getNextDayStart(referenceDate);

  const [types, records, dayNote] = await Promise.all([
    loadRoutineTypes(db, userId),
    routineDb.routineRecord.findMany({
      where: {
        userId,
        recordDate: {
          gte: dayStart,
          lt: nextDayStart,
        },
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        typeId: true,
        status: true,
        performedAt: true,
        photoUrl1: true,
        photoUrl2: true,
        memo: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    routineDb.routineDayNote.findUnique({
      where: {
        userId_recordDate: {
          userId,
          recordDate: dayStart,
        },
      },
      select: {
        id: true,
        memo: true,
      },
    }),
  ]);

  const latestRecordByType = new Map<number, (typeof records)[number]>();
  for (const record of records) {
    if (!latestRecordByType.has(record.typeId)) {
      latestRecordByType.set(record.typeId, record);
    }
  }

  return {
    routineTypes: types.map((type: any) => ({
      ...type,
      todayRecord: latestRecordByType.get(type.id) ?? null,
    })),
    dayNote: dayNote ?? null,
  };
}

export async function loadRoutineCalendarRecords(db: RoutineDbClient, userId: string, rangeStart: Date, rangeEnd: Date) {
  const routineDb = getRoutineDb(db);
  return routineDb.routineRecord.findMany({
    where: {
      userId,
      recordDate: {
        gte: rangeStart,
        lt: rangeEnd,
      },
    },
    select: {
      id: true,
      typeId: true,
      status: true,
      recordDate: true,
      createdAt: true,
      type: {
        select: {
          id: true,
          color: true,
          sortOrder: true,
        },
      },
    },
  });
}

export async function createRoutineType(db: RoutineDbClient, userId: string, formData: FormData) {
  const routineDb = getRoutineDb(db);
  const parsed = createRoutineTypeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("루틴 이름을 다시 확인해 주세요.");
  }

  const duplicate = await routineDb.routineType.findFirst({
    where: {
      userId,
      name: parsed.data.name,
      isActive: true,
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new Error("같은 이름의 루틴이 이미 있어요.");
  }

  const lastType = await routineDb.routineType.findFirst({
    where: { userId },
    orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
    select: { sortOrder: true },
  });

  await routineDb.routineType.create({
    data: {
      userId,
      name: parsed.data.name,
      color: parsed.data.color,
      weeklyGoalCount: parsed.data.weeklyGoalCount,
      sortOrder: (lastType?.sortOrder ?? 0) + 1,
    },
  });
}

export async function updateRoutineType(db: RoutineDbClient, userId: string, formData: FormData) {
  const routineDb = getRoutineDb(db);
  const parsed = updateRoutineTypeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("루틴 이름을 다시 확인해 주세요.");
  }

  const existingType = await routineDb.routineType.findFirst({
    where: {
      id: parsed.data.typeId,
      userId,
      isActive: true,
    },
    select: { id: true },
  });

  if (!existingType) {
    throw new Error("수정할 루틴 타입을 찾을 수 없어요.");
  }

  const duplicate = await routineDb.routineType.findFirst({
    where: {
      userId,
      name: parsed.data.name,
      isActive: true,
      NOT: { id: parsed.data.typeId },
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new Error("같은 이름의 루틴이 이미 있어요.");
  }

  await routineDb.routineType.update({
    where: { id: parsed.data.typeId },
    data: {
      name: parsed.data.name,
      color: parsed.data.color,
      weeklyGoalCount: parsed.data.weeklyGoalCount,
    },
  });
}

export async function saveRoutineDayNote(db: RoutineDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const routineDb = getRoutineDb(db);
  const parsed = saveRoutineNoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("하루 메모를 다시 확인해 주세요.");
  }

  const dayStart = getDayStart(referenceDate);
  const memo = parsed.data.memo?.trim() || null;

  if (!memo) {
    await routineDb.routineDayNote.deleteMany({
      where: {
        userId,
        recordDate: dayStart,
      },
    });
    return;
  }

  await routineDb.routineDayNote.upsert({
    where: {
      userId_recordDate: {
        userId,
        recordDate: dayStart,
      },
    },
    update: {
      memo,
    },
    create: {
      userId,
      recordDate: dayStart,
      memo,
    },
  });
}

export async function saveRoutineRecord(db: RoutineDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const routineDb = getRoutineDb(db);
  const parsed = saveRoutineRecordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("루틴 기록을 다시 확인해 주세요.");
  }

  const routineType = await routineDb.routineType.findFirst({
    where: {
      id: parsed.data.typeId,
      userId,
      isActive: true,
    },
    select: { id: true },
  });

  if (!routineType) {
    throw new Error("기록할 루틴 타입을 찾을 수 없어요.");
  }

  const dayStart = getDayStart(referenceDate);
  const nextDayStart = getNextDayStart(referenceDate);

  const existingRecord =
    parsed.data.recordId !== null
      ? await routineDb.routineRecord.findFirst({
          where: {
            id: parsed.data.recordId,
            userId,
          },
        })
      : await routineDb.routineRecord.findFirst({
          where: {
            userId,
            typeId: parsed.data.typeId,
            recordDate: {
              gte: dayStart,
              lt: nextDayStart,
            },
          },
          orderBy: [{ createdAt: "desc" }],
        });

  const nextPhotoUrl1 = await uploadRoutineImage(formData.get("photo1"), existingRecord?.photoUrl1 ?? null);
  const nextPhotoUrl2 = await uploadRoutineImage(formData.get("photo2"), existingRecord?.photoUrl2 ?? null);
  const performedAt = combineDateAndTime(referenceDate, parsed.data.performedTime);
  const memo = parsed.data.memo?.trim() || null;

  if (existingRecord) {
    await routineDb.routineRecord.update({
      where: { id: existingRecord.id },
      data: {
        status: parsed.data.status,
        performedAt,
        photoUrl1: nextPhotoUrl1,
        photoUrl2: nextPhotoUrl2,
        memo,
      },
    });
    return;
  }

  await routineDb.routineRecord.create({
    data: {
      userId,
      typeId: parsed.data.typeId,
      status: parsed.data.status,
      recordDate: dayStart,
      performedAt,
      photoUrl1: nextPhotoUrl1,
      photoUrl2: nextPhotoUrl2,
      memo,
    },
  });
}

export async function deleteRoutineRecord(db: RoutineDbClient, userId: string, formData: FormData) {
  const routineDb = getRoutineDb(db);
  const parsed = deleteRoutineRecordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new Error("삭제할 루틴 기록을 찾을 수 없어요.");
  }

  const existingRecord = await routineDb.routineRecord.findFirst({
    where: {
      id: parsed.data.recordId,
      userId,
    },
  });

  if (!existingRecord) {
    throw new Error("삭제할 루틴 기록을 찾을 수 없어요.");
  }

  await routineDb.routineRecord.delete({
    where: { id: existingRecord.id },
  });

  await Promise.all(
    [existingRecord.photoUrl1, existingRecord.photoUrl2]
      .filter((url): url is string => Boolean(url))
      .map((url) => deleteImage(url)),
  );
}
