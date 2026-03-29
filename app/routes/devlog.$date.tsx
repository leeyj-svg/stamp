import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Briefcase,
  CalendarDays,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  FolderKanban,
  Github,
  GripVertical,
  Hammer,
  Heart,
  History,
  House,
  LayoutGrid,
  Layers3,
  ListTodo,
  Move,
  NotebookPen,
  Palette,
  Pin,
  Plus,
  Search,
  SquareArrowOutUpRight,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Form, Link, redirect, useFetcher, useLoaderData, useNavigate, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";

import { DevlogRichText } from "~/components/devlog-rich-text";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { DEVLOG_CLOSED_STATUS_KEYS, getDevlogStatusLabel, type DevlogStatusValue } from "~/lib/devlog";
import {
  attachDevWorkItemToDiaryPage,
  createDevWorkSet,
  createDevWorkStatusDefinition,
  createDevWorkItem,
  deleteDevWorkSet,
  deleteDevWorkStatusDefinition,
  loadDevDashboardSnapshot,
  moveDevWorkSet,
  moveDevWorkItemOnCanvas,
  moveDevWorkItemOnStatusBoard,
  renameDevWorkSet,
  saveDevDiaryPage,
  saveDevWorkStatusDefinition,
  setDefaultDevWorkSet,
} from "~/lib/devlog.server";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { getDateKey, parseRequiredDateToken } from "~/lib/ledger-entry";
import { commitSession, getFlashSession } from "~/lib/session.server";

const DASHBOARD_VIEWS = ["day", "status", "free"] as const;
type DashboardView = (typeof DASHBOARD_VIEWS)[number];

function parseDashboardView(value: string | null): DashboardView {
  return DASHBOARD_VIEWS.includes(value as DashboardView) ? (value as DashboardView) : "day";
}

function parseWorkSetId(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSearchQuery(value: string | null) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildDashboardLink(
  dateToken: string,
  view: DashboardView,
  workSetIdOrOptions?: number | null | { workSetId?: number | null; searchQuery?: string | null },
  searchQuery?: string | null,
) {
  const workSetId =
    typeof workSetIdOrOptions === "object" && workSetIdOrOptions !== null
      ? (workSetIdOrOptions.workSetId ?? null)
      : (workSetIdOrOptions ?? null);
  const resolvedSearchQuery =
    typeof workSetIdOrOptions === "object" && workSetIdOrOptions !== null
      ? parseSearchQuery(workSetIdOrOptions.searchQuery ?? null)
      : parseSearchQuery(searchQuery ?? null);
  const query = new URLSearchParams();
  if (view !== "day") {
    query.set("view", view);
  }
  if (workSetId) {
    query.set("set", String(workSetId));
  }
  if (resolvedSearchQuery) {
    query.set("q", resolvedSearchQuery);
  }

  const search = query.toString();
  return `/devlog/${dateToken}${search ? `?${search}` : ""}`;
}

function buildArchiveLink(workSetId?: number | null, searchQuery?: string | null) {
  const resolvedSearchQuery = parseSearchQuery(searchQuery ?? null);
  const query = new URLSearchParams();
  if (workSetId) {
    query.set("set", String(workSetId));
  }
  if (resolvedSearchQuery) {
    query.set("q", resolvedSearchQuery);
  }

  const search = query.toString();
  return `/devlog/archive${search ? `?${search}` : ""}`;
}

function buildWorkWindowLink(dateToken: string, workItemId: number, workSetId?: number | null) {
  const query = workSetId ? `?set=${workSetId}` : "";
  return `/devlog/${dateToken}/work/${workItemId}${query}`;
}

function shiftDate(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12, 0, 0, 0);
}

function formatDisplayDate(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

const WORK_SET_COLOR_OPTIONS = ["#b7844d", "#d97706", "#0f766e", "#2563eb", "#7c3aed", "#dc2626", "#475569", "#15803d"];

const WORK_SET_ICON_OPTIONS: Array<{ value: string; label: string; icon: LucideIcon }> = [
  { value: "briefcase", label: "회사", icon: Briefcase },
  { value: "house", label: "집", icon: House },
  { value: "folder", label: "프로젝트", icon: FolderKanban },
  { value: "layers", label: "카테고리", icon: Layers3 },
  { value: "star", label: "중요", icon: Star },
  { value: "book", label: "기록", icon: BookOpenText },
  { value: "hammer", label: "작업", icon: Hammer },
  { value: "heart", label: "개인", icon: Heart },
];

function getWorkSetColor(color: string | null | undefined) {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#b7844d";
}

function getWorkSetIcon(icon: string | null | undefined) {
  return WORK_SET_ICON_OPTIONS.find((item) => item.value === icon)?.icon ?? Layers3;
}

function summarizeChecklist(
  checklist: Array<{
    isDone: boolean;
    isTodayTodo: boolean;
  }>,
) {
  const totalCount = checklist.length;
  const doneCount = checklist.filter((item) => item.isDone).length;
  const todayCount = checklist.filter((item) => item.isTodayTodo && !item.isDone).length;

  return {
    totalCount,
    doneCount,
    remainingCount: totalCount - doneCount,
    todayCount,
  };
}

function getSuccessMessage(intent: FormDataEntryValue | null) {
  switch (intent) {
    case "save_page":
      return "날짜 메모를 저장했어요.";
    case "save_status_title":
      return "상태 제목을 저장했어요.";
    case "create_status":
      return "상태 카드를 만들었어요.";
    case "delete_status":
      return "상태 카드를 삭제했어요.";
    case "create_work_item":
      return "새 작업 카드를 만들었어요.";
    case "rename_work_set":
      return "일세트 이름을 바꿨어요.";
    case "move_work_set":
      return "일세트 순서를 바꿨어요.";
    case "delete_work_set":
      return "일세트를 정리했어요.";
    case "attach_work_item_to_page":
      return "선택한 날짜로 작업 카드를 가져왔어요.";
    default:
      return "변경사항을 저장했어요.";
  }
}

function getErrorMessage(intent: FormDataEntryValue | null) {
  switch (intent) {
    case "save_page":
      return "날짜 메모를 저장하지 못했어요.";
    case "save_status_title":
      return "상태 제목을 저장하지 못했어요.";
    case "create_status":
      return "상태 카드를 만들지 못했어요.";
    case "delete_status":
      return "상태 카드를 삭제하지 못했어요.";
    case "create_work_item":
      return "새 작업 카드를 만들지 못했어요.";
    case "rename_work_set":
      return "일세트 이름을 바꾸지 못했어요.";
    case "move_work_set":
      return "일세트 순서를 바꾸지 못했어요.";
    case "delete_work_set":
      return "일세트를 정리하지 못했어요.";
    case "attach_work_item_to_page":
      return "작업 카드를 날짜에 연결하지 못했어요.";
    default:
      return "요청을 처리하지 못했어요.";
  }
}

async function redirectWithToast(
  request: Request,
  type: "success" | "error",
  message: string,
  dateToken: string,
  view: DashboardView,
  workSetId?: number | null,
  searchQuery?: string | null,
) {
  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  flashSession.flash("toast", { type, message });

  return redirect(buildDashboardLink(dateToken, view, workSetId, searchQuery), {
    headers: {
      "Set-Cookie": await commitSession(flashSession),
    },
  });
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "ADMIN");
  const selectedDate = parseRequiredDateToken(params.date);
  const searchParams = new URL(request.url).searchParams;
  const currentView = parseDashboardView(searchParams.get("view"));
  const snapshot = await loadDevDashboardSnapshot(db, user.id, selectedDate, {
    requestedWorkSetId: parseWorkSetId(searchParams.get("set")),
    searchQuery: parseSearchQuery(searchParams.get("q")),
  });

  return {
    dateToken: getDateKey(selectedDate),
    displayDateLabel: formatDisplayDate(selectedDate),
    prevDateToken: getDateKey(shiftDate(selectedDate, -1)),
    nextDateToken: getDateKey(shiftDate(selectedDate, 1)),
    currentView,
    ...snapshot,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "ADMIN");
  const selectedDate = parseRequiredDateToken(params.date);
  const dateToken = getDateKey(selectedDate);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const searchParams = new URL(request.url).searchParams;
  const currentView = parseDashboardView(
    typeof formData.get("view") === "string" ? String(formData.get("view")) : searchParams.get("view"),
  );
  const currentWorkSetId = parseWorkSetId(
    typeof formData.get("workSetId") === "string" ? String(formData.get("workSetId")) : searchParams.get("set"),
  );
  const currentSearchQuery = parseSearchQuery(
    typeof formData.get("searchQuery") === "string" ? String(formData.get("searchQuery")) : searchParams.get("q"),
  );

  try {
    if (intent === "save_page") await saveDevDiaryPage(db, user.id, selectedDate, formData);
    else if (intent === "save_status_title") await saveDevWorkStatusDefinition(db, user.id, selectedDate, formData);
    else if (intent === "create_status") await createDevWorkStatusDefinition(db, user.id, selectedDate, formData);
    else if (intent === "delete_status") await deleteDevWorkStatusDefinition(db, user.id, selectedDate, formData);
    else if (intent === "create_work_item") await createDevWorkItem(db, user.id, selectedDate, formData);
    else if (intent === "create_work_set") {
      const workSet = await createDevWorkSet(db, user.id, formData);
      return redirectWithToast(request, "success", "일세트를 만들었어요.", dateToken, currentView, workSet.id, currentSearchQuery);
    }
    else if (intent === "rename_work_set") {
      const workSet = await renameDevWorkSet(db, user.id, formData);
      return redirectWithToast(request, "success", "일세트를 저장했어요.", dateToken, currentView, workSet.id, currentSearchQuery);
    }
    else if (intent === "move_work_set") {
      const workSet = await moveDevWorkSet(db, user.id, formData);
      return redirectWithToast(request, "success", "일세트 순서를 바꿨어요.", dateToken, currentView, workSet.id, currentSearchQuery);
    }
    else if (intent === "delete_work_set") {
      const workSet = await deleteDevWorkSet(db, user.id, formData);
      return redirectWithToast(request, "success", "일세트를 정리했어요.", dateToken, currentView, workSet.id, currentSearchQuery);
    }
    else if (intent === "set_default_work_set") {
      const workSet = await setDefaultDevWorkSet(db, user.id, formData);
      return redirectWithToast(request, "success", "시작 일세트로 저장했어요.", dateToken, currentView, workSet.id, currentSearchQuery);
    }
    else if (intent === "attach_work_item_to_page") await attachDevWorkItemToDiaryPage(db, user.id, selectedDate, formData);
    else if (intent === "move_status_item") {
      await moveDevWorkItemOnStatusBoard(db, user.id, selectedDate, formData);
      return { ok: true };
    } else if (intent === "move_canvas_item") {
      await moveDevWorkItemOnCanvas(db, user.id, formData);
      return { ok: true };
    } else {
      throw new Response("Invalid intent", { status: 400 });
    }

    return redirectWithToast(request, "success", getSuccessMessage(intent), dateToken, currentView, currentWorkSetId, currentSearchQuery);
  } catch {
    return redirectWithToast(request, "error", getErrorMessage(intent), dateToken, currentView, currentWorkSetId, currentSearchQuery);
  }
};

