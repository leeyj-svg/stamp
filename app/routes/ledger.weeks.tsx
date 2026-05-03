import { Link, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { useMemo, useState, type TouchEvent } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, MoreVertical } from "lucide-react";

import { RoutineWeekPanel } from "~/components/routine-week-panel";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { getSessionWithPermission } from "~/lib/auth.server";
import { getBudgetDisplayTotalAmount, getBudgetPeriodDayCount, getFixedExpenseCategoryIds } from "~/lib/ledger-budget";
import { ensureLedgerBudgetPeriodForDate, getCurrentLedgerWeekBudgetSummary } from "~/lib/ledger-budget.server";
import { db } from "~/lib/db.server";
import {
  buildBudgetQuery,
  buildLedgerBudgetLink,
  buildLedgerDateLink,
  buildLedgerListLink,
  buildLedgerMonthLink,
  buildLedgerWeekListLink,
  buildPeriodRemainingBudgetUntilDate,
  buildWeeklyBudgetStateByDate,
  findWeeklyBudgetStateForRange,
  formatEntryTimeLine,
  getCategoryChipClass,
  getMonthStart,
  getMonthWeekRanges,
  parseCategoryIds,
  parseCurrentWeekBudgetView,
  parseEntryFilter,
  parseMonthToken,
  toggleEntryFilter,
  type LedgerListBudgetEntrySummary,
  type LedgerListBudgetPeriodSummary,
} from "~/lib/ledger-listing";
import {
  formatLedgerAmount,
  getLedgerBenefitTagAmount,
  getDateKey,
  getPaymentMethodLabel,
  type LedgerEntryTypeValue,
} from "~/lib/ledger-entry";
import { ensureLedgerSetup, getLedgerReferenceDateForMonthToken, getMonthToken, shiftMonthToken } from "~/lib/ledger";
import { cn } from "~/lib/utils";

type WeekPanelView = "ledger" | "routine";

function getAmountClass(type: LedgerEntryTypeValue) {
  if (type === "INCOME") {
    return "text-sky-500";
  }

  if (type === "EXPENSE") {
    return "text-rose-500";
  }

  return "text-emerald-600";
}

function getBudgetResultClass(type: LedgerEntryTypeValue, amount: number) {
  if (type === "EXPENSE") {
    return amount < 0 ? "text-rose-500" : "text-slate-500";
  }

  if (type === "INCOME") {
    return amount < 0 ? "text-sky-600" : "text-slate-500";
  }

  return amount < 0 ? "text-emerald-600" : "text-slate-500";
}

function formatWeekRangeLabel(start: Date, end: Date) {
  const displayEnd = new Date(end);
  displayEnd.setDate(displayEnd.getDate() - 1);

  return `${start.getMonth() + 1}/${start.getDate()} - ${displayEnd.getMonth() + 1}/${displayEnd.getDate()}`;
}

function formatFullPeriodLabel(start: Date, endExclusive: Date) {
  const displayEnd = new Date(endExclusive);
  displayEnd.setDate(displayEnd.getDate() - 1);

  const startYear = start.getFullYear();
  const startMonth = `${start.getMonth() + 1}`.padStart(2, "0");
  const startDay = `${start.getDate()}`.padStart(2, "0");
  const endYear = displayEnd.getFullYear();
  const endMonth = `${displayEnd.getMonth() + 1}`.padStart(2, "0");
  const endDay = `${displayEnd.getDate()}`.padStart(2, "0");

  return `${startYear}.${startMonth}.${startDay}~${endYear}.${endMonth}.${endDay}`;
}

function parseWeekPanelView(value: string | null): WeekPanelView {
  return value === "routine" ? "routine" : "ledger";
}

