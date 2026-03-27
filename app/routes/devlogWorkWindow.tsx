import { ArrowLeft, Check, CheckSquare, ChevronsUpDown, Minimize2, PanelRightOpen, Pin, Save, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "~/components/ui/command";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";
import {
  formatDevlogWorkItemReference,
  getDevlogStatusLabel,
  getDevlogWorkItemReferenceParts,
} from "~/lib/devlog";
import {
  addDevWorkAttachment,
  createDevWorkChecklistItem,
  deleteDevWorkAttachment,
  deleteDevWorkChecklistItem,
  loadDevWorkItemWindow,
  saveDevWorkItem,
  setDevWorkItemMinimized,
  toggleDevWorkChecklistItem,
  toggleDevWorkChecklistToday,
} from "~/lib/devlog.server";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { getDateKey, parseRequiredDateToken } from "~/lib/ledger-entry";
import { commitSession, getFlashSession } from "~/lib/session.server";

function buildDashboardLink(dateToken: string) {
  return `/devlog/${dateToken}`;
}

function buildWorkWindowLink(dateToken: string, workItemId: number) {
  return `/devlog/${dateToken}/work/${workItemId}`;
}

function parseWorkItemId(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatDisplayDate(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return "기록 없음";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "기록 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toDateInputValue(value: string | Date | null | undefined) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function formatByteSize(value: number | null | undefined) {
  if (!value || value < 1) {
    return null;
  }

  if (value < 1024) {
    return `${value}B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)}KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

type ParentWorkItemPickerProps = {
  workItemId: number;
  currentParentWorkItem: {
    id: number;
    title: string;
    status: string;
    isMinimized: boolean;
  } | null;
  parentCandidates: Array<{
    id: number;
    title: string;
    status: string;
    isMinimized: boolean;
  }>;
  getStatusLabel: (status: string) => string;
};

function ParentWorkItemPicker({
  workItemId,
  currentParentWorkItem,
  parentCandidates,
  getStatusLabel,
}: ParentWorkItemPickerProps) {
  const [open, setOpen] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState(currentParentWorkItem ? String(currentParentWorkItem.id) : "");

  useEffect(() => {
    setSelectedParentId(currentParentWorkItem ? String(currentParentWorkItem.id) : "");
  }, [currentParentWorkItem?.id, workItemId]);

  const selectedParentWorkItem = useMemo(
    () =>
      parentCandidates.find((item) => String(item.id) === selectedParentId) ??
      (currentParentWorkItem && String(currentParentWorkItem.id) === selectedParentId ? currentParentWorkItem : null),
    [currentParentWorkItem, parentCandidates, selectedParentId],
  );

  return (
    <label className="space-y-2 text-sm font-medium text-slate-700">
      <span>상위 카드</span>
      <input type="hidden" name="parentWorkItemId" value={selectedParentId} />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full justify-between rounded-md border-input bg-background px-3 text-left font-normal shadow-sm"
          >
            {selectedParentWorkItem ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-xs font-semibold text-[#94724b]">
                  {formatDevlogWorkItemReference(selectedParentWorkItem.id)}
                </span>
                <span className="truncate text-slate-900">{selectedParentWorkItem.title}</span>
              </span>
            ) : (
              <span className="text-slate-500">상위 카드 검색해서 연결</span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[min(520px,calc(100vw-3rem))] p-0">
          <Command>
            <CommandInput placeholder="카드 제목 또는 #번호로 검색" />
            <CommandList>
              <CommandEmpty>연결할 카드를 찾지 못했어요.</CommandEmpty>

              <CommandGroup heading="선택">
                <CommandItem
                  value="연결 안 함 없음 해제"
                  onSelect={() => {
                    setSelectedParentId("");
                    setOpen(false);
                  }}
                >
                  <Check className={`h-4 w-4 ${selectedParentId ? "opacity-0" : "opacity-100"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">연결 안 함</p>
                    <p className="text-xs text-slate-500">현재 카드에 상위 카드를 두지 않아요.</p>
                  </div>
                </CommandItem>
              </CommandGroup>

              <CommandGroup heading="카드 검색">
                {parentCandidates.map((item) => {
                  const reference = formatDevlogWorkItemReference(item.id);
                  const isSelected = selectedParentId === String(item.id);

                  return (
                    <CommandItem
                      key={item.id}
                      value={`${reference} ${item.title} ${getStatusLabel(item.status)} ${item.isMinimized ? "보드 카드" : "작업창"}`}
                      keywords={[String(item.id), reference, item.title, getStatusLabel(item.status)]}
                      onSelect={() => {
                        setSelectedParentId(String(item.id));
                        setOpen(false);
                      }}
                    >
                      <Check className={`h-4 w-4 ${isSelected ? "opacity-100" : "opacity-0"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 text-xs font-semibold text-[#94724b]">{reference}</span>
                          <p className="truncate font-medium text-slate-900">{item.title}</p>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {getStatusLabel(item.status)} · {item.isMinimized ? "보드 카드" : "작업창"}
                        </p>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <p className="text-xs text-slate-500">카드 제목이나 `#번호`로 바로 찾아서 연결할 수 있어요.</p>
    </label>
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
          <Link
            key={`${part.workItemId}-${index}`}
            to={buildWorkWindowLink(dateToken, part.workItemId)}
            className="font-medium text-[#8a5f36] underline underline-offset-4 hover:text-[#6d4726]"
          >
            {part.value}
          </Link>
        ) : (
          <span key={`text-${index}`}>{part.value}</span>
        ),
      )}
    </p>
  );
}

function getSuccessMessage(intent: FormDataEntryValue | null) {
  switch (intent) {
    case "save_work_item":
      return "작업 내용을 저장했어요.";
    case "restore_work_item":
      return "작업 카드를 보드 밖으로 꺼냈어요.";
    case "add_checklist_item":
      return "체크리스트 항목을 추가했어요.";
    case "toggle_checklist_item":
      return "체크리스트 상태를 바꿨어요.";
    case "toggle_checklist_today":
      return "오늘 할 일 표시를 바꿨어요.";
    case "delete_checklist_item":
      return "체크리스트 항목을 삭제했어요.";
    case "add_attachment":
      return "파일을 올렸어요.";
    case "delete_attachment":
      return "파일을 삭제했어요.";
    default:
      return "변경사항을 저장했어요.";
  }
}

function getErrorMessage(intent: FormDataEntryValue | null) {
  switch (intent) {
    case "save_work_item":
      return "작업 내용을 저장하지 못했어요.";
    case "restore_work_item":
      return "작업 카드를 보드 밖으로 꺼내지 못했어요.";
    case "add_checklist_item":
      return "체크리스트 항목을 추가하지 못했어요.";
    case "toggle_checklist_item":
      return "체크리스트 상태를 바꾸지 못했어요.";
    case "toggle_checklist_today":
      return "오늘 할 일 표시를 바꾸지 못했어요.";
    case "delete_checklist_item":
      return "체크리스트 항목을 삭제하지 못했어요.";
    case "add_attachment":
      return "파일을 올리지 못했어요.";
    case "delete_attachment":
      return "파일을 삭제하지 못했어요.";
    case "minimize_work_item":
      return "작업 카드를 최소화하지 못했어요.";
    default:
      return "요청을 처리하지 못했어요.";
  }
}

async function redirectWithToast(request: Request, type: "success" | "error", message: string, to: string) {
  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  flashSession.flash("toast", { type, message });

  return redirect(to, {
    headers: {
      "Set-Cookie": await commitSession(flashSession),
    },
  });
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "ADMIN");
  const selectedDate = parseRequiredDateToken(params.date);
  const workItemId = parseWorkItemId(params.workItemId);

  if (!workItemId) {
    throw new Response("작업창을 찾을 수 없어요.", { status: 404 });
  }

  const snapshot = await loadDevWorkItemWindow(db, user.id, selectedDate, workItemId);
  const dateToken = getDateKey(selectedDate);

  return {
    dateToken,
    dashboardLink: buildDashboardLink(dateToken),
    workLink: buildWorkWindowLink(dateToken, workItemId),
    displayDateLabel: formatDisplayDate(selectedDate),
    ...snapshot,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "ADMIN");
  const selectedDate = parseRequiredDateToken(params.date);
  const workItemId = parseWorkItemId(params.workItemId);

  if (!workItemId) {
    throw new Response("작업창을 찾을 수 없어요.", { status: 404 });
  }

  const dateToken = getDateKey(selectedDate);
  const dashboardLink = buildDashboardLink(dateToken);
  const workLink = buildWorkWindowLink(dateToken, workItemId);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const responseMode = formData.get("responseMode");

  try {
    if (intent === "save_work_item") await saveDevWorkItem(db, user.id, selectedDate, formData);
    else if (intent === "restore_work_item") await setDevWorkItemMinimized(db, user.id, selectedDate, formData, false);
    else if (intent === "add_checklist_item") await createDevWorkChecklistItem(db, user.id, selectedDate, formData);
    else if (intent === "toggle_checklist_item") await toggleDevWorkChecklistItem(db, user.id, selectedDate, formData);
    else if (intent === "toggle_checklist_today") await toggleDevWorkChecklistToday(db, user.id, selectedDate, formData);
    else if (intent === "delete_checklist_item") await deleteDevWorkChecklistItem(db, user.id, selectedDate, formData);
    else if (intent === "add_attachment") await addDevWorkAttachment(db, user.id, selectedDate, formData);
    else if (intent === "delete_attachment") await deleteDevWorkAttachment(db, user.id, selectedDate, formData);
    else if (intent === "minimize_work_item") {
      await setDevWorkItemMinimized(db, user.id, selectedDate, formData, true);

      if (responseMode === "popup") {
        return {
          minimized: true,
          redirectTo: dashboardLink,
        };
      }

      return redirectWithToast(request, "success", "작업 카드를 보드로 최소화했어요.", dashboardLink);
    } else {
      throw new Response("Invalid intent", { status: 400 });
    }

    return redirectWithToast(request, "success", getSuccessMessage(intent), workLink);
  } catch {
    if (intent === "minimize_work_item" && responseMode === "popup") {
      return {
        minimized: false,
        error: getErrorMessage(intent),
      };
    }

    return redirectWithToast(request, "error", getErrorMessage(intent), workLink);
  }
};

export default function DevlogWorkWindowPage() {
  const { dateToken, displayDateLabel, dashboardLink, page, statuses, parentCandidates, workItem } = useLoaderData<typeof loader>();
  const minimizeFetcher = useFetcher<{ minimized?: boolean; redirectTo?: string; error?: string }>();
  const statusLabelMap = useMemo(
    () => Object.fromEntries(statuses.map((status) => [status.key, status.label])),
    [statuses],
  );

  const checklistSummary = useMemo(() => {
    const totalCount = workItem.checklist.length;
    const doneCount = workItem.checklist.filter((item) => item.isDone).length;
    const todayCount = workItem.checklist.filter((item) => item.isTodayTodo && !item.isDone).length;

    return {
      totalCount,
      doneCount,
      remainingCount: totalCount - doneCount,
      todayCount,
    };
  }, [workItem.checklist]);

  useEffect(() => {
    if (!minimizeFetcher.data?.minimized) {
      return;
    }

    const redirectTo = minimizeFetcher.data.redirectTo ?? dashboardLink;

    if (typeof window === "undefined") {
      return;
    }

    if (window.opener && !window.opener.closed) {
      try {
        window.opener.location.href = redirectTo;
      } catch {
        window.opener.location.reload();
      }

      window.close();
      return;
    }

    window.location.href = redirectTo;
  }, [dashboardLink, minimizeFetcher.data]);

  function handleMinimize() {
    const payload = new FormData();
    payload.set("intent", "minimize_work_item");
    payload.set("workItemId", String(workItem.id));
    payload.set("responseMode", "popup");

    minimizeFetcher.submit(payload, { method: "post" });
  }

  function getStatusLabel(status: string) {
    return getDevlogStatusLabel(status, statusLabelMap);
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f3eadb_0%,#fbf7f1_50%,#ffffff_100%)] p-4">
      <div className="mx-auto max-w-[1380px] space-y-5">
        <section className="rounded-[32px] border border-[#dbc8ad] bg-white/92 p-5 shadow-[0_24px_60px_rgba(72,54,28,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to={dashboardLink}>
                    <ArrowLeft className="h-4 w-4" />
                    보드로 돌아가기
                  </Link>
                </Button>
                <Badge variant="outline">{getStatusLabel(workItem.status)}</Badge>
                {workItem.isPinned ? <Badge variant="secondary">고정됨</Badge> : null}
                {workItem.isMinimized ? <Badge variant="secondary">현재 보드 카드 상태</Badge> : null}
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-[#94724b]">{displayDateLabel}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h1 className="text-3xl font-semibold text-slate-900">{workItem.title}</h1>
                  <Badge variant="outline" className="text-[#94724b]">
                    {formatDevlogWorkItemReference(workItem.id)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  {page.title ? `${page.title} 페이지에서 이어지는 작업창` : "이 날짜 페이지에 연결된 작업창"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {workItem.isMinimized ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="restore_work_item" />
                  <input type="hidden" name="workItemId" value={workItem.id} />
                  <Button type="submit" variant="outline">
                    <PanelRightOpen className="h-4 w-4" />
                    보드에서 꺼내기
                  </Button>
                </Form>
              ) : (
                <Button type="button" variant="outline" onClick={handleMinimize} disabled={minimizeFetcher.state !== "idle"}>
                  <Minimize2 className="h-4 w-4" />
                  보드로 최소화
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.close();
                  }
                }}
              >
                <X className="h-4 w-4" />
                창 닫기
              </Button>
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5">
            <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
              <CardHeader>
                <CardTitle>작업 메모</CardTitle>
                <CardDescription>깃 프로젝트처럼 Markdown으로 작업 내용을 적고, 상태와 다음 할일을 한 창에서 관리하세요.</CardDescription>
              </CardHeader>
              <CardContent>
                <Form method="post" className="space-y-4">
                  <input type="hidden" name="intent" value="save_work_item" />
                  <input type="hidden" name="workItemId" value={workItem.id} />

                  <div className="grid gap-3 md:grid-cols-[1fr_180px_160px]">
                    <Input name="title" defaultValue={workItem.title} placeholder="작업 제목" />

                    <label className="space-y-2 text-sm font-medium text-slate-700">
                      <span>상태</span>
                      <select
                        name="status"
                        defaultValue={workItem.status}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                      >
                        {statuses.map((status) => (
                          <option key={status.key} value={status.key}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2 text-sm font-medium text-slate-700">
                      <span>예정일</span>
                      <Input type="date" name="plannedDate" defaultValue={toDateInputValue(workItem.plannedDate)} />
                    </label>
                  </div>

                  <ParentWorkItemPicker
                    workItemId={workItem.id}
                    currentParentWorkItem={workItem.parentWorkItem}
                    parentCandidates={parentCandidates}
                    getStatusLabel={getStatusLabel}
                  />

                  <Input name="nextAction" defaultValue={workItem.nextAction ?? ""} placeholder="다음 할일 한 줄" />

                  <label className="flex items-center gap-2 rounded-2xl border border-[#eadfce] bg-[#fbf7f1] px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" name="isPinned" value="1" defaultChecked={workItem.isPinned} />
                    <Pin className="h-4 w-4 text-[#94724b]" />
                    이 작업을 우선순위가 높은 카드로 고정
                  </label>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">Markdown 작업 메모</p>
                    <Textarea
                      name="contentMd"
                      defaultValue={workItem.contentMd ?? ""}
                      rows={22}
                      className="font-mono text-sm leading-6"
                      placeholder={"# 작업 메모\n\n- 진행 상황\n- 참고 링크\n- 코드 블록\n- 내일 이어서 볼 내용"}
                    />
                    <p className="text-xs text-slate-500">
                      `# 제목`, `- 목록`, ```` ```ts ```` 같은 Markdown 문법으로 자유롭게 적어두면 돼요.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="submit">
                      <Save className="h-4 w-4" />
                      작업 저장
                    </Button>
                    <Badge variant="outline">최근 수정 {formatTimestamp(workItem.updatedAt)}</Badge>
                    <Badge variant="outline">마지막 작업 {formatTimestamp(workItem.lastWorkedAt)}</Badge>
                  </div>
                </Form>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
              <CardHeader>
                <CardTitle>연결 카드</CardTitle>
                <CardDescription>상위 카드 1개 아래에 하위 카드를 여러 개 두는 서브이슈 흐름으로 연결해요.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#94724b]">Parent</p>
                    {workItem.parentWorkItem ? <Badge variant="outline">1개</Badge> : null}
                  </div>
                  {workItem.parentWorkItem ? (
                    <Link
                      to={buildWorkWindowLink(dateToken, workItem.parentWorkItem.id)}
                      className="block rounded-2xl border border-[#eadfce] bg-[#fbf7f1] p-4 transition hover:bg-white"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-[#94724b]">
                          {formatDevlogWorkItemReference(workItem.parentWorkItem.id)}
                        </Badge>
                        <p className="font-medium text-slate-900">{workItem.parentWorkItem.title}</p>
                        <Badge variant="outline">{getStatusLabel(workItem.parentWorkItem.status)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-500">
                        {workItem.parentWorkItem.isMinimized ? "보드 카드로 연결된 상위 작업이에요." : "작업창에서 이어지는 상위 작업이에요."}
                      </p>
                    </Link>
                  ) : (
                    <p className="rounded-2xl border border-dashed px-4 py-5 text-sm text-slate-500">상위 카드가 아직 없어요.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#94724b]">Children</p>
                    <Badge variant="outline">{workItem.childWorkItems.length}개</Badge>
                  </div>
                  {workItem.childWorkItems.length === 0 ? (
                    <p className="rounded-2xl border border-dashed px-4 py-5 text-sm text-slate-500">하위 카드가 아직 없어요.</p>
                  ) : (
                    <div className="space-y-3">
                      {workItem.childWorkItems.map((item) => (
                        <Link
                          key={item.id}
                          to={buildWorkWindowLink(dateToken, item.id)}
                          className="block rounded-2xl border border-[#eadfce] bg-[#fbf7f1] p-4 transition hover:bg-white"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="text-[#94724b]">
                              {formatDevlogWorkItemReference(item.id)}
                            </Badge>
                            <p className="font-medium text-slate-900">{item.title}</p>
                            <Badge variant="outline">{getStatusLabel(item.status)}</Badge>
                          </div>
                          <WorkItemReferenceText
                            dateToken={dateToken}
                            text={item.nextAction}
                            className="mt-2 text-sm text-slate-600"
                          />
                          <p className="mt-2 text-xs text-slate-500">
                            {item.isMinimized ? "보드 카드로 연결됨" : "작업창 상태"} · 최근 수정 {formatTimestamp(item.updatedAt)}
                          </p>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#94724b]">Referenced</p>
                    <Badge variant="outline">{workItem.referencedWorkItems.length} refs</Badge>
                  </div>
                  {workItem.referencedWorkItems.length === 0 ? (
                    <p className="rounded-2xl border border-dashed px-4 py-5 text-sm text-slate-500">
                      No referenced cards yet. Add `#123` in the note or next step to link one.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {workItem.referencedWorkItems.map((item) => (
                        <Link
                          key={item.id}
                          to={buildWorkWindowLink(dateToken, item.id)}
                          className="block rounded-2xl border border-[#eadfce] bg-[#fbf7f1] p-4 transition hover:bg-white"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="text-[#94724b]">
                              {formatDevlogWorkItemReference(item.id)}
                            </Badge>
                            <p className="font-medium text-slate-900">{item.title}</p>
                            <Badge variant="outline">{getStatusLabel(item.status)}</Badge>
                          </div>
                          <WorkItemReferenceText
                            dateToken={dateToken}
                            text={item.nextAction}
                            className="mt-2 text-sm text-slate-600"
                          />
                          <p className="mt-2 text-xs text-slate-500">
                            {item.isMinimized ? "board card" : "work window"} · updated {formatTimestamp(item.updatedAt)}
                          </p>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
              <CardHeader>
                <CardTitle>체크리스트</CardTitle>
                <CardDescription>
                  완료 {checklistSummary.doneCount}/{checklistSummary.totalCount} · 오늘 할 일 {checklistSummary.todayCount}개
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Form method="post" className="space-y-3">
                  <input type="hidden" name="intent" value="add_checklist_item" />
                  <input type="hidden" name="workItemId" value={workItem.id} />
                  <Input name="content" placeholder="체크리스트 항목 추가" />
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" name="isTodayTodo" value="1" />
                    오늘 할 일에도 같이 올리기
                  </label>
                  <Button type="submit" variant="outline" className="w-full">
                    <CheckSquare className="h-4 w-4" />
                    체크리스트 추가
                  </Button>
                </Form>

                {workItem.checklist.length === 0 ? (
                  <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">
                    아직 체크리스트가 없어요.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {workItem.checklist.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-[#eadfce] bg-[#fbf7f1] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm ${item.isDone ? "text-slate-400 line-through" : "text-slate-800"}`}>
                              {item.content}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {item.isDone ? <Badge variant="secondary">완료</Badge> : <Badge variant="outline">진행중</Badge>}
                              {item.isTodayTodo ? <Badge variant="outline">오늘 할 일</Badge> : null}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap gap-2">
                            <Form method="post">
                              <input type="hidden" name="intent" value="toggle_checklist_item" />
                              <input type="hidden" name="checklistItemId" value={item.id} />
                              <Button type="submit" variant="outline" size="sm">
                                {item.isDone ? "미완료" : "완료"}
                              </Button>
                            </Form>

                            <Form method="post">
                              <input type="hidden" name="intent" value="toggle_checklist_today" />
                              <input type="hidden" name="checklistItemId" value={item.id} />
                              <Button type="submit" variant="outline" size="sm">
                                {item.isTodayTodo ? "오늘 해제" : "오늘 할 일"}
                              </Button>
                            </Form>

                            <Form method="post">
                              <input type="hidden" name="intent" value="delete_checklist_item" />
                              <input type="hidden" name="checklistItemId" value={item.id} />
                              <Button type="submit" variant="outline" size="sm">
                                <Trash2 className="h-4 w-4" />
                                삭제
                              </Button>
                            </Form>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
              <CardHeader>
                <CardTitle>파일 첨부</CardTitle>
                <CardDescription>작업에 필요한 문서나 압축 파일도 이 카드에 같이 묶어둘 수 있어요.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Form method="post" encType="multipart/form-data" className="space-y-3">
                  <input type="hidden" name="intent" value="add_attachment" />
                  <input type="hidden" name="workItemId" value={workItem.id} />
                  <Input type="file" name="attachment" />
                  <p className="text-xs text-slate-500">스토리지 설정이 연결돼 있으면 바로 업로드되고, 아니면 오류 토스트가 보여요.</p>
                  <Button type="submit" variant="outline" className="w-full">
                    <Upload className="h-4 w-4" />
                    파일 올리기
                  </Button>
                </Form>

                {workItem.attachments.length === 0 ? (
                  <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">
                    아직 첨부된 파일이 없어요.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {workItem.attachments.map((attachment) => (
                      <div key={attachment.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[#eadfce] bg-[#fbf7f1] p-3">
                        <div className="min-w-0">
                          <a
                            href={attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-sm font-medium text-slate-800 underline underline-offset-2"
                          >
                            {attachment.fileName}
                          </a>
                          <p className="mt-1 text-xs text-slate-500">
                            {attachment.kind}
                            {formatByteSize(attachment.byteSize) ? ` · ${formatByteSize(attachment.byteSize)}` : ""}
                          </p>
                        </div>

                        <Form method="post">
                          <input type="hidden" name="intent" value="delete_attachment" />
                          <input type="hidden" name="attachmentId" value={attachment.id} />
                          <Button type="submit" variant="outline" size="sm">
                            <Trash2 className="h-4 w-4" />
                            삭제
                          </Button>
                        </Form>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
              <CardHeader>
                <CardTitle>최근 기록</CardTitle>
                <CardDescription>작업 상태 변경과 체크리스트 수정 기록을 최근 순서대로 보여줘요.</CardDescription>
              </CardHeader>
              <CardContent>
                {workItem.logs.length === 0 ? (
                  <p className="rounded-2xl border border-dashed px-4 py-6 text-sm text-slate-500">
                    아직 기록이 없어요.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {workItem.logs.map((log) => (
                      <div key={log.id} className="rounded-2xl border border-[#eadfce] bg-[#fbf7f1] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm text-slate-800">{log.message || "작업 기록이 남았어요."}</p>
                          <span className="shrink-0 text-xs text-slate-500">{formatTimestamp(log.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
