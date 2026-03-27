import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCheck,
  CircleDot,
  GripVertical,
  History,
  LayoutGrid,
  ListTodo,
  Minimize2,
  Move,
  NotebookPen,
  Plus,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Form, Link, redirect, useFetcher, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { getDevlogStatusLabel, getDevlogWorkItemReferenceParts, type DevlogStatusValue } from "~/lib/devlog";
import {
  attachDevWorkItemToDiaryPage,
  createDevWorkStatusDefinition,
  createDevWorkItem,
  deleteDevWorkStatusDefinition,
  loadDevDashboardSnapshot,
  moveDevWorkItemOnCanvas,
  moveDevWorkItemOnStatusBoard,
  saveDevDiaryPage,
  saveDevWorkStatusDefinition,
  setDevWorkItemMinimized,
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

function buildDashboardLink(dateToken: string, view: DashboardView) {
  const query = view === "day" ? "" : `?view=${view}`;
  return `/devlog/${dateToken}${query}`;
}

function buildWorkWindowLink(dateToken: string, workItemId: number) {
  return `/devlog/${dateToken}/work/${workItemId}`;
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
    case "restore_work_item":
      return "작업 카드를 다시 꺼냈어요.";
    case "minimize_work_item":
      return "작업 카드를 대시보드로 최소화했어요.";
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
    case "restore_work_item":
      return "작업 카드를 꺼내지 못했어요.";
    case "minimize_work_item":
      return "작업 카드를 최소화하지 못했어요.";
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
) {
  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  flashSession.flash("toast", { type, message });

  return redirect(buildDashboardLink(dateToken, view), {
    headers: {
      "Set-Cookie": await commitSession(flashSession),
    },
  });
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "ADMIN");
  const selectedDate = parseRequiredDateToken(params.date);
  const snapshot = await loadDevDashboardSnapshot(db, user.id, selectedDate);
  const currentView = parseDashboardView(new URL(request.url).searchParams.get("view"));

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
  const currentView = parseDashboardView(typeof formData.get("view") === "string" ? String(formData.get("view")) : null);

  try {
    if (intent === "save_page") await saveDevDiaryPage(db, user.id, selectedDate, formData);
    else if (intent === "save_status_title") await saveDevWorkStatusDefinition(db, user.id, selectedDate, formData);
    else if (intent === "create_status") await createDevWorkStatusDefinition(db, user.id, selectedDate, formData);
    else if (intent === "delete_status") await deleteDevWorkStatusDefinition(db, user.id, selectedDate, formData);
    else if (intent === "create_work_item") await createDevWorkItem(db, user.id, selectedDate, formData);
    else if (intent === "restore_work_item") await setDevWorkItemMinimized(db, user.id, selectedDate, formData, false);
    else if (intent === "minimize_work_item") await setDevWorkItemMinimized(db, user.id, selectedDate, formData, true);
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

    return redirectWithToast(request, "success", getSuccessMessage(intent), dateToken, currentView);
  } catch {
    return redirectWithToast(request, "error", getErrorMessage(intent), dateToken, currentView);
  }
};