function buildWeekPanelLink(
  monthToken: string,
  filter: "ALL" | LedgerEntryTypeValue,
  displayParam: string | null,
  showCurrentWeekBudget: boolean,
  selectedCategoryIds: number[] = [],
  panelView: WeekPanelView = "ledger",
) {
  const baseLink = buildLedgerWeekListLink(monthToken, filter, displayParam, showCurrentWeekBudget, selectedCategoryIds);
  if (panelView === "ledger") {
    return baseLink;
  }

  return `${baseLink}${baseLink.includes("?") ? "&" : "?"}panel=routine`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  await ensureLedgerSetup(db, user.id);
  const { loadLedgerCategories } = await import("~/lib/ledger-entry.server");
  const { loadRoutineCalendarRecords, loadRoutineTypes } = await import("~/lib/routine.server");

  const url = new URL(request.url);
  const today = new Date();
  const todayMonthToken = getMonthToken(today);
  const monthToken = parseMonthToken(url.searchParams.get("month")) ?? todayMonthToken;
  const selectedFilter = parseEntryFilter(url.searchParams.get("type"));
  const selectedCategoryIdsRaw = parseCategoryIds(url.searchParams);
  const showCurrentWeekBudget = parseCurrentWeekBudgetView(url.searchParams.get("currentWeek"));
  const selectedPanelView = parseWeekPanelView(url.searchParams.get("panel"));
  const displayParam = url.searchParams.get("display");
  const budgetFocusType: LedgerEntryTypeValue = selectedFilter === "ALL" ? "EXPENSE" : selectedFilter;
  const monthStart = getMonthStart(monthToken);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 12, 0, 0, 0);
  const nextMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1, 0, 0, 0, 0);

  const [startBudgetResult, endBudgetResult, currentWeekBudget, categories] = await Promise.all([
    ensureLedgerBudgetPeriodForDate(db, user.id, monthStart),
    ensureLedgerBudgetPeriodForDate(db, user.id, monthEnd),
    monthToken === todayMonthToken ? getCurrentLedgerWeekBudgetSummary(db, user.id, budgetFocusType, today) : Promise.resolve(null),
    loadLedgerCategories(db, user.id),
  ]);

  const periodReferenceDate = getLedgerReferenceDateForMonthToken(
    monthToken,
    startBudgetResult.settings.defaultPeriodBasis,
    startBudgetResult.settings.paydayDay ?? 25,
  );
  const referenceBudgetResult =
    periodReferenceDate.getTime() === monthStart.getTime()
      ? startBudgetResult
      : await ensureLedgerBudgetPeriodForDate(db, user.id, periodReferenceDate);
  const periodBasis = referenceBudgetResult.settings.defaultPeriodBasis;
  const displayRangeStart = periodBasis === "PAYDAY" ? new Date(referenceBudgetResult.period.periodStartAt) : monthStart;
  const displayRangeEnd = periodBasis === "PAYDAY" ? new Date(referenceBudgetResult.period.periodEndAt) : nextMonthStart;
  const displayRangeLabel = formatFullPeriodLabel(displayRangeStart, displayRangeEnd);

  const budgetPeriodsById = new Map<number, LedgerListBudgetPeriodSummary>();
  for (const period of periodBasis === "PAYDAY" ? [referenceBudgetResult.period] : [startBudgetResult.period, endBudgetResult.period]) {
    budgetPeriodsById.set(period.id, {
      id: period.id,
      periodStartAt: period.periodStartAt.toISOString(),
      periodEndAt: period.periodEndAt.toISOString(),
      plans: period.plans.map((plan) => ({
        type: plan.type,
        totalAmount: Number(plan.totalAmount),
        weekCarryMode: plan.weekCarryMode,
        weeks: plan.weeks.map((week) => ({
          weekIndex: week.weekIndex,
          weekStartAt: week.weekStartAt.toISOString(),
          weekEndAt: week.weekEndAt.toISOString(),
          plannedAmount: Number(week.plannedAmount),
          carryInAmount: Number(week.carryInAmount),
          carryOutAmount: Number(week.carryOutAmount),
        })),
        allocations: plan.allocations.map((allocation) => ({
          categoryId: allocation.categoryId,
          plannedAmount: Number(allocation.plannedAmount),
          isFixed: allocation.isFixed,
        })),
      })),
    });
  }

  const budgetPeriods = Array.from(budgetPeriodsById.values());
  const displayWeekRanges = getMonthWeekRanges(displayRangeStart, displayRangeEnd, startBudgetResult.settings.weekStartDay);
  const routineRangeStart = displayWeekRanges[0]?.start ?? displayRangeStart;
  const routineRangeEnd = displayWeekRanges[displayWeekRanges.length - 1]?.end ?? displayRangeEnd;

  const entryRangeStart = budgetPeriods.reduce(
    (start, period) => {
      const periodStartAt = new Date(period.periodStartAt);
      return periodStartAt < start ? periodStartAt : start;
    },
    new Date(displayRangeStart),
  );
  const entryRangeEnd = budgetPeriods.reduce(
    (end, period) => {
      const periodEndAt = new Date(period.periodEndAt);
      return periodEndAt > end ? periodEndAt : end;
    },
    new Date(displayRangeEnd),
  );

  const [entries, routineTypes, routineRecords] = await Promise.all([
    db.ledgerEntry.findMany({
      where: {
        userId: user.id,
        usedAt: {
          gte: entryRangeStart,
          lt: entryRangeEnd,
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
      orderBy: [{ usedAt: "desc" }, { createdAt: "desc" }],
    }),
    loadRoutineTypes(db, user.id),
    loadRoutineCalendarRecords(db, user.id, routineRangeStart, routineRangeEnd),
  ]);

  const selectedCategoryIds =
    selectedFilter !== "ALL"
      ? selectedCategoryIdsRaw.filter((categoryId) =>
          categories.some((category) => category.id === categoryId && category.type === selectedFilter),
        )
      : [];

  const monthCategoryIds = new Set(
    entries
      .filter((entry) => entry.categoryId !== null && entry.type === selectedFilter)
      .map((entry) => entry.categoryId as number),
  );

  return {
    monthToken,
    monthLabel: displayRangeLabel,
    prevMonthToken: shiftMonthToken(monthToken, -1),
    nextMonthToken: shiftMonthToken(monthToken, 1),
    selectedFilter,
    selectedCategoryIds,
    selectedPanelView,
    showCurrentWeekBudget,
    displayParam,
    budgetFocusType,
    periodBasis,
    weekStartDay: referenceBudgetResult.settings.weekStartDay,
    displayRangeStartAt: displayRangeStart.toISOString(),
    displayRangeEndAt: displayRangeEnd.toISOString(),
    currentWeekBudget: currentWeekBudget
      ? {
          weekStartAt: currentWeekBudget.weekStartAt,
          weekEndAt: currentWeekBudget.weekEndAt,
        }
      : null,
    budgetPeriods,
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
      excludeFromStats: entry.excludeFromStats,
      paymentMethodLabel: getPaymentMethodLabel(entry.paymentMethod),
      paymentSourceName: entry.paymentSourceName,
      memo: entry.memo,
      categoryName: entry.category?.name ?? null,
      tagNames: entry.tags.map((item) => item.tag.name),
    })),
    routineTypes: routineTypes.map((type: any) => ({
      id: type.id,
      name: type.name,
      color: type.color,
      weeklyGoalCount: type.weeklyGoalCount,
    })),
    routineRecords: routineRecords.map((record: any) => ({
      id: record.id,
      typeId: record.typeId,
      status: record.status,
      recordDate: record.recordDate.toISOString(),
    })),
  };
};

