import { Prisma } from "@prisma/client";
import type { DevWorkAttachmentKind, PrismaClient } from "@prisma/client";

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
import {
  createGitHubIssue,
  encryptGitHubIssueToken,
  getGitHubIssueIntegrationSummary,
  isGitHubIssueSyncAvailable,
} from "~/lib/github.server";
import { deleteImage, isStorageUploadAvailable, uploadFileToStorage } from "~/lib/upload.server";

type DevlogDbClient = PrismaClient | Prisma.TransactionClient;
type WorkLogType =
  | "CREATED"
  | "STATUS_CHANGED"
  | "NOTE_UPDATED"
  | "CHECKLIST_UPDATED"
  | "ATTACHMENT_ADDED"
  | "ATTACHMENT_REMOVED"
  | "MINIMIZED"
  | "RESTORED";

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

const DEFAULT_DEV_WORK_SET_NAME = "\uAE30\uBCF8 \uC138\uD2B8";
const DEFAULT_DEV_WORK_SET_ICON = "briefcase";
const DEFAULT_DEV_WORK_SET_COLOR = "#b7844d";

function parseWorkSetIcon(value: FormDataEntryValue | null, fallback = DEFAULT_DEV_WORK_SET_ICON) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_-]{2,32}$/.test(normalized) ? normalized : fallback;
}

function parseWorkSetColor(value: FormDataEntryValue | null, fallback = DEFAULT_DEV_WORK_SET_COLOR) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}

function normalizeGitHubRepoValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return null;
  }

  return /^[A-Za-z0-9._-]+$/.test(normalized) ? normalized : null;
}

function normalizeGitHubIssueLabelsInput(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const labels = value
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);

  return labels.length > 0 ? labels.join(", ") : null;
}

function normalizeSecretInput(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function serializeDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function compareNullableDatesDesc(left: Date | null | undefined, right: Date | null | undefined) {
  const leftTime = left ? left.getTime() : 0;
  const rightTime = right ? right.getTime() : 0;
  return rightTime - leftTime;
}

function normalizeSearchQuery(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildWorkItemSearchWhere(searchQuery: string | null) {
  if (!searchQuery) {
    return null;
  }

  const referenceMatch = searchQuery.match(/^#?(\d+)$/);
  const referenceId = referenceMatch ? Number(referenceMatch[1]) : null;
  const orConditions: Prisma.DevWorkItemWhereInput[] = [
    {
      title: {
        contains: searchQuery,
      },
    },
    {
      nextAction: {
        contains: searchQuery,
      },
    },
    {
      contentMd: {
        contains: searchQuery,
      },
    },
    {
      notes: {
        some: {
          contentMd: {
            contains: searchQuery,
          },
        },
      },
    },
  ];

  if (referenceId) {
    orConditions.unshift({
      id: referenceId,
    });
  }

  return {
    OR: orConditions,
  } satisfies Prisma.DevWorkItemWhereInput;
}

function mergeDistinctMultilineText(primary: string | null | undefined, secondary: string | null | undefined) {
  const normalizedPrimary = primary?.trim() ?? "";
  const normalizedSecondary = secondary?.trim() ?? "";

  if (!normalizedPrimary) {
    return normalizedSecondary || null;
  }

  if (!normalizedSecondary || normalizedPrimary === normalizedSecondary) {
    return normalizedPrimary;
  }

  return `${normalizedPrimary}\n\n---\n\n${normalizedSecondary}`;
}

function formatGitHubIssueDate(value: Date | null | undefined) {
  if (!value) {
    return null;
  }

  return value.toISOString().slice(0, 10);
}

function sanitizeDevlogGitHubIssueText(value: string) {
  return value.replace(/#(\d+)\b/g, (_match, workItemId: string) => `카드 ${workItemId}`);
}

function buildDevWorkItemGitHubIssueBody(input: {
  plannedDate: Date | null;
  nextAction: string | null;
  notes: string[];
  checklist: Array<{ content: string; isDone: boolean }>;
}) {
  const sections: string[] = [];
  const pushSection = (...lines: string[]) => {
    if (lines.length === 0) {
      return;
    }
    if (sections.length > 0) {
      sections.push("");
    }
    sections.push(...lines);
  };

  const plannedDate = formatGitHubIssueDate(input.plannedDate);
  if (plannedDate) {
    sections.push(`- 마감일: ${plannedDate}`);
  }

  if (input.notes.length > 0) {
    pushSection(input.notes.map(sanitizeDevlogGitHubIssueText).join("\n\n---\n\n"));
  }

  if (input.checklist.length > 0) {
    pushSection("## 체크리스트", "");
    for (const item of input.checklist) {
      sections.push(`- [${item.isDone ? "x" : " "}] ${sanitizeDevlogGitHubIssueText(item.content)}`);
    }
  }

  if (input.nextAction) {
    pushSection("## 다음 할 일", "", sanitizeDevlogGitHubIssueText(input.nextAction));
  }

  return sections.join("\n");
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

type DevWorkSetSummary = {
  id: number;
  name: string;
  icon: string;
  color: string;
  githubIssueRepoOwner: string | null;
  githubIssueRepoName: string | null;
  githubIssueLabels: string | null;
  githubIssueTokenEncrypted: string | null;
  sortOrder: number;
  isDefault: boolean;
};

async function ensureDevWorkSets(db: DevlogDbClient, userId: string) {
  let workSets = await db.devWorkSet.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      icon: true,
      color: true,
      githubIssueRepoOwner: true,
      githubIssueRepoName: true,
      githubIssueLabels: true,
      githubIssueTokenEncrypted: true,
      sortOrder: true,
      isDefault: true,
    },
  });

  if (workSets.length === 0) {
    const created = await db.devWorkSet.create({
      data: {
        userId,
        name: "기본 세트",
        icon: DEFAULT_DEV_WORK_SET_ICON,
        color: DEFAULT_DEV_WORK_SET_COLOR,
        sortOrder: 10,
        isDefault: true,
      },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
        githubIssueRepoOwner: true,
        githubIssueRepoName: true,
        githubIssueLabels: true,
        githubIssueTokenEncrypted: true,
        sortOrder: true,
        isDefault: true,
      },
    });

    const normalizedCreated = await db.devWorkSet.update({
      where: { id: created.id },
      data: {
        name: DEFAULT_DEV_WORK_SET_NAME,
      },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
        githubIssueRepoOwner: true,
        githubIssueRepoName: true,
        githubIssueLabels: true,
        githubIssueTokenEncrypted: true,
        sortOrder: true,
        isDefault: true,
      },
    });

    return [normalizedCreated];
  }

  if (workSets.some((workSet) => workSet.isDefault)) {
    return workSets;
  }

  const firstWorkSet = workSets[0];
  await db.devWorkSet.update({
    where: { id: firstWorkSet.id },
    data: {
      isDefault: true,
    },
  });

  return workSets.map((workSet) => (workSet.id === firstWorkSet.id ? { ...workSet, isDefault: true } : workSet));
}

