import { Form, Link, redirect, useLoaderData, useNavigate, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useMemo, useState, type TouchEvent } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, MoreVertical, Plus } from "lucide-react";

import { RoutinePanel } from "~/components/routine-panel";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { getSessionWithPermission } from "~/lib/auth.server";
import { applyManualCarryToCurrentLedgerWeek, getCurrentLedgerWeekBudgetSummary } from "~/lib/ledger-budget.server";
import { db } from "~/lib/db.server";
import {
  formatLedgerAmount,
  getLedgerBenefitTagAmount,
  getDateKey,
  getPaymentMethodLabel,
  parseRequiredDateToken,
  type LedgerEntryTypeValue,
} from "~/lib/ledger-entry";
import { ensureLedgerSetup, getMonthToken } from "~/lib/ledger";
import {
  createRoutineType,
  deleteRoutineRecord,
  loadRoutineDateSnapshot,
  saveRoutineDayNote,
  saveRoutineRecord,
  updateRoutineType,
} from "~/lib/routine.server";
import { commitSession, getFlashSession } from "~/lib/session.server";
import { cn } from "~/lib/utils";

type EntryFilterValue = "ALL" | LedgerEntryTypeValue;
type DatePanelView = "ledger" | "routine";
type CurrentWeekBudgetSummary = {
  type: LedgerEntryTypeValue;
  weekCarryMode: "NONE" | "AUTO" | "MANUAL";
  weekLabel: string;
  weekStartAt: string;
  weekEndAt: string;
  displayAmount: number;
  targetAmount: number;
  plannedAmount: number;
  carryInAmount: number;
  spentAmount: number;
  availableCarryAmount: number;
  canApplyCarry: boolean;
};

function parseMonthToken(value: string | null) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

function parseEntryFilter(value: string | null): EntryFilterValue {
  if (value === "INCOME" || value === "EXPENSE" || value === "SAVING") {
    return value;
  }

  return "ALL";
}

function parseCurrentWeekBudgetView(value: string | null) {
  return value === "1";
}

function parseDatePanelView(value: string | null): DatePanelView {
  return value === "routine" ? "routine" : "ledger";
}

function parseCategoryId(value: string | null) {
  const categoryId = Number(value);
  return Number.isInteger(categoryId) && categoryId > 0 ? categoryId : null;
}

function parseCategoryIds(searchParams: URLSearchParams) {
  const categoryIdsValue = searchParams.get("categoryIds");
  if (categoryIdsValue && categoryIdsValue.trim().length > 0) {
    return Array.from(
      new Set(
        categoryIdsValue
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((item) => Number.isInteger(item) && item > 0),
      ),
    );
  }

  const singleCategoryId = parseCategoryId(searchParams.get("categoryId"));
  return singleCategoryId !== null ? [singleCategoryId] : [];
}

function getMonthStart(monthToken: string) {
  const [year, month] = monthToken.split("-").map(Number);
  return new Date(year, month - 1, 1, 12, 0, 0, 0);
}

function buildBudgetQuery(showCurrentWeekBudget: boolean, selectedCategoryIds: number[] = []) {
  const params = new URLSearchParams();
  if (showCurrentWeekBudget) {
    params.set("currentWeek", "1");
  }

  if (selectedCategoryIds.length > 0) {
    params.set("categoryIds", selectedCategoryIds.join(","));
  }

  return params.toString();
}

function buildLedgerDateLink(
  dateToken: string,
  monthToken: string,
  filter: EntryFilterValue,
  showCurrentWeekBudget = false,
  selectedCategoryIds: number[] = [],
  panelView: DatePanelView = "ledger",
) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
    if (selectedCategoryIds.length > 0) {
      params.set("categoryIds", selectedCategoryIds.join(","));
    }
  }

  if (showCurrentWeekBudget) {
    params.set("currentWeek", "1");
  }

  if (panelView === "routine") {
    params.set("panel", "routine");
  }

  return `/ledger/${dateToken}?${params.toString()}`;
}

