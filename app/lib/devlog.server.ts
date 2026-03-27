import { Prisma } from "@prisma/client";
import type { DevWorkAttachmentKind, DevWorkLogType, PrismaClient } from "@prisma/client";

import {
  DEVLOG_CLOSED_STATUS_KEYS,
  DEVLOG_HIDDEN_BOARD_STATUS_KEYS,
  DEVLOG_NEXT_WORK_STATUS_PRIORITY,
  createDevlogStatusKey,
  extractDevlogWorkItemReferenceIds,
  getDefaultDevlogStatuses,
  getDevlogStatusLabel,
  type DevlogStatusValue,
} from "~/lib/devlog";
import { deleteImage, isStorageUploadAvailable, uploadFileToStorage } from "~/lib/upload.server";

type DevlogDbClient = PrismaClient | Prisma.TransactionClient;

function getDayStart(referenceDate: Date) {
  return new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), 0, 0, 0, 0);
}

function normalizeMultilineText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\r\n/g, "\n");
  return normalized.trim().length > 0 ? normalized : null;
}

function normalizeShortText(value: FormDataEntryValue | null, fallback?: string) {
  if (typeof value !== "string") {
    return fallback ?? null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return fallback ?? null;
  }

  return normalized;
}

function parsePositiveInt(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseInteger(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseDateInput(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseStatusKey(value: FormDataEntryValue | null, fallback = "TODO") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function parseBooleanFlag(value: FormDataEntryValue | null) {
  return value === "1" || value === "true" || value === "on";
}

function serializeDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function getDefaultStatusTitles() {
  return Object.fromEntries(getDefaultDevlogStatuses().map((status) => [status.statusKey, status.label])) as Record<string, string>;
}

function normalizeStatusTitles(value: Prisma.JsonValue | null | undefined) {
  const defaults = getDefaultStatusTitles();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const record = value as Record<string, unknown>;
  const nextTitles = { ...defaults };

  for (const status of Object.keys(defaults)) {
    const currentValue = record[status];
    if (typeof currentValue === "string" && currentValue.trim().length > 0) {
      nextTitles[status] = currentValue.trim();
    }
  }

  return nextTitles;
}

function getFallbackStatusKey(statuses: Array<{ statusKey: string }>) {
  return statuses.find((status) => status.statusKey === "TODO")?.statusKey ?? statuses[0]?.statusKey ?? "TODO";
}

function getStatusLabelMap(statuses: Array<{ statusKey: string; label: string }>) {
  return Object.fromEntries(statuses.map((status) => [status.statusKey, status.label])) as Record<string, string>;
}

async function ensureDevWorkStatuses(db: DevlogDbClient, userId: string) {
  const existingStatuses = await db.devWorkStatusDefinition.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      statusKey: true,
      label: true,
      sortOrder: true,
    },
  });

  if (existingStatuses.length > 0) {
    return existingStatuses;
  }

  const latestPageWithTitles = await db.devDiaryPage.findFirst({
    where: {
      userId,
      statusTitlesJson: {
        not: Prisma.AnyNull,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      statusTitlesJson: true,
    },
  });

  const seededTitles = normalizeStatusTitles(latestPageWithTitles?.statusTitlesJson);
  await db.devWorkStatusDefinition.createMany({
    data: getDefaultDevlogStatuses().map((status) => ({
      userId,
      statusKey: status.statusKey,
      label: seededTitles[status.statusKey] ?? status.label,
      sortOrder: status.sortOrder,
    })),
  });

  return db.devWorkStatusDefinition.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      statusKey: true,
      label: true,
      sortOrder: true,
    },
  });
}

async function requireDevWorkStatusDefinition(db: DevlogDbClient, userId: string, statusKey: string) {
  const statuses = await ensureDevWorkStatuses(db, userId);
  const status = statuses.find((item) => item.statusKey === statusKey);

  if (!status) {
    throw new Error("상태 카드를 찾을 수 없어요.");
  }

  return {
    status,
    statuses,
  };
}

function clampPosition(value: number, fallback: number) {
  return Math.max(16, Math.min(4000, Number.isFinite(value) ? value : fallback));
}

function getAttachmentKind(file: File): DevWorkAttachmentKind {
  if (file.type.startsWith("image/")) {
    return "IMAGE";
  }

  if (
    file.type.includes("zip") ||
    file.type.includes("tar") ||
    file.type.includes("compressed") ||
    /\.(zip|7z|rar|tar|gz)$/i.test(file.name || "")
  ) {
    return "ARCHIVE";
  }

  if (
    file.type.startsWith("text/") ||
    file.type.includes("json") ||
    file.type.includes("pdf") ||
    file.type.includes("msword") ||
    file.type.includes("officedocument")
  ) {
    return "DOCUMENT";
  }

  return "OTHER";
}

async function createWorkLog(
  db: DevlogDbClient,
  userId: string,
  workItemId: number,
  type: DevWorkLogType,
  input?: {
    logDate?: Date;
    message?: string | null;
    noteMd?: string | null;
    meta?: Prisma.InputJsonValue | null;
  },
) {
  await db.devWorkLog.create({
    data: {
      userId,
      workItemId,
      type,
      logDate: input?.logDate ?? new Date(),
      message: input?.message ?? null,
      noteMd: input?.noteMd ?? null,
      meta: input?.meta ?? undefined,
    },
  });
}