async function resolveRequestedWorkSet(db: DevlogDbClient, userId: string, requestedWorkSetId?: number | null) {
  const workSets = await ensureDevWorkSets(db, userId);
  const selectedWorkSet =
    (requestedWorkSetId ? workSets.find((workSet) => workSet.id === requestedWorkSetId) : null) ??
    workSets.find((workSet) => workSet.isDefault) ??
    workSets[0];

  if (!selectedWorkSet) {
    throw new Error("일세트를 찾을 수 없어요.");
  }

  return {
    workSets,
    selectedWorkSet,
  };
}

async function requireWorkSet(db: DevlogDbClient, userId: string, workSetId: number) {
  const workSet = await db.devWorkSet.findFirst({
    where: {
      id: workSetId,
      userId,
    },
    select: {
      id: true,
      name: true,
      icon: true,
      color: true,
      githubIssueRepoOwner: true,
      githubIssueRepoName: true,
      githubIssueLabels: true,
      githubIssueTokenEncrypted: true,
      sortOrder: true,
      isDefault: true,
    },
  });

  if (!workSet) {
    throw new Error("일세트를 찾을 수 없어요.");
  }

  return workSet;
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
    throw new Error("작업 상태를 찾을 수 없어요.");
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
  type: WorkLogType,
  input?: {
    logDate?: Date;
    message?: string | null;
    noteMd?: string | null;
    meta?: Prisma.InputJsonValue | null;
  },
) {
  return;
}