function buildLedgerListLink(
  monthToken: string,
  filter: EntryFilterValue,
  showCurrentWeekBudget = false,
  selectedCategoryIds: number[] = [],
) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
    if (selectedCategoryIds.length > 0) {
      params.set("categoryIds", selectedCategoryIds.join(","));
    }
  }

  if (showCurrentWeekBudget) {
    params.set("currentWeek", "1");
  }

  return `/ledger/list?${params.toString()}`;
}

function buildLedgerWeekListLink(
  monthToken: string,
  filter: EntryFilterValue,
  showCurrentWeekBudget = false,
  selectedCategoryIds: number[] = [],
) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
    if (selectedCategoryIds.length > 0) {
      params.set("categoryIds", selectedCategoryIds.join(","));
    }
  }

  if (showCurrentWeekBudget) {
    params.set("currentWeek", "1");
  }

  return `/ledger/weeks?${params.toString()}`;
}

function toggleEntryFilter(currentFilter: EntryFilterValue, nextFilter: LedgerEntryTypeValue): EntryFilterValue {
  return currentFilter === nextFilter ? "ALL" : nextFilter;
}

function getAmountClass(type: LedgerEntryTypeValue) {
  if (type === "INCOME") return "text-sky-500";
  if (type === "EXPENSE") return "text-rose-500";
  return "text-emerald-600";
}