async function ensureDiaryPage(db: DevlogDbClient, userId: string, referenceDate: Date) {
  const pageDate = getDayStart(referenceDate);

  return db.devDiaryPage.upsert({
    where: {
      userId_pageDate: {
        userId,
        pageDate,
      },
    },
    update: {},
    create: {
      userId,
      pageDate,
    },
    select: {
      id: true,
      pageDate: true,
      title: true,
      noteMd: true,
      statusTitlesJson: true,
      updatedAt: true,
    },
  });
}

async function requireWorkItem(db: DevlogDbClient, userId: string, workItemId: number) {
  const workItem = await db.devWorkItem.findFirst({
    where: {
      id: workItemId,
      userId,
    },
    select: {
      id: true,
      title: true,
      status: true,
      parentWorkItemId: true,
      contentMd: true,
      nextAction: true,
      sortOrder: true,
      isPinned: true,
      isMinimized: true,
      boardX: true,
      boardY: true,
      plannedDate: true,
      startedAt: true,
      completedAt: true,
    },
  });

  if (!workItem) {
    throw new Error("작업 카드를 찾을 수 없어요.");
  }

  return workItem;
}

async function resolveParentWorkItemId(
  db: DevlogDbClient,
  userId: string,
  workItemId: number | null,
  parentWorkItemId: number | null,
) {
  if (!parentWorkItemId) {
    return null;
  }

  if (workItemId && parentWorkItemId === workItemId) {
    throw new Error("자기 자신을 상위 카드로 연결할 수 없어요.");
  }

  const parentWorkItem = await db.devWorkItem.findFirst({
    where: {
      id: parentWorkItemId,
      userId,
    },
    select: {
      id: true,
      parentWorkItemId: true,
    },
  });

  if (!parentWorkItem) {
    throw new Error("상위 카드로 연결할 작업을 찾을 수 없어요.");
  }

  if (!workItemId) {
    return parentWorkItem.id;
  }

  let currentParentId = parentWorkItem.parentWorkItemId;
  while (currentParentId) {
    if (currentParentId === workItemId) {
      throw new Error("하위 카드 밑으로 다시 연결할 수 없어요.");
    }

    const nextWorkItem = await db.devWorkItem.findFirst({
      where: {
        id: currentParentId,
        userId,
      },
      select: {
        parentWorkItemId: true,
      },
    });

    currentParentId = nextWorkItem?.parentWorkItemId ?? null;
  }

  return parentWorkItem.id;
}

function serializeChecklistItem(item: {
  id: number;
  content: string;
  isDone: boolean;
  isTodayTodo: boolean;
  completedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  sortOrder: number;
}) {
  return {
    ...item,
    completedAt: serializeDate(item.completedAt),
    createdAt: item.createdAt ? serializeDate(item.createdAt) : undefined,
    updatedAt: item.updatedAt ? serializeDate(item.updatedAt) : undefined,
  };
}

function serializeAttachment(item: {
  id: number;
  kind: DevWorkAttachmentKind;
  fileName: string;
  url: string;
  mimeType: string | null;
  byteSize: number | null;
  createdAt: Date;
}) {
  return {
    ...item,
    createdAt: serializeDate(item.createdAt),
  };
}

function serializeDashboardItem(item: {
  id: number;
  title: string;
  status: DevlogStatusValue;
  contentMd: string | null;
  nextAction: string | null;
  priority: number;
  sortOrder: number;
  isMinimized: boolean;
  isPinned: boolean;
  boardX: number;
  boardY: number;
  plannedDate: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastWorkedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  checklist: Array<{
    id: number;
    content: string;
    isDone: boolean;
    isTodayTodo: boolean;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    sortOrder: number;
  }>;
  diaryPages?: Array<{
    page: {
      pageDate: Date;
      title: string | null;
    };
  }>;
}) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    contentMd: item.contentMd,
    nextAction: item.nextAction,
    priority: item.priority,
    sortOrder: item.sortOrder,
    isMinimized: item.isMinimized,
    isPinned: item.isPinned,
    boardX: item.boardX,
    boardY: item.boardY,
    plannedDate: serializeDate(item.plannedDate),
    startedAt: serializeDate(item.startedAt),
    completedAt: serializeDate(item.completedAt),
    lastWorkedAt: serializeDate(item.lastWorkedAt),
    createdAt: serializeDate(item.createdAt),
    updatedAt: serializeDate(item.updatedAt),
    checklist: item.checklist.map(serializeChecklistItem),
    lastDiaryPage: item.diaryPages?.[0]
      ? {
          pageDate: item.diaryPages[0].page.pageDate.toISOString(),
          title: item.diaryPages[0].page.title ?? "",
        }
      : null,
  };
}

function getDashboardCardSelect() {
  return {
    id: true,
    title: true,
    status: true,
    contentMd: true,
    nextAction: true,
    priority: true,
    sortOrder: true,
    isMinimized: true,
    isPinned: true,
    boardX: true,
    boardY: true,
    plannedDate: true,
    startedAt: true,
    completedAt: true,
    lastWorkedAt: true,
    createdAt: true,
    updatedAt: true,
    checklist: {
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        content: true,
        isDone: true,
        isTodayTodo: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
        sortOrder: true,
      },
    },
    diaryPages: {
      orderBy: [{ createdAt: "desc" }],
      take: 1,
      select: {
        page: {
          select: {
            pageDate: true,
            title: true,
          },
        },
      },
    },
  } satisfies Prisma.DevWorkItemSelect;
}

