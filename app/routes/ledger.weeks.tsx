import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, MoreVertical } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { getSessionWithPermission } from "~/lib/auth.server";
import { ensureLedgerBudgetPeriodForDate, getCurrentLedgerWeekBudgetSummary } from "~/lib/ledger-budget.server";
import { db } from "~/lib/db.server";
import {
  buildBudgetQuery,
  buildLedgerBudgetLink,
  buildLedgerDateLink,
  buildLedgerListLink,
  buildLedgerMonthLink,
  buildLedgerWeekListLink,
  buildWeeklyBudgetStateByDate,
  findWeeklyBudgetStateForRange,
  formatEntryTimeLine,
  getCategoryChipClass,
  getMonthLabel,
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
  getDateKey,
  getPaymentMethodLabel,
  type LedgerEntryTypeValue,
} from "~/lib/ledger-entry";
import { ensureLedgerSetup, getMonthToken, shiftMonthToken } from "~/lib/ledger";
import { cn } from "~/lib/utils";

function getAmountClass(type: LedgerEntryTypeValue) {
  if (type === "INCOME") {
    return "text-sky-500";
  }

  if (type === "EXPENSE") {
    return "text-rose-500";
  }

  return "text-emerald-600";
}

function formatWeekRangeLabel(start: Date, end: Date) {
  const displayEnd = new Date(end);
  displayEnd.setDate(displayEnd.getDate() - 1);

  return `${start.getMonth() + 1}/${start.getDate()} - ${displayEnd.getMonth() + 1}/${displayEnd.getDate()}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  await ensureLedgerSetup(db, user.id);
  const { loadLedgerCategories } = await import("~/lib/ledger-entry.server");

  const url = new URL(request.url);
  const today = new Date();
  const todayMonthToken = getMonthToken(today);
  const monthToken = parseMonthToken(url.searchParams.get("month")) ?? todayMonthToken;
  const selectedFilter = parseEntryFilter(url.searchParams.get("type"));
  const selectedCategoryIdsRaw = parseCategoryIds(url.searchParams);
  const showCurrentWeekBudget = parseCurrentWeekBudgetView(url.searchParams.get("currentWeek"));
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

  const budgetPeriodsById = new Map<number, LedgerListBudgetPeriodSummary>();
  for (const period of [startBudgetResult.period, endBudgetResult.period]) {
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
  const entryRangeStart = budgetPeriods.reduce(
    (start, period) => {
      const periodStartAt = new Date(period.periodStartAt);
      return periodStartAt < start ? periodStartAt : start;
    },
    new Date(monthStart.getFullYear(), monthStart.getMonth(), 1, 0, 0, 0, 0),
  );
  const entryRangeEnd = budgetPeriods.reduce(
    (end, period) => {
      const periodEndAt = new Date(period.periodEndAt);
      return periodEndAt > end ? periodEndAt : end;
    },
    nextMonthStart,
  );

  const entries = await db.ledgerEntry.findMany({
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
  });

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
    monthLabel: getMonthLabel(monthStart),
    prevMonthToken: shiftMonthToken(monthToken, -1),
    nextMonthToken: shiftMonthToken(monthToken, 1),
    selectedFilter,
    selectedCategoryIds,
    showCurrentWeekBudget,
    displayParam,
    budgetFocusType,
    weekStartDay: startBudgetResult.settings.weekStartDay,
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
    showCurrentWeekBudget,
    displayParam,
    budgetFocusType,
    weekStartDay,
    currentWeekBudget,
    budgetPeriods,
    categories,
    entries,
  } = useLoaderData<typeof loader>();
  const [isCategoryFiltersExpanded, setIsCategoryFiltersExpanded] = useState(false);
  const monthStart = useMemo(() => getMonthStart(monthToken), [monthToken]);
  const nextMonthStart = useMemo(
    () => new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1, 0, 0, 0, 0),
    [monthStart],
  );

  const monthEntries = useMemo(
    () =>
      entries.filter((entry) => {
        const usedAt = new Date(entry.usedAt);
        return usedAt >= monthStart && usedAt < nextMonthStart;
      }),
    [entries, monthStart, nextMonthStart],
  );

  const filteredEntries = useMemo(() => {
    const typeEntries = selectedFilter === "ALL" ? monthEntries : monthEntries.filter((entry) => entry.type === selectedFilter);
    return selectedCategoryIds.length === 0
      ? typeEntries
      : typeEntries.filter((entry) => entry.categoryId !== null && selectedCategoryIds.includes(entry.categoryId));
  }, [monthEntries, selectedCategoryIds, selectedFilter]);

  const summary = useMemo(
    () =>
      filteredEntries.reduce(
        (acc, entry) => {
          if (entry.type === "INCOME") acc.income += entry.amount;
          if (entry.type === "EXPENSE") acc.expense += entry.amount;
          if (entry.type === "SAVING") acc.saving += entry.amount;
          return acc;
        },
        { income: 0, expense: 0, saving: 0 },
      ),
    [filteredEntries],
  );

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
    const ranges = getMonthWeekRanges(monthStart, nextMonthStart, weekStartDay);

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
          weekBudget,
          isCurrentWeek,
        };
      })
      .filter((group) => group.dateGroups.length > 0 || group.weekBudget !== null);
  }, [currentWeekBudget, filteredEntries, monthStart, nextMonthStart, showCurrentWeekBudget, weekStartDay, weeklyBudgetStateByDate]);

  const canCollapseCategoryFilters = categories.length > 6;
  const shouldShowCategoryFilters = !canCollapseCategoryFilters || isCategoryFiltersExpanded || selectedCategoryIds.length > 0;

  const buildCategoryLink = (categoryId: number) =>
    buildLedgerWeekListLink(
      monthToken,
      selectedFilter,
      displayParam,
      showCurrentWeekBudget,
      selectedCategoryIds.includes(categoryId)
        ? selectedCategoryIds.filter((id) => id !== categoryId)
        : [...selectedCategoryIds, categoryId],
    );

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
              <Link to={buildLedgerWeekListLink(prevMonthToken, selectedFilter, displayParam, showCurrentWeekBudget, selectedCategoryIds)}>
                <ChevronLeft className="h-6 w-6" />
              </Link>
            </Button>
            <div className="min-w-0 text-center">
              <h1 className="text-[1.15rem] font-semibold text-slate-900">{monthLabel}</h1>
            </div>
            <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
              <Link to={buildLedgerWeekListLink(nextMonthToken, selectedFilter, displayParam, showCurrentWeekBudget, selectedCategoryIds)}>
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

      <div className="grid grid-cols-3 border-b bg-white">
        <Link
          to={buildLedgerWeekListLink(monthToken, toggleEntryFilter(selectedFilter, "INCOME"), displayParam, showCurrentWeekBudget)}
          className={cn("py-3 text-center transition-colors", selectedFilter === "INCOME" ? "bg-sky-50" : "hover:bg-slate-50")}
        >
          <p className="text-[0.82rem] font-medium text-slate-900">수입</p>
          <p className="mt-1 text-[0.82rem] font-semibold text-sky-500">{formatLedgerAmount(summary.income)}</p>
        </Link>
        <Link
          to={buildLedgerWeekListLink(monthToken, toggleEntryFilter(selectedFilter, "EXPENSE"), displayParam, showCurrentWeekBudget)}
          className={cn("py-3 text-center transition-colors", selectedFilter === "EXPENSE" ? "bg-rose-50" : "hover:bg-slate-50")}
        >
          <p className="text-[0.82rem] font-medium text-slate-900">지출</p>
          <p className="mt-1 text-[0.82rem] font-semibold text-rose-400">{formatLedgerAmount(summary.expense)}</p>
        </Link>
        <Link
          to={buildLedgerWeekListLink(monthToken, toggleEntryFilter(selectedFilter, "SAVING"), displayParam, showCurrentWeekBudget)}
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

      <div className="pb-20">
        {weekGroups.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">아직 등록된 내역이 없습니다.</div>
        ) : (
          weekGroups.map((group) => (
            <section key={group.id} className={cn("border-b bg-white", group.isCurrentWeek ? "bg-amber-50/50" : "")}>
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2">
                <p className="text-[0.84rem] font-semibold text-slate-800">{group.label}</p>
                {group.weekBudget ? (
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

                            <p className={cn("shrink-0 whitespace-nowrap pt-1 text-right text-[0.8rem] font-medium", getAmountClass(entry.type))}>
                              {formatLedgerAmount(entry.amount)}
                            </p>
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
  );
}