function formatEntryTimeLine(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

async function redirectWithLedgerToast(
  request: Request,
  type: "success" | "error",
  message: string,
  dateToken: string,
  monthToken: string,
  filter: EntryFilterValue,
  showCurrentWeekBudget: boolean,
  selectedCategoryIds: number[],
) {
  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  flashSession.flash("toast", { type, message });
  const url = new URL(request.url);
  const panelView = parseDatePanelView(url.searchParams.get("panel"));

  return redirect(buildLedgerDateLink(dateToken, monthToken, filter, showCurrentWeekBudget, selectedCategoryIds, panelView), {
    headers: {
      "Set-Cookie": await commitSession(flashSession),
    },
  });
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  const selectedDate = parseRequiredDateToken(params.date);
  const dateToken = getDateKey(selectedDate);
  const url = new URL(request.url);
  const calendarMonthToken = parseMonthToken(url.searchParams.get("month")) ?? getMonthToken(selectedDate);
  const selectedFilter = parseEntryFilter(url.searchParams.get("type"));
  const showCurrentWeekBudget = parseCurrentWeekBudgetView(url.searchParams.get("currentWeek"));
  const selectedCategoryIds = parseCategoryIds(url.searchParams);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create_routine_type") {
    try {
      await createRoutineType(db, user.id, formData);
      return redirectWithLedgerToast(request, "success", "루틴 타입을 추가했어요.", dateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds);
    } catch (error) {
      return redirectWithLedgerToast(request, "error", error instanceof Error ? error.message : "루틴 타입을 추가하지 못했어요.", dateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds);
    }
  }

  if (intent === "update_routine_type") {
    try {
      await updateRoutineType(db, user.id, formData);
      return redirectWithLedgerToast(request, "success", "루틴 타입을 저장했어요.", dateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds);
    } catch (error) {
      return redirectWithLedgerToast(request, "error", error instanceof Error ? error.message : "루틴 타입을 저장하지 못했어요.", dateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds);
    }
  }

  if (intent === "save_routine_record") {
    try {
      await saveRoutineRecord(db, user.id, selectedDate, formData);
      return redirectWithLedgerToast(request, "success", "루틴 기록을 저장했어요.", dateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds);
    } catch (error) {
      return redirectWithLedgerToast(request, "error", error instanceof Error ? error.message : "루틴 기록을 저장하지 못했어요.", dateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds);
    }
  }

  if (intent === "delete_routine_record") {
    try {
      await deleteRoutineRecord(db, user.id, formData);
      return redirectWithLedgerToast(request, "success", "루틴 기록을 삭제했어요.", dateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds);
    } catch (error) {
      return redirectWithLedgerToast(request, "error", error instanceof Error ? error.message : "루틴 기록을 삭제하지 못했어요.", dateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds);
    }
  }

  if (intent === "save_routine_day_note") {
    try {
      await saveRoutineDayNote(db, user.id, selectedDate, formData);
      return redirectWithLedgerToast(request, "success", "하루 메모를 저장했어요.", dateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds);
    } catch (error) {
      return redirectWithLedgerToast(request, "error", error instanceof Error ? error.message : "하루 메모를 저장하지 못했어요.", dateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds);
    }
  }

  if (intent === "apply_week_carry") {
    const budgetType: LedgerEntryTypeValue = selectedFilter === "ALL" ? "EXPENSE" : selectedFilter;

    try {
      const carriedAmount = await applyManualCarryToCurrentLedgerWeek(db, user.id, budgetType);
      const carryMessage =
        carriedAmount >= 0
          ? `이번 주 예산에 ${formatLedgerAmount(carriedAmount)}을 더했습니다.`
          : `이번 주 예산에서 ${formatLedgerAmount(Math.abs(carriedAmount))}을 차감했습니다.`;
      return redirectWithLedgerToast(
        request,
        "success",
        carryMessage,
        dateToken,
        calendarMonthToken,
        selectedFilter,
        showCurrentWeekBudget,
        selectedCategoryIds,
      );
    } catch (error) {
      return redirectWithLedgerToast(
        request,
        "error",
        error instanceof Error ? error.message : "이번 주 예산을 이월하지 못했습니다.",
        dateToken,
        calendarMonthToken,
        selectedFilter,
        showCurrentWeekBudget,
        selectedCategoryIds,
      );
    }
  }

  return redirect(buildLedgerDateLink(dateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds));
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  await ensureLedgerSetup(db, user.id);
  const { loadLedgerCategories } = await import("~/lib/ledger-entry.server");

  const selectedDate = parseRequiredDateToken(params.date);
  const dayStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 0, 0, 0, 0);
  const nextDayStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1, 0, 0, 0, 0);
  const url = new URL(request.url);
  const calendarMonthToken = parseMonthToken(url.searchParams.get("month")) ?? getMonthToken(selectedDate);
  const selectedFilter = parseEntryFilter(url.searchParams.get("type"));
  const showCurrentWeekBudget = parseCurrentWeekBudgetView(url.searchParams.get("currentWeek"));
  const selectedPanelView = parseDatePanelView(url.searchParams.get("panel"));
  const requestedCategoryIds = parseCategoryIds(url.searchParams);
  const monthStart = getMonthStart(calendarMonthToken);
  const nextMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1, 0, 0, 0, 0);

  const [entries, categories, monthCategoryRows, routineSnapshot] = await Promise.all([
    db.ledgerEntry.findMany({
      where: {
        userId: user.id,
        usedAt: {
          gte: dayStart,
          lt: nextDayStart,
        },
      },
      include: {
        category: {
          select: { name: true },
        },
        tags: {
          select: {
            tag: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
    }),
    loadLedgerCategories(db, user.id),
    db.ledgerEntry.findMany({
      where: {
        userId: user.id,
        usedAt: {
          gte: monthStart,
          lt: nextMonthStart,
        },
      },
      select: {
        categoryId: true,
        type: true,
      },
    }),
    loadRoutineDateSnapshot(db, user.id, selectedDate),
  ]);

  const prevDate = new Date(selectedDate);
  prevDate.setDate(prevDate.getDate() - 1);
  const nextDate = new Date(selectedDate);
  nextDate.setDate(nextDate.getDate() + 1);
  const budgetFocusType: LedgerEntryTypeValue = selectedFilter === "ALL" ? "EXPENSE" : selectedFilter;
  const selectedCategoryIds =
    selectedFilter !== "ALL"
      ? requestedCategoryIds.filter((categoryId) =>
          categories.some((category) => category.id === categoryId && category.type === selectedFilter),
        )
      : [];
  const monthCategoryIds = new Set(
    monthCategoryRows
      .filter((entry) => entry.type === selectedFilter && entry.categoryId !== null)
      .map((entry) => entry.categoryId as number),
  );
  const today = new Date();
  const currentWeekBudget =
    showCurrentWeekBudget && getMonthToken(selectedDate) === getMonthToken(today)
      ? await getCurrentLedgerWeekBudgetSummary(db, user.id, budgetFocusType, today)
      : null;
  const isDateInCurrentWeek = currentWeekBudget
    ? selectedDate >= new Date(currentWeekBudget.weekStartAt) && selectedDate < new Date(currentWeekBudget.weekEndAt)
    : false;

  return {
    dateToken: getDateKey(selectedDate),
    dateLabel: selectedDate.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    calendarMonthToken,
    selectedFilter,
    selectedCategoryIds,
    selectedPanelView,
    showCurrentWeekBudget,
    currentWeekBudget,
    isDateInCurrentWeek,
    prevDateToken: getDateKey(prevDate),
    nextDateToken: getDateKey(nextDate),
    categories:
      selectedFilter === "ALL"
        ? []
        : categories
            .filter(
              (category) =>
                category.type === selectedFilter && (monthCategoryIds.has(category.id) || selectedCategoryIds.includes(category.id)),
            )
            .map((category) => ({
              id: category.id,
              name: category.name,
            })),
    entries: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      categoryId: entry.categoryId,
      amount: Number(entry.amount),
      usedAt: entry.usedAt.toISOString(),
      createdAt: entry.createdAt.toISOString(),
      paymentMethodLabel: getPaymentMethodLabel(entry.paymentMethod),
      paymentSourceName: entry.paymentSourceName,
      memo: entry.memo,
      categoryName: entry.category?.name ?? null,
      tagNames: entry.tags.map((item) => item.tag.name),
    })),
    routineTypes: routineSnapshot.routineTypes.map((type: any) => ({
      id: type.id,
      name: type.name,
      color: type.color,
      weeklyGoalCount: type.weeklyGoalCount,
      todayRecord: type.todayRecord
        ? {
            id: type.todayRecord.id,
            status: type.todayRecord.status,
            performedAt: type.todayRecord.performedAt?.toISOString() ?? null,
            photoUrl1: type.todayRecord.photoUrl1,
            photoUrl2: type.todayRecord.photoUrl2,
            memo: type.todayRecord.memo,
          }
        : null,
    })),
    routineDayNoteMemo: routineSnapshot.dayNote?.memo ?? "",
  };
};