export default function DevlogDashboardPage() {
  const {
    dateToken,
    displayDateLabel,
    prevDateToken,
    nextDateToken,
    currentView,
    page,
    dateItems,
    openWorkItems,
    minimizedBoardItems,
    recentMinimizedItems,
    recentPages,
    nextWorkItem,
    todayTodoCount,
    statuses,
    statusCounts,
  } = useLoaderData<typeof loader>();

  const statusMoveFetcher = useFetcher();
  const canvasMoveFetcher = useFetcher();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [draggedStatusItemId, setDraggedStatusItemId] = useState<number | null>(null);
  const [activeStatusMenu, setActiveStatusMenu] = useState<DevlogStatusValue | null>(null);
  const [editingStatusTitle, setEditingStatusTitle] = useState<null | { status: DevlogStatusValue; value: string }>(null);
  const [isAddingStatus, setIsAddingStatus] = useState(false);
  const [newStatusTitle, setNewStatusTitle] = useState("");
  const [draftPositions, setDraftPositions] = useState<Record<number, { x: number; y: number }>>({});
  const draftPositionsRef = useRef<Record<number, { x: number; y: number }>>({});
  const [canvasDrag, setCanvasDrag] = useState<null | { workItemId: number; offsetX: number; offsetY: number }>(null);
  const [freePanel, setFreePanel] = useState<"page" | "new" | "open" | "recent" | null>("open");
  const freeCanvasInset = currentView === "free" ? { x: 24, y: 148 } : { x: 0, y: 0 };
  const statusLabelMap = useMemo(
    () => Object.fromEntries(statuses.map((status) => [status.key, status.label])),
    [statuses],
  );

  useEffect(() => {
    const nextPositions = Object.fromEntries(minimizedBoardItems.map((item) => [item.id, { x: item.boardX, y: item.boardY }]));
    setDraftPositions(nextPositions);
    draftPositionsRef.current = nextPositions;
  }, [minimizedBoardItems]);

  useEffect(() => {
    draftPositionsRef.current = draftPositions;
  }, [draftPositions]);

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
  }, [canvasDrag, canvasMoveFetcher, currentView, freeCanvasInset.x, freeCanvasInset.y]);

  const statusBoardColumns = useMemo(
    () =>
      statuses.map((status) => ({
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

  function toggleStatusMenu(status: DevlogStatusValue) {
    setIsAddingStatus(false);
    setNewStatusTitle("");
    if (activeStatusMenu === status) {
      setEditingStatusTitle((editing) => (editing?.status === status ? null : editing));
      setActiveStatusMenu(null);
      return;
    }

    setEditingStatusTitle((editing) => (editing?.status === status ? editing : null));
    setActiveStatusMenu(status);
  }

  function startStatusTitleEdit(status: DevlogStatusValue, label: string) {
    setIsAddingStatus(false);
    setNewStatusTitle("");
    setActiveStatusMenu(status);
    setEditingStatusTitle({ status, value: label });
  }

  function cancelStatusTitleEdit(status: DevlogStatusValue) {
    setEditingStatusTitle((current) => (current?.status === status ? null : current));
    setActiveStatusMenu((current) => (current === status ? null : current));
  }

  function toggleStatusCreate() {
    setActiveStatusMenu(null);
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
        <div className="mx-auto max-w-[1600px]">
          <section className="rounded-[34px] border border-[#dbc8ad] bg-white/86 p-4 shadow-[0_28px_70px_rgba(72,54,28,0.12)]">
            <div
              ref={canvasRef}
              className="relative overflow-hidden rounded-[30px] border border-[#eadfce] bg-[radial-gradient(circle_at_top_left,#fff6e9_0%,#fcf9f4_48%,#f7f1e7_100%)]"
              style={{ minHeight: freeCanvasHeight }}
            >
              <div className="absolute inset-x-4 top-4 z-20 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-white/70 bg-white/88 px-3 py-2.5 shadow-[0_18px_40px_rgba(72,54,28,0.08)] backdrop-blur">
                  <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                    <Link to={buildDashboardLink(dateToken, "day")} aria-label="날짜 보기" title="날짜 보기">
                      <CalendarDays className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                    <Link to={buildDashboardLink(dateToken, "status")} aria-label="상태 보기" title="상태 보기">
                      <LayoutGrid className="h-4 w-4" />
                    </Link>
                  </Button>
                  <div className="mx-1 hidden h-7 w-px bg-[#eadfce] sm:block" />
                  <Button type="button" variant={freePanel === "page" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="날짜 메모" title="날짜 메모" onClick={() => setFreePanel((current) => (current === "page" ? null : "page"))}>
                    <NotebookPen className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant={freePanel === "new" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="새 작업 카드" title="새 작업 카드" onClick={() => setFreePanel((current) => (current === "new" ? null : "new"))}>
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant={freePanel === "open" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="열린 작업" title="열린 작업" onClick={() => setFreePanel((current) => (current === "open" ? null : "open"))}>
                    <ListTodo className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant={freePanel === "recent" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="최근 기록" title="최근 기록" onClick={() => setFreePanel((current) => (current === "recent" ? null : "recent"))}>
                    <History className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 rounded-[24px] border border-white/70 bg-white/88 px-3 py-3 shadow-[0_18px_40px_rgba(72,54,28,0.08)] backdrop-blur">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#94724b]">
                    <span className="h-2 w-2 rounded-full bg-[#b7844d]" />
                    Free Board
                  </div>

                  <div className="min-w-[220px] flex-1">
                    <p className="text-lg font-semibold text-slate-900">{page?.title || "자유 배치 중심 보드"}</p>
                    {page?.title ? <p className="mt-1 text-sm text-slate-500">자유 배치 중심 보드</p> : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">오늘 할 일 {todayTodoCount}개</Badge>
                    <Badge variant="outline">열린 작업 {openWorkItems.length}개</Badge>
                    {nextWorkItem ? (
                      <Badge>{getStatusLabel(nextWorkItem.status)} · 다음 작업 {nextWorkItem.title}</Badge>
                    ) : (
                      <Badge variant="secondary">다음 작업은 아직 비어 있어요.</Badge>
                    )}
                  </div>
                </div>
              </div>

              {freePanel ? (
                <div className="absolute left-4 right-4 top-[152px] z-20 sm:top-[116px] xl:left-auto xl:right-4 xl:top-[104px] xl:w-[360px]">
                  <div className="rounded-[28px] border border-white/70 bg-white/92 p-4 shadow-[0_22px_44px_rgba(72,54,28,0.12)] backdrop-blur">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {freePanel === "page" && "날짜 메모"}
                          {freePanel === "new" && "새 작업 카드"}
                          {freePanel === "open" && "열린 작업"}
                          {freePanel === "recent" && "최근 기록"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {freePanel === "page" && "현재 날짜의 메모를 자유 배치 보드 안에서 바로 수정해요."}
                          {freePanel === "new" && "캔버스에 올릴 새 작업 카드를 빠르게 만들어요."}
                          {freePanel === "open" && "열려 있는 작업을 바로 열거나 최소화해요."}
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
                        <Input name="title" placeholder="새 작업 제목" />
                        <Input name="nextAction" placeholder="다음 할일 한 줄" />
                        <Button type="submit" className="w-full">
                          <Plus className="h-4 w-4" />
                          작업 카드 만들기
                        </Button>
                      </Form>
                    ) : null}

                    {freePanel === "open" ? (
                      <div className="space-y-3">
                        {openWorkItems.length === 0 ? (
                          <p className="rounded-2xl border border-dashed px-4 py-8 text-sm text-slate-500">열린 작업이 아직 없어요.</p>
                        ) : (
                          openWorkItems.map((item) => {
                            const checklistSummary = summarizeChecklist(item.checklist);
                            return (
                              <div key={item.id} className="rounded-2xl border border-[#e7dac9] bg-[#fffaf3] p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="truncate font-medium text-slate-900">{item.title}</p>
                                      <Badge variant="outline">{getStatusLabel(item.status)}</Badge>
                                    </div>
                                    <WorkItemReferenceText
                                      dateToken={dateToken}
                                      text={item.nextAction}
                                      emptyText="다음 할일이 아직 없어요."
                                      className="mt-2 text-sm text-slate-600"
                                    />
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                                      <span>남은 체크 {checklistSummary.remainingCount}개</span>
                                      <span>오늘 할 일 {checklistSummary.todayCount}개</span>
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 flex-wrap gap-2">
                                    <WorkWindowButton to={buildWorkWindowLink(dateToken, item.id)} size="sm" />
                                    <Form method="post">
                                      <input type="hidden" name="intent" value="minimize_work_item" />
                                      <input type="hidden" name="workItemId" value={item.id} />
                                      <input type="hidden" name="view" value={currentView} />
                                      <Button type="submit" variant="outline" size="sm">
                                        <Minimize2 className="h-4 w-4" />
                                        최소화
                                      </Button>
                                    </Form>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : null}

                    {freePanel === "recent" ? (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#94724b]">Recent Pages</p>
                          {recentPages.map((item) => (
                            <Link
                              key={item.id}
                              to={buildDashboardLink(item.pageDate.slice(0, 10), currentView)}
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

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#94724b]">Reusable Cards</p>
                          {recentMinimizedItems.length === 0 ? (
                            <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">다시 붙일 카드가 아직 없어요.</p>
                          ) : (
                            recentMinimizedItems.map((item) => (
                              <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[#e6d9c7] bg-[#fffaf3] p-3">
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-slate-900">{item.title}</p>
                                  <WorkItemReferenceText
                                    dateToken={dateToken}
                                    text={item.nextAction}
                                    emptyText="다음 할일이 아직 없어요."
                                    className="mt-1 text-sm text-slate-500"
                                  />
                                </div>
                                <Form method="post">
                                  <input type="hidden" name="intent" value="attach_work_item_to_page" />
                                  <input type="hidden" name="workItemId" value={item.id} />
                                  <input type="hidden" name="view" value={currentView} />
                                  <Button type="submit" variant="outline" size="sm">현재 날짜에 붙이기</Button>
                                </Form>
                              </div>
                            ))
                          )}
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
                  const position = draftPositions[item.id] ?? { x: item.boardX, y: item.boardY };
                  return (
                    <div
                      key={item.id}
                      className="absolute w-[230px] rounded-[24px] border border-[#e6d9c7] bg-white/95 p-3 shadow-[0_18px_36px_rgba(72,54,28,0.12)]"
                      style={{ left: position.x + freeCanvasInset.x, top: position.y + freeCanvasInset.y }}
                      onMouseDown={(event) => handleCanvasMouseDown(event, item.id)}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-sm font-semibold text-slate-900">{item.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{getStatusLabel(item.status)}</p>
                        </div>
                        <Move className="h-4 w-4 shrink-0 text-slate-300" />
                      </div>
                      <WorkItemReferenceText
                        dateToken={dateToken}
                        text={item.nextAction}
                        emptyText="다음 할일이 아직 없어요."
                        className="line-clamp-2 text-xs text-slate-600"
                      />
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span>남은 체크 {checklistSummary.remainingCount}개</span>
                        <span>오늘 {checklistSummary.todayCount}개</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <WorkWindowButton to={buildWorkWindowLink(dateToken, item.id)} size="sm" />
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
        <div className="mx-auto max-w-[1680px]">
          <section className="rounded-[34px] border border-[#dbc8ad] bg-white/86 p-4 shadow-[0_28px_70px_rgba(72,54,28,0.12)]">
            <div className="relative overflow-hidden rounded-[30px] border border-[#eadfce] bg-[radial-gradient(circle_at_top_left,#fff6e9_0%,#fcf9f4_48%,#f7f1e7_100%)]">
              <div className="absolute inset-x-4 top-4 z-20 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-white/70 bg-white/88 px-3 py-2.5 shadow-[0_18px_40px_rgba(72,54,28,0.08)] backdrop-blur">
                  <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                    <Link to={buildDashboardLink(dateToken, "day")} aria-label="날짜 보기" title="날짜 보기">
                      <CalendarDays className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="default" size="icon" className="h-10 w-10 rounded-full">
                    <Link to={buildDashboardLink(dateToken, "status")} aria-label="상태 보기" title="상태 보기">
                      <LayoutGrid className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                    <Link to={buildDashboardLink(dateToken, "free")} aria-label="자유 배치" title="자유 배치">
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
                  <Button type="button" variant={freePanel === "open" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="열린 작업" title="열린 작업" onClick={() => setFreePanel((current) => (current === "open" ? null : "open"))}>
                    <ListTodo className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant={freePanel === "recent" ? "default" : "outline"} size="icon" className="h-10 w-10 rounded-full" aria-label="최근 기록" title="최근 기록" onClick={() => setFreePanel((current) => (current === "recent" ? null : "recent"))}>
                    <History className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 rounded-[24px] border border-white/70 bg-white/88 px-3 py-3 shadow-[0_18px_40px_rgba(72,54,28,0.08)] backdrop-blur">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#94724b]">
                    <span className="h-2 w-2 rounded-full bg-[#b7844d]" />
                    Status Board
                  </div>

                  <div className="min-w-[220px] flex-1">
                    <p className="text-lg font-semibold text-slate-900">{page?.title || "상태 보드"}</p>
                    {page?.title ? <p className="mt-1 text-sm text-slate-500">상태 보드</p> : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">오늘 할 일 {todayTodoCount}개</Badge>
                    <Badge variant="outline">열린 작업 {openWorkItems.length}개</Badge>
                    {nextWorkItem ? (
                      <Badge>{getStatusLabel(nextWorkItem.status)} · 다음 작업 {nextWorkItem.title}</Badge>
                    ) : (
                      <Badge variant="secondary">다음 작업이 아직 비어 있어요.</Badge>
                    )}
                  </div>
                </div>
              </div>

              {freePanel ? (
                <div className="absolute left-4 right-4 top-[152px] z-20 sm:top-[116px] xl:left-auto xl:right-4 xl:top-[104px] xl:w-[360px]">
                  <div className="rounded-[28px] border border-white/70 bg-white/92 p-4 shadow-[0_22px_44px_rgba(72,54,28,0.12)] backdrop-blur">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {freePanel === "page" && "날짜 메모"}
                          {freePanel === "new" && "새 작업 카드"}
                          {freePanel === "open" && "열린 작업"}
                          {freePanel === "recent" && "최근 기록"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {freePanel === "page" && "지금 보고 있는 날짜 메모를 상태 보드 안에서 바로 수정해요."}
                          {freePanel === "new" && "상태 보드에서 바로 새 작업 카드를 만들어요."}
                          {freePanel === "open" && "열린 작업을 확인하고 작업창을 열거나 최소화할 수 있어요."}
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
                        <Input name="title" placeholder="새 작업 제목" />
                        <Input name="nextAction" placeholder="다음 할일 한 줄" />
                        <Button type="submit" className="w-full">
                          <Plus className="h-4 w-4" />
                          작업 카드 만들기
                        </Button>
                      </Form>
                    ) : null}

                    {freePanel === "open" ? (
                      <div className="space-y-3">
                        {openWorkItems.length === 0 ? (
                          <p className="rounded-2xl border border-dashed px-4 py-8 text-sm text-slate-500">열린 작업이 아직 없어요.</p>
                        ) : (
                          openWorkItems.map((item) => {
                            const checklistSummary = summarizeChecklist(item.checklist);
                            return (
                              <div key={item.id} className="rounded-2xl border border-[#e7dac9] bg-[#fffaf3] p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="truncate font-medium text-slate-900">{item.title}</p>
                                      <Badge variant="outline">{getStatusLabel(item.status)}</Badge>
                                    </div>
                                    <WorkItemReferenceText
                                      dateToken={dateToken}
                                      text={item.nextAction}
                                      emptyText="다음 할일이 아직 없어요."
                                      className="mt-2 text-sm text-slate-600"
                                    />
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                                      <span>남은 체크 {checklistSummary.remainingCount}개</span>
                                      <span>오늘 할 일 {checklistSummary.todayCount}개</span>
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 flex-wrap gap-2">
                                    <WorkWindowButton to={buildWorkWindowLink(dateToken, item.id)} size="sm" />
                                    <Form method="post">
                                      <input type="hidden" name="intent" value="minimize_work_item" />
                                      <input type="hidden" name="workItemId" value={item.id} />
                                      <input type="hidden" name="view" value={currentView} />
                                      <Button type="submit" variant="outline" size="sm">
                                        <Minimize2 className="h-4 w-4" />
                                        최소화
                                      </Button>
                                    </Form>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : null}

                    {freePanel === "recent" ? (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#94724b]">Recent Pages</p>
                          {recentPages.map((item) => (
                            <Link
                              key={item.id}
                              to={buildDashboardLink(item.pageDate.slice(0, 10), currentView)}
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

                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#94724b]">Reusable Cards</p>
                          {recentMinimizedItems.length === 0 ? (
                            <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">다시 붙일 카드가 아직 없어요.</p>
                          ) : (
                            recentMinimizedItems.map((item) => (
                              <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[#e6d9c7] bg-[#fffaf3] p-3">
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-slate-900">{item.title}</p>
                                  <WorkItemReferenceText
                                    dateToken={dateToken}
                                    text={item.nextAction}
                                    emptyText="다음 할일이 아직 없어요."
                                    className="mt-1 text-sm text-slate-500"
                                  />
                                </div>
                                <Form method="post">
                                  <input type="hidden" name="intent" value="attach_work_item_to_page" />
                                  <input type="hidden" name="workItemId" value={item.id} />
                                  <input type="hidden" name="view" value={currentView} />
                                  <Button type="submit" variant="outline" size="sm">현재 날짜에 붙이기</Button>
                                </Form>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className={`relative z-10 flex gap-4 overflow-x-auto px-4 pb-4 pt-[252px] sm:pt-[212px] xl:pt-[168px] ${freePanel ? "xl:pr-[392px]" : ""}`}>
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
                        activeStatusMenu={activeStatusMenu}
                        editingStatusTitle={editingStatusTitle}
                        onToggleMenu={toggleStatusMenu}
                        onStartEdit={startStatusTitleEdit}
                        onEditChange={(value) =>
                          setEditingStatusTitle((current) =>
                            current?.status === column.status ? { ...current, value } : current,
                          )
                        }
                        onCancelEdit={cancelStatusTitleEdit}
                        statusesCount={statusBoardColumns.length}
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
                              onClick={() => openWorkWindow(buildWorkWindowLink(dateToken, item.id))}
                              className="cursor-pointer rounded-2xl border border-[#e6d9c7] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                            >
                              <div className="flex items-start gap-3">
                                <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold tracking-[-0.01em] text-slate-900">{item.title}</p>
                                  <WorkItemReferenceText
                                    dateToken={dateToken}
                                    text={item.nextAction}
                                    className="mt-2 text-sm text-slate-600"
                                  />
                                  {(primaryTodayTodo || checklistSummary.totalCount > 0 || item.plannedDate || item.lastDiaryPage) ? (
                                    <div className={`${item.nextAction ? "mt-3" : "mt-2"} flex flex-wrap items-center gap-3 text-xs text-slate-500`}>
                                      {primaryTodayTodo ? (
                                        <span
                                          className="inline-flex items-center text-[#b8742f]"
                                          title={
                                            todayTodoItems.length > 1
                                              ? `오늘 할일 ${todayTodoItems.length}개`
                                              : `오늘 할일: ${primaryTodayTodo.content}`
                                          }
                                        >
                                          <CircleDot className="h-3.5 w-3.5" />
                                        </span>
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
      <div className="mx-auto max-w-[1480px] space-y-5">
        <section className="rounded-[32px] border border-[#dbc8ad] bg-white/92 p-5 shadow-[0_24px_60px_rgba(72,54,28,0.08)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0 space-y-3 xl:max-w-[560px]">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#eadbc6] bg-[#f8f2e9] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#94724b]">
                <span className="h-2 w-2 rounded-full bg-[#b7844d]" />
                Dev Dashboard
              </div>

              <div>
                <h1 className="text-2xl font-semibold text-slate-900">{displayDateLabel}</h1>
                <p className="mt-1 text-sm text-slate-500">날짜 이동은 가볍게 두고, 작업 정리는 자유 배치를 중심으로 보는 대시보드예요.</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm" className="rounded-full border-[#e3d3bc] bg-white/80">
                  <Link to={buildDashboardLink(prevDateToken, currentView)}>
                    <ArrowLeft className="h-4 w-4" />
                    이전 날짜
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="rounded-full border-[#e3d3bc] bg-white/80">
                  <Link to={buildDashboardLink(nextDateToken, currentView)}>
                    다음 날짜
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 xl:justify-end">
              <ViewButton to={buildDashboardLink(dateToken, "day")} active={currentView === "day"} label="날짜 보기" />
              <ViewButton to={buildDashboardLink(dateToken, "status")} active={false} label="상태 보기" />
              <ViewButton to={buildDashboardLink(dateToken, "free")} active={false} label="자유 배치" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="outline">오늘 할 일 {todayTodoCount}개</Badge>
            <Badge variant="outline">열린 작업창 {openWorkItems.length}개</Badge>
            {nextWorkItem ? (
              <Badge>{getStatusLabel(nextWorkItem.status)} · 다음 작업: {nextWorkItem.title}</Badge>
            ) : (
              <Badge variant="secondary">다음 작업이 아직 없어요.</Badge>
            )}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
          <aside className="space-y-5">
            <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
              <CardHeader>
                <CardTitle>날짜 페이지 메모</CardTitle>
                <CardDescription>선택한 날짜는 일기처럼 남기고, 작업은 대시보드에서 다양한 방식으로 관리해요.</CardDescription>
              </CardHeader>
              <CardContent>
                <Form method="post" className="space-y-3">
                  <input type="hidden" name="intent" value="save_page" />
                  <input type="hidden" name="view" value={currentView} />
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
                <CardTitle>열린 작업창</CardTitle>
                <CardDescription>현재 최소화하지 않은 작업들이에요.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {openWorkItems.length === 0 ? (
                  <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">열린 작업창이 없어요.</p>
                ) : (
                  openWorkItems.map((item) => {
                    const checklistSummary = summarizeChecklist(item.checklist);
                    return (
                      <div key={item.id} className="rounded-2xl border border-[#e7dac9] bg-[#fffaf3] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-medium text-slate-900">{item.title}</p>
                              <Badge variant="outline">{getStatusLabel(item.status)}</Badge>
                            </div>
                            <WorkItemReferenceText
                              dateToken={dateToken}
                              text={item.nextAction}
                              emptyText="다음 할일이 아직 없어요."
                              className="mt-2 text-sm text-slate-600"
                            />
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                              <span>남은 체크 {checklistSummary.remainingCount}개</span>
                              <span>오늘 할 일 {checklistSummary.todayCount}개</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <WorkWindowButton to={buildWorkWindowLink(dateToken, item.id)} />
                            <Form method="post">
                              <input type="hidden" name="intent" value="minimize_work_item" />
                              <input type="hidden" name="workItemId" value={item.id} />
                              <input type="hidden" name="view" value={currentView} />
                              <Button type="submit" variant="outline" size="sm">
                                <Minimize2 className="h-4 w-4" />
                                최소화
                              </Button>
                            </Form>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
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
                    to={buildDashboardLink(item.pageDate.slice(0, 10), currentView)}
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
          </aside>

          <main className="space-y-5">
            {currentView === "day" ? (
              <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
                <CardHeader>
                  <CardTitle>날짜 보기</CardTitle>
                  <CardDescription>선택한 날짜와 연결된 작업들을 한 장의 페이지처럼 봅니다.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {dateItems.length === 0 ? (
                    <p className="rounded-2xl border border-dashed px-4 py-12 text-center text-sm text-slate-500">
                      이 날짜에 연결된 작업 카드가 아직 없어요.
                    </p>
                  ) : (
                    dateItems.map((item) => {
                      const checklistSummary = summarizeChecklist(item.checklist);
                      return (
                        <div key={item.id} className="rounded-[24px] border border-[#e7dac9] bg-[#fffaf3] p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-base font-semibold text-slate-900">{item.title}</p>
                                <Badge variant="outline">{getStatusLabel(item.status)}</Badge>
                                {item.isMinimized ? <Badge variant="secondary">대시보드 카드</Badge> : <Badge variant="secondary">열린 작업창</Badge>}
                              </div>
                              <WorkItemReferenceText
                                dateToken={dateToken}
                                text={item.nextAction}
                                emptyText="다음 할일이 아직 없어요."
                                className="mt-2 text-sm text-slate-600"
                              />
                              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                                <span>남은 체크 {checklistSummary.remainingCount}개</span>
                                <span>오늘 할 일 {checklistSummary.todayCount}개</span>
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <WorkWindowButton to={buildWorkWindowLink(dateToken, item.id)} />
                              <Form method="post">
                                <input type="hidden" name="intent" value={item.isMinimized ? "restore_work_item" : "minimize_work_item"} />
                                <input type="hidden" name="workItemId" value={item.id} />
                                <input type="hidden" name="view" value={currentView} />
                                <Button type="submit" variant="outline" size="sm">
                                  {item.isMinimized ? "꺼내기" : "최소화"}
                                </Button>
                              </Form>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}

                  <div className="rounded-[24px] border border-[#eadfce] bg-[#fbf8f3] p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-medium text-slate-900">다른 날짜 작업 가져오기</h3>
                      <Badge variant="outline">{recentMinimizedItems.length}개</Badge>
                    </div>
                    <div className="space-y-3">
                      {recentMinimizedItems.length === 0 ? (
                        <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">다시 가져올 카드가 없어요.</p>
                      ) : (
                        recentMinimizedItems.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[#e6d9c7] bg-white p-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">{item.title}</p>
                              <WorkItemReferenceText
                                dateToken={dateToken}
                                text={item.nextAction}
                                emptyText="다음 할일이 아직 없어요."
                                className="mt-1 text-sm text-slate-500"
                              />
                            </div>
                            <Form method="post">
                              <input type="hidden" name="intent" value="attach_work_item_to_page" />
                              <input type="hidden" name="workItemId" value={item.id} />
                              <input type="hidden" name="view" value={currentView} />
                              <Button type="submit" variant="outline">이 날짜에 연결</Button>
                            </Form>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
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
                  <CardDescription>날짜와 상관없이 최소화된 작업 카드들을 상태별로 정리합니다.</CardDescription>
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
                                        text={item.nextAction}
                                        emptyText="다음 할일이 아직 없어요."
                                        className="mt-1 line-clamp-2 text-xs text-slate-500"
                                      />
                                    </div>
                                    <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                                  </div>
                                  <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                    <span>남은 체크 {checklistSummary.remainingCount}개</span>
                                    <span>오늘 할 일 {checklistSummary.todayCount}개</span>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <WorkWindowButton to={buildWorkWindowLink(dateToken, item.id)} size="sm" />
                                    <Form method="post">
                                      <input type="hidden" name="intent" value="attach_work_item_to_page" />
                                      <input type="hidden" name="workItemId" value={item.id} />
                                      <input type="hidden" name="view" value={currentView} />
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
  activeStatusMenu,
  editingStatusTitle,
  onToggleMenu,
  onStartEdit,
  onEditChange,
  onCancelEdit,
  statusesCount,
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
  activeStatusMenu: DevlogStatusValue | null;
  editingStatusTitle: { status: DevlogStatusValue; value: string } | null;
  onToggleMenu: (status: DevlogStatusValue) => void;
  onStartEdit: (status: DevlogStatusValue, label: string) => void;
  onEditChange: (value: string) => void;
  onCancelEdit: (status: DevlogStatusValue) => void;
  statusesCount: number;
  showAddButton: boolean;
  isAddingStatus: boolean;
  newStatusTitle: string;
  onToggleCreate: () => void;
  onCreateTitleChange: (value: string) => void;
  onCancelCreate: () => void;
}) {
  const isMenuOpen = activeStatusMenu === column.status;
  const isEditing = editingStatusTitle?.status === column.status;
  const draftTitle = isEditing ? editingStatusTitle.value : column.label;
  const canDeleteStatus = statusesCount > 1 && column.totalCount === 0;
  const statusMetaLabel = column.status.startsWith("CUSTOM_") ? "CUSTOM STATUS" : column.status.replaceAll("_", " ");

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-[#9d7a53]" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#94724b]">{statusMetaLabel}</p>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleMenu(column.status)}
                className={`min-w-0 rounded-2xl px-1 py-1 text-left transition ${
                  isMenuOpen ? "bg-white/90 shadow-sm" : "hover:bg-white/80"
                }`}
                aria-expanded={isMenuOpen}
              >
                <span className="block truncate text-2xl font-semibold text-slate-900">{column.label}</span>
              </button>
              <Badge variant="outline">
                {column.items.length}/{column.totalCount}
              </Badge>
            </div>

            {isEditing ? (
              <Form method="post" className="mt-3 flex flex-col gap-2">
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
            ) : isMenuOpen ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="h-10 rounded-full px-4" onClick={() => onStartEdit(column.status, column.label)}>
                  수정
                </Button>
                <Form method="post">
                  <input type="hidden" name="intent" value="delete_status" />
                  <input type="hidden" name="view" value={currentView} />
                  <input type="hidden" name="status" value={column.status} />
                  <Button type="submit" variant="outline" size="sm" className="h-10 rounded-full px-4" disabled={!canDeleteStatus}>
                    삭제
                  </Button>
                </Form>
                {!canDeleteStatus ? (
                  <p className="basis-full text-xs text-slate-500">비어 있는 상태만 삭제할 수 있어요.</p>
                ) : null}
              </div>
            ) : null}

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

          {showAddButton ? (
            <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0 rounded-full" aria-label="새 상태 추가" title="새 상태 추가" onClick={onToggleCreate}>
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

function ViewButton({ to, active, label }: { to: string; active: boolean; label: string }) {
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className={`rounded-full border ${
        active
          ? "border-[#c69a67] bg-[#f6e8d4] text-[#714a28] hover:bg-[#f0dfc6]"
          : "border-[#e7dccd] bg-white/85 text-slate-600 hover:bg-[#faf5ee]"
      }`}
    >
      <Link to={to}>{label}</Link>
    </Button>
  );
}

function WorkItemReferenceText({
  dateToken,
  text,
  className,
  emptyText,
}: {
  dateToken: string;
  text: string | null | undefined;
  className: string;
  emptyText?: string;
}) {
  if (!text) {
    return emptyText ? <p className={className}>{emptyText}</p> : null;
  }

  const parts = getDevlogWorkItemReferenceParts(text);

  return (
    <p className={className}>
      {parts.map((part, index) =>
        part.type === "reference" ? (
          <button
            key={`${part.workItemId}-${index}`}
            type="button"
            className="font-medium text-[#8a5f36] underline underline-offset-4 hover:text-[#6d4726]"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openWorkWindow(buildWorkWindowLink(dateToken, part.workItemId));
            }}
          >
            {part.value}
          </button>
        ) : (
          <span key={`text-${index}`}>{part.value}</span>
        ),
      )}
    </p>
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