function getBoardPositionByIndex(index: number) {
  const column = index % 4;
  const row = Math.floor(index / 4);

  return {
    boardX: 32 + column * 260,
    boardY: 32 + row * 200,
  };
}

export async function loadDevDashboardSnapshot(db: DevlogDbClient, userId: string, referenceDate: Date) {
  const pageDate = getDayStart(referenceDate);
  const dashboardCardSelect = getDashboardCardSelect();
  const statuses = await ensureDevWorkStatuses(db, userId);

  const [
    page,
    dateEntries,
    openWorkItems,
    minimizedWorkItems,
    statusCountRows,
    todayTodoCount,
    recentPages,
    nextCandidates,
  ] = await Promise.all([
    db.devDiaryPage.findUnique({
      where: {
        userId_pageDate: {
          userId,
          pageDate,
        },
      },
      select: {
        id: true,
        title: true,
        noteMd: true,
        statusTitlesJson: true,
        updatedAt: true,
      },
    }),
    db.devDiaryPageEntry.findMany({
      where: {
        page: {
          userId,
          pageDate,
        },
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        sortOrder: true,
        workItem: {
          select: dashboardCardSelect,
        },
      },
    }),
    db.devWorkItem.findMany({
      where: {
        userId,
        isMinimized: false,
        status: {
          notIn: [...DEVLOG_HIDDEN_BOARD_STATUS_KEYS],
        },
      },
      orderBy: [{ isPinned: "desc" }, { lastWorkedAt: "desc" }, { updatedAt: "desc" }],
      take: 10,
      select: dashboardCardSelect,
    }),
    db.devWorkItem.findMany({
      where: {
        userId,
        isMinimized: true,
        status: {
          notIn: [...DEVLOG_HIDDEN_BOARD_STATUS_KEYS],
        },
      },
      orderBy: [{ isPinned: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
      select: dashboardCardSelect,
    }),
    db.devWorkItem.groupBy({
      by: ["status"],
      where: { userId },
      _count: {
        status: true,
      },
    }),
    db.devWorkChecklistItem.count({
      where: {
        isTodayTodo: true,
        isDone: false,
        workItem: {
          userId,
          status: {
            notIn: [...DEVLOG_CLOSED_STATUS_KEYS],
          },
        },
      },
    }),
    db.devDiaryPage.findMany({
      where: { userId },
      orderBy: [{ pageDate: "desc" }],
      take: 10,
      select: {
        id: true,
        title: true,
        pageDate: true,
        updatedAt: true,
        _count: {
          select: {
            workItems: true,
          },
        },
      },
    }),
    db.devWorkItem.findMany({
      where: {
        userId,
        status: {
          notIn: [...DEVLOG_CLOSED_STATUS_KEYS],
        },
      },
      orderBy: [{ isPinned: "desc" }, { lastWorkedAt: "desc" }, { updatedAt: "desc" }],
      take: 40,
      select: {
        id: true,
        title: true,
        status: true,
        nextAction: true,
        updatedAt: true,
      },
    }),
  ]);

  const dateItems = dateEntries.map((entry) => ({
    pageEntryId: entry.id,
    pageSortOrder: entry.sortOrder,
    ...serializeDashboardItem(entry.workItem),
  }));
  const linkedIds = new Set(dateItems.map((item) => item.id));
  const statusCounts = Object.fromEntries(statuses.map((status) => [status.statusKey, 0])) as Record<string, number>;

  for (const row of statusCountRows) {
    statusCounts[row.status] = row._count.status;
  }

  const nextWorkItem =
    DEVLOG_NEXT_WORK_STATUS_PRIORITY.map((statusKey) => nextCandidates.find((item) => item.status === statusKey)).find(Boolean) ??
    nextCandidates[0] ??
    null;

  return {
    page: page
      ? {
          id: page.id,
          title: page.title ?? "",
          noteMd: page.noteMd ?? "",
          updatedAt: page.updatedAt.toISOString(),
        }
      : null,
    statuses: statuses.map((status) => ({
      key: status.statusKey,
      label: status.label,
      sortOrder: status.sortOrder,
    })),
    dateItems,
    openWorkItems: openWorkItems.map(serializeDashboardItem),
    minimizedBoardItems: minimizedWorkItems.map(serializeDashboardItem),
    recentMinimizedItems: minimizedWorkItems
      .filter((item) => !linkedIds.has(item.id))
      .slice(0, 8)
      .map(serializeDashboardItem),
    recentPages: recentPages.map((item) => ({
      id: item.id,
      title: item.title ?? "",
      pageDate: item.pageDate.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      workItemCount: item._count.workItems,
    })),
    statusCounts,
    todayTodoCount,
    nextWorkItem,
  };
}

export async function saveDevDiaryPage(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const title = normalizeShortText(formData.get("title"), "") ?? "";
  const noteMd = normalizeMultilineText(formData.get("noteMd"));
  const page = await ensureDiaryPage(db, userId, referenceDate);

  await db.devDiaryPage.update({
    where: { id: page.id },
    data: {
      title,
      noteMd,
    },
  });
}

export async function saveDevWorkStatusDefinition(db: DevlogDbClient, userId: string, _referenceDate: Date, formData: FormData) {
  const statusKey = parseStatusKey(formData.get("status"), "");
  const statusTitle = normalizeShortText(formData.get("statusTitle"));
  if (!statusKey || !statusTitle) {
    throw new Error("상태 제목을 저장할 수 없어요.");
  }

  const { status } = await requireDevWorkStatusDefinition(db, userId, statusKey);
  await db.devWorkStatusDefinition.update({
    where: { id: status.id },
    data: {
      label: statusTitle,
    },
  });
}

export async function createDevWorkStatusDefinition(db: DevlogDbClient, userId: string, _referenceDate: Date, formData: FormData) {
  const statusTitle = normalizeShortText(formData.get("statusTitle"));
  if (!statusTitle) {
    throw new Error("상태 카드를 만들 이름이 필요해요.");
  }

  const statuses = await ensureDevWorkStatuses(db, userId);
  const statusKey = createDevlogStatusKey(
    statusTitle,
    statuses.map((status) => status.statusKey),
  );

  await db.devWorkStatusDefinition.create({
    data: {
      userId,
      statusKey,
      label: statusTitle,
      sortOrder: (statuses[statuses.length - 1]?.sortOrder ?? 0) + 10,
    },
  });
}

export async function deleteDevWorkStatusDefinition(db: DevlogDbClient, userId: string, _referenceDate: Date, formData: FormData) {
  const statusKey = parseStatusKey(formData.get("status"), "");
  if (!statusKey) {
    throw new Error("삭제할 상태 카드를 찾을 수 없어요.");
  }

  const { status, statuses } = await requireDevWorkStatusDefinition(db, userId, statusKey);
  if (statuses.length <= 1) {
    throw new Error("상태 카드는 하나 이상 남아 있어야 해요.");
  }

  const workItemCount = await db.devWorkItem.count({
    where: {
      userId,
      status: status.statusKey,
    },
  });

  if (workItemCount > 0) {
    throw new Error("작업 카드가 남아 있는 상태는 삭제할 수 없어요.");
  }

  await db.devWorkStatusDefinition.delete({
    where: { id: status.id },
  });
}

export async function createDevWorkItem(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const title = normalizeShortText(formData.get("title"), "새 작업") ?? "새 작업";
  const statuses = await ensureDevWorkStatuses(db, userId);
  const requestedStatus = parseStatusKey(formData.get("status"), getFallbackStatusKey(statuses));
  const status = statuses.some((item) => item.statusKey === requestedStatus) ? requestedStatus : getFallbackStatusKey(statuses);
  const parentWorkItemId = await resolveParentWorkItemId(db, userId, null, parsePositiveInt(formData.get("parentWorkItemId")));
  const nextAction = normalizeShortText(formData.get("nextAction"));
  const contentMd = normalizeMultilineText(formData.get("contentMd"));
  const plannedDate = parseDateInput(formData.get("plannedDate"));
  const page = await ensureDiaryPage(db, userId, referenceDate);

  const [lastPageEntry, lastWorkItem, minimizedCount] = await Promise.all([
    db.devDiaryPageEntry.findFirst({
      where: { pageId: page.id },
      orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
      select: { sortOrder: true },
    }),
    db.devWorkItem.findFirst({
      where: { userId },
      orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
      select: { sortOrder: true },
    }),
    db.devWorkItem.count({
      where: {
        userId,
        isMinimized: true,
        status: {
          notIn: [...DEVLOG_HIDDEN_BOARD_STATUS_KEYS],
        },
      },
    }),
  ]);

  const now = new Date();
  const boardPosition = getBoardPositionByIndex(minimizedCount);
  const workItem = await db.devWorkItem.create({
    data: {
      userId,
      parentWorkItemId,
      title,
      status,
      nextAction,
      contentMd,
      plannedDate,
      sortOrder: (lastWorkItem?.sortOrder ?? 0) + 10,
      boardX: boardPosition.boardX,
      boardY: boardPosition.boardY,
      startedAt: status === "IN_PROGRESS" ? now : null,
      completedAt: status === "DONE" ? now : null,
      lastWorkedAt: now,
      diaryPages: {
        create: {
          pageId: page.id,
          sortOrder: (lastPageEntry?.sortOrder ?? 0) + 10,
        },
      },
    },
    select: { id: true },
  });

  await createWorkLog(db, userId, workItem.id, "CREATED", {
    logDate: getDayStart(referenceDate),
    message: `${title} 작업을 만들었어요.`,
    noteMd: contentMd,
  });
}

export async function saveDevWorkItem(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const workItemId = parsePositiveInt(formData.get("workItemId"));
  if (!workItemId) {
    throw new Error("저장할 작업 카드를 찾을 수 없어요.");
  }

  const statuses = await ensureDevWorkStatuses(db, userId);
  const existing = await requireWorkItem(db, userId, workItemId);
  const title = normalizeShortText(formData.get("title"), existing.title) ?? existing.title;
  const requestedStatus = parseStatusKey(formData.get("status"), existing.status);
  const status = statuses.some((item) => item.statusKey === requestedStatus) ? requestedStatus : getFallbackStatusKey(statuses);
  const parentWorkItemId = await resolveParentWorkItemId(db, userId, existing.id, parsePositiveInt(formData.get("parentWorkItemId")));
  const nextAction = normalizeShortText(formData.get("nextAction"));
  const contentMd = normalizeMultilineText(formData.get("contentMd"));
  const plannedDate = parseDateInput(formData.get("plannedDate"));
  const isPinned = parseBooleanFlag(formData.get("isPinned"));
  const now = new Date();
  const statusLabelMap = getStatusLabelMap(statuses);

  await db.devWorkItem.update({
    where: { id: existing.id },
    data: {
      title,
      status,
      parentWorkItemId,
      nextAction,
      contentMd,
      plannedDate,
      isPinned,
      startedAt: status === "IN_PROGRESS" ? existing.startedAt ?? now : existing.startedAt,
      completedAt: status === "DONE" ? existing.completedAt ?? now : null,
      lastWorkedAt: now,
    },
  });

  if (existing.status !== status) {
    await createWorkLog(db, userId, existing.id, "STATUS_CHANGED", {
      logDate: getDayStart(referenceDate),
      message: `${getDevlogStatusLabel(existing.status, statusLabelMap)}에서 ${getDevlogStatusLabel(status, statusLabelMap)}로 상태를 바꿨어요.`,
      meta: {
        from: existing.status,
        to: status,
      },
    });
  }

  if (existing.parentWorkItemId !== parentWorkItemId) {
    await createWorkLog(db, userId, existing.id, "NOTE_UPDATED", {
      logDate: getDayStart(referenceDate),
      message: parentWorkItemId ? "상위 카드를 연결했어요." : "상위 카드 연결을 해제했어요.",
      meta: {
        fromParentWorkItemId: existing.parentWorkItemId,
        toParentWorkItemId: parentWorkItemId,
      },
    });
  }

  if (existing.contentMd !== contentMd || existing.nextAction !== nextAction) {
    await createWorkLog(db, userId, existing.id, "NOTE_UPDATED", {
      logDate: getDayStart(referenceDate),
      message: "작업 메모를 업데이트했어요.",
      noteMd: contentMd,
    });
  }
}

export async function setDevWorkItemMinimized(
  db: DevlogDbClient,
  userId: string,
  referenceDate: Date,
  formData: FormData,
  isMinimized: boolean,
) {
  const workItemId = parsePositiveInt(formData.get("workItemId"));
  if (!workItemId) {
    throw new Error("작업 카드를 찾을 수 없어요.");
  }

  const workItem = await requireWorkItem(db, userId, workItemId);

  await db.devWorkItem.update({
    where: { id: workItem.id },
    data: {
      isMinimized,
      lastWorkedAt: new Date(),
    },
  });

  await createWorkLog(db, userId, workItem.id, isMinimized ? "MINIMIZED" : "RESTORED", {
    logDate: getDayStart(referenceDate),
    message: isMinimized ? "작업 카드를 보드로 최소화했어요." : "작업 카드를 다시 꺼냈어요.",
  });
}

export async function attachDevWorkItemToDiaryPage(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const workItemId = parsePositiveInt(formData.get("workItemId"));
  if (!workItemId) {
    throw new Error("가져올 작업 카드를 찾을 수 없어요.");
  }

  const workItem = await requireWorkItem(db, userId, workItemId);
  const page = await ensureDiaryPage(db, userId, referenceDate);
  const lastPageEntry = await db.devDiaryPageEntry.findFirst({
    where: { pageId: page.id },
    orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
    select: { sortOrder: true },
  });

  await db.devDiaryPageEntry.upsert({
    where: {
      pageId_workItemId: {
        pageId: page.id,
        workItemId: workItem.id,
      },
    },
    update: {
      sortOrder: (lastPageEntry?.sortOrder ?? 0) + 10,
    },
    create: {
      pageId: page.id,
      workItemId: workItem.id,
      sortOrder: (lastPageEntry?.sortOrder ?? 0) + 10,
    },
  });

  await db.devWorkItem.update({
    where: { id: workItem.id },
    data: {
      isMinimized: false,
      lastWorkedAt: new Date(),
    },
  });

  await createWorkLog(db, userId, workItem.id, "RESTORED", {
    logDate: getDayStart(referenceDate),
    message: "선택한 날짜 페이지로 작업 카드를 다시 연결했어요.",
  });
}

export async function createDevWorkChecklistItem(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const workItemId = parsePositiveInt(formData.get("workItemId"));
  if (!workItemId) {
    throw new Error("체크리스트를 추가할 작업 카드를 찾을 수 없어요.");
  }

  const workItem = await requireWorkItem(db, userId, workItemId);
  const content = normalizeShortText(formData.get("content"));
  if (!content) {
    throw new Error("체크리스트 내용을 입력해 주세요.");
  }

  const lastChecklistItem = await db.devWorkChecklistItem.findFirst({
    where: { workItemId: workItem.id },
    orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
    select: { sortOrder: true },
  });

  await db.devWorkChecklistItem.create({
    data: {
      workItemId: workItem.id,
      content,
      isTodayTodo: parseBooleanFlag(formData.get("isTodayTodo")),
      sortOrder: (lastChecklistItem?.sortOrder ?? 0) + 10,
    },
  });

  await createWorkLog(db, userId, workItem.id, "CHECKLIST_UPDATED", {
    logDate: getDayStart(referenceDate),
    message: `체크리스트를 추가했어요: ${content}`,
  });
}

export async function toggleDevWorkChecklistItem(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const checklistItemId = parsePositiveInt(formData.get("checklistItemId"));
  if (!checklistItemId) {
    throw new Error("체크리스트 항목을 찾을 수 없어요.");
  }

  const checklistItem = await db.devWorkChecklistItem.findFirst({
    where: {
      id: checklistItemId,
      workItem: {
        userId,
      },
    },
    select: {
      id: true,
      content: true,
      isDone: true,
      workItemId: true,
    },
  });

  if (!checklistItem) {
    throw new Error("체크리스트 항목을 찾을 수 없어요.");
  }

  const nextDone = !checklistItem.isDone;
  await db.devWorkChecklistItem.update({
    where: { id: checklistItem.id },
    data: {
      isDone: nextDone,
      completedAt: nextDone ? new Date() : null,
    },
  });

  await createWorkLog(db, userId, checklistItem.workItemId, "CHECKLIST_UPDATED", {
    logDate: getDayStart(referenceDate),
    message: `${nextDone ? "완료" : "미완료"}로 바꿨어요: ${checklistItem.content}`,
  });
}

export async function toggleDevWorkChecklistToday(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const checklistItemId = parsePositiveInt(formData.get("checklistItemId"));
  if (!checklistItemId) {
    throw new Error("체크리스트 항목을 찾을 수 없어요.");
  }

  const checklistItem = await db.devWorkChecklistItem.findFirst({
    where: {
      id: checklistItemId,
      workItem: {
        userId,
      },
    },
    select: {
      id: true,
      content: true,
      isTodayTodo: true,
      workItemId: true,
    },
  });

  if (!checklistItem) {
    throw new Error("체크리스트 항목을 찾을 수 없어요.");
  }

  const nextTodayTodo = !checklistItem.isTodayTodo;
  await db.devWorkChecklistItem.update({
    where: { id: checklistItem.id },
    data: {
      isTodayTodo: nextTodayTodo,
    },
  });

  await createWorkLog(db, userId, checklistItem.workItemId, "CHECKLIST_UPDATED", {
    logDate: getDayStart(referenceDate),
    message: `${nextTodayTodo ? "오늘 할 일로 올렸어요" : "오늘 할 일에서 내렸어요"}: ${checklistItem.content}`,
  });
}

export async function deleteDevWorkChecklistItem(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const checklistItemId = parsePositiveInt(formData.get("checklistItemId"));
  if (!checklistItemId) {
    throw new Error("삭제할 체크리스트 항목을 찾을 수 없어요.");
  }

  const checklistItem = await db.devWorkChecklistItem.findFirst({
    where: {
      id: checklistItemId,
      workItem: {
        userId,
      },
    },
    select: {
      id: true,
      content: true,
      workItemId: true,
    },
  });

  if (!checklistItem) {
    throw new Error("삭제할 체크리스트 항목을 찾을 수 없어요.");
  }

  await db.devWorkChecklistItem.delete({
    where: { id: checklistItem.id },
  });

  await createWorkLog(db, userId, checklistItem.workItemId, "CHECKLIST_UPDATED", {
    logDate: getDayStart(referenceDate),
    message: `체크리스트를 삭제했어요: ${checklistItem.content}`,
  });
}

export async function addDevWorkAttachment(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const workItemId = parsePositiveInt(formData.get("workItemId"));
  if (!workItemId) {
    throw new Error("파일을 올릴 작업 카드를 찾을 수 없어요.");
  }

  const workItem = await requireWorkItem(db, userId, workItemId);
  const fileValue = formData.get("attachment");
  const file = typeof File !== "undefined" && fileValue instanceof File && fileValue.size > 0 ? fileValue : null;

  if (!file) {
    throw new Error("업로드할 파일을 선택해 주세요.");
  }

  if (!isStorageUploadAvailable()) {
    throw new Error("파일 업로드용 스토리지 설정이 비어 있어요.");
  }

  const uploaded = await uploadFileToStorage(file);
  if (!uploaded) {
    throw new Error("파일 업로드에 실패했어요.");
  }

  const lastAttachment = await db.devWorkAttachment.findFirst({
    where: { workItemId: workItem.id },
    orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
    select: { sortOrder: true },
  });

  await db.devWorkAttachment.create({
    data: {
      workItemId: workItem.id,
      kind: getAttachmentKind(file),
      fileName: file.name || "attachment",
      url: uploaded.url,
      mimeType: uploaded.mimeType,
      byteSize: uploaded.byteSize,
      sortOrder: (lastAttachment?.sortOrder ?? 0) + 10,
    },
  });

  await createWorkLog(db, userId, workItem.id, "ATTACHMENT_ADDED", {
    logDate: getDayStart(referenceDate),
    message: `파일을 첨부했어요: ${file.name}`,
  });
}

export async function deleteDevWorkAttachment(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const attachmentId = parsePositiveInt(formData.get("attachmentId"));
  if (!attachmentId) {
    throw new Error("삭제할 첨부 파일을 찾을 수 없어요.");
  }

  const attachment = await db.devWorkAttachment.findFirst({
    where: {
      id: attachmentId,
      workItem: {
        userId,
      },
    },
    select: {
      id: true,
      fileName: true,
      url: true,
      workItemId: true,
    },
  });

  if (!attachment) {
    throw new Error("삭제할 첨부 파일을 찾을 수 없어요.");
  }

  await db.devWorkAttachment.delete({
    where: { id: attachment.id },
  });
  await deleteImage(attachment.url);

  await createWorkLog(db, userId, attachment.workItemId, "ATTACHMENT_REMOVED", {
    logDate: getDayStart(referenceDate),
    message: `첨부 파일을 삭제했어요: ${attachment.fileName}`,
  });
}

export async function moveDevWorkItemOnStatusBoard(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const workItemId = parsePositiveInt(formData.get("workItemId"));
  const beforeWorkItemId = parsePositiveInt(formData.get("beforeWorkItemId"));
  const statuses = await ensureDevWorkStatuses(db, userId);
  const visibleStatuses = statuses.filter((status) => !DEVLOG_HIDDEN_BOARD_STATUS_KEYS.includes(status.statusKey as never));
  const fallbackStatus = getFallbackStatusKey(visibleStatuses.length > 0 ? visibleStatuses : statuses);
  const requestedStatus = parseStatusKey(formData.get("targetStatus"), fallbackStatus);
  const targetStatus = visibleStatuses.some((status) => status.statusKey === requestedStatus) ? requestedStatus : fallbackStatus;
  const statusLabelMap = getStatusLabelMap(statuses);

  if (!workItemId) {
    throw new Error("이동할 작업 카드를 찾을 수 없어요.");
  }

  const boardItems = await db.devWorkItem.findMany({
    where: {
      userId,
      isMinimized: true,
      status: {
        notIn: [...DEVLOG_HIDDEN_BOARD_STATUS_KEYS],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
    },
  });

  const draggedItem = boardItems.find((item) => item.id === workItemId);
  if (!draggedItem) {
    throw new Error("보드에서 작업 카드를 찾을 수 없어요.");
  }

  const lanes = new Map<string, typeof boardItems>();
  for (const status of visibleStatuses) {
    lanes.set(status.statusKey, []);
  }

  for (const item of boardItems) {
    if (item.id === workItemId) {
      continue;
    }
    lanes.get(item.status)?.push(item);
  }

  const targetLane = lanes.get(targetStatus) ?? [];
  if (beforeWorkItemId) {
    const insertIndex = targetLane.findIndex((item) => item.id === beforeWorkItemId);
    if (insertIndex >= 0) {
      targetLane.splice(insertIndex, 0, draggedItem);
    } else {
      targetLane.push(draggedItem);
    }
  } else {
    targetLane.push(draggedItem);
  }
  lanes.set(targetStatus, targetLane);

  const rootDb = db as PrismaClient;
  await rootDb.$transaction(async (tx) => {
    if (draggedItem.status !== targetStatus) {
      const now = new Date();
      await tx.devWorkItem.update({
        where: { id: draggedItem.id },
        data: {
          status: targetStatus,
          lastWorkedAt: now,
          startedAt: targetStatus === "IN_PROGRESS" ? draggedItem.startedAt ?? now : draggedItem.startedAt,
          completedAt: targetStatus === "DONE" ? draggedItem.completedAt ?? now : null,
        },
      });

      await createWorkLog(tx, userId, draggedItem.id, "STATUS_CHANGED", {
        logDate: getDayStart(referenceDate),
        message: `${getDevlogStatusLabel(draggedItem.status, statusLabelMap)}에서 ${getDevlogStatusLabel(targetStatus, statusLabelMap)}로 상태를 바꿨어요.`,
        meta: {
          from: draggedItem.status,
          to: targetStatus,
        },
      });
    }

    await Promise.all(
      visibleStatuses.flatMap((status) =>
        (lanes.get(status.statusKey) ?? []).map((item, index) =>
          tx.devWorkItem.update({
            where: { id: item.id },
            data: {
              sortOrder: (index + 1) * 10,
            },
          }),
        ),
      ),
    );
  });
}

export async function moveDevWorkItemOnCanvas(db: DevlogDbClient, userId: string, formData: FormData) {
  const workItemId = parsePositiveInt(formData.get("workItemId"));
  const boardX = parseInteger(formData.get("boardX"));
  const boardY = parseInteger(formData.get("boardY"));

  if (!workItemId || boardX === null || boardY === null) {
    throw new Error("캔버스 위치를 저장할 작업 카드를 찾을 수 없어요.");
  }

  const workItem = await requireWorkItem(db, userId, workItemId);
  await db.devWorkItem.update({
    where: { id: workItem.id },
    data: {
      boardX: clampPosition(boardX, workItem.boardX),
      boardY: clampPosition(boardY, workItem.boardY),
      lastWorkedAt: new Date(),
    },
  });
}

export async function loadDevWorkItemWindow(db: DevlogDbClient, userId: string, referenceDate: Date, workItemId: number) {
  const pageDate = getDayStart(referenceDate);
  const statuses = await ensureDevWorkStatuses(db, userId);
  const [page, workItem, relatedWorkItems] = await Promise.all([
    db.devDiaryPage.findUnique({
      where: {
        userId_pageDate: {
          userId,
          pageDate,
        },
      },
      select: {
        id: true,
        title: true,
        pageDate: true,
      },
    }),
    db.devWorkItem.findFirst({
      where: {
        id: workItemId,
        userId,
      },
      select: {
        id: true,
        parentWorkItemId: true,
        title: true,
        status: true,
        contentMd: true,
        nextAction: true,
        priority: true,
        sortOrder: true,
        isMinimized: true,
        isPinned: true,
        boardX: true,
        boardY: true,
        plannedDate: true,
        startedAt: true,
        completedAt: true,
        lastWorkedAt: true,
        createdAt: true,
        updatedAt: true,
        checklist: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: {
            id: true,
            content: true,
            isDone: true,
            isTodayTodo: true,
            completedAt: true,
            sortOrder: true,
          },
        },
        attachments: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: {
            id: true,
            kind: true,
            fileName: true,
            url: true,
            mimeType: true,
            byteSize: true,
            createdAt: true,
          },
        },
        logs: {
          orderBy: [{ createdAt: "desc" }],
          take: 12,
          select: {
            id: true,
            type: true,
            message: true,
            createdAt: true,
          },
        },
      },
    }),
    db.devWorkItem.findMany({
      where: {
        userId,
      },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        parentWorkItemId: true,
        title: true,
        status: true,
        nextAction: true,
        isMinimized: true,
        updatedAt: true,
      },
    }),
  ]);

  if (!workItem) {
    throw new Response("작업창을 찾을 수 없어요.", { status: 404 });
  }

  const childIdsByParentId = new Map<number, number[]>();
  for (const item of relatedWorkItems) {
    if (!item.parentWorkItemId) {
      continue;
    }

    const childIds = childIdsByParentId.get(item.parentWorkItemId) ?? [];
    childIds.push(item.id);
    childIdsByParentId.set(item.parentWorkItemId, childIds);
  }

  const descendantIds = new Set<number>();
  const pendingIds = [...(childIdsByParentId.get(workItem.id) ?? [])];
  while (pendingIds.length > 0) {
    const currentId = pendingIds.shift();
    if (!currentId || descendantIds.has(currentId)) {
      continue;
    }

    descendantIds.add(currentId);
    pendingIds.push(...(childIdsByParentId.get(currentId) ?? []));
  }

  const parentWorkItem = workItem.parentWorkItemId
    ? relatedWorkItems.find((item) => item.id === workItem.parentWorkItemId) ?? null
    : null;
  const childWorkItems = relatedWorkItems.filter((item) => item.parentWorkItemId === workItem.id);
  const parentCandidates = relatedWorkItems.filter((item) => item.id !== workItem.id && !descendantIds.has(item.id));
  const referencedWorkItemIds = extractDevlogWorkItemReferenceIds(workItem.nextAction, workItem.contentMd).filter(
    (itemId) => itemId !== workItem.id,
  );
  const referencedWorkItems = referencedWorkItemIds
    .map((itemId) => relatedWorkItems.find((item) => item.id === itemId))
    .filter((item): item is (typeof relatedWorkItems)[number] => Boolean(item));

  return {
    page: page
      ? {
          id: page.id,
          title: page.title ?? "",
          pageDate: page.pageDate.toISOString(),
        }
      : {
          id: null,
          title: "",
          pageDate: pageDate.toISOString(),
        },
    statuses: statuses.map((status) => ({
      key: status.statusKey,
      label: status.label,
      sortOrder: status.sortOrder,
    })),
    parentCandidates: parentCandidates.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      isMinimized: item.isMinimized,
    })),
    workItem: {
      ...workItem,
      plannedDate: serializeDate(workItem.plannedDate),
      startedAt: serializeDate(workItem.startedAt),
      completedAt: serializeDate(workItem.completedAt),
      lastWorkedAt: serializeDate(workItem.lastWorkedAt),
      createdAt: serializeDate(workItem.createdAt),
      updatedAt: serializeDate(workItem.updatedAt),
      parentWorkItem: parentWorkItem
        ? {
            id: parentWorkItem.id,
            title: parentWorkItem.title,
            status: parentWorkItem.status,
            isMinimized: parentWorkItem.isMinimized,
          }
        : null,
      childWorkItems: childWorkItems.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        nextAction: item.nextAction,
        isMinimized: item.isMinimized,
        updatedAt: item.updatedAt.toISOString(),
      })),
      referencedWorkItems: referencedWorkItems.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        nextAction: item.nextAction,
        isMinimized: item.isMinimized,
        updatedAt: item.updatedAt.toISOString(),
      })),
      checklist: workItem.checklist.map(serializeChecklistItem),
      attachments: workItem.attachments.map(serializeAttachment),
      logs: workItem.logs.map((log) => ({
        ...log,
        createdAt: log.createdAt.toISOString(),
      })),
    },
  };
}