export default function LedgerWeeksPage() {
  const {
    monthToken,
    monthLabel,
    prevMonthToken,
    nextMonthToken,
    selectedFilter,
    selectedCategoryIds,
    selectedPanelView,
    showCurrentWeekBudget,
    displayParam,
    budgetFocusType,
    weekStartDay,
    displayRangeStartAt,
    displayRangeEndAt,
    currentWeekBudget,
    budgetPeriods,
    categories,
    entries,
    routineTypes,
    routineRecords,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [isCategoryFiltersExpanded, setIsCategoryFiltersExpanded] = useState(false);
  const [touchStartPoint, setTouchStartPoint] = useState<{ x: number; y: number } | null>(null);
  const displayRangeStart = useMemo(() => new Date(displayRangeStartAt), [displayRangeStartAt]);
  const displayRangeEnd = useMemo(() => new Date(displayRangeEndAt), [displayRangeEndAt]);

  const periodEntries = useMemo(
    () =>
      entries.filter((entry) => {
        const usedAt = new Date(entry.usedAt);
        return usedAt >= displayRangeStart && usedAt < displayRangeEnd;
      }),
    [displayRangeEnd, displayRangeStart, entries],
  );

  const filteredEntries = useMemo(() => {
    const typeEntries = selectedFilter === "ALL" ? periodEntries : periodEntries.filter((entry) => entry.type === selectedFilter);
    return selectedCategoryIds.length === 0
      ? typeEntries
      : typeEntries.filter((entry) => entry.categoryId !== null && selectedCategoryIds.includes(entry.categoryId));
  }, [periodEntries, selectedCategoryIds, selectedFilter]);

  const summary = useMemo(
    () =>
      periodEntries.reduce(
        (acc, entry) => {
          if (entry.type === "INCOME") acc.income += entry.amount;
          if (entry.type === "EXPENSE") acc.expense += entry.amount;
          if (entry.type === "SAVING") acc.saving += entry.amount;
          return acc;
        },
        { income: 0, expense: 0, saving: 0 },
      ),
    [periodEntries],
  );
  const monthlyGoalSummary =
    selectedFilter !== "ALL" && selectedCategoryIds.length === 0
      ? (() => {
          const monthTargetAmount = budgetPeriods.reduce((sum, period) => {
            const periodStartAt = new Date(period.periodStartAt);
            const periodEndAt = new Date(period.periodEndAt);
            const overlapStart = Math.max(periodStartAt.getTime(), displayRangeStart.getTime());
            const overlapEnd = Math.min(periodEndAt.getTime(), displayRangeEnd.getTime());
            const overlapDays = Math.max(0, Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)));

            if (overlapDays <= 0) {
              return sum;
            }

            const plan = period.plans.find((item) => item.type === selectedFilter);
            if (!plan || plan.totalAmount <= 0) {
              return sum;
            }

            const totalAmount =
              selectedFilter === "EXPENSE"
                ? plan.totalAmount
                : getBudgetDisplayTotalAmount(selectedFilter, plan.totalAmount, plan.allocations);
            const overlapRatio = overlapDays / Math.max(getBudgetPeriodDayCount(period), 1);
            return sum + totalAmount * overlapRatio;
          }, 0);

          const actualAmount = periodEntries.reduce((sum, entry) => {
            if (entry.type !== selectedFilter) {
              return sum;
            }

            return sum + entry.amount;
          }, 0);
          return {
            actualAmount,
            remainingAmount: Math.round((monthTargetAmount - actualAmount) * 100) / 100,
            remainingLabel: selectedFilter === "EXPENSE" ? "남은 예산" : "남은 목표",
          };
        })()
      : null;

  const budgetStatsEntries = useMemo<LedgerListBudgetEntrySummary[]>(
    () =>
      entries
        .filter((entry) => !entry.excludeFromStats && entry.type === budgetFocusType)
        .map((entry) => ({
          type: entry.type,
          amount: entry.amount,
          usedAt: entry.usedAt,
          excludeFromStats: entry.excludeFromStats,
          categoryId: entry.categoryId,
        })),
    [budgetFocusType, entries],
  );

  const weeklyBudgetStateByDate = useMemo(
    () =>
      buildWeeklyBudgetStateByDate({
        budgetPeriods,
        budgetFocusType,
        budgetStatsEntries,
        weekStartDay,
      }),
    [budgetFocusType, budgetPeriods, budgetStatsEntries, weekStartDay],
  );

  const weekGroups = useMemo(() => {
    const ranges = getMonthWeekRanges(displayRangeStart, displayRangeEnd, weekStartDay);

    return ranges
      .map((range, index) => {
        const rangeEntries = filteredEntries.filter((entry) => {
          const usedAt = new Date(entry.usedAt);
          return usedAt >= range.start && usedAt < range.end;
        });

        const grouped = new Map<
          string,
          {
            dateLabel: string;
            entries: typeof rangeEntries;
          }
        >();

        for (const entry of rangeEntries) {
          const entryDate = new Date(entry.usedAt);
          const dateKey = getDateKey(entryDate);
          const dateLabel = entryDate.toLocaleDateString("ko-KR", {
            month: "long",
            day: "numeric",
            weekday: "short",
          });
          const current = grouped.get(dateKey) ?? { dateLabel, entries: [] };
          current.entries.push(entry);
          grouped.set(dateKey, current);
        }

        const weekBudget = findWeeklyBudgetStateForRange(range, weeklyBudgetStateByDate);
        const typeTotalAmount = rangeEntries.reduce((sum, entry) => sum + entry.amount, 0);
        const fixedExpenseAmount =
          selectedFilter === "EXPENSE" && selectedCategoryIds.length === 0
            ? (() => {
                const fixedExpenseCategoryIds = new Set<number>();

                for (const period of budgetPeriods) {
                  const periodStartAt = new Date(period.periodStartAt);
                  const periodEndAt = new Date(period.periodEndAt);
                  if (periodStartAt >= range.end || periodEndAt <= range.start) {
                    continue;
                  }

                  const expensePlan = period.plans.find((item) => item.type === "EXPENSE");
                  if (!expensePlan) {
                    continue;
                  }

                  for (const categoryId of getFixedExpenseCategoryIds(expensePlan.allocations)) {
                    fixedExpenseCategoryIds.add(categoryId);
                  }
                }

                if (fixedExpenseCategoryIds.size === 0) {
                  return 0;
                }

                return periodEntries.reduce((sum, entry) => {
                  const usedAt = new Date(entry.usedAt);
                  if (
                    entry.type !== "EXPENSE" ||
                    entry.categoryId === null ||
                    !fixedExpenseCategoryIds.has(entry.categoryId) ||
                    usedAt < range.start ||
                    usedAt >= range.end
                  ) {
                    return sum;
                  }

                  return sum + entry.amount;
                }, 0);
              })()
            : 0;
        const periodRemainingBudget =
          selectedFilter !== "ALL" && selectedFilter !== "EXPENSE" && selectedCategoryIds.length === 0
            ? buildPeriodRemainingBudgetUntilDate({
                budgetPeriods,
                budgetFocusType: selectedFilter,
                budgetStatsEntries,
                referenceEnd: range.end,
              })
            : null;
        const typeResultAmount =
          selectedFilter !== "ALL" && selectedCategoryIds.length === 0
            ? selectedFilter === "EXPENSE"
              ? weekBudget
                ? weekBudget.value
                : null
              : periodRemainingBudget
                ? periodRemainingBudget.remainingAmount
                : null
            : null;
        const isCurrentWeek =
          showCurrentWeekBudget &&
          currentWeekBudget &&
          range.start < new Date(currentWeekBudget.weekEndAt) &&
          range.end > new Date(currentWeekBudget.weekStartAt);

        return {
          id: `${getDateKey(range.start)}-${index}`,
          label: formatWeekRangeLabel(range.start, range.end),
          dateGroups: Array.from(grouped.entries()).map(([dateKey, group]) => ({
            dateKey,
            dateLabel: group.dateLabel,
            entries: group.entries,
          })),
          typeTotalAmount,
          typeResultAmount,
          fixedExpenseAmount,
          weekBudget,
          isCurrentWeek,
        };
      })
      .filter((group) => group.dateGroups.length > 0 || group.weekBudget !== null);
  }, [
    currentWeekBudget,
    budgetPeriods,
    budgetStatsEntries,
    displayRangeEnd,
    displayRangeStart,
    filteredEntries,
    periodEntries,
    selectedCategoryIds.length,
    selectedFilter,
    showCurrentWeekBudget,
    weekStartDay,
    weeklyBudgetStateByDate,
  ]);

  const canCollapseCategoryFilters = categories.length > 6;
  const shouldShowCategoryFilters = !canCollapseCategoryFilters || isCategoryFiltersExpanded || selectedCategoryIds.length > 0;

  const buildCategoryLink = (categoryId: number) =>
    buildWeekPanelLink(
      monthToken,
      selectedFilter,
      displayParam,
      showCurrentWeekBudget,
      selectedCategoryIds.includes(categoryId)
        ? selectedCategoryIds.filter((id) => id !== categoryId)
        : [...selectedCategoryIds, categoryId],
      selectedPanelView,
    );

  const ledgerPanelLink = buildWeekPanelLink(
    monthToken,
    selectedFilter,
    displayParam,
    showCurrentWeekBudget,
    selectedCategoryIds,
    "ledger",
  );
  const routinePanelLink = buildWeekPanelLink(
    monthToken,
    selectedFilter,
    displayParam,
    showCurrentWeekBudget,
    selectedCategoryIds,
    "routine",
  );

  const moveToPanel = (nextPanelView: WeekPanelView) => {
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
    <div className="min-h-screen bg-white">
      <div className="border-b bg-white px-2 py-3">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
            <Link to={buildLedgerMonthLink(monthToken, selectedFilter, displayParam, showCurrentWeekBudget, selectedCategoryIds)}>
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>

          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
              <Link to={buildWeekPanelLink(prevMonthToken, selectedFilter, displayParam, showCurrentWeekBudget, selectedCategoryIds, selectedPanelView)}>
                <ChevronLeft className="h-6 w-6" />
              </Link>
            </Button>
            <div className="min-w-0 max-w-[12rem] text-center">
              <h1 className="truncate whitespace-nowrap text-[0.92rem] font-semibold tracking-[-0.01em] text-slate-900">
                {monthLabel}
              </h1>
              <div className="mt-1 inline-flex items-center gap-1.5 text-[10px] leading-none">
                <button
                  type="button"
                  onClick={() => moveToPanel("ledger")}
                  className={cn(
                    "border-b px-0 py-0 transition-colors",
                    selectedPanelView === "ledger" ? "border-slate-700 text-slate-800" : "border-transparent text-slate-400",
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
                    selectedPanelView === "routine" ? "border-slate-700 text-slate-800" : "border-transparent text-slate-400",
                  )}
                >
                  루틴
                </button>
              </div>
            </div>
            <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
              <Link to={buildWeekPanelLink(nextMonthToken, selectedFilter, displayParam, showCurrentWeekBudget, selectedCategoryIds, selectedPanelView)}>
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
                <Link to={buildLedgerMonthLink(monthToken, selectedFilter, displayParam, showCurrentWeekBudget, selectedCategoryIds)}>
                  달력으로
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={buildLedgerListLink(monthToken, selectedFilter, displayParam, showCurrentWeekBudget, selectedCategoryIds)} reloadDocument>
                  월 리스트 보기
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/ledger/stats?month=${monthToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}`} reloadDocument>
                  통계
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/ledger/settings">설정</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={buildLedgerBudgetLink(monthToken, selectedFilter)}>이 달 예산 수정</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-x-hidden" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <div
          className={cn(
            "flex w-[200%] items-start transition-transform duration-300 ease-out",
            selectedPanelView === "routine" ? "-translate-x-1/2" : "translate-x-0",
          )}
        >
          <div className="w-1/2 shrink-0">
            <div className="grid grid-cols-3 border-b bg-white">
              <Link
                to={buildWeekPanelLink(monthToken, toggleEntryFilter(selectedFilter, "INCOME"), displayParam, showCurrentWeekBudget, [], selectedPanelView)}
                className={cn("py-3 text-center transition-colors", selectedFilter === "INCOME" ? "bg-sky-50" : "hover:bg-slate-50")}
              >
                <p className="text-[0.82rem] font-medium text-slate-900">수입</p>
                <p className="mt-1 text-[0.82rem] font-semibold text-sky-500">{formatLedgerAmount(summary.income)}</p>
              </Link>
              <Link
                to={buildWeekPanelLink(monthToken, toggleEntryFilter(selectedFilter, "EXPENSE"), displayParam, showCurrentWeekBudget, [], selectedPanelView)}
                className={cn("py-3 text-center transition-colors", selectedFilter === "EXPENSE" ? "bg-rose-50" : "hover:bg-slate-50")}
              >
                <p className="text-[0.82rem] font-medium text-slate-900">지출</p>
                <p className="mt-1 text-[0.82rem] font-semibold text-rose-400">{formatLedgerAmount(summary.expense)}</p>
              </Link>
              <Link
                to={buildWeekPanelLink(monthToken, toggleEntryFilter(selectedFilter, "SAVING"), displayParam, showCurrentWeekBudget, [], selectedPanelView)}
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
                              getCategoryChipClass(selectedFilter, selectedCategoryIds.includes(category.id)),
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

             {monthlyGoalSummary ? (
               <div className="border-b bg-white px-4 py-2.5">
                 <div className="flex items-center justify-end gap-3">
                   {selectedFilter === "EXPENSE" ? (
                     <div className="text-right">
                       <p
                         className={cn(
                           "inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[0.68rem] font-medium",
                           getBudgetResultClass(selectedFilter as LedgerEntryTypeValue, monthlyGoalSummary.remainingAmount),
                         )}
                       >
                         총 남은 예산 {formatLedgerAmount(monthlyGoalSummary.remainingAmount)}
                       </p>
                       <p className="mt-0.5 text-[0.62rem] font-medium text-rose-400">
                         총지출 {formatLedgerAmount(monthlyGoalSummary.actualAmount)}
                       </p>
                     </div>
                   ) : (
                     <div className="text-right">
                       <p
                         className={cn(
                           "text-[0.68rem] font-medium",
                           getBudgetResultClass(selectedFilter as LedgerEntryTypeValue, monthlyGoalSummary.remainingAmount),
                         )}
                       >
                         {monthlyGoalSummary.remainingLabel} {formatLedgerAmount(monthlyGoalSummary.remainingAmount)}
                       </p>
                       <p
                         className={cn(
                           "mt-0.5 text-[0.62rem] font-medium",
                           getAmountClass(selectedFilter as LedgerEntryTypeValue),
                         )}
                       >
                         총금액 {formatLedgerAmount(monthlyGoalSummary.actualAmount)}
                       </p>
                     </div>
                   )}
                 </div>
               </div>
             ) : null}

            <div className="pb-20">
              {weekGroups.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">아직 등록된 내역이 없습니다.</div>
              ) : (
                weekGroups.map((group) => (
                  <section key={group.id} className={cn("border-b bg-white", group.isCurrentWeek ? "bg-amber-50/50" : "")}>
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2">
                      <p className="text-[0.84rem] font-semibold text-slate-800">{group.label}</p>
                      {selectedFilter !== "ALL" ? (
                        <div className="shrink-0 text-right">
                          <p className={cn("text-[0.78rem] font-semibold", getAmountClass(selectedFilter))}>
                            {formatLedgerAmount(group.typeTotalAmount)}
                          </p>
                          {selectedFilter === "EXPENSE" && group.typeResultAmount !== null ? (
                            <div className="mt-0.5 text-[0.64rem] font-medium">
                              <p className={cn(getBudgetResultClass(selectedFilter, group.typeResultAmount))}>
                                남은 운영 예산 {formatLedgerAmount(group.typeResultAmount)}
                              </p>
                              {group.fixedExpenseAmount > 0 ? (
                                <p className="mt-0.5 text-[0.6rem] font-medium text-slate-300">
                                  고정지출 {formatLedgerAmount(group.fixedExpenseAmount)}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : group.weekBudget ? (
                        <p
                          className={cn(
                            "shrink-0 text-[0.76rem] font-semibold",
                            budgetFocusType === "EXPENSE"
                              ? group.weekBudget.value < 0
                                ? "text-rose-500"
                                : "text-slate-600"
                              : budgetFocusType === "INCOME"
                                ? "text-sky-500"
                                : "text-emerald-600",
                          )}
                        >
                          {formatLedgerAmount(group.weekBudget.value)}
                        </p>
                      ) : null}
                    </div>

                    {group.dateGroups.length === 0 ? (
                      <div className="px-4 py-5 text-center text-[0.76rem] text-slate-400">이 주에는 내역이 없습니다.</div>
                    ) : (
                      group.dateGroups.map((dateGroup) => (
                        <div key={dateGroup.dateKey}>
                          <div className="border-b border-slate-100 px-4 py-2">
                            <Link
                              to={buildLedgerDateLink(
                                dateGroup.dateKey,
                                monthToken,
                                selectedFilter,
                                displayParam,
                                showCurrentWeekBudget,
                                selectedCategoryIds,
                              )}
                              className="text-[0.78rem] font-medium text-slate-700"
                            >
                              {dateGroup.dateLabel}
                            </Link>
                          </div>

                          {dateGroup.entries.map((entry, index) => {
                            const categoryText = entry.categoryName ?? "미분류";
                            const memoText = entry.memo?.trim() || "";
                            const paymentDetail = [entry.paymentSourceName?.trim(), entry.paymentMethodLabel].filter(Boolean).join("-");
                            const tagDetail = entry.tagNames.length > 0 ? entry.tagNames.join(", ") : "";
                            const benefitTagAmount = entry.amount === 0 ? getLedgerBenefitTagAmount(entry.tagNames) : 0;
                            const detailText = [paymentDetail, tagDetail].filter(Boolean).join(" · ");

                            return (
                              <Link
                                key={entry.id}
                                to={`/ledger/entries/${entry.id}/edit?month=${monthToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}${
                                  buildBudgetQuery(displayParam, showCurrentWeekBudget, selectedCategoryIds)
                                    ? `&${buildBudgetQuery(displayParam, showCurrentWeekBudget, selectedCategoryIds)}`
                                    : ""
                                }`}
                                className={cn(
                                  "block px-5 py-4 transition-colors hover:bg-slate-50",
                                  index < dateGroup.entries.length - 1 ? "border-b border-slate-100" : "",
                                )}
                              >
                                <div className="flex items-start gap-4">
                                  <div className="w-[5rem] shrink-0 text-slate-700">
                                    <p className="truncate text-[0.78rem] font-medium leading-tight text-slate-700">{categoryText}</p>
                                    <p className="mt-1 text-[0.66rem] leading-tight text-slate-400">{formatEntryTimeLine(entry.createdAt)}</p>
                                  </div>

                                  <div className="min-w-0 flex-1 pl-1 pt-1">
                                    {memoText ? (
                                      <p className="truncate text-[0.72rem] font-semibold leading-tight text-slate-700">{memoText}</p>
                                    ) : null}
                                    {detailText ? (
                                      <p className="mt-1 truncate text-[0.64rem] leading-tight text-slate-400">{detailText}</p>
                                    ) : null}
                                  </div>

                                  <div className="shrink-0 pt-1 text-right">
                                    <p className={cn("whitespace-nowrap text-[0.8rem] font-medium", getAmountClass(entry.type))}>
                                      {formatLedgerAmount(entry.amount)}
                                    </p>
                                    {entry.amount === 0 ? (
                                      <p className="mt-1 rounded-full bg-amber-50 px-2 py-0.5 text-[0.58rem] font-medium text-amber-700">
                                        0원 기록
                                      </p>
                                    ) : null}
                                    {benefitTagAmount > 0 ? (
                                      <p className="mt-1 text-[0.62rem] font-semibold text-slate-500">
                                        표시가 {formatLedgerAmount(benefitTagAmount)}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </section>
                ))
              )}
            </div>
          </div>

          <div className="w-1/2 shrink-0">
            <RoutineWeekPanel
              monthToken={monthToken}
              selectedFilter={selectedFilter}
              displayParam={displayParam}
              showCurrentWeekBudget={showCurrentWeekBudget}
              selectedCategoryIds={selectedCategoryIds}
              weekStartDay={weekStartDay}
              displayRangeStartAt={displayRangeStartAt}
              displayRangeEndAt={displayRangeEndAt}
              routineTypes={routineTypes}
              routineRecords={routineRecords}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