export default function DevlogDashboardPage() {
  const {
    dateToken,
    displayDateLabel,
    prevDateToken,
    nextDateToken,
    currentView,
    searchQuery,
    workSets,
    selectedWorkSet,
    page,
    dateItems,
    openWorkItems,
    minimizedBoardItems,
    recentPages,
    searchResults,
    nextWorkItem,
    todayTodoCount,
    todayTodoItems,
    statuses,
    statusCounts,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const statusMoveFetcher = useFetcher();
  const canvasMoveFetcher = useFetcher();
  const canvasRef = useRef<HTMLDivElement>(null);
  const dayDateInputRef = useRef<HTMLInputElement>(null);
  const [draggedStatusItemId, setDraggedStatusItemId] = useState<number | null>(null);
  const [editingStatusTitle, setEditingStatusTitle] = useState<null | { status: DevlogStatusValue; value: string }>(null);
  const [isAddingStatus, setIsAddingStatus] = useState(false);
  const [newStatusTitle, setNewStatusTitle] = useState("");
  const [draftPositions, setDraftPositions] = useState<Record<number, { x: number; y: number }>>({});
  const draftPositionsRef = useRef<Record<number, { x: number; y: number }>>({});
  const [canvasDrag, setCanvasDrag] = useState<null | { workItemId: number; offsetX: number; offsetY: number }>(null);
  const [freePanel, setFreePanel] = useState<"page" | "new" | "todo" | "search" | "recent" | null>(null);
  const freeHeaderRef = useRef<HTMLDivElement>(null);
  const statusHeaderRef = useRef<HTMLDivElement>(null);
  const [freeHeaderHeight, setFreeHeaderHeight] = useState(180);
  const [statusHeaderHeight, setStatusHeaderHeight] = useState(180);
  const freeCanvasInset = currentView === "free" ? { x: 24, y: freeHeaderHeight + 36 } : { x: 0, y: 0 };
  const statusLabelMap = useMemo(
    () => Object.fromEntries(statuses.map((status) => [status.key, status.label])),
    [statuses],
  );
  const isDayView = currentView === "day";
  const hasPageMemo = Boolean(page?.title?.trim() || page?.noteMd?.trim());
  const currentWorkSetId = selectedWorkSet.id;
  const todayTodoGroups = useMemo(() => {
    const groups = new Map<
      number,
      {
        workItem: (typeof todayTodoItems)[number]["workItem"];
        items: Array<{
          checklistItemId: number;
          content: string;
          sortOrder: number;
        }>;
      }
    >();

    for (const todoItem of todayTodoItems) {
      const existingGroup = groups.get(todoItem.workItem.id);
      if (existingGroup) {
        existingGroup.items.push({
          checklistItemId: todoItem.checklistItemId,
          content: todoItem.content,
          sortOrder: todoItem.sortOrder,
        });
        continue;
      }

      groups.set(todoItem.workItem.id, {
        workItem: todoItem.workItem,
        items: [
          {
            checklistItemId: todoItem.checklistItemId,
            content: todoItem.content,
            sortOrder: todoItem.sortOrder,
          },
        ],
      });
    }

    return Array.from(groups.values());
  }, [todayTodoItems]);

  useEffect(() => {
    const nextPositions = Object.fromEntries(minimizedBoardItems.map((item) => [item.id, { x: item.boardX, y: item.boardY }]));
    setDraftPositions(nextPositions);
    draftPositionsRef.current = nextPositions;
  }, [minimizedBoardItems]);

  useEffect(() => {
    draftPositionsRef.current = draftPositions;
  }, [draftPositions]);

  useEffect(() => {
    if (searchQuery) {
      setFreePanel((current) => (current ?? "search"));
      return;
    }

    setFreePanel((current) => (current === "search" ? null : current));
  }, [searchQuery]);

  useEffect(() => {
    const element = freeHeaderRef.current;
    if (!element) {
      return;
    }

    const updateHeight = () => {
      setFreeHeaderHeight(Math.ceil(element.getBoundingClientRect().height));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selectedWorkSet.id, workSets.length, searchQuery, currentView]);

  useEffect(() => {
    const element = statusHeaderRef.current;
    if (!element) {
      return;
    }

    const updateHeight = () => {
      setStatusHeaderHeight(Math.ceil(element.getBoundingClientRect().height));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selectedWorkSet.id, workSets.length, searchQuery, currentView]);

  useEffect(() => {
    if (!canvasDrag) {
      return;
    }
    const activeDrag = canvasDrag;

    function handleMouseMove(event: MouseEvent) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const nextX = Math.max(
        16,
        Math.min(rect.width - 240 - freeCanvasInset.x, event.clientX - rect.left - activeDrag.offsetX - freeCanvasInset.x),
      );
      const nextY = Math.max(16, event.clientY - rect.top - activeDrag.offsetY - freeCanvasInset.y);

      setDraftPositions((current) => ({
        ...current,
        [activeDrag.workItemId]: {
          x: Math.round(nextX),
          y: Math.round(nextY),
        },
      }));
    }

    function handleMouseUp() {
      const nextPosition = draftPositionsRef.current[activeDrag.workItemId];
      if (nextPosition) {
        const payload = new FormData();
        payload.set("intent", "move_canvas_item");
        payload.set("workItemId", String(activeDrag.workItemId));
        payload.set("boardX", String(nextPosition.x));
        payload.set("boardY", String(nextPosition.y));
        payload.set("view", currentView);
        payload.set("workSetId", String(currentWorkSetId));
        canvasMoveFetcher.submit(payload, { method: "post" });
      }
      setCanvasDrag(null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [canvasDrag, canvasMoveFetcher, currentView, currentWorkSetId, freeCanvasInset.x, freeCanvasInset.y]);

  const statusBoardColumns = useMemo(
    () =>
      statuses
        .filter((status) => !DEVLOG_CLOSED_STATUS_KEYS.includes(status.key as never))
        .map((status) => ({
        status: status.key,
        label: status.label,
        totalCount: statusCounts[status.key] ?? 0,
        items: minimizedBoardItems.filter((item) => item.status === status.key),
      })),
    [minimizedBoardItems, statusCounts, statuses],
  );

  function getStatusLabel(status: string) {
    return getDevlogStatusLabel(status, statusLabelMap);
  }

  function openDayDatePicker() {
    const input = dayDateInputRef.current;
    if (!input) {
      return;
    }

    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof pickerInput.showPicker === "function") {
      pickerInput.showPicker();
      return;
    }

    input.focus();
    input.click();
  }

  function handleDayDateInputChange(event: ChangeEvent<HTMLInputElement>) {
    const nextDateToken = event.currentTarget.value;
    if (!nextDateToken) {
      return;
    }

    navigate(buildDashboardLink(nextDateToken, currentView, currentWorkSetId, searchQuery));
  }

  const canvasHeight = useMemo(() => {
    const maxY = minimizedBoardItems.reduce((highest, item) => {
      const current = draftPositions[item.id]?.y ?? item.boardY;
      return Math.max(highest, current);
    }, 0);

    return Math.max(720, maxY + 220);
  }, [draftPositions, minimizedBoardItems]);

  function moveStatusCard(workItemId: number, targetStatus: DevlogStatusValue, beforeWorkItemId?: number | null) {
    const payload = new FormData();
    payload.set("intent", "move_status_item");
    payload.set("workItemId", String(workItemId));
    payload.set("targetStatus", targetStatus);
    payload.set("view", currentView);
    payload.set("workSetId", String(currentWorkSetId));
    if (beforeWorkItemId) payload.set("beforeWorkItemId", String(beforeWorkItemId));
    statusMoveFetcher.submit(payload, { method: "post" });
  }

  function handleStatusDrop(event: DragEvent<HTMLElement>, targetStatus: DevlogStatusValue, beforeWorkItemId?: number | null) {
    event.preventDefault();
    if (!draggedStatusItemId) return;
    if (beforeWorkItemId && beforeWorkItemId === draggedStatusItemId) {
      setDraggedStatusItemId(null);
      return;
    }
    moveStatusCard(draggedStatusItemId, targetStatus, beforeWorkItemId);
    setDraggedStatusItemId(null);
  }

  function startStatusTitleEdit(status: DevlogStatusValue, label: string) {
    setIsAddingStatus(false);
    setNewStatusTitle("");
    setEditingStatusTitle({ status, value: label });
  }

  function cancelStatusTitleEdit(status: DevlogStatusValue) {
    setEditingStatusTitle((current) => (current?.status === status ? null : current));
  }

  function toggleStatusCreate() {
    setEditingStatusTitle(null);
    if (isAddingStatus) {
      setIsAddingStatus(false);
      setNewStatusTitle("");
      return;
    }

    setIsAddingStatus(true);
    setNewStatusTitle("");
  }

  function cancelStatusCreate() {
    setIsAddingStatus(false);
    setNewStatusTitle("");
  }

  function handleCanvasMouseDown(event: ReactMouseEvent<HTMLDivElement>, workItemId: number) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setCanvasDrag({
      workItemId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    });
  }

  const freeCanvasHeight = Math.max(860, canvasHeight + freeCanvasInset.y + 48);

  if (currentView === "free") {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#ece4d7_0%,#f6f0e7_46%,#fbf8f4_100%)] p-4">
        <div className="w-full">
          <section>
            <div
              ref={canvasRef}
              className="relative overflow-hidden rounded-[30px] border border-[#dbc8ad] bg-[radial-gradient(circle_at_top_left,#fff6e9_0%,#fcf9f4_48%,#f7f1e7_100%)] shadow-[0_28px_70px_rgba(72,54,28,0.12)]"
              style={{ minHeight: freeCanvasHeight }}
            >
              <div ref={freeHeaderRef} className="absolute inset-x-4 top-4 z-20 flex flex-col gap-3">
                <WorkSetSwitcher
                  dateToken={dateToken}
                  currentView={currentView}
                  searchQuery={searchQuery}
                  workSets={workSets}
                  selectedWorkSet={selectedWorkSet}
                />

                <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-white/70 bg-white/88 px-3 py-2.5 shadow-[0_18px_40px_rgba(72,54,28,0.08)] backdrop-blur">
                  <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                    <Link to={buildDashboardLink(dateToken, "day", currentWorkSetId, searchQuery)} aria-label="날짜 보기" title="날짜 보기">
                      <CalendarDays className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                    <Link to={buildDashboardLink(dateToken, "status", currentWorkSetId, searchQuery)} aria-label="상태 보기" title="상태 보기">
                      <LayoutGrid className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="default" size="icon" className="h-10 w-10 rounded-full shrink-0">
                    <Link to={buildDashboardLink(dateToken, "free", currentWorkSetId, searchQuery)} aria-label="자유 배치" title="자유 배치">
                      <Move className="h-4 w-4" />
                    </Link>
                  </Button>
                  <div className="mx-1 hidden h-7 w-px bg-[#eadfce] sm:block" />
                  <Button type="button" variant={freePanel === "page" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="날짜 메모" title="날짜 메모" onClick={() => setFreePanel((current) => (current === "page" ? null : "page"))}>
                    <NotebookPen className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant={freePanel === "new" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="새 작업 카드" title="새 작업 카드" onClick={() => setFreePanel((current) => (current === "new" ? null : "new"))}>
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant={freePanel === "todo" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="오늘 할 일" title="오늘 할 일" onClick={() => setFreePanel((current) => (current === "todo" ? null : "todo"))}>
                    <ListTodo className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant={freePanel === "search" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="검색 결과" title="검색 결과" onClick={() => setFreePanel((current) => (current === "search" ? null : "search"))}>
                    <Search className="h-4 w-4" />
                  </Button>
                  <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                    <Link to={buildArchiveLink(currentWorkSetId, searchQuery)} aria-label="보관함" title="보관함">
                      <Archive className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button type="button" variant={freePanel === "recent" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="최근 기록" title="최근 기록" onClick={() => setFreePanel((current) => (current === "recent" ? null : "recent"))}>
                    <History className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 px-1 py-1">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#94724b]">
                    <span className="h-2 w-2 rounded-full bg-[#b7844d]" />
                    자유 배치
                  </div>

                  <div className="min-w-[220px] flex-1">
                    <p className="text-lg font-semibold text-slate-900">{page?.title || "자유 배치 중심 보드"}</p>
                    {page?.title ? <p className="mt-1 text-sm text-slate-500">자유 배치 중심 보드</p> : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">오늘 할 일 {todayTodoCount}개</Badge>
                    <Badge variant="outline">작업 {openWorkItems.length}개</Badge>
                    {nextWorkItem ? (
                      <Badge>{getStatusLabel(nextWorkItem.status)} · 다음 작업 {nextWorkItem.title}</Badge>
                    ) : (
                      <Badge variant="secondary">다음 작업은 아직 비어 있어요.</Badge>
                    )}
                  </div>
                </div>

              </div>

              {freePanel ? (
                <div
                  className="absolute left-4 right-4 z-20 xl:left-auto xl:right-4 xl:w-[360px]"
                  style={{ top: freeHeaderHeight + 32 }}
                >
                  <div className="rounded-[28px] border border-white/70 bg-white/92 p-4 shadow-[0_22px_44px_rgba(72,54,28,0.12)] backdrop-blur">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {freePanel === "page" && "날짜 메모"}
                          {freePanel === "new" && "새 작업 카드"}
                          {freePanel === "todo" && "오늘 할 일"}
                          {freePanel === "search" && "검색 결과"}
                          {freePanel === "recent" && "최근 기록"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {freePanel === "page" && "현재 날짜의 메모를 자유 배치 보드 안에서 바로 수정해요."}
                          {freePanel === "new" && "캔버스에 올릴 새 작업 카드를 빠르게 만들어요."}
                          {freePanel === "todo" && "오늘 표시한 체크리스트만 빠르게 모아봐요."}
                          {freePanel === "search" && "이 세트 안에서 찾은 작업만 빠르게 모아봐요."}
                          {freePanel === "recent" && "최근 날짜와 다시 붙일 카드들을 한 번에 봐요."}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="rounded-full" onClick={() => setFreePanel(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {freePanel === "page" ? (
                      <Form method="post" className="space-y-3">
                        <input type="hidden" name="intent" value="save_page" />
                        <input type="hidden" name="view" value={currentView} />
                        <input type="hidden" name="workSetId" value={currentWorkSetId} />
                        <Input name="title" defaultValue={page?.title ?? ""} placeholder="날짜 메모 제목" />
                        <Textarea
                          name="noteMd"
                          defaultValue={page?.noteMd ?? ""}
                          rows={9}
                          className="font-mono text-sm"
                          placeholder={"# 오늘의 메모\n\n- 기록할 포인트\n- 이어서 할 일\n- 남겨둘 맥락"}
                        />
                        <Button type="submit" className="w-full">메모 저장</Button>
                      </Form>
                    ) : null}

                    {freePanel === "new" ? (
                      <Form method="post" className="space-y-3">
                        <input type="hidden" name="intent" value="create_work_item" />
                        <input type="hidden" name="view" value={currentView} />
                        <input type="hidden" name="workSetId" value={currentWorkSetId} />
                        <Input name="title" placeholder="새 작업 제목" />
                        <Input name="nextAction" placeholder="다음 할일 한 줄" />
                        <Button type="submit" className="w-full">
                          <Plus className="h-4 w-4" />
                          작업 카드 만들기
                        </Button>
                      </Form>
                    ) : null}

                    {freePanel === "todo" ? (
                      <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
                        {todayTodoGroups.length === 0 ? (
                          <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">오늘 할 일이 아직 없어요.</p>
                        ) : (
                          todayTodoGroups.map((group) => (
                            <TodayTodoGroupCard
                              key={group.workItem.id}
                              dateToken={dateToken}
                              workSetId={currentWorkSetId}
                              group={group}
                              statusLabel={getStatusLabel(group.workItem.status)}
                            />
                          ))
                        )}
                      </div>
                    ) : null}

                    {freePanel === "search" ? (
                      <div className="space-y-3">
                        <DashboardSearchForm
                          dateToken={dateToken}
                          currentView={currentView}
                          workSetId={currentWorkSetId}
                          searchQuery={searchQuery}
                        />
                        <div className="max-h-[68vh] overflow-y-auto pr-1">
                          <DashboardWorkItemList
                            items={searchResults}
                            dateToken={dateToken}
                            workSetId={currentWorkSetId}
                            getStatusLabel={getStatusLabel}
                            emptyText={searchQuery ? "검색 결과가 없어요." : "검색어를 먼저 입력해 주세요."}
                          />
                        </div>
                      </div>
                    ) : null}

                    {freePanel === "recent" ? (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#94724b]">최근 날짜</p>
                          {recentPages.map((item) => (
                            <Link
                              key={item.id}
                              to={buildDashboardLink(item.pageDate.slice(0, 10), currentView, currentWorkSetId, searchQuery)}
                              className="flex items-center justify-between rounded-2xl border border-[#e7dac9] bg-[#fffaf3] px-3 py-3 text-sm"
                            >
                              <div>
                                <p className="font-medium text-slate-800">{formatShortDate(item.pageDate)}</p>
                                <p className="text-xs text-slate-500">{item.title || "제목 없는 페이지"}</p>
                              </div>
                              <Badge variant="outline">{item.workItemCount}개</Badge>
                            </Link>
                          ))}
                        </div>

                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {minimizedBoardItems.length === 0 ? (
                <div className="flex items-center justify-center text-sm text-slate-500" style={{ minHeight: freeCanvasHeight }}>
                  자유 배치할 카드가 아직 없어요.
                </div>
              ) : (
                minimizedBoardItems.map((item) => {
                  const checklistSummary = summarizeChecklist(item.checklist);
                  const todayTodoItems = item.checklist.filter((checklistItem) => checklistItem.isTodayTodo && !checklistItem.isDone);
                  const primaryTodayTodo = todayTodoItems[0] ?? null;
                  const metaDate = item.plannedDate ?? item.lastDiaryPage?.pageDate ?? null;
                  const position = draftPositions[item.id] ?? { x: item.boardX, y: item.boardY };
                  return (
                    <div
                      key={item.id}
                      className="absolute w-[240px] cursor-grab rounded-2xl border border-[#e6d9c7] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing"
                      style={{ left: position.x + freeCanvasInset.x, top: position.y + freeCanvasInset.y }}
                      onMouseDown={(event) => handleCanvasMouseDown(event, item.id)}
                    >
                      <div className="flex items-start gap-3">
                        <Move className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-semibold tracking-[-0.01em] text-slate-900">{item.title}</p>
                                {item.isPinned ? <PinnedBadge compact /> : null}
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 rounded-full text-slate-300 hover:bg-[#faf5ee] hover:text-slate-600"
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                openWorkWindow(buildWorkWindowLink(dateToken, item.id, currentWorkSetId));
                              }}
                              aria-label="작업창 열기"
                              title="작업창 열기"
                            >
                              <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <WorkItemReferenceText
                            dateToken={dateToken}
                            workSetId={currentWorkSetId}
                            text={item.nextAction}
                            emptyText="다음 할일이 아직 없어요."
                            className="mt-2 text-sm text-slate-600"
                          />
                          {(primaryTodayTodo || checklistSummary.totalCount > 0 || metaDate) ? (
                            <div className={`${item.nextAction ? "mt-3" : "mt-2"} flex flex-wrap items-center gap-3 text-xs text-slate-500`}>
                              {primaryTodayTodo ? (
                                <TodayTodoBadge
                                  count={todayTodoItems.length}
                                  compact
                                  title={
                                    todayTodoItems.length > 1
                                      ? `오늘 할 일 ${todayTodoItems.length}개`
                                      : `오늘 할 일: ${primaryTodayTodo.content}`
                                  }
                                />
                              ) : null}
                              {checklistSummary.totalCount > 0 ? (
                                <span
                                  className="inline-flex items-center gap-1.5"
                                  title={`체크리스트 ${checklistSummary.doneCount}/${checklistSummary.totalCount}`}
                                >
                                  {checklistSummary.remainingCount === 0 ? (
                                    <CheckCheck className="h-3.5 w-3.5 text-emerald-600" />
                                  ) : (
                                    <ListTodo className="h-3.5 w-3.5 text-slate-400" />
                                  )}
                                  <span className="font-medium text-slate-500">
                                    {checklistSummary.remainingCount === 0
                                      ? `${checklistSummary.doneCount}/${checklistSummary.totalCount}`
                                      : `${checklistSummary.remainingCount}/${checklistSummary.totalCount}`}
                                  </span>
                                </span>
                              ) : null}
                              {metaDate ? (
                                <span className="inline-flex items-center gap-1.5 text-slate-400">
                                  <CalendarDays className="h-3.5 w-3.5" />
                                  <span>{formatShortDate(metaDate)}</span>
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (currentView === "status") {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#ece4d7_0%,#f6f0e7_46%,#fbf8f4_100%)] p-4">
        <div className="w-full">
          <section>
            <div className="relative overflow-hidden rounded-[30px] border border-[#dbc8ad] bg-[radial-gradient(circle_at_top_left,#fff6e9_0%,#fcf9f4_48%,#f7f1e7_100%)] shadow-[0_28px_70px_rgba(72,54,28,0.12)]">
              <div ref={statusHeaderRef} className="absolute inset-x-4 top-4 z-20 flex flex-col gap-3">
                <WorkSetSwitcher
                  dateToken={dateToken}
                  currentView={currentView}
                  searchQuery={searchQuery}
                  workSets={workSets}
                  selectedWorkSet={selectedWorkSet}
                />

                <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-white/70 bg-white/88 px-3 py-2.5 shadow-[0_18px_40px_rgba(72,54,28,0.08)] backdrop-blur">
                  <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                    <Link to={buildDashboardLink(dateToken, "day", currentWorkSetId, searchQuery)} aria-label="날짜 보기" title="날짜 보기">
                      <CalendarDays className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="default" size="icon" className="h-10 w-10 rounded-full">
                    <Link to={buildDashboardLink(dateToken, "status", currentWorkSetId, searchQuery)} aria-label="상태 보기" title="상태 보기">
                      <LayoutGrid className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                    <Link to={buildDashboardLink(dateToken, "free", currentWorkSetId, searchQuery)} aria-label="자유 배치" title="자유 배치">
                      <Move className="h-4 w-4" />
                    </Link>
                  </Button>
                  <div className="mx-1 hidden h-7 w-px bg-[#eadfce] sm:block" />
                  <Button type="button" variant={freePanel === "page" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="날짜 메모" title="날짜 메모" onClick={() => setFreePanel((current) => (current === "page" ? null : "page"))}>
                    <NotebookPen className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant={freePanel === "new" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="새 작업 카드" title="새 작업 카드" onClick={() => setFreePanel((current) => (current === "new" ? null : "new"))}>
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant={freePanel === "todo" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="오늘 할 일" title="오늘 할 일" onClick={() => setFreePanel((current) => (current === "todo" ? null : "todo"))}>
                    <ListTodo className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant={freePanel === "search" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="검색 결과" title="검색 결과" onClick={() => setFreePanel((current) => (current === "search" ? null : "search"))}>
                    <Search className="h-4 w-4" />
                  </Button>
                  <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                    <Link to={buildArchiveLink(currentWorkSetId, searchQuery)} aria-label="보관함" title="보관함">
                      <Archive className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button type="button" variant={freePanel === "recent" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="최근 기록" title="최근 기록" onClick={() => setFreePanel((current) => (current === "recent" ? null : "recent"))}>
                    <History className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 px-1 py-1">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#94724b]">
                    <span className="h-2 w-2 rounded-full bg-[#b7844d]" />
                    상태 보기
                  </div>

                  <div className="min-w-[220px] flex-1">
                    <p className="text-lg font-semibold text-slate-900">{page?.title || "상태 보드"}</p>
                    {page?.title ? <p className="mt-1 text-sm text-slate-500">상태 보드</p> : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">오늘 할 일 {todayTodoCount}개</Badge>
                    <Badge variant="outline">작업 {openWorkItems.length}개</Badge>
                    {nextWorkItem ? (
                      <Badge>{getStatusLabel(nextWorkItem.status)} · 다음 작업 {nextWorkItem.title}</Badge>
                    ) : (
                      <Badge variant="secondary">다음 작업이 아직 비어 있어요.</Badge>
                    )}
                  </div>
                </div>

              </div>

              {freePanel ? (
                <div
                  className="absolute left-4 right-4 z-20 xl:left-auto xl:right-4 xl:w-[360px]"
                  style={{ top: statusHeaderHeight + 32 }}
                >
                  <div className="rounded-[28px] border border-white/70 bg-white/92 p-4 shadow-[0_22px_44px_rgba(72,54,28,0.12)] backdrop-blur">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {freePanel === "page" && "날짜 메모"}
                          {freePanel === "new" && "새 작업 카드"}
                          {freePanel === "todo" && "오늘 할 일"}
                          {freePanel === "search" && "검색 결과"}
                          {freePanel === "recent" && "최근 기록"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {freePanel === "page" && "지금 보고 있는 날짜 메모를 상태 보드 안에서 바로 수정해요."}
                          {freePanel === "new" && "상태 보드에서 바로 새 작업 카드를 만들어요."}
                          {freePanel === "todo" && "오늘 표시한 체크리스트만 빠르게 모아봐요."}
                          {freePanel === "search" && "이 세트 안에서 찾은 작업만 빠르게 모아봐요."}
                          {freePanel === "recent" && "최근 페이지와 다시 붙일 카드를 한 번에 확인해요."}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="rounded-full" onClick={() => setFreePanel(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {freePanel === "page" ? (
                      <Form method="post" className="space-y-3">
                        <input type="hidden" name="intent" value="save_page" />
                        <input type="hidden" name="view" value={currentView} />
                        <input type="hidden" name="workSetId" value={currentWorkSetId} />
                        <Input name="title" defaultValue={page?.title ?? ""} placeholder="날짜 메모 제목" />
                        <Textarea
                          name="noteMd"
                          defaultValue={page?.noteMd ?? ""}
                          rows={9}
                          className="font-mono text-sm"
                          placeholder={"# 오늘의 메모\n\n- 지금 보는 상태\n- 이어서 할 일\n- 막힌 점"}
                        />
                        <Button type="submit" className="w-full">메모 저장</Button>
                      </Form>
                    ) : null}

                    {freePanel === "new" ? (
                      <Form method="post" className="space-y-3">
                        <input type="hidden" name="intent" value="create_work_item" />
                        <input type="hidden" name="view" value={currentView} />
                        <input type="hidden" name="workSetId" value={currentWorkSetId} />
                        <Input name="title" placeholder="새 작업 제목" />
                        <Input name="nextAction" placeholder="다음 할일 한 줄" />
                        <Button type="submit" className="w-full">
                          <Plus className="h-4 w-4" />
                          작업 카드 만들기
                        </Button>
                      </Form>
                    ) : null}

                    {freePanel === "todo" ? (
                      <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
                        {todayTodoGroups.length === 0 ? (
                          <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">오늘 할 일이 아직 없어요.</p>
                        ) : (
                          todayTodoGroups.map((group) => (
                            <TodayTodoGroupCard
                              key={group.workItem.id}
                              dateToken={dateToken}
                              workSetId={currentWorkSetId}
                              group={group}
                              statusLabel={getStatusLabel(group.workItem.status)}
                            />
                          ))
                        )}
                      </div>
                    ) : null}

                    {freePanel === "search" ? (
                      <div className="space-y-3">
                        <DashboardSearchForm
                          dateToken={dateToken}
                          currentView={currentView}
                          workSetId={currentWorkSetId}
                          searchQuery={searchQuery}
                        />
                        <div className="max-h-[68vh] overflow-y-auto pr-1">
                          <DashboardWorkItemList
                            items={searchResults}
                            dateToken={dateToken}
                            workSetId={currentWorkSetId}
                            getStatusLabel={getStatusLabel}
                            emptyText={searchQuery ? "검색 결과가 없어요." : "검색어를 먼저 입력해 주세요."}
                          />
                        </div>
                      </div>
                    ) : null}

                    {freePanel === "recent" ? (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#94724b]">최근 날짜</p>
                          {recentPages.map((item) => (
                            <Link
                              key={item.id}
                              to={buildDashboardLink(item.pageDate.slice(0, 10), currentView, currentWorkSetId, searchQuery)}
                              className="flex items-center justify-between rounded-2xl border border-[#e7dac9] bg-[#fffaf3] px-3 py-3 text-sm"
                            >
                              <div>
                                <p className="font-medium text-slate-800">{formatShortDate(item.pageDate)}</p>
                                <p className="text-xs text-slate-500">{item.title || "제목 없는 페이지"}</p>
                              </div>
                              <Badge variant="outline">{item.workItemCount}개</Badge>
                            </Link>
                          ))}
                        </div>

                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div
                className={`relative z-10 flex gap-4 overflow-x-auto px-4 pb-4 ${freePanel ? "xl:pr-[392px]" : ""}`}
                style={{ paddingTop: statusHeaderHeight + 32 }}
              >
                {statusBoardColumns.map((column, index) => (
                  <section
                    key={column.status}
                    className="flex min-h-[420px] w-[280px] shrink-0 flex-col rounded-[28px] border border-[#eadfce] bg-[#fbf8f3] p-4 lg:w-[320px]"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleStatusDrop(event, column.status)}
                  >
                    <div className="mb-4 border-b border-[#eadfce] pb-4">
                      <StatusBoardColumnHeader
                        column={column}
                        currentView={currentView}
                        editingStatusTitle={editingStatusTitle}
                        onStartEdit={startStatusTitleEdit}
                        onEditChange={(value) =>
                          setEditingStatusTitle((current) =>
                            current?.status === column.status ? { ...current, value } : current,
                          )
                        }
                        onCancelEdit={cancelStatusTitleEdit}
                        showAddButton={index === statusBoardColumns.length - 1}
                        isAddingStatus={isAddingStatus}
                        newStatusTitle={newStatusTitle}
                        onToggleCreate={toggleStatusCreate}
                        onCreateTitleChange={setNewStatusTitle}
                        onCancelCreate={cancelStatusCreate}
                      />
                    </div>

                    <div className="flex flex-1 flex-col gap-3">
                      {column.items.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed px-3 py-10 text-center text-sm text-slate-400">카드가 없어요.</div>
                      ) : (
                        column.items.map((item) => {
                          const checklistSummary = summarizeChecklist(item.checklist);
                          const todayTodoItems = item.checklist.filter((checklistItem) => checklistItem.isTodayTodo && !checklistItem.isDone);
                          const primaryTodayTodo = todayTodoItems[0] ?? null;
                          return (
                            <article
                              key={item.id}
                              draggable
                              onDragStart={() => setDraggedStatusItemId(item.id)}
                              onDragEnd={() => setDraggedStatusItemId(null)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => handleStatusDrop(event, column.status, item.id)}
                              onClick={() => openWorkWindow(buildWorkWindowLink(dateToken, item.id, currentWorkSetId))}
                              className="cursor-pointer rounded-2xl border border-[#e6d9c7] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                            >
                              <div className="flex items-start gap-3">
                                <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="truncate text-sm font-semibold tracking-[-0.01em] text-slate-900">{item.title}</p>
                                    {item.isPinned ? <PinnedBadge compact /> : null}
                                  </div>
                                  <WorkItemReferenceText
                                    dateToken={dateToken}
                                    workSetId={currentWorkSetId}
                                    text={item.nextAction}
                                    className="mt-2 text-sm text-slate-600"
                                  />
                                  {(primaryTodayTodo || checklistSummary.totalCount > 0 || item.plannedDate || item.lastDiaryPage) ? (
                                    <div className={`${item.nextAction ? "mt-3" : "mt-2"} flex flex-wrap items-center gap-3 text-xs text-slate-500`}>
              {primaryTodayTodo ? (
                <TodayTodoBadge
                  count={todayTodoItems.length}
                  compact
                  title={
                    todayTodoItems.length > 1
                      ? `오늘 할일 ${todayTodoItems.length}개`
                      : `오늘 할일: ${primaryTodayTodo.content}`
                  }
                />
              ) : null}
                                      {checklistSummary.totalCount > 0 ? (
                                        <span
                                          className="inline-flex items-center gap-1.5"
                                          title={`체크리스트 ${checklistSummary.doneCount}/${checklistSummary.totalCount}`}
                                        >
                                          {checklistSummary.remainingCount === 0 ? (
                                            <CheckCheck className="h-3.5 w-3.5 text-emerald-600" />
                                          ) : (
                                            <ListTodo className="h-3.5 w-3.5 text-slate-400" />
                                          )}
                                          <span className="font-medium text-slate-500">
                                            {checklistSummary.remainingCount === 0
                                              ? `${checklistSummary.doneCount}/${checklistSummary.totalCount}`
                                              : `${checklistSummary.remainingCount}/${checklistSummary.totalCount}`}
                                          </span>
                                        </span>
                                      ) : null}
                                      {item.plannedDate || item.lastDiaryPage ? (
                                        <span className="inline-flex items-center gap-1.5 text-slate-400">
                                          <CalendarDays className="h-3.5 w-3.5" />
                                          <span>{formatShortDate(item.plannedDate ?? item.lastDiaryPage?.pageDate ?? "")}</span>
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </article>
                          );
                        })
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#ece4d7_0%,#f6f0e7_46%,#fbf8f4_100%)] p-4">
      <div className="w-full space-y-5">
        <section>
          <div className="rounded-[30px] border border-[#dbc8ad] bg-[radial-gradient(circle_at_top_left,#fff6e9_0%,#fcf9f4_48%,#f7f1e7_100%)] p-4 shadow-[0_28px_70px_rgba(72,54,28,0.12)]">
            <div className="flex flex-col gap-3">
              <WorkSetSwitcher
                dateToken={dateToken}
                currentView={currentView}
                searchQuery={searchQuery}
                workSets={workSets}
                selectedWorkSet={selectedWorkSet}
              />

              <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-white/70 bg-white/88 px-3 py-2.5 shadow-[0_18px_40px_rgba(72,54,28,0.08)] backdrop-blur">
                <Button asChild variant="default" size="icon" className="h-10 w-10 rounded-full shrink-0">
                  <Link to={buildDashboardLink(dateToken, "day", currentWorkSetId, searchQuery)} aria-label="날짜 보기" title="날짜 보기">
                    <CalendarDays className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                  <Link to={buildDashboardLink(dateToken, "status", currentWorkSetId, searchQuery)} aria-label="상태 보기" title="상태 보기">
                    <LayoutGrid className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                  <Link to={buildDashboardLink(dateToken, "free", currentWorkSetId, searchQuery)} aria-label="자유 배치" title="자유 배치">
                    <Move className="h-4 w-4" />
                  </Link>
                </Button>
                <div className="mx-1 hidden h-7 w-px bg-[#eadfce] sm:block" />
                <Button
                  type="button"
                  variant={freePanel === "search" ? "default" : "outline"}
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  aria-label="검색 결과"
                  title="검색 결과"
                  onClick={() => setFreePanel((current) => (current === "search" ? null : "search"))}
                >
                  <Search className="h-4 w-4" />
                </Button>
                <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                  <Link to={buildArchiveLink(currentWorkSetId, searchQuery)} aria-label="보관함" title="보관함">
                    <Archive className="h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 px-1 py-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#94724b]">
                  <span className="h-2 w-2 rounded-full bg-[#b7844d]" />
                  날짜 보기
                </div>

                <div className="flex min-w-[260px] flex-1 items-center justify-center gap-3">
                  <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                    <Link to={buildDashboardLink(prevDateToken, currentView, currentWorkSetId, searchQuery)} aria-label="이전 날짜" title="이전 날짜">
                      <ArrowLeft className="h-4 w-4" />
                    </Link>
                  </Button>
                  <div className="relative">
                    <input
                      ref={dayDateInputRef}
                      type="date"
                      value={dateToken}
                      onChange={handleDayDateInputChange}
                      tabIndex={-1}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 opacity-0"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto rounded-full px-4 py-2 text-lg font-semibold text-slate-900 hover:bg-white/80"
                      aria-label="날짜 선택"
                      title="날짜 선택"
                      onClick={openDayDatePicker}
                    >
                      {displayDateLabel}
                    </Button>
                  </div>
                  <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                    <Link to={buildDashboardLink(nextDateToken, currentView, currentWorkSetId, searchQuery)} aria-label="다음 날짜" title="다음 날짜">
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">오늘 할 일 {todayTodoCount}개</Badge>
                  <Badge variant="outline">작업 {openWorkItems.length}개</Badge>
                  {nextWorkItem ? (
                    <Badge>{getStatusLabel(nextWorkItem.status)} · 다음 작업 {nextWorkItem.title}</Badge>
                  ) : (
                    <Badge variant="secondary">다음 작업이 아직 없어요.</Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className={`grid gap-5 ${isDayView ? "xl:grid-cols-[minmax(0,1fr)_380px] xl:items-stretch" : "xl:grid-cols-[380px_1fr]"}`}>
          <aside className={`space-y-5 ${isDayView ? "xl:order-2" : ""}`}>
            {isDayView ? (
              <>
                {freePanel === "search" ? (
                  <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <CardTitle>검색 결과</CardTitle>
                          {searchQuery ? <CardDescription>{searchQuery}와 연결된 작업만 보여줘요.</CardDescription> : null}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="rounded-full"
                          onClick={() => setFreePanel((current) => (current === "search" ? null : current))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <DashboardSearchForm
                        dateToken={dateToken}
                        currentView={currentView}
                        workSetId={currentWorkSetId}
                        searchQuery={searchQuery}
                      />
                      <DashboardWorkItemList
                        items={searchResults}
                        dateToken={dateToken}
                        workSetId={currentWorkSetId}
                        getStatusLabel={getStatusLabel}
                        emptyText={searchQuery ? "검색 결과가 없어요." : "검색어를 먼저 입력해 주세요."}
                      />
                    </CardContent>
                  </Card>
                ) : null}

                <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
                  <CardHeader>
                    <CardTitle>오늘 할 일 목록</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {todayTodoGroups.length === 0 ? (
                      <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">오늘 할 일이 아직 없어요.</p>
                    ) : (
                      todayTodoGroups.map((group) => (
                      <TodayTodoGroupCard
                        key={group.workItem.id}
                        dateToken={dateToken}
                        workSetId={currentWorkSetId}
                        group={group}
                        statusLabel={getStatusLabel(group.workItem.status)}
                      />
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
                  <CardHeader>
                    <CardTitle>날짜 메모</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form method="post" className="space-y-3">
                      <input type="hidden" name="intent" value="save_page" />
                      <input type="hidden" name="view" value={currentView} />
                      <input type="hidden" name="workSetId" value={currentWorkSetId} />
                      <Input name="title" defaultValue={page?.title ?? ""} placeholder="날짜 제목" />
                      <Textarea
                        name="noteMd"
                        defaultValue={page?.noteMd ?? ""}
                        rows={8}
                        className="font-mono text-sm"
                        placeholder={"# 오늘 메모\n\n- 이 날짜에 한 일\n- 이어서 볼 포인트\n- 남겨둘 메모"}
                      />
                      <Button type="submit" className="w-full">날짜 메모 저장</Button>
                    </Form>
                  </CardContent>
                </Card>
              </>
            ) : (
              <>
                <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
                  <CardHeader>
                    <CardTitle>날짜 페이지 메모</CardTitle>
                    <CardDescription>선택한 날짜는 일기처럼 남기고, 작업은 대시보드에서 다양한 방식으로 관리해요.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Form method="post" className="space-y-3">
                      <input type="hidden" name="intent" value="save_page" />
                      <input type="hidden" name="view" value={currentView} />
                      <input type="hidden" name="workSetId" value={currentWorkSetId} />
                      <Input name="title" defaultValue={page?.title ?? ""} placeholder="예: 개발 대시보드 구조 정리" />
                      <Textarea
                        name="noteMd"
                        defaultValue={page?.noteMd ?? ""}
                        rows={7}
                        className="font-mono text-sm"
                        placeholder={"# 오늘의 페이지\n\n- 이 날짜에 한 일\n- 이어서 볼 포인트\n- 막힌 점 정리"}
                      />
                      <Button type="submit" className="w-full">날짜 메모 저장</Button>
                    </Form>
                  </CardContent>
                </Card>

                <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
                  <CardHeader>
                    <CardTitle>새 작업 카드</CardTitle>
                    <CardDescription>작업창은 따로 열리고, 대시보드에서는 카드를 자유롭게 정리할 수 있어요.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Form method="post" className="space-y-3">
                      <input type="hidden" name="intent" value="create_work_item" />
                      <input type="hidden" name="view" value={currentView} />
                      <input type="hidden" name="workSetId" value={currentWorkSetId} />
                      <Input name="title" placeholder="새 작업 제목" />
                      <Input name="nextAction" placeholder="다음 할일 한 줄" />
                      <Button type="submit" className="w-full">
                        <Plus className="h-4 w-4" />
                        작업 카드 추가
                      </Button>
                    </Form>
                  </CardContent>
                </Card>

                <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
                  <CardHeader>
                    <CardTitle>날짜 빠른 이동</CardTitle>
                    <CardDescription>최근 작성한 날짜 페이지를 바로 열 수 있어요.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {recentPages.map((item) => (
                      <Link
                        key={item.id}
                        to={buildDashboardLink(item.pageDate.slice(0, 10), currentView, currentWorkSetId, searchQuery)}
                        className="flex items-center justify-between rounded-2xl border border-[#e7dac9] bg-[#fffaf3] px-3 py-3 text-sm"
                      >
                        <div>
                          <p className="font-medium text-slate-800">{formatShortDate(item.pageDate)}</p>
                          <p className="text-xs text-slate-500">{item.title || "제목 없는 페이지"}</p>
                        </div>
                        <Badge variant="outline">{item.workItemCount}개</Badge>
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              </>
            )}
          </aside>

          <main className={`space-y-5 ${isDayView ? "xl:order-1 xl:self-stretch" : ""}`}>
            {currentView === "day" ? (
              <Card
                className={`rounded-[28px] border-[#dbc8ad] bg-white/90 ${isDayView ? "xl:flex xl:h-full xl:flex-col" : ""}`}
              >
                <CardHeader>
                  <CardTitle>날짜 보기</CardTitle>
                </CardHeader>
                <CardContent className={dateItems.length === 0 ? "flex flex-1 flex-col gap-4" : "flex-1 space-y-4"}>
                  {hasPageMemo ? (
                    <div className="rounded-[22px] border border-[#e7dac9] bg-[#fffaf3] p-4">
                      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94724b]">
                        <span className="h-2 w-2 rounded-full bg-[#b7844d]" />
                        날짜 메모
                      </div>
                      {page?.title?.trim() ? <p className="mt-3 text-sm font-semibold text-slate-900">{page.title}</p> : null}
                      {page?.noteMd?.trim() ? (
                        <DevlogRichText
                          text={page.noteMd}
                          className={`${page?.title?.trim() ? "mt-2" : "mt-3"} text-sm text-slate-700`}
                        />
                      ) : null}
                    </div>
                  ) : null}

                  {dateItems.length === 0 ? (
                    <p className="flex flex-1 items-center justify-center rounded-2xl border border-dashed px-4 py-12 text-center text-sm text-slate-500">
                      이 날짜에 연결된 작업 카드가 아직 없어요.
                    </p>
                  ) : (
                    <div className="grid content-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                      {dateItems.map((item) => (
                        <DayViewWorkItemCard
                          key={item.id}
                          dateToken={dateToken}
                          workSetId={currentWorkSetId}
                          item={item}
                          statusLabel={getStatusLabel(item.status)}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {false ? (
              <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4 text-[#94724b]" />
                    <CardTitle>상태 보기</CardTitle>
                  </div>
                  <CardDescription>날짜와 상관없이 진행 중인 작업을 상태별로 정리합니다.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 xl:grid-cols-5">
                    {statusBoardColumns.map((column) => (
                      <section
                        key={column.status}
                        className="rounded-[24px] border border-[#eadfce] bg-[#fbf8f3] p-3"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleStatusDrop(event, column.status)}
                      >
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="h-2.5 w-2.5 rounded-full bg-[#9d7a53]" />
                            <p className="text-sm font-semibold text-slate-800">{column.label}</p>
                          </div>
                          <Badge variant="outline">{column.items.length}/{column.totalCount}</Badge>
                        </div>
                        <div className="space-y-3">
                          {column.items.length === 0 ? (
                            <div className="rounded-2xl border border-dashed px-3 py-8 text-center text-xs text-slate-400">카드가 없어요.</div>
                          ) : (
                            column.items.map((item) => {
                              const checklistSummary = summarizeChecklist(item.checklist);
                              return (
                                <article
                                  key={item.id}
                                  draggable
                                  onDragStart={() => setDraggedStatusItemId(item.id)}
                                  onDragEnd={() => setDraggedStatusItemId(null)}
                                  onDragOver={(event) => event.preventDefault()}
                                  onDrop={(event) => handleStatusDrop(event, column.status, item.id)}
                                  className="rounded-2xl border border-[#e6d9c7] bg-white p-3 shadow-sm"
                                >
                                  <div className="mb-2 flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="line-clamp-2 text-sm font-medium text-slate-800">{item.title}</p>
                                      <WorkItemReferenceText
                                        dateToken={dateToken}
                                        workSetId={currentWorkSetId}
                                        text={item.nextAction}
                                        emptyText="다음 할일이 아직 없어요."
                                        className="mt-1 line-clamp-2 text-xs text-slate-500"
                                      />
                                    </div>
                                    <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                                  </div>
                                  <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                    <span>남은 체크 {checklistSummary.remainingCount}개</span>
                                    <TodayTodoBadge
                                      count={checklistSummary.todayCount}
                                      compact
                                      title={`오늘 할 일 ${checklistSummary.todayCount}개`}
                                    />
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <WorkWindowButton to={buildWorkWindowLink(dateToken, item.id, currentWorkSetId)} size="sm" />
                                    <Form method="post">
                                      <input type="hidden" name="intent" value="attach_work_item_to_page" />
                                      <input type="hidden" name="workItemId" value={item.id} />
                                      <input type="hidden" name="view" value={currentView} />
                                      <input type="hidden" name="workSetId" value={currentWorkSetId} />
                                      <Button type="submit" variant="outline" size="sm">날짜 연결</Button>
                                    </Form>
                                  </div>
                                </article>
                              );
                            })
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}

          </main>
        </div>
      </div>
    </div>
  );
}

function StatusBoardColumnHeader({
  column,
  currentView,
  editingStatusTitle,
  onStartEdit,
  onEditChange,
  onCancelEdit,
  showAddButton,
  isAddingStatus,
  newStatusTitle,
  onToggleCreate,
  onCreateTitleChange,
  onCancelCreate,
}: {
  column: {
    status: DevlogStatusValue;
    label: string;
    items: Array<unknown>;
    totalCount: number;
  };
  currentView: DashboardView;
  editingStatusTitle: { status: DevlogStatusValue; value: string } | null;
  onStartEdit: (status: DevlogStatusValue, label: string) => void;
  onEditChange: (value: string) => void;
  onCancelEdit: (status: DevlogStatusValue) => void;
  showAddButton: boolean;
  isAddingStatus: boolean;
  newStatusTitle: string;
  onToggleCreate: () => void;
  onCreateTitleChange: (value: string) => void;
  onCancelCreate: () => void;
}) {
  const isEditing = editingStatusTitle?.status === column.status;
  const draftTitle = isEditing ? editingStatusTitle.value : column.label;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <Form method="post" className="flex flex-col gap-2">
              <input type="hidden" name="intent" value="save_status_title" />
              <input type="hidden" name="view" value={currentView} />
              <input type="hidden" name="status" value={column.status} />
              <Input
                name="statusTitle"
                value={draftTitle}
                onChange={(event) => onEditChange(event.currentTarget.value)}
                className="h-10 bg-white"
                placeholder="상태 제목"
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" className="h-10 rounded-full px-4">
                  저장
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-10 rounded-full px-4" onClick={() => onCancelEdit(column.status)}>
                  취소
                </Button>
              </div>
            </Form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onStartEdit(column.status, column.label)}
                className="min-w-0 rounded-2xl px-1 py-1 text-left transition hover:bg-white/80"
              >
                <span className="block truncate text-2xl font-semibold text-slate-900">{column.label}</span>
              </button>
              <Badge variant="outline">
                {column.items.length}/{column.totalCount}
              </Badge>
            </div>
          )}

          {showAddButton && isAddingStatus ? (
            <Form method="post" className="mt-3 flex flex-col gap-2">
              <input type="hidden" name="intent" value="create_status" />
              <input type="hidden" name="view" value={currentView} />
              <Input
                name="statusTitle"
                value={newStatusTitle}
                onChange={(event) => onCreateTitleChange(event.currentTarget.value)}
                className="h-10 bg-white"
                placeholder="새 상태 이름"
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" className="h-10 rounded-full px-4">
                  추가
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-10 rounded-full px-4" onClick={onCancelCreate}>
                  취소
                </Button>
              </div>
            </Form>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Form method="post">
            <input type="hidden" name="intent" value="delete_status" />
            <input type="hidden" name="view" value={currentView} />
            <input type="hidden" name="status" value={column.status} />
            <Button type="submit" variant="ghost" size="icon" className="h-9 w-9 rounded-full text-slate-400 hover:bg-white hover:text-rose-500" aria-label="상태 삭제" title="상태 삭제">
              <Trash2 className="h-4 w-4" />
            </Button>
          </Form>
          {showAddButton ? (
            <Button type="button" variant="outline" size="icon" className="h-9 w-9 rounded-full" aria-label="새 상태 추가" title="새 상태 추가" onClick={onToggleCreate}>
              <Plus className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PrimaryViewButton({ to, active }: { to: string; active: boolean }) {
  return (
    <Button
      asChild
      variant="outline"
      className={`h-auto w-full justify-start rounded-[28px] border px-5 py-4 text-left shadow-none transition ${
        active
          ? "border-[#845733] bg-[#845733] text-white hover:bg-[#744a28]"
          : "border-[#d9c0a1] bg-[linear-gradient(135deg,#fff8ee_0%,#f4e2c7_100%)] text-slate-900 hover:bg-[linear-gradient(135deg,#fff5e4_0%,#efdbb9_100%)]"
      }`}
    >
      <Link to={to} className="flex w-full items-start gap-4">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            active ? "bg-white/15 text-white" : "bg-white text-[#8a5f36]"
          }`}
        >
          <Move className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">자유 배치</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                active ? "bg-white/15 text-white/90" : "bg-[#f1dcc0] text-[#8a5f36]"
              }`}
            >
              {active ? "현재 보기" : "메인 보기"}
            </span>
          </span>
          <span className={`mt-1 block text-sm ${active ? "text-white/80" : "text-slate-600"}`}>
            카드를 넓게 펼쳐두고 우선순위와 맥락을 직접 잡는 핵심 보드예요.
          </span>
        </span>
      </Link>
    </Button>
  );
}

function DashboardSearchForm({
  dateToken,
  currentView,
  workSetId,
  searchQuery,
}: {
  dateToken: string;
  currentView: DashboardView;
  workSetId: number;
  searchQuery: string | null;
}) {
  return (
    <Form
      method="get"
      className="flex flex-wrap items-center gap-2 rounded-[24px] border border-white/70 bg-white/88 px-3 py-2.5 shadow-[0_18px_40px_rgba(72,54,28,0.08)] backdrop-blur"
    >
      {currentView !== "day" ? <input type="hidden" name="view" value={currentView} /> : null}
      <input type="hidden" name="set" value={workSetId} />
      <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-[#e3d3bc] bg-white/90 px-3">
        <Search className="h-4 w-4 shrink-0 text-[#8a5f36]" />
        <Input
          name="q"
          defaultValue={searchQuery ?? ""}
          placeholder="제목, 메모, #링크 검색"
          className="h-9 border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
      </div>
      <Button type="submit" size="sm" className="rounded-full">
        검색
      </Button>
      {searchQuery ? (
        <Button asChild type="button" variant="outline" size="sm" className="rounded-full border-[#e3d3bc] bg-white/90">
          <Link to={buildDashboardLink(dateToken, currentView, workSetId)}>
            지우기
          </Link>
        </Button>
      ) : null}
    </Form>
  );
}

function DashboardWorkItemList({
  items,
  dateToken,
  workSetId,
  getStatusLabel,
  emptyText,
}: {
  items: Array<{
    id: number;
    title: string;
    status: DevlogStatusValue;
    isPinned: boolean;
    nextAction: string | null;
    plannedDate: string | null;
    lastDiaryPage: { pageDate: string; title: string } | null;
    checklist: Array<{
      content: string;
      isDone: boolean;
      isTodayTodo: boolean;
    }>;
  }>;
  dateToken: string;
  workSetId: number;
  getStatusLabel: (status: string) => string;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <DayViewWorkItemCard
          key={item.id}
          dateToken={dateToken}
          workSetId={workSetId}
          item={item}
          statusLabel={getStatusLabel(item.status)}
        />
      ))}
    </div>
  );
}

function WorkSetSwitcher({
  dateToken,
  currentView,
  searchQuery,
  workSets,
  selectedWorkSet,
}: {
  dateToken: string;
  currentView: DashboardView;
  searchQuery: string | null;
  workSets: Array<{
    id: number;
    name: string;
    icon: string;
    color: string;
    isDefault: boolean;
  }>;
  selectedWorkSet: {
    id: number;
    name: string;
    icon: string;
    color: string;
    githubIssueRepoOwner: string | null;
    githubIssueRepoName: string | null;
    githubIssueLabels: string | null;
    hasGitHubIssueToken: boolean;
    isDefault: boolean;
  };
}) {
  const [isCreatingWorkSet, setIsCreatingWorkSet] = useState(false);
  const [isEditingWorkSet, setIsEditingWorkSet] = useState(false);
  const [editingWorkSetName, setEditingWorkSetName] = useState(selectedWorkSet.name);
  const [editingWorkSetColor, setEditingWorkSetColor] = useState(selectedWorkSet.color);
  const [editingWorkSetIcon, setEditingWorkSetIcon] = useState(selectedWorkSet.icon);
  const [editingGitHubRepoOwner, setEditingGitHubRepoOwner] = useState(selectedWorkSet.githubIssueRepoOwner ?? "");
  const [editingGitHubRepoName, setEditingGitHubRepoName] = useState(selectedWorkSet.githubIssueRepoName ?? "");
  const [editingGitHubIssueLabels, setEditingGitHubIssueLabels] = useState(selectedWorkSet.githubIssueLabels ?? "");
  const [shouldClearGitHubIssueToken, setShouldClearGitHubIssueToken] = useState(false);
  const [creatingWorkSetColor, setCreatingWorkSetColor] = useState(WORK_SET_COLOR_OPTIONS[0]);
  const [creatingWorkSetIcon, setCreatingWorkSetIcon] = useState(WORK_SET_ICON_OPTIONS[0]?.value ?? "briefcase");
  const selectedIndex = workSets.findIndex((workSet) => workSet.id === selectedWorkSet.id);
  const SelectedSetIcon = getWorkSetIcon(selectedWorkSet.icon);
  const selectedSetColor = getWorkSetColor(selectedWorkSet.color);

  useEffect(() => {
    setIsCreatingWorkSet(false);
    setIsEditingWorkSet(false);
    setEditingWorkSetName(selectedWorkSet.name);
    setEditingWorkSetColor(getWorkSetColor(selectedWorkSet.color));
    setEditingWorkSetIcon(selectedWorkSet.icon);
    setEditingGitHubRepoOwner(selectedWorkSet.githubIssueRepoOwner ?? "");
    setEditingGitHubRepoName(selectedWorkSet.githubIssueRepoName ?? "");
    setEditingGitHubIssueLabels(selectedWorkSet.githubIssueLabels ?? "");
    setShouldClearGitHubIssueToken(false);
  }, [
    selectedWorkSet.color,
    selectedWorkSet.githubIssueLabels,
    selectedWorkSet.githubIssueRepoName,
    selectedWorkSet.githubIssueRepoOwner,
    selectedWorkSet.icon,
    selectedWorkSet.id,
    selectedWorkSet.name,
  ]);

  return (
    <div className="space-y-3 px-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#94724b]">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: selectedSetColor }} />
          <SelectedSetIcon className="h-3.5 w-3.5" />
          일세트
        </span>
        {workSets.map((workSet) => (
          (() => {
            const WorkSetIcon = getWorkSetIcon(workSet.icon);
            const workSetColor = getWorkSetColor(workSet.color);

            return (
              <Button
                key={workSet.id}
                asChild
                variant={workSet.id === selectedWorkSet.id ? "default" : "outline"}
                size="sm"
                className={`rounded-full ${
                  workSet.id === selectedWorkSet.id ? "" : "border-[#e3d3bc] bg-white/90 text-slate-700 hover:bg-[#faf5ee]"
                }`}
              >
                <Link to={buildDashboardLink(dateToken, currentView, workSet.id, searchQuery)} className="inline-flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: workSetColor }} />
                    <WorkSetIcon className="h-3.5 w-3.5" />
                  </span>
                  <span>{workSet.name}</span>
                  {workSet.isDefault ? <span className="text-[10px] opacity-80">기본</span> : null}
                </Link>
              </Button>
            );
          })()
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Form method="post">
            <input type="hidden" name="intent" value="move_work_set" />
            <input type="hidden" name="view" value={currentView} />
            <input type="hidden" name="workSetId" value={selectedWorkSet.id} />
            {searchQuery ? <input type="hidden" name="searchQuery" value={searchQuery} /> : null}
            <input type="hidden" name="direction" value="left" />
            <Button
              type="submit"
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-full border-[#e3d3bc] bg-white/90"
              disabled={selectedIndex <= 0}
              aria-label="일세트 왼쪽으로 이동"
              title="일세트 왼쪽으로 이동"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="move_work_set" />
            <input type="hidden" name="view" value={currentView} />
            <input type="hidden" name="workSetId" value={selectedWorkSet.id} />
            {searchQuery ? <input type="hidden" name="searchQuery" value={searchQuery} /> : null}
            <input type="hidden" name="direction" value="right" />
            <Button
              type="submit"
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-full border-[#e3d3bc] bg-white/90"
              disabled={selectedIndex < 0 || selectedIndex >= workSets.length - 1}
              aria-label="일세트 오른쪽으로 이동"
              title="일세트 오른쪽으로 이동"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Form>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full border-[#e3d3bc] bg-white/90"
            onClick={() => {
              setIsEditingWorkSet((current) => !current);
              setIsCreatingWorkSet(false);
              setEditingWorkSetName(selectedWorkSet.name);
              setEditingWorkSetColor(getWorkSetColor(selectedWorkSet.color));
              setEditingWorkSetIcon(selectedWorkSet.icon);
              setEditingGitHubRepoOwner(selectedWorkSet.githubIssueRepoOwner ?? "");
              setEditingGitHubRepoName(selectedWorkSet.githubIssueRepoName ?? "");
              setEditingGitHubIssueLabels(selectedWorkSet.githubIssueLabels ?? "");
              setShouldClearGitHubIssueToken(false);
            }}
          >
            세트 설정
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full border-[#e3d3bc] bg-white/90"
            onClick={() => {
              setIsCreatingWorkSet((current) => !current);
              setIsEditingWorkSet(false);
            }}
          >
            <Plus className="h-4 w-4" />
            세트 추가
          </Button>
          <Form method="post">
            <input type="hidden" name="intent" value="set_default_work_set" />
            <input type="hidden" name="view" value={currentView} />
            <input type="hidden" name="workSetId" value={selectedWorkSet.id} />
            {searchQuery ? <input type="hidden" name="searchQuery" value={searchQuery} /> : null}
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="rounded-full border-[#e3d3bc] bg-white/90"
              disabled={selectedWorkSet.isDefault}
            >
              시작 세트
            </Button>
          </Form>
          <Form
            method="post"
            onSubmit={(event) => {
              if (!window.confirm(`'${selectedWorkSet.name}' 세트를 지우고 작업을 다른 세트로 옮길까요?`)) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="delete_work_set" />
            <input type="hidden" name="view" value={currentView} />
            <input type="hidden" name="workSetId" value={selectedWorkSet.id} />
            {searchQuery ? <input type="hidden" name="searchQuery" value={searchQuery} /> : null}
            <Button
              type="submit"
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-full border-[#efd0c8] bg-white/90 text-rose-500 hover:bg-[#fff3ef] hover:text-rose-600"
              disabled={workSets.length < 2}
              aria-label="일세트 삭제"
              title="일세트 삭제"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </Form>
        </div>
      </div>

      {isEditingWorkSet ? (
        <Form method="post" className="mt-2 space-y-3 rounded-[22px] border border-white/60 bg-white/78 px-3 py-3 backdrop-blur">
          <input type="hidden" name="intent" value="rename_work_set" />
          <input type="hidden" name="view" value={currentView} />
          <input type="hidden" name="workSetId" value={selectedWorkSet.id} />
          {searchQuery ? <input type="hidden" name="searchQuery" value={searchQuery} /> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              name="workSetName"
              value={editingWorkSetName}
              onChange={(event) => setEditingWorkSetName(event.currentTarget.value)}
              placeholder="일세트 이름"
              className="h-9 max-w-[220px] bg-white"
            />
            <input type="hidden" name="workSetIcon" value={editingWorkSetIcon} />
            <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-[#e3d3bc] bg-white/90 px-2 py-1">
              {WORK_SET_ICON_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = option.value === editingWorkSetIcon;

                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={isSelected ? "default" : "ghost"}
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => setEditingWorkSetIcon(option.value)}
                    aria-label={option.label}
                    title={option.label}
                  >
                    <Icon className="h-4 w-4" />
                  </Button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[#e3d3bc] bg-white/90 px-3 py-1.5">
              <Palette className="h-4 w-4 text-[#8a5f36]" />
              <input
                type="color"
                name="workSetColor"
                value={editingWorkSetColor}
                onChange={(event) => setEditingWorkSetColor(event.currentTarget.value)}
                className="h-8 w-10 cursor-pointer rounded border-none bg-transparent p-0"
              />
            </div>
          </div>

          <div className="rounded-[18px] border border-[#eadfce] bg-[#fbf7f1] p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
              <Github className="h-4 w-4 text-[#8a5f36]" />
              GitHub 이슈 설정
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <Input
                name="githubIssueRepoOwner"
                value={editingGitHubRepoOwner}
                onChange={(event) => setEditingGitHubRepoOwner(event.currentTarget.value)}
                placeholder="repo owner"
                className="h-9 bg-white"
              />
              <Input
                name="githubIssueRepoName"
                value={editingGitHubRepoName}
                onChange={(event) => setEditingGitHubRepoName(event.currentTarget.value)}
                placeholder="repo name"
                className="h-9 bg-white"
              />
              <Input
                name="githubIssueLabels"
                value={editingGitHubIssueLabels}
                onChange={(event) => setEditingGitHubIssueLabels(event.currentTarget.value)}
                placeholder="label1, label2"
                className="h-9 bg-white md:col-span-2"
              />
              <Input
                name="githubIssueToken"
                type="password"
                placeholder={selectedWorkSet.hasGitHubIssueToken ? "토큰 변경할 때만 다시 입력" : "GitHub token"}
                className="h-9 bg-white md:col-span-2"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {selectedWorkSet.hasGitHubIssueToken && !shouldClearGitHubIssueToken ? (
                <span className="rounded-full border border-[#e3d3bc] bg-white/90 px-2.5 py-1">토큰 저장됨</span>
              ) : null}
              {shouldClearGitHubIssueToken ? <input type="hidden" name="clearGitHubIssueToken" value="1" /> : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full border-[#e3d3bc] bg-white/90"
                onClick={() => setShouldClearGitHubIssueToken((current) => !current)}
              >
                {shouldClearGitHubIssueToken ? "토큰 삭제 취소" : "저장 토큰 삭제"}
              </Button>
              <span>세트마다 다른 저장소로 이슈를 만들 수 있어요.</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" className="rounded-full">
              저장
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full border-[#e3d3bc] bg-white/90"
              onClick={() => {
                setIsEditingWorkSet(false);
                setEditingWorkSetName(selectedWorkSet.name);
                setEditingWorkSetColor(getWorkSetColor(selectedWorkSet.color));
                setEditingWorkSetIcon(selectedWorkSet.icon);
                setEditingGitHubRepoOwner(selectedWorkSet.githubIssueRepoOwner ?? "");
                setEditingGitHubRepoName(selectedWorkSet.githubIssueRepoName ?? "");
                setEditingGitHubIssueLabels(selectedWorkSet.githubIssueLabels ?? "");
                setShouldClearGitHubIssueToken(false);
              }}
            >
              취소
            </Button>
          </div>
        </Form>
      ) : null}

      {isCreatingWorkSet ? (
        <Form method="post" className="mt-2 flex flex-wrap items-center gap-2 rounded-[22px] border border-white/60 bg-white/78 px-3 py-3 backdrop-blur">
          <input type="hidden" name="intent" value="create_work_set" />
          <input type="hidden" name="view" value={currentView} />
          {searchQuery ? <input type="hidden" name="searchQuery" value={searchQuery} /> : null}
          <Input name="workSetName" placeholder="예: 회사, 집일" className="h-9 max-w-[220px] bg-white" />
          <input type="hidden" name="workSetIcon" value={creatingWorkSetIcon} />
          <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-[#e3d3bc] bg-white/90 px-2 py-1">
            {WORK_SET_ICON_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isSelected = option.value === creatingWorkSetIcon;

              return (
                <Button
                  key={option.value}
                  type="button"
                  variant={isSelected ? "default" : "ghost"}
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setCreatingWorkSetIcon(option.value)}
                  aria-label={option.label}
                  title={option.label}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#e3d3bc] bg-white/90 px-3 py-1.5">
            <Palette className="h-4 w-4 text-[#8a5f36]" />
            <input
              type="color"
              name="workSetColor"
              value={creatingWorkSetColor}
              onChange={(event) => setCreatingWorkSetColor(event.currentTarget.value)}
              className="h-8 w-10 cursor-pointer rounded border-none bg-transparent p-0"
            />
          </div>
          <Button type="submit" size="sm" className="rounded-full">
            추가
          </Button>
        </Form>
      ) : null}
    </div>
  );
}

function TodayTodoBadge({
  count,
  title,
  compact = false,
}: {
  count: number;
  title: string;
  compact?: boolean;
}) {
  if (count < 1) {
    return null;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-[#efcfaa] bg-[#fff1de] font-semibold text-[#b8742f] ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
      title={title}
    >
      <CircleDot className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      <span>{compact ? `${count}개` : `오늘 할 일 ${count}개`}</span>
    </span>
  );
}

function PinnedBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border border-[#ead8b7] bg-[#fff7e8] text-[#9a6a2f] ${
        compact ? "h-6 w-6" : "h-7 w-7"
      }`}
      title="상단 고정"
      aria-label="상단 고정"
    >
      <Pin className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"}`} />
    </span>
  );
}

function DayViewWorkItemCard({
  dateToken,
  workSetId,
  item,
  statusLabel,
}: {
  dateToken: string;
  workSetId: number;
  statusLabel: string;
  item: {
    id: number;
    title: string;
    status: DevlogStatusValue;
    isPinned: boolean;
    nextAction: string | null;
    plannedDate: string | null;
    lastDiaryPage: { pageDate: string; title: string } | null;
    checklist: Array<{
      content: string;
      isDone: boolean;
      isTodayTodo: boolean;
    }>;
  };
}) {
  const checklistSummary = summarizeChecklist(item.checklist);
  const todayTodoItems = item.checklist.filter((checklistItem) => checklistItem.isTodayTodo && !checklistItem.isDone);
  const primaryTodayTodo = todayTodoItems[0] ?? null;
  const metaDate = item.plannedDate ?? item.lastDiaryPage?.pageDate ?? null;

  return (
    <article
      onClick={() => openWorkWindow(buildWorkWindowLink(dateToken, item.id, workSetId))}
      className="cursor-pointer rounded-2xl border border-[#e6d9c7] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="line-clamp-2 text-sm font-semibold tracking-[-0.01em] text-slate-900">{item.title}</p>
            {item.isPinned ? <PinnedBadge compact /> : null}
            <Badge variant="outline">{statusLabel}</Badge>
          </div>

          <WorkItemReferenceText
            dateToken={dateToken}
            workSetId={workSetId}
            text={item.nextAction}
            className="mt-2 text-sm text-slate-600"
          />

          {(primaryTodayTodo || checklistSummary.totalCount > 0 || metaDate) ? (
            <div className={`${item.nextAction ? "mt-3" : "mt-2"} flex flex-wrap items-center gap-3 text-xs text-slate-500`}>
              {primaryTodayTodo ? (
                <TodayTodoBadge
                  count={todayTodoItems.length}
                  title={
                    todayTodoItems.length > 1
                      ? `오늘 할 일 ${todayTodoItems.length}개`
                      : `오늘 할 일: ${primaryTodayTodo.content}`
                  }
                />
              ) : null}

              {checklistSummary.totalCount > 0 ? (
                <span
                  className="inline-flex items-center gap-1.5"
                  title={`체크리스트 ${checklistSummary.doneCount}/${checklistSummary.totalCount}`}
                >
                  {checklistSummary.remainingCount === 0 ? (
                    <CheckCheck className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <ListTodo className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  <span className="font-medium text-slate-500">
                    {checklistSummary.remainingCount === 0
                      ? `${checklistSummary.doneCount}/${checklistSummary.totalCount}`
                      : `${checklistSummary.remainingCount}/${checklistSummary.totalCount}`}
                  </span>
                </span>
              ) : null}

              {metaDate ? (
                <span className="inline-flex items-center gap-1.5 text-slate-400">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>{formatShortDate(metaDate)}</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <SquareArrowOutUpRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
      </div>
    </article>
  );
}

function TodayTodoGroupCard({
  dateToken,
  workSetId,
  group,
  statusLabel,
}: {
  dateToken: string;
  workSetId: number;
  statusLabel: string;
  group: {
    workItem: {
      id: number;
      title: string;
      status: DevlogStatusValue;
      isPinned: boolean;
      nextAction: string | null;
      plannedDate: string | null;
      lastDiaryPage: { pageDate: string; title: string } | null;
    };
    items: Array<{
      checklistItemId: number;
      content: string;
    }>;
  };
}) {
  const metaDate = group.workItem.plannedDate ?? group.workItem.lastDiaryPage?.pageDate ?? null;

  return (
    <article
      onClick={() => openWorkWindow(buildWorkWindowLink(dateToken, group.workItem.id, workSetId))}
      className="cursor-pointer rounded-2xl border border-[#e6d9c7] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="line-clamp-2 text-sm font-semibold tracking-[-0.01em] text-slate-900">{group.workItem.title}</p>
            {group.workItem.isPinned ? <PinnedBadge compact /> : null}
            <Badge variant="outline">{statusLabel}</Badge>
          </div>

          <WorkItemReferenceText
            dateToken={dateToken}
            workSetId={workSetId}
            text={group.workItem.nextAction}
            className="mt-2 text-sm text-slate-600"
          />

          <div className={`${group.workItem.nextAction ? "mt-3" : "mt-2"} flex flex-wrap items-center gap-3 text-xs text-slate-500`}>
            <TodayTodoBadge count={group.items.length} title={`오늘 할 일 ${group.items.length}개`} />

            {metaDate ? (
              <span className="inline-flex items-center gap-1.5 text-slate-400">
                <CalendarDays className="h-3.5 w-3.5" />
                <span>{formatShortDate(metaDate)}</span>
              </span>
            ) : null}
          </div>
        </div>

        <SquareArrowOutUpRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
      </div>

      <div className="mt-3 space-y-2 border-t border-[#f1e7da] pt-3">
        {group.items.map((todoItem) => (
          <div key={todoItem.checklistItemId} className="flex items-start gap-2 rounded-xl bg-[#faf6ef] px-3 py-2.5">
            <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b8742f]" />
            <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-slate-700">{todoItem.content}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function WorkItemReferenceText({
  dateToken,
  workSetId,
  text,
  className,
  emptyText,
}: {
  dateToken: string;
  workSetId: number;
  text: string | null | undefined;
  className: string;
  emptyText?: string;
}) {
  return (
    <DevlogRichText
      text={text}
      className={className}
      emptyText={emptyText}
      onReferenceClick={(workItemId, event) => {
        event.preventDefault();
        event.stopPropagation();
        openWorkWindow(buildWorkWindowLink(dateToken, workItemId, workSetId));
      }}
    />
  );
}

function openWorkWindow(to: string) {
  if (typeof window === "undefined") return;

  const opened = window.open(
    to,
    `devlog-work-${to.replace(/[^a-zA-Z0-9]/g, "-")}`,
    "popup=yes,width=1180,height=900,resizable=yes,scrollbars=yes",
  );

  if (!opened) {
    window.location.href = to;
  }
}

function WorkWindowButton({ to, size = "default" }: { to: string; size?: "default" | "sm" }) {
  return (
    <Button
      type="button"
      variant="default"
      size={size}
      onClick={() => openWorkWindow(to)}
    >
      <SquareArrowOutUpRight className="h-4 w-4" />
      작업창
    </Button>
  );
}