export default function LedgerDatePage() {
  const {
    dateToken,
    dateLabel,
    calendarMonthToken,
    selectedFilter,
    selectedCategoryIds,
    selectedPanelView,
    showCurrentWeekBudget,
    prevDateToken,
    nextDateToken,
    categories,
    entries,
    routineTypes,
    routineDayNoteMemo,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [isCategoryFiltersExpanded, setIsCategoryFiltersExpanded] = useState(false);
  const [touchStartPoint, setTouchStartPoint] = useState<{ x: number; y: number } | null>(null);

  const filteredEntries = useMemo(() => {
    const typeEntries = selectedFilter === "ALL" ? entries : entries.filter((entry) => entry.type === selectedFilter);
    return selectedCategoryIds.length === 0
      ? typeEntries
      : typeEntries.filter((entry) => entry.categoryId !== null && selectedCategoryIds.includes(entry.categoryId));
  }, [entries, selectedCategoryIds, selectedFilter]);

  const summary = useMemo(
    () =>
      entries.reduce(
        (acc, entry) => {
          if (entry.type === "INCOME") acc.income += entry.amount;
          if (entry.type === "EXPENSE") acc.expense += entry.amount;
          if (entry.type === "SAVING") acc.saving += entry.amount;
          return acc;
        },
        { income: 0, expense: 0, saving: 0 },
      ),
    [entries],
  );

  const resultAmount = useMemo(() => {
    if (selectedFilter === "INCOME") {
      return summary.income;
    }

    if (selectedFilter === "EXPENSE") {
      return -summary.expense;
    }

    if (selectedFilter === "SAVING") {
      return -summary.saving;
    }

    return summary.income - summary.expense - summary.saving;
  }, [selectedFilter, summary]);

  const resultClassName = resultAmount > 0 ? "text-sky-500" : resultAmount < 0 ? "text-rose-500" : "text-slate-500";
  const canCollapseCategoryFilters = categories.length > 6;
  const shouldShowCategoryFilters = !canCollapseCategoryFilters || isCategoryFiltersExpanded || selectedCategoryIds.length > 0;

  const buildCategoryLink = (categoryId: number) =>
    buildLedgerDateLink(
      dateToken,
      calendarMonthToken,
      selectedFilter,
      showCurrentWeekBudget,
      selectedCategoryIds.includes(categoryId)
        ? selectedCategoryIds.filter((id) => id !== categoryId)
        : [...selectedCategoryIds, categoryId],
      selectedPanelView,
    );

  const budgetQuery = buildBudgetQuery(showCurrentWeekBudget, selectedCategoryIds);
  const ledgerPanelLink = buildLedgerDateLink(
    dateToken,
    calendarMonthToken,
    selectedFilter,
    showCurrentWeekBudget,
    selectedCategoryIds,
    "ledger",
  );
  const routinePanelLink = buildLedgerDateLink(
    dateToken,
    calendarMonthToken,
    selectedFilter,
    showCurrentWeekBudget,
    selectedCategoryIds,
    "routine",
  );

  const moveToPanel = (nextPanelView: DatePanelView) => {
    if (nextPanelView === selectedPanelView) {
      return;
    }

    navigate(nextPanelView === "ledger" ? ledgerPanelLink : routinePanelLink);
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    setTouchStartPoint({ x: touch.clientX, y: touch.clientY });
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (!touchStartPoint) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartPoint.x;
    const deltaY = touch.clientY - touchStartPoint.y;
    setTouchStartPoint(null);

    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }

    if (deltaX < 0) {
      moveToPanel("routine");
      return;
    }

    moveToPanel("ledger");
  };

  return (
    <>
      <div className="min-h-screen bg-white">
        <div className="border-b bg-white px-2 pb-1 pt-3">
          <div className="flex items-center justify-between gap-2">
            <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
              <Link to={`/ledger?month=${calendarMonthToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}${budgetQuery ? `&${budgetQuery}` : ""}`}>
                <ArrowLeft className="h-6 w-6" />
              </Link>
            </Button>

            <div className="flex items-center gap-1">
              <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
                <Link to={buildLedgerDateLink(prevDateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds, selectedPanelView)}>
                  <ChevronLeft className="h-6 w-6" />
                </Link>
              </Button>
              <div className="min-w-0 text-center">
                <h1 className="text-[1.15rem] font-semibold text-slate-900">{dateLabel}</h1>
                <div className="mt-1 inline-flex items-center gap-1.5 text-[10px] leading-none">
                  <button
                    type="button"
                    onClick={() => moveToPanel("ledger")}
                    className={cn(
                      "border-b px-0 py-0 transition-colors",
                      selectedPanelView === "ledger"
                        ? "border-slate-700 text-slate-800"
                        : "border-transparent text-slate-400",
                    )}
                  >
                    가계부
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => moveToPanel("routine")}
                    className={cn(
                      "border-b px-0 py-0 transition-colors",
                      selectedPanelView === "routine"
                        ? "border-slate-700 text-slate-800"
                        : "border-transparent text-slate-400",
                    )}
                  >
                    루틴
                  </button>
                </div>
              </div>
              <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
                <Link to={buildLedgerDateLink(nextDateToken, calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds, selectedPanelView)}>
                  <ChevronRight className="h-6 w-6" />
                </Link>
              </Button>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`/ledger?month=${calendarMonthToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}${budgetQuery ? `&${budgetQuery}` : ""}`}>
                    달력으로
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/ledger/stats?month=${calendarMonthToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}${budgetQuery ? `&${budgetQuery}` : ""}`}>
                    통계
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={buildLedgerListLink(calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds)} reloadDocument>
                    월 리스트 보기
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={buildLedgerWeekListLink(calendarMonthToken, selectedFilter, showCurrentWeekBudget, selectedCategoryIds)} reloadDocument>
                    주별 리스트 보기
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/ledger/settings">설정</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/ledger/budgets?month=${calendarMonthToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}`}>
                    이 달 예산 수정
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/ledger/new?date=${dateToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}${budgetQuery ? `&${budgetQuery}` : ""}`}>
                    이 날짜 작성
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div
          className="overflow-x-hidden"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className={cn(
              "flex w-[200%] items-start transition-transform duration-300 ease-out",
              selectedPanelView === "routine" ? "-translate-x-1/2" : "translate-x-0",
            )}
          >
            <div className="w-1/2 shrink-0">
            <div className="grid grid-cols-3 border-b bg-white">
              <Link
                to={buildLedgerDateLink(dateToken, calendarMonthToken, toggleEntryFilter(selectedFilter, "INCOME"), showCurrentWeekBudget, [], "ledger")}
                className={cn("py-3 text-center transition-colors", selectedFilter === "INCOME" ? "bg-sky-50" : "hover:bg-slate-50")}
              >
                <p className="text-[0.82rem] font-medium text-slate-900">수입</p>
                <p className="mt-1 text-[0.82rem] font-semibold text-sky-500">{formatLedgerAmount(summary.income)}</p>
              </Link>
              <Link
                to={buildLedgerDateLink(dateToken, calendarMonthToken, toggleEntryFilter(selectedFilter, "EXPENSE"), showCurrentWeekBudget, [], "ledger")}
                className={cn("py-3 text-center transition-colors", selectedFilter === "EXPENSE" ? "bg-rose-50" : "hover:bg-slate-50")}
              >
                <p className="text-[0.82rem] font-medium text-slate-900">지출</p>
                <p className="mt-1 text-[0.82rem] font-semibold text-rose-500">{formatLedgerAmount(summary.expense)}</p>
              </Link>
              <Link
                to={buildLedgerDateLink(dateToken, calendarMonthToken, toggleEntryFilter(selectedFilter, "SAVING"), showCurrentWeekBudget, [], "ledger")}
                className={cn("py-3 text-center transition-colors", selectedFilter === "SAVING" ? "bg-emerald-50" : "hover:bg-slate-50")}
              >
                <p className="text-[0.82rem] font-medium text-slate-900">저축</p>
                <p className="mt-1 text-[0.82rem] font-semibold text-emerald-600">{formatLedgerAmount(summary.saving)}</p>
              </Link>
            </div>

            {selectedFilter !== "ALL" && categories.length > 0 ? (
              <div className="border-b bg-white px-2 py-2">
                <div className="space-y-1">
                  {canCollapseCategoryFilters ? (
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-50"
                      onClick={() => setIsCategoryFiltersExpanded((open) => !open)}
                    >
                      <span>카테고리 {categories.length}개</span>
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", shouldShowCategoryFilters && "rotate-180")} />
                    </button>
                  ) : null}
                  {shouldShowCategoryFilters ? (
                    <div className="overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <div className="inline-flex gap-1.5">
                        {categories.map((category) => (
                          <Link
                            key={category.id}
                            to={buildCategoryLink(category.id)}
                            className={cn(
                              "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
                              selectedCategoryIds.includes(category.id)
                                ? selectedFilter === "EXPENSE"
                                  ? "border-rose-300 bg-rose-50 text-rose-500"
                                  : selectedFilter === "INCOME"
                                    ? "border-sky-300 bg-sky-50 text-sky-500"
                                    : "border-emerald-300 bg-emerald-50 text-emerald-600"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                            )}
                          >
                            {category.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="pb-24">
              {filteredEntries.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">아직 등록된 내역이 없습니다.</div>
              ) : (
                <div className="border-y border-slate-200 bg-white">
                  {filteredEntries.map((entry, index) => {
                    const categoryText = entry.categoryName ?? "미분류";
                    const memoText = entry.memo?.trim() || "";
                    const paymentDetail = [entry.paymentSourceName?.trim(), entry.paymentMethodLabel].filter(Boolean).join("-");
                    const tagDetail = entry.tagNames.length > 0 ? entry.tagNames.join(", ") : "";
                    const detailText = [paymentDetail, tagDetail].filter(Boolean).join(" · ");
                    const benefitTagAmount = entry.amount === 0 ? getLedgerBenefitTagAmount(entry.tagNames) : 0;

                    return (
                      <Link
                        key={entry.id}
                        to={`/ledger/entries/${entry.id}/edit?month=${calendarMonthToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}${budgetQuery ? `&${budgetQuery}` : ""}`}
                        className={cn(
                          "block px-5 py-4 transition-colors hover:bg-slate-50",
                          index < filteredEntries.length - 1 ? "border-b border-slate-200" : "",
                        )}
                      >
                        <div className="flex items-start gap-4">
                          <div className="w-[5rem] shrink-0 text-slate-700">
                            <p className="truncate text-[0.84rem] font-medium leading-tight text-slate-700">{categoryText}</p>
                            <p className="mt-1 text-[0.7rem] leading-tight text-slate-400">{formatEntryTimeLine(entry.createdAt)}</p>
                          </div>

                          <div className="min-w-0 flex-1 pl-1 pt-1">
                            {memoText ? <p className="truncate text-[0.78rem] font-semibold leading-tight text-slate-700">{memoText}</p> : null}
                            {detailText ? <p className="mt-1 truncate text-[0.68rem] leading-tight text-slate-400">{detailText}</p> : null}
                          </div>

                          <div className="shrink-0 pt-1 text-right">
                            <p className={cn("whitespace-nowrap text-[0.88rem] font-medium", getAmountClass(entry.type))}>
                              {formatLedgerAmount(entry.amount)}
                            </p>
                            {entry.amount === 0 ? (
                              <p className="mt-1 rounded-full bg-amber-50 px-2 py-0.5 text-[0.6rem] font-medium text-amber-700">
                                {benefitTagAmount > 0 ? formatLedgerAmount(benefitTagAmount) : "0원"}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              <div className="border-t border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-end text-sm font-semibold">
                  <span className={cn("whitespace-nowrap", resultClassName)}>{formatLedgerAmount(resultAmount)}</span>
                </div>
              </div>
            </div>
            </div>

            <div className="w-1/2 shrink-0">
              <RoutinePanel routineTypes={routineTypes} dayNoteMemo={routineDayNoteMemo} />
            </div>
          </div>
        </div>
      </div>

      {selectedPanelView === "ledger" ? (
        <Button asChild size="icon" className="fixed bottom-5 right-5 z-30 h-14 w-14 rounded-full bg-slate-500 shadow-lg hover:bg-slate-600">
          <Link
            to={`/ledger/new?date=${dateToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}${budgetQuery ? `&${budgetQuery}` : ""}`}
            aria-label="선택한 날짜로 가계부 작성"
          >
            <Plus className="h-6 w-6" />
          </Link>
        </Button>
      ) : null}
    </>
  );
}