async function ensureDiaryPage(db: DevlogDbClient, userId: string, workSetId: number, referenceDate: Date) {
  const pageDate = getDayStart(referenceDate);

  return db.devDiaryPage.upsert({
    where: {
      userId_workSetId_pageDate: {
        userId,
        workSetId,
        pageDate,
      },
    },
    update: {},
    create: {
      userId,
      workSetId,
      pageDate,
    },
    select: {
      id: true,
      workSetId: true,
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
      workSetId: true,
      title: true,
      status: true,
      parentWorkItemId: true,
      contentMd: true,
      nextAction: true,
      githubIssueRepo: true,
      githubIssueNumber: true,
      githubIssueUrl: true,
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

async function requireWorkNote(db: DevlogDbClient, userId: string, noteId: number) {
  const note = await db.devWorkNote.findFirst({
    where: {
      id: noteId,
      workItem: {
        userId,
      },
    },
    select: {
      id: true,
      workItemId: true,
      contentMd: true,
    },
  });

  if (!note) {
    throw new Error("작업 메모를 찾을 수 없어요.");
  }

  return note;
}

async function syncDevWorkItemContentFromNotes(db: DevlogDbClient, workItemId: number) {
  const notes = await db.devWorkNote.findMany({
    where: { workItemId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      contentMd: true,
    },
  });

  const contentMd =
    notes
      .map((note) => note.contentMd.trim())
      .filter((note) => note.length > 0)
      .join("\n\n") || null;

  await db.devWorkItem.update({
    where: { id: workItemId },
    data: {
      contentMd,
      lastWorkedAt: new Date(),
    },
  });
}

async function resolveParentWorkItemId(
  db: DevlogDbClient,
  userId: string,
  workSetId: number,
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
      workSetId,
    },
    select: {
      id: true,
      parentWorkItemId: true,
    },
  });

  if (!parentWorkItem) {
    throw new Error("상위 카드로 연결할 작업 카드를 찾을 수 없어요.");
  }

  if (!workItemId) {
    return parentWorkItem.id;
  }

  let currentParentId = parentWorkItem.parentWorkItemId;
  while (currentParentId) {
    if (currentParentId === workItemId) {
      throw new Error("순환 구조가 생기도록 연결할 수 없어요.");
    }

    const nextWorkItem = await db.devWorkItem.findFirst({
      where: {
        id: currentParentId,
        userId,
        workSetId,
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

function serializeWorkNote(item: {
  id: number;
  contentMd: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...item,
    createdAt: serializeDate(item.createdAt),
    updatedAt: serializeDate(item.updatedAt),
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

export async function loadDevDashboardSnapshot(
  db: DevlogDbClient,
  userId: string,
  referenceDate: Date,
  input?: number | null | { requestedWorkSetId?: number | null; searchQuery?: string | null },
) {
  const pageDate = getDayStart(referenceDate);
  const dashboardCardSelect = getDashboardCardSelect();
  const requestedWorkSetId =
    typeof input === "object" && input !== null ? (input.requestedWorkSetId ?? null) : (input ?? null);
  const searchQuery = normalizeSearchQuery(typeof input === "object" && input !== null ? input.searchQuery : null);
  const { workSets, selectedWorkSet } = await resolveRequestedWorkSet(db, userId, requestedWorkSetId);
  const statuses = await ensureDevWorkStatuses(db, userId);
  const workItemSearchWhere = buildWorkItemSearchWhere(searchQuery);
  const activeWorkItemWhere = {
    userId,
    workSetId: selectedWorkSet.id,
    status: {
      notIn: [...DEVLOG_CLOSED_STATUS_KEYS],
    },
    ...(workItemSearchWhere ? { AND: [workItemSearchWhere] } : {}),
  } satisfies Prisma.DevWorkItemWhereInput;

  const [
    page,
    dateEntries,
    openWorkItems,
    boardWorkItems,
    statusCountRows,
    todayTodoRows,
    recentPages,
    nextCandidates,
    searchResultRows,
  ] = await Promise.all([
    db.devDiaryPage.findUnique({
      where: {
        userId_workSetId_pageDate: {
          userId,
          workSetId: selectedWorkSet.id,
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
          workSetId: selectedWorkSet.id,
          pageDate,
        },
        workItem: {
          status: {
            notIn: [...DEVLOG_CLOSED_STATUS_KEYS],
          },
          ...(workItemSearchWhere ? { AND: [workItemSearchWhere] } : {}),
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
      where: activeWorkItemWhere,
      orderBy: [{ isPinned: "desc" }, { lastWorkedAt: "desc" }, { updatedAt: "desc" }],
      select: dashboardCardSelect,
    }),
    db.devWorkItem.findMany({
      where: activeWorkItemWhere,
      orderBy: [{ isPinned: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
      select: dashboardCardSelect,
    }),
    db.devWorkItem.groupBy({
      by: ["status"],
      where: {
        userId,
        workSetId: selectedWorkSet.id,
      },
      _count: {
        status: true,
      },
    }),
    db.devWorkChecklistItem.findMany({
      where: {
        isTodayTodo: true,
        isDone: false,
        workItem: {
          userId,
          workSetId: selectedWorkSet.id,
          status: {
            notIn: [...DEVLOG_CLOSED_STATUS_KEYS],
          },
        },
      },
      select: {
        id: true,
        content: true,
        sortOrder: true,
        workItem: {
          select: {
            id: true,
            title: true,
            status: true,
            nextAction: true,
            isPinned: true,
            isMinimized: true,
            plannedDate: true,
            lastWorkedAt: true,
            updatedAt: true,
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
          },
        },
      },
    }),
    db.devDiaryPage.findMany({
      where: {
        userId,
        workSetId: selectedWorkSet.id,
      },
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
        workSetId: selectedWorkSet.id,
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
    searchQuery
      ? db.devWorkItem.findMany({
          where: {
            userId,
            workSetId: selectedWorkSet.id,
            ...(workItemSearchWhere ? { AND: [workItemSearchWhere] } : {}),
          },
          orderBy: [{ isPinned: "desc" }, { lastWorkedAt: "desc" }, { updatedAt: "desc" }],
          take: 24,
          select: dashboardCardSelect,
        })
      : Promise.resolve([]),
  ]);

  const dateItems = dateEntries.map((entry) => ({
    pageEntryId: entry.id,
    pageSortOrder: entry.sortOrder,
    ...serializeDashboardItem(entry.workItem),
  }));
  const statusCounts = Object.fromEntries(statuses.map((status) => [status.statusKey, 0])) as Record<string, number>;

  for (const row of statusCountRows) {
    statusCounts[row.status] = row._count.status;
  }

  const nextWorkItem =
    DEVLOG_NEXT_WORK_STATUS_PRIORITY.map((statusKey) => nextCandidates.find((item) => item.status === statusKey)).find(Boolean) ??
    nextCandidates[0] ??
    null;
  const todayTodoItems = todayTodoRows
    .slice()
    .sort((left, right) => {
      if (left.workItem.isPinned !== right.workItem.isPinned) {
        return Number(right.workItem.isPinned) - Number(left.workItem.isPinned);
      }

      const lastWorkedAtCompare = compareNullableDatesDesc(left.workItem.lastWorkedAt, right.workItem.lastWorkedAt);
      if (lastWorkedAtCompare !== 0) {
        return lastWorkedAtCompare;
      }

      const updatedAtCompare = compareNullableDatesDesc(left.workItem.updatedAt, right.workItem.updatedAt);
      if (updatedAtCompare !== 0) {
        return updatedAtCompare;
      }

      if (left.workItem.id !== right.workItem.id) {
        return left.workItem.id - right.workItem.id;
      }

      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }

      return left.id - right.id;
    })
    .map((item) => ({
      checklistItemId: item.id,
      content: item.content,
      sortOrder: item.sortOrder,
      workItem: {
        id: item.workItem.id,
        title: item.workItem.title,
        status: item.workItem.status,
        nextAction: item.workItem.nextAction,
        isPinned: item.workItem.isPinned,
        isMinimized: item.workItem.isMinimized,
        plannedDate: serializeDate(item.workItem.plannedDate),
        lastWorkedAt: serializeDate(item.workItem.lastWorkedAt),
        updatedAt: item.workItem.updatedAt.toISOString(),
        lastDiaryPage: item.workItem.diaryPages[0]
          ? {
              pageDate: item.workItem.diaryPages[0].page.pageDate.toISOString(),
              title: item.workItem.diaryPages[0].page.title ?? "",
            }
          : null,
      },
    }));

  return {
    searchQuery,
    workSets: workSets.map((workSet) => ({
      id: workSet.id,
      name: workSet.name,
      icon: workSet.icon,
      color: workSet.color,
      isDefault: workSet.isDefault,
      sortOrder: workSet.sortOrder,
    })),
    selectedWorkSet: {
      id: selectedWorkSet.id,
      name: selectedWorkSet.name,
      icon: selectedWorkSet.icon,
      color: selectedWorkSet.color,
      githubIssueRepoOwner: selectedWorkSet.githubIssueRepoOwner,
      githubIssueRepoName: selectedWorkSet.githubIssueRepoName,
      githubIssueLabels: selectedWorkSet.githubIssueLabels,
      hasGitHubIssueToken: Boolean(selectedWorkSet.githubIssueTokenEncrypted),
      isDefault: selectedWorkSet.isDefault,
      sortOrder: selectedWorkSet.sortOrder,
    },
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
    minimizedBoardItems: boardWorkItems.map(serializeDashboardItem),
    recentPages: recentPages.map((item) => ({
      id: item.id,
      title: item.title ?? "",
      pageDate: item.pageDate.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      workItemCount: item._count.workItems,
    })),
    searchResults: searchResultRows.map(serializeDashboardItem),
    statusCounts,
    todayTodoCount: todayTodoItems.length,
    todayTodoItems,
    nextWorkItem,
  };
}

export async function loadArchivedDevWorkSnapshot(
  db: DevlogDbClient,
  userId: string,
  input?: { requestedWorkSetId?: number | null; searchQuery?: string | null },
) {
  const dashboardCardSelect = getDashboardCardSelect();
  const requestedWorkSetId = input?.requestedWorkSetId ?? null;
  const searchQuery = normalizeSearchQuery(input?.searchQuery ?? null);
  const { workSets, selectedWorkSet } = await resolveRequestedWorkSet(db, userId, requestedWorkSetId);
  const workItemSearchWhere = buildWorkItemSearchWhere(searchQuery);

  const archivedItems = await db.devWorkItem.findMany({
    where: {
      userId,
      workSetId: selectedWorkSet.id,
      status: "ARCHIVED",
      ...(workItemSearchWhere ? { AND: [workItemSearchWhere] } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 120,
    select: dashboardCardSelect,
  });

  return {
    searchQuery,
    workSets: workSets.map((workSet) => ({
      id: workSet.id,
      name: workSet.name,
      icon: workSet.icon,
      color: workSet.color,
      isDefault: workSet.isDefault,
      sortOrder: workSet.sortOrder,
    })),
    selectedWorkSet: {
      id: selectedWorkSet.id,
      name: selectedWorkSet.name,
      icon: selectedWorkSet.icon,
      color: selectedWorkSet.color,
      isDefault: selectedWorkSet.isDefault,
      sortOrder: selectedWorkSet.sortOrder,
    },
    archivedItems: archivedItems.map(serializeDashboardItem),
  };
}

export async function createDevWorkSet(db: DevlogDbClient, userId: string, formData: FormData) {
  const name = normalizeShortText(formData.get("workSetName"));
  if (!name) {
    throw new Error("일세트 이름을 입력해 주세요.");
  }

  const workSets = await ensureDevWorkSets(db, userId);
  const lastWorkSet = workSets[workSets.length - 1];

  return db.devWorkSet.create({
    data: {
      userId,
      name,
      icon: parseWorkSetIcon(formData.get("workSetIcon")),
      color: parseWorkSetColor(formData.get("workSetColor")),
      sortOrder: (lastWorkSet?.sortOrder ?? 0) + 10,
      isDefault: false,
    },
    select: {
      id: true,
      name: true,
      icon: true,
      color: true,
      githubIssueRepoOwner: true,
      githubIssueRepoName: true,
      githubIssueLabels: true,
      githubIssueTokenEncrypted: true,
      sortOrder: true,
      isDefault: true,
    },
  });
}

export async function setDefaultDevWorkSet(db: DevlogDbClient, userId: string, formData: FormData) {
  const workSetId = parsePositiveInt(formData.get("workSetId"));
  if (!workSetId) {
    throw new Error("기본으로 둘 일세트를 찾을 수 없어요.");
  }

  const workSet = await requireWorkSet(db, userId, workSetId);
  const rootDb = db as PrismaClient;

  await rootDb.$transaction(async (tx) => {
    await tx.devWorkSet.updateMany({
      where: {
        userId,
        isDefault: true,
      },
      data: {
        isDefault: false,
      },
    });

    await tx.devWorkSet.update({
      where: { id: workSet.id },
      data: {
        isDefault: true,
      },
    });
  });

  return workSet;
}

export async function renameDevWorkSet(db: DevlogDbClient, userId: string, formData: FormData) {
  const workSetId = parsePositiveInt(formData.get("workSetId"));
  if (!workSetId) {
    throw new Error("이름을 바꿀 일세트를 찾을 수 없어요.");
  }

  const name = normalizeShortText(formData.get("workSetName"));
  if (!name) {
    throw new Error("일세트 이름을 입력해 주세요.");
  }

  const workSet = await requireWorkSet(db, userId, workSetId);
  const githubIssueRepoOwner = normalizeGitHubRepoValue(formData.get("githubIssueRepoOwner"));
  const githubIssueRepoName = normalizeGitHubRepoValue(formData.get("githubIssueRepoName"));
  const githubIssueLabels = normalizeGitHubIssueLabelsInput(formData.get("githubIssueLabels"));
  const githubIssueToken = normalizeSecretInput(formData.get("githubIssueToken"));
  const clearGitHubIssueToken = parseBooleanFlag(formData.get("clearGitHubIssueToken"));

  if ((githubIssueRepoOwner && !githubIssueRepoName) || (!githubIssueRepoOwner && githubIssueRepoName)) {
    throw new Error("GitHub 저장소는 owner와 repo 이름을 함께 입력해 주세요.");
  }

  const nextTokenEncrypted = clearGitHubIssueToken
    ? null
    : githubIssueToken
      ? encryptGitHubIssueToken(githubIssueToken)
      : workSet.githubIssueTokenEncrypted;

  return db.devWorkSet.update({
    where: { id: workSet.id },
    data: {
      name,
      icon: parseWorkSetIcon(formData.get("workSetIcon"), workSet.icon),
      color: parseWorkSetColor(formData.get("workSetColor"), workSet.color),
      githubIssueRepoOwner,
      githubIssueRepoName,
      githubIssueLabels,
      githubIssueTokenEncrypted: nextTokenEncrypted,
    },
    select: {
      id: true,
      name: true,
      icon: true,
      color: true,
      sortOrder: true,
      isDefault: true,
    },
  });
}

export async function moveDevWorkSet(db: DevlogDbClient, userId: string, formData: FormData) {
  const workSetId = parsePositiveInt(formData.get("workSetId"));
  const direction = typeof formData.get("direction") === "string" ? String(formData.get("direction")) : "";
  if (!workSetId) {
    throw new Error("순서를 바꿀 일세트를 찾을 수 없어요.");
  }

  const workSets = await ensureDevWorkSets(db, userId);
  const currentIndex = workSets.findIndex((workSet) => workSet.id === workSetId);
  if (currentIndex < 0) {
    throw new Error("순서를 바꿀 일세트를 찾을 수 없어요.");
  }

  const targetIndex = direction === "left" || direction === "up" ? currentIndex - 1 : currentIndex + 1;
  const currentWorkSet = workSets[currentIndex];
  const targetWorkSet = workSets[targetIndex];
  if (!targetWorkSet) {
    return currentWorkSet;
  }

  const rootDb = db as PrismaClient;
  await rootDb.$transaction(async (tx) => {
    await tx.devWorkSet.update({
      where: { id: currentWorkSet.id },
      data: {
        sortOrder: targetWorkSet.sortOrder,
      },
    });

    await tx.devWorkSet.update({
      where: { id: targetWorkSet.id },
      data: {
        sortOrder: currentWorkSet.sortOrder,
      },
    });
  });

  return currentWorkSet;
}

export async function deleteDevWorkSet(db: DevlogDbClient, userId: string, formData: FormData) {
  const workSetId = parsePositiveInt(formData.get("workSetId"));
  if (!workSetId) {
    throw new Error("삭제할 일세트를 찾을 수 없어요.");
  }

  const workSets = await ensureDevWorkSets(db, userId);
  if (workSets.length < 2) {
    throw new Error("마지막 일세트는 삭제할 수 없어요.");
  }

  const sourceWorkSet = workSets.find((workSet) => workSet.id === workSetId);
  if (!sourceWorkSet) {
    throw new Error("삭제할 일세트를 찾을 수 없어요.");
  }

  const targetWorkSet =
    workSets.find((workSet) => workSet.id !== sourceWorkSet.id && (sourceWorkSet.isDefault ? false : workSet.isDefault)) ??
    workSets.find((workSet) => workSet.id !== sourceWorkSet.id);

  if (!targetWorkSet) {
    throw new Error("옮겨 둘 다른 일세트를 찾을 수 없어요.");
  }

  const rootDb = db as PrismaClient;
  await rootDb.$transaction(async (tx) => {
    const sourcePages = await tx.devDiaryPage.findMany({
      where: {
        userId,
        workSetId: sourceWorkSet.id,
      },
      orderBy: [{ pageDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        pageDate: true,
        title: true,
        noteMd: true,
        statusTitlesJson: true,
      },
    });

    const targetPages = await tx.devDiaryPage.findMany({
      where: {
        userId,
        workSetId: targetWorkSet.id,
        pageDate: {
          in: sourcePages.map((page) => page.pageDate),
        },
      },
      select: {
        id: true,
        pageDate: true,
        title: true,
        noteMd: true,
        statusTitlesJson: true,
      },
    });

    const targetPageMap = new Map(targetPages.map((page) => [page.pageDate.toISOString(), page]));

    for (const sourcePage of sourcePages) {
      const matchedTargetPage = targetPageMap.get(sourcePage.pageDate.toISOString());

      if (!matchedTargetPage) {
        await tx.devDiaryPage.update({
          where: { id: sourcePage.id },
          data: {
            workSetId: targetWorkSet.id,
          },
        });
        continue;
      }

      const [sourceEntries, targetEntries, lastTargetEntry] = await Promise.all([
        tx.devDiaryPageEntry.findMany({
          where: {
            pageId: sourcePage.id,
          },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: {
            workItemId: true,
          },
        }),
        tx.devDiaryPageEntry.findMany({
          where: {
            pageId: matchedTargetPage.id,
          },
          select: {
            workItemId: true,
          },
        }),
        tx.devDiaryPageEntry.findFirst({
          where: {
            pageId: matchedTargetPage.id,
          },
          orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
          select: {
            sortOrder: true,
          },
        }),
      ]);

      const existingWorkItemIds = new Set(targetEntries.map((entry) => entry.workItemId));
      let nextSortOrder = (lastTargetEntry?.sortOrder ?? 0) + 10;

      for (const sourceEntry of sourceEntries) {
        if (existingWorkItemIds.has(sourceEntry.workItemId)) {
          continue;
        }

        await tx.devDiaryPageEntry.create({
          data: {
            pageId: matchedTargetPage.id,
            workItemId: sourceEntry.workItemId,
            sortOrder: nextSortOrder,
          },
        });

        nextSortOrder += 10;
      }

      await tx.devDiaryPage.update({
        where: { id: matchedTargetPage.id },
        data: {
          title: matchedTargetPage.title || sourcePage.title || null,
          noteMd: mergeDistinctMultilineText(matchedTargetPage.noteMd, sourcePage.noteMd),
          statusTitlesJson: matchedTargetPage.statusTitlesJson ?? sourcePage.statusTitlesJson ?? undefined,
        },
      });

      await tx.devDiaryPage.delete({
        where: { id: sourcePage.id },
      });
    }

    await tx.devWorkItem.updateMany({
      where: {
        userId,
        workSetId: sourceWorkSet.id,
      },
      data: {
        workSetId: targetWorkSet.id,
      },
    });

    if (sourceWorkSet.isDefault) {
      await tx.devWorkSet.updateMany({
        where: {
          userId,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });

      await tx.devWorkSet.update({
        where: { id: targetWorkSet.id },
        data: {
          isDefault: true,
        },
      });
    }

    await tx.devWorkSet.delete({
      where: { id: sourceWorkSet.id },
    });
  });

  return targetWorkSet;
}

export async function saveDevDiaryPage(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const title = normalizeShortText(formData.get("title"), "") ?? "";
  const noteMd = normalizeMultilineText(formData.get("noteMd"));
  const { selectedWorkSet } = await resolveRequestedWorkSet(db, userId, parsePositiveInt(formData.get("workSetId")));
  const page = await ensureDiaryPage(db, userId, selectedWorkSet.id, referenceDate);

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
    throw new Error("작업 상태 이름을 입력해 주세요.");
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
    throw new Error("작업 상태 이름을 새로 입력해 주세요.");
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
    throw new Error("삭제할 작업 상태를 찾을 수 없어요.");
  }

  const { status, statuses } = await requireDevWorkStatusDefinition(db, userId, statusKey);
  if (statuses.length <= 1) {
    throw new Error("작업 상태는 하나 이상 남아 있어야 해요.");
  }

  const workItemCount = await db.devWorkItem.count({
    where: {
      userId,
      status: status.statusKey,
    },
  });

  if (workItemCount > 0) {
    throw new Error("이 상태를 쓰고 있는 작업이 있어 삭제할 수 없어요.");
  }

  await db.devWorkStatusDefinition.delete({
    where: { id: status.id },
  });
}

export async function createDevWorkItem(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const title = normalizeShortText(formData.get("title"), "새 작업") ?? "새 작업";
  const { selectedWorkSet } = await resolveRequestedWorkSet(db, userId, parsePositiveInt(formData.get("workSetId")));
  const statuses = await ensureDevWorkStatuses(db, userId);
  const requestedStatus = parseStatusKey(formData.get("status"), getFallbackStatusKey(statuses));
  const status = statuses.some((item) => item.statusKey === requestedStatus) ? requestedStatus : getFallbackStatusKey(statuses);
  const parentWorkItemId = await resolveParentWorkItemId(
    db,
    userId,
    selectedWorkSet.id,
    null,
    parsePositiveInt(formData.get("parentWorkItemId")),
  );
  const nextAction = normalizeShortText(formData.get("nextAction"));
  const contentMd = normalizeMultilineText(formData.get("contentMd"));
  const plannedDate = parseDateInput(formData.get("plannedDate"));
  const page = await ensureDiaryPage(db, userId, selectedWorkSet.id, referenceDate);

  const [lastPageEntry, lastWorkItem, boardItemCount] = await Promise.all([
    db.devDiaryPageEntry.findFirst({
      where: { pageId: page.id },
      orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
      select: { sortOrder: true },
    }),
    db.devWorkItem.findFirst({
      where: {
        userId,
        workSetId: selectedWorkSet.id,
      },
      orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
      select: { sortOrder: true },
    }),
    db.devWorkItem.count({
      where: {
        userId,
        workSetId: selectedWorkSet.id,
        status: {
          notIn: [...DEVLOG_HIDDEN_BOARD_STATUS_KEYS],
        },
      },
    }),
  ]);

  const now = new Date();
  const boardPosition = getBoardPositionByIndex(boardItemCount);
  const workItem = await db.devWorkItem.create({
    data: {
      userId,
      workSetId: selectedWorkSet.id,
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
      notes: contentMd
        ? {
            create: {
              contentMd,
              sortOrder: 10,
            },
          }
        : undefined,
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
  const requestedParentWorkItemId = formData.get("parentWorkItemId");
  const requestedNextAction = formData.get("nextAction");
  const requestedContentMd = formData.get("contentMd");
  const requestedIsPinned = formData.get("isPinned");
  const title = normalizeShortText(formData.get("title"), existing.title) ?? existing.title;
  const requestedStatus = parseStatusKey(formData.get("status"), existing.status);
  const status = statuses.some((item) => item.statusKey === requestedStatus) ? requestedStatus : getFallbackStatusKey(statuses);
  const parentWorkItemId =
    requestedParentWorkItemId === null
      ? existing.parentWorkItemId
      : await resolveParentWorkItemId(db, userId, existing.workSetId, existing.id, parsePositiveInt(requestedParentWorkItemId));
  const nextAction = requestedNextAction === null ? existing.nextAction : normalizeShortText(requestedNextAction);
  const contentMd = requestedContentMd === null ? existing.contentMd : normalizeMultilineText(requestedContentMd);
  const plannedDate = parseDateInput(formData.get("plannedDate"));
  const isPinned = requestedIsPinned === null ? existing.isPinned : parseBooleanFlag(requestedIsPinned);
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
      message: `${getDevlogStatusLabel(existing.status, statusLabelMap)} -> ${getDevlogStatusLabel(status, statusLabelMap)} 상태 변경`, 
      meta: {
        from: existing.status,
        to: status,
      },
    });
  }

  if (existing.parentWorkItemId !== parentWorkItemId) {
    await createWorkLog(db, userId, existing.id, "NOTE_UPDATED", {
      logDate: getDayStart(referenceDate),
      message: parentWorkItemId ? "상위 카드에 연결했어요." : "상위 카드 연결을 해제했어요.",
      meta: {
        fromParentWorkItemId: existing.parentWorkItemId,
        toParentWorkItemId: parentWorkItemId,
      },
    });
  }

  if (existing.contentMd !== contentMd || existing.nextAction !== nextAction) {
    await createWorkLog(db, userId, existing.id, "NOTE_UPDATED", {
      logDate: getDayStart(referenceDate),
      message: "작업 내용을 업데이트했어요.",
      noteMd: contentMd,
    });
  }
}

export async function createGitHubIssueForDevWorkItem(db: DevlogDbClient, userId: string, formData: FormData) {
  const workItemId = parsePositiveInt(formData.get("workItemId"));
  if (!workItemId) {
    throw new Error("GitHub 이슈로 보낼 작업 카드를 찾을 수 없어요.");
  }

  const workItem = await db.devWorkItem.findFirst({
    where: {
      id: workItemId,
      userId,
    },
    select: {
      id: true,
      title: true,
      status: true,
      nextAction: true,
      plannedDate: true,
      githubIssueRepo: true,
      githubIssueNumber: true,
      githubIssueUrl: true,
      workSet: {
        select: {
          name: true,
          githubIssueRepoOwner: true,
          githubIssueRepoName: true,
          githubIssueLabels: true,
          githubIssueTokenEncrypted: true,
        },
      },
      notes: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          contentMd: true,
        },
      },
      checklist: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          content: true,
          isDone: true,
        },
      },
    },
  });

  if (!workItem) {
    throw new Error("GitHub 이슈로 보낼 작업 카드를 찾을 수 없어요.");
  }

  if (workItem.githubIssueRepo && workItem.githubIssueNumber && workItem.githubIssueUrl) {
    return {
      repo: workItem.githubIssueRepo,
      number: workItem.githubIssueNumber,
      url: workItem.githubIssueUrl,
      alreadyLinked: true,
    };
  }

  if (
    !isGitHubIssueSyncAvailable({
      repoOwner: workItem.workSet.githubIssueRepoOwner,
      repoName: workItem.workSet.githubIssueRepoName,
      labels: workItem.workSet.githubIssueLabels,
      tokenEncrypted: workItem.workSet.githubIssueTokenEncrypted,
    })
  ) {
    throw new Error("이 세트의 GitHub 저장소와 토큰을 먼저 설정해 주세요.");
  }

  const issue = await createGitHubIssue({
    title: workItem.title,
    body: buildDevWorkItemGitHubIssueBody({
      plannedDate: workItem.plannedDate,
      nextAction: workItem.nextAction,
      notes: workItem.notes.map((note) => note.contentMd.trim()).filter((note) => note.length > 0),
      checklist: workItem.checklist,
    }),
    config: {
      repoOwner: workItem.workSet.githubIssueRepoOwner,
      repoName: workItem.workSet.githubIssueRepoName,
      labels: workItem.workSet.githubIssueLabels,
      tokenEncrypted: workItem.workSet.githubIssueTokenEncrypted,
    },
  });

  await db.devWorkItem.update({
    where: { id: workItem.id },
    data: {
      githubIssueRepo: issue.repo,
      githubIssueNumber: issue.number,
      githubIssueUrl: issue.url,
      lastWorkedAt: new Date(),
    },
  });

  return {
    ...issue,
    alreadyLinked: false,
  };
}

export async function createDevWorkNote(db: DevlogDbClient, userId: string, _referenceDate: Date, formData: FormData) {
  const workItemId = parsePositiveInt(formData.get("workItemId"));
  if (!workItemId) {
    throw new Error("작업 카드를 찾을 수 없어요.");
  }

  const noteMd = normalizeMultilineText(formData.get("noteMd"));
  if (!noteMd) {
    throw new Error("메모 내용을 입력해 주세요.");
  }

  const existing = await requireWorkItem(db, userId, workItemId);
  const lastNote = await db.devWorkNote.findFirst({
    where: { workItemId: existing.id },
    orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
    select: { sortOrder: true },
  });

  await db.devWorkNote.create({
    data: {
      workItemId: existing.id,
      contentMd: noteMd,
      sortOrder: (lastNote?.sortOrder ?? 0) + 10,
    },
  });

  await syncDevWorkItemContentFromNotes(db, existing.id);
}

export async function updateDevWorkNote(db: DevlogDbClient, userId: string, _referenceDate: Date, formData: FormData) {
  const noteId = parsePositiveInt(formData.get("noteId"));
  if (!noteId) {
    throw new Error("작업 메모를 찾을 수 없어요.");
  }

  const noteMd = normalizeMultilineText(formData.get("noteMd"));
  if (!noteMd) {
    throw new Error("메모 내용을 입력해 주세요.");
  }

  const existing = await requireWorkNote(db, userId, noteId);

  await db.devWorkNote.update({
    where: { id: existing.id },
    data: {
      contentMd: noteMd,
    },
  });

  await syncDevWorkItemContentFromNotes(db, existing.workItemId);
}

export async function deleteDevWorkNote(db: DevlogDbClient, userId: string, _referenceDate: Date, formData: FormData) {
  const noteId = parsePositiveInt(formData.get("noteId"));
  if (!noteId) {
    throw new Error("작업 메모를 찾을 수 없습니다.");
  }

  const existing = await requireWorkNote(db, userId, noteId);

  await db.devWorkNote.delete({
    where: { id: existing.id },
  });

  await syncDevWorkItemContentFromNotes(db, existing.workItemId);
}

export async function setDevWorkItemPinned(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const workItemId = parsePositiveInt(formData.get("workItemId"));
  if (!workItemId) {
    throw new Error("작업 카드를 찾을 수 없어요.");
  }

  const workItem = await requireWorkItem(db, userId, workItemId);
  const isPinned = parseBooleanFlag(formData.get("isPinned"));

  if (workItem.isPinned === isPinned) {
    return isPinned;
  }

  await db.devWorkItem.update({
    where: { id: workItem.id },
    data: {
      isPinned,
      lastWorkedAt: new Date(),
    },
  });

  await createWorkLog(db, userId, workItem.id, "NOTE_UPDATED", {
    logDate: getDayStart(referenceDate),
    message: isPinned ? "작업을 상단에 고정했어요." : "작업 상단 고정을 해제했어요.",
    meta: {
      isPinned,
    },
  });

  return isPinned;
}

export async function attachDevWorkItemToDiaryPage(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const workItemId = parsePositiveInt(formData.get("workItemId"));
  if (!workItemId) {
    throw new Error("연결할 작업 카드를 찾을 수 없어요.");
  }

  const workItem = await requireWorkItem(db, userId, workItemId);
  const page = await ensureDiaryPage(db, userId, workItem.workSetId, referenceDate);
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
      lastWorkedAt: new Date(),
    },
  });

  await createWorkLog(db, userId, workItem.id, "RESTORED", {
    logDate: getDayStart(referenceDate),
    message: "현재 날짜 페이지에 작업 카드를 연결했어요.",
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
    message: `체크리스트 추가: ${content}`, 
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
      isTodayTodo: true,
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
      isTodayTodo: nextDone ? false : checklistItem.isTodayTodo,
      completedAt: nextDone ? new Date() : null,
    },
  });

  await createWorkLog(db, userId, checklistItem.workItemId, "CHECKLIST_UPDATED", {
    logDate: getDayStart(referenceDate),
    message: `${nextDone ? "완료" : "미완료"}: ${checklistItem.content}`, 
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
    message: `${nextTodayTodo ? "오늘 할 일로 설정" : "오늘 할 일 해제"}: ${checklistItem.content}`, 
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
    message: `체크리스트 삭제: ${checklistItem.content}`, 
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
    throw new Error("올릴 파일을 선택해 주세요.");
  }

  if (!isStorageUploadAvailable()) {
    throw new Error("파일 업로드를 지금 사용할 수 없어요.");
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
    message: `파일 추가: ${file.name}`, 
  });
}

export async function deleteDevWorkAttachment(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const attachmentId = parsePositiveInt(formData.get("attachmentId"));
  if (!attachmentId) {
    throw new Error("삭제할 파일을 찾을 수 없어요.");
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
    throw new Error("삭제할 파일을 찾을 수 없어요.");
  }

  await db.devWorkAttachment.delete({
    where: { id: attachment.id },
  });
  await deleteImage(attachment.url);

  await createWorkLog(db, userId, attachment.workItemId, "ATTACHMENT_REMOVED", {
    logDate: getDayStart(referenceDate),
    message: `파일 삭제: ${attachment.fileName}`, 
  });
}

export async function moveDevWorkItemOnStatusBoard(db: DevlogDbClient, userId: string, referenceDate: Date, formData: FormData) {
  const workItemId = parsePositiveInt(formData.get("workItemId"));
  const beforeWorkItemId = parsePositiveInt(formData.get("beforeWorkItemId"));
  const { selectedWorkSet } = await resolveRequestedWorkSet(db, userId, parsePositiveInt(formData.get("workSetId")));
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
      workSetId: selectedWorkSet.id,
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
    throw new Error("보드에서 이동할 작업 카드를 찾을 수 없어요.");
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
        message: `${getDevlogStatusLabel(draggedItem.status, statusLabelMap)} -> ${getDevlogStatusLabel(targetStatus, statusLabelMap)} 상태 변경`, 
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
    throw new Error("이동할 작업 카드와 좌표를 확인해 주세요.");
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
  const workItemScope = await db.devWorkItem.findFirst({
    where: {
      id: workItemId,
      userId,
    },
    select: {
      workSetId: true,
      workSet: {
        select: {
          id: true,
          name: true,
          githubIssueRepoOwner: true,
          githubIssueRepoName: true,
          githubIssueLabels: true,
          githubIssueTokenEncrypted: true,
          sortOrder: true,
          isDefault: true,
        },
      },
    },
  });

  if (!workItemScope) {
    throw new Response("작업창을 찾을 수 없습니다.", { status: 404 });
  }

  const [page, workItem, relatedWorkItems, currentPageEntry, workSets] = await Promise.all([
    db.devDiaryPage.findUnique({
      where: {
        userId_workSetId_pageDate: {
          userId,
          workSetId: workItemScope.workSetId,
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
        workSetId: true,
        parentWorkItemId: true,
        title: true,
        status: true,
        contentMd: true,
        nextAction: true,
        githubIssueRepo: true,
        githubIssueNumber: true,
        githubIssueUrl: true,
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
        workSet: {
          select: {
            id: true,
            name: true,
            githubIssueRepoOwner: true,
            githubIssueRepoName: true,
            githubIssueLabels: true,
            githubIssueTokenEncrypted: true,
            sortOrder: true,
            isDefault: true,
          },
        },
        notes: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: {
            id: true,
            contentMd: true,
            sortOrder: true,
            createdAt: true,
            updatedAt: true,
          },
        },
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
      },
    }),
    db.devWorkItem.findMany({
      where: {
        userId,
        workSetId: workItemScope.workSetId,
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
    db.devDiaryPageEntry.findFirst({
      where: {
        workItemId,
        page: {
          userId,
          workSetId: workItemScope.workSetId,
          pageDate,
        },
      },
      select: {
        id: true,
      },
    }),
    ensureDevWorkSets(db, userId),
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
  const selectedWorkSet = workSets.find((item) => item.id === workItem.workSetId) ?? workItem.workSet;

  return {
    workSets: workSets.map((workSet) => ({
      id: workSet.id,
      name: workSet.name,
      isDefault: workSet.isDefault,
      sortOrder: workSet.sortOrder,
    })),
    selectedWorkSet: {
      id: selectedWorkSet.id,
      name: selectedWorkSet.name,
      isDefault: selectedWorkSet.isDefault,
      sortOrder: selectedWorkSet.sortOrder,
    },
    githubIssueIntegration: {
      ...getGitHubIssueIntegrationSummary({
        repoOwner: selectedWorkSet.githubIssueRepoOwner,
        repoName: selectedWorkSet.githubIssueRepoName,
        labels: selectedWorkSet.githubIssueLabels,
        tokenEncrypted: selectedWorkSet.githubIssueTokenEncrypted,
      }),
    },
    page: page
      ? {
          id: page.id,
          title: page.title ?? "",
          pageDate: page.pageDate.toISOString(),
          isAttached: Boolean(currentPageEntry),
        }
      : {
          id: null,
          title: "",
          pageDate: pageDate.toISOString(),
          isAttached: false,
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
      workSet: {
        id: workItem.workSet.id,
        name: workItem.workSet.name,
        isDefault: workItem.workSet.isDefault,
        sortOrder: workItem.workSet.sortOrder,
      },
      plannedDate: serializeDate(workItem.plannedDate),
      startedAt: serializeDate(workItem.startedAt),
      completedAt: serializeDate(workItem.completedAt),
      lastWorkedAt: serializeDate(workItem.lastWorkedAt),
      createdAt: serializeDate(workItem.createdAt),
      updatedAt: serializeDate(workItem.updatedAt),
      githubIssueRepo: workItem.githubIssueRepo,
      githubIssueNumber: workItem.githubIssueNumber,
      githubIssueUrl: workItem.githubIssueUrl,
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
      notes: workItem.notes.map(serializeWorkNote),
      checklist: workItem.checklist.map(serializeChecklistItem),
      attachments: workItem.attachments.map(serializeAttachment),
      logs: [] as Array<{ id: number; message: string | null; createdAt: string }>,
    },
  };
}

