import { Link, redirect, useLoaderData, useNavigate, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useMemo, useState, type TouchEvent } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, MoreVertical, Plus } from "lucide-react";

import { PlannedPurchasePanel } from "~/components/planned-purchase-panel";
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
import { getBudgetDisplayTotalAmount, getFixedExpenseCategoryIds } from "~/lib/ledger-budget";
import {
  buildBudgetQuery,
  buildLedgerBudgetLink,
  buildLedgerDateLink,
  buildLedgerListLink,
  buildLedgerMonthLink,
  buildLedgerWeekListLink,
  formatEntryTimeLine,
  getCategoryChipClass,
  getMonthLabel,
  getMonthStart,
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
import {
  createLedgerPlannedPurchase,
  deleteLedgerPlannedPurchase,
  listLedgerPlannedPurchasesForMonth,
  parseLedgerPlannedPurchaseAmount,
  parseLedgerPlannedPurchaseDate,
  parseLedgerPlannedPurchaseId,
  parseLedgerPlannedPurchaseStatus,
  updateLedgerPlannedPurchaseStatus,
  type LedgerPlannedPurchaseSummary,
} from "~/lib/ledger-planned-purchase.server";
import { cn } from "~/lib/utils";

type ListPanelView = "ledger" | "purchase";

function getAmountClass(type: LedgerEntryTypeValue) {
  if (type === "INCOME") {
    return "text-sky-500";
  }

  if (type === "EXPENSE") {
    return "text-rose-500";
  }

  return "text-emerald-600";
}

function parseListPanelView(value: string | null): ListPanelView {
  return value === "purchase" ? "purchase" : "ledger";
}

function buildListPanelLink(
  monthToken: string,
  filter: "ALL" | LedgerEntryTypeValue,
  displayParam: string | null,
  showCurrentWeekBudget: boolean,
  selectedCategoryIds: number[] = [],
  panelView: ListPanelView = "ledger",
) {
  const baseLink = buildLedgerListLink(monthToken, filter, displayParam, showCurrentWeekBudget, selectedCategoryIds);
  if (panelView === "ledger") {
    return baseLink;
  }

  return `${baseLink}${baseLink.includes("?") ? "&" : "?"}panel=purchase`;
}

function getMatchingExpensePlan(
  budgetPeriods: LedgerListBudgetPeriodSummary[],
  referenceDate: Date,
) {
  const matchingPeriod =
    budgetPeriods.find((period) => {
      const periodStartAt = new Date(period.periodStartAt);
      const periodEndAt = new Date(period.periodEndAt);
      return referenceDate >= periodStartAt && referenceDate < periodEndAt;
    }) ?? null;

  if (!matchingPeriod) {
    return null;
  }

  const expensePlan = matchingPeriod.plans.find((plan) => plan.type === "EXPENSE") ?? null;
  if (!expensePlan) {
    return null;
  }

  return {
    period: matchingPeriod,
    plan: expensePlan,
  };
}

function buildPlannedPurchaseBudgetSummaries(
  purchases: LedgerPlannedPurchaseSummary[],
  budgetPeriods: LedgerListBudgetPeriodSummary[],
  budgetEntries: LedgerListBudgetEntrySummary[],
) {
  return purchases.map((purchase) => {
    const matchingExpensePlan = getMatchingExpensePlan(budgetPeriods, new Date(purchase.plannedFor));

    if (!matchingExpensePlan) {
      return {
        ...purchase,
        budgetPeriodKey: null,
        budgetPeriodLabel: null,
        overallRemainingAmount: null,
        overallAfterAmount: null,
        categoryRemainingAmount: null,
        categoryAfterAmount: null,
        hasCategoryBudget: false,
      };
    }

    const { period, plan } = matchingExpensePlan;
    const periodStartAt = new Date(period.periodStartAt);
    const periodEndAt = new Date(period.periodEndAt);
    const displayTotalAmount = getBudgetDisplayTotalAmount("EXPENSE", plan.totalAmount, plan.allocations);
    const fixedExpenseCategoryIds = getFixedExpenseCategoryIds(plan.allocations);
    const periodEntries = budgetEntries.filter((entry) => {
      const usedAt = new Date(entry.usedAt);
      return usedAt >= periodStartAt && usedAt < periodEndAt;
    });

    const actualExpenseAmount = periodEntries.reduce((sum, entry) => {
      if (entry.categoryId !== null && fixedExpenseCategoryIds.has(entry.categoryId)) {
        return sum;
      }

      return sum + entry.amount;
    }, 0);

    const overallRemainingAmount = Math.round((displayTotalAmount - actualExpenseAmount) * 100) / 100;
    const overallAfterAmount = Math.round((overallRemainingAmount - purchase.amount) * 100) / 100;
    const matchingAllocation =
      purchase.categoryId !== null ? plan.allocations.find((allocation) => allocation.categoryId === purchase.categoryId) ?? null : null;
    const actualCategoryAmount =
      purchase.categoryId !== null
        ? periodEntries.reduce((sum, entry) => (entry.categoryId === purchase.categoryId ? sum + entry.amount : sum), 0)
        : null;
    const categoryRemainingAmount =
      matchingAllocation && actualCategoryAmount !== null
        ? Math.round((matchingAllocation.plannedAmount - actualCategoryAmount) * 100) / 100
        : null;
    const categoryAfterAmount =
      categoryRemainingAmount !== null ? Math.round((categoryRemainingAmount - purchase.amount) * 100) / 100 : null;

    return {
      ...purchase,
      budgetPeriodKey: `${period.id}`,
      budgetPeriodLabel: `${periodStartAt.getMonth() + 1}/${periodStartAt.getDate()}~${new Date(periodEndAt.getTime() - 1).getMonth() + 1}/${new Date(periodEndAt.getTime() - 1).getDate()}`,
      overallRemainingAmount,
      overallAfterAmount,
      categoryRemainingAmount,
      categoryAfterAmount,
      hasCategoryBudget: matchingAllocation !== null,
    };
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  const formData = await request.formData();
  const intent = formData.get("intent");
  const { handleCategoryIntent } = await import("~/lib/ledger-entry.server");
  const url = new URL(request.url);
  const monthToken = parseMonthToken(url.searchParams.get("month")) ?? getMonthToken(new Date());
  const monthStart = getMonthStart(monthToken);

  const categoryResponse = await handleCategoryIntent(db, user.id, formData);
  if (categoryResponse) {
    return categoryResponse;
  }

  if (intent === "create_planned_purchase") {
    const title = String(formData.get("title") ?? "").trim();
    const amount = parseLedgerPlannedPurchaseAmount(formData.get("amount"));
    const categoryId = parseLedgerPlannedPurchaseId(formData.get("categoryId"));
    const plannedFor = parseLedgerPlannedPurchaseDate(formData.get("plannedFor"), monthStart);
    const memoValue = String(formData.get("memo") ?? "").trim();
    const memo = memoValue.length > 0 ? memoValue : null;

    if (title.length > 0 && amount > 0) {
      const category =
        categoryId !== null
          ? await db.ledgerCategory.findFirst({
              where: {
                id: categoryId,
                userId: user.id,
                type: "EXPENSE",
              },
              select: { id: true },
            })
          : null;

      await createLedgerPlannedPurchase(db, user.id, {
        title,
        amount,
        memo,
        plannedFor,
        categoryId: category?.id ?? null,
      });
    }
  }

  if (intent === "update_planned_purchase_status") {
    const purchaseId = parseLedgerPlannedPurchaseId(formData.get("purchaseId"));
    const status = parseLedgerPlannedPurchaseStatus(formData.get("status"));

    if (purchaseId !== null && status !== null) {
      await updateLedgerPlannedPurchaseStatus(db, user.id, purchaseId, status);
    }
  }

  if (intent === "delete_planned_purchase") {
    const purchaseId = parseLedgerPlannedPurchaseId(formData.get("purchaseId"));

    if (purchaseId !== null) {
      await deleteLedgerPlannedPurchase(db, user.id, purchaseId);
    }
  }

  return redirect(`${url.pathname}${url.search}`);
};

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
  const selectedPanelView = parseListPanelView(url.searchParams.get("panel"));
  const displayParam = url.searchParams.get("display");
  const budgetFocusType: LedgerEntryTypeValue = selectedFilter === "ALL" ? "EXPENSE" : selectedFilter;
  const monthStart = getMonthStart(monthToken);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 12, 0, 0, 0);
  const nextMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1, 0, 0, 0, 0);

  const [startBudgetResult, endBudgetResult, currentWeekBudget, categories, plannedPurchases] = await Promise.all([
    ensureLedgerBudgetPeriodForDate(db, user.id, monthStart),
    ensureLedgerBudgetPeriodForDate(db, user.id, monthEnd),
    monthToken === todayMonthToken ? getCurrentLedgerWeekBudgetSummary(db, user.id, budgetFocusType, today) : Promise.resolve(null),
    loadLedgerCategories(db, user.id),
    listLedgerPlannedPurchasesForMonth(db, user.id, monthStart, nextMonthStart),
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

  const purchaseCategories = categories
    .filter((category) => category.type === "EXPENSE")
    .map((category) => ({
      id: category.id,
      name: category.name,
      isActive: category.isActive,
      entryCount: category.entryCount,
      budgetAllocationCount: category.budgetAllocationCount,
    }));

  const expenseBudgetEntries: LedgerListBudgetEntrySummary[] = entries
    .filter((entry) => entry.type === "EXPENSE" && !entry.excludeFromStats)
    .map((entry) => ({
      type: entry.type,
      amount: Number(entry.amount),
      usedAt: entry.usedAt.toISOString(),
      excludeFromStats: entry.excludeFromStats,
      categoryId: entry.categoryId,
    }));

  const plannedPurchaseItems = buildPlannedPurchaseBudgetSummaries(plannedPurchases, budgetPeriods, expenseBudgetEntries);
  const defaultPlannedPurchaseDateValue =
    monthToken === todayMonthToken
      ? `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, "0")}-${`${today.getDate()}`.padStart(2, "0")}`
      : `${monthStart.getFullYear()}-${`${monthStart.getMonth() + 1}`.padStart(2, "0")}-${`${monthStart.getDate()}`.padStart(2, "0")}`;

  return {
    monthToken,
    monthLabel: getMonthLabel(monthStart),
    prevMonthToken: shiftMonthToken(monthToken, -1),
    nextMonthToken: shiftMonthToken(monthToken, 1),
    selectedFilter,
    selectedCategoryIds,
    selectedPanelView,
    showCurrentWeekBudget,
    displayParam,
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
    plannedPurchases: plannedPurchaseItems,
    purchaseCategories,
    defaultPlannedPurchaseDateValue,
  };
};

export default function LedgerListPage() {
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
    categories,
    entries,
    plannedPurchases,
    purchaseCategories,
    defaultPlannedPurchaseDateValue,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [isCategoryFiltersExpanded, setIsCategoryFiltersExpanded] = useState(false);
  const [isCreatePurchaseDialogOpen, setIsCreatePurchaseDialogOpen] = useState(false);
  const [touchStartPoint, setTouchStartPoint] = useState<{ x: number; y: number } | null>(null);
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

  const groupedEntries = useMemo(() => {
    const grouped = new Map<
      string,
      {
        dateLabel: string;
        entries: typeof filteredEntries;
      }
    >();

    for (const entry of filteredEntries) {
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

    return Array.from(grouped.entries()).map(([dateKey, group]) => ({
      dateKey,
      dateLabel: group.dateLabel,
      entries: group.entries,
    }));
  }, [filteredEntries]);

  const canCollapseCategoryFilters = categories.length > 6;
  const shouldShowCategoryFilters = !canCollapseCategoryFilters || isCategoryFiltersExpanded || selectedCategoryIds.length > 0;

  const buildCategoryLink = (categoryId: number) =>
    buildListPanelLink(
      monthToken,
      selectedFilter,
      displayParam,
      showCurrentWeekBudget,
      selectedCategoryIds.includes(categoryId)
        ? selectedCategoryIds.filter((id) => id !== categoryId)
        : [...selectedCategoryIds, categoryId],
      selectedPanelView,
    );

  const ledgerPanelLink = buildListPanelLink(
    monthToken,
    selectedFilter,
    displayParam,
    showCurrentWeekBudget,
    selectedCategoryIds,
    "ledger",
  );
  const purchasePanelLink = buildListPanelLink(
    monthToken,
    selectedFilter,
    displayParam,
    showCurrentWeekBudget,
    selectedCategoryIds,
    "purchase",
  );

  const moveToPanel = (nextPanelView: ListPanelView) => {
    if (nextPanelView === selectedPanelView) {
      return;
    }

    navigate(nextPanelView === "ledger" ? ledgerPanelLink : purchasePanelLink);
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
      moveToPanel("purchase");
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
              <Link
                to={buildListPanelLink(
                  prevMonthToken,
                  selectedFilter,
                  displayParam,
                  showCurrentWeekBudget,
                  selectedCategoryIds,
                  selectedPanelView,
                )}
              >
                <ChevronLeft className="h-6 w-6" />
              </Link>
            </Button>
            <div className="min-w-0 max-w-[12rem] text-center">
              <h1 className="truncate whitespace-nowrap text-[1.15rem] font-semibold text-slate-900">{monthLabel}</h1>
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
                  onClick={() => moveToPanel("purchase")}
                  className={cn(
                    "border-b px-0 py-0 transition-colors",
                    selectedPanelView === "purchase" ? "border-slate-700 text-slate-800" : "border-transparent text-slate-400",
                  )}
                >
                  살 것
                </button>
              </div>
            </div>
            <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
              <Link
                to={buildListPanelLink(
                  nextMonthToken,
                  selectedFilter,
                  displayParam,
                  showCurrentWeekBudget,
                  selectedCategoryIds,
                  selectedPanelView,
                )}
              >
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
                <Link to={buildLedgerWeekListLink(monthToken, selectedFilter, displayParam, showCurrentWeekBudget, selectedCategoryIds)} reloadDocument>
                  주별 리스트 보기
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
            selectedPanelView === "purchase" ? "-translate-x-1/2" : "translate-x-0",
          )}
        >
          <div className="w-1/2 shrink-0">
            <div className="grid grid-cols-3 border-b bg-white">
              <Link
                to={buildListPanelLink(monthToken, toggleEntryFilter(selectedFilter, "INCOME"), displayParam, showCurrentWeekBudget, [], selectedPanelView)}
                className={cn("py-3 text-center transition-colors", selectedFilter === "INCOME" ? "bg-sky-50" : "hover:bg-slate-50")}
              >
                <p className="text-[0.82rem] font-medium text-slate-900">수입</p>
                <p className="mt-1 text-[0.82rem] font-semibold text-sky-500">{formatLedgerAmount(summary.income)}</p>
              </Link>
              <Link
                to={buildListPanelLink(monthToken, toggleEntryFilter(selectedFilter, "EXPENSE"), displayParam, showCurrentWeekBudget, [], selectedPanelView)}
                className={cn("py-3 text-center transition-colors", selectedFilter === "EXPENSE" ? "bg-rose-50" : "hover:bg-slate-50")}
              >
                <p className="text-[0.82rem] font-medium text-slate-900">지출</p>
                <p className="mt-1 text-[0.82rem] font-semibold text-rose-400">{formatLedgerAmount(summary.expense)}</p>
              </Link>
              <Link
                to={buildListPanelLink(monthToken, toggleEntryFilter(selectedFilter, "SAVING"), displayParam, showCurrentWeekBudget, [], selectedPanelView)}
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
              {groupedEntries.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">아직 등록된 내역이 없습니다.</div>
              ) : (
                groupedEntries.map((group) => (
                  <section key={group.dateKey} className="border-b bg-white">
                    <div className="border-b border-slate-100 px-4 py-2">
                      <Link
                        to={buildLedgerDateLink(
                          group.dateKey,
                          monthToken,
                          selectedFilter,
                          displayParam,
                          showCurrentWeekBudget,
                          selectedCategoryIds,
                        )}
                        className="text-[0.84rem] font-semibold text-slate-800"
                      >
                        {group.dateLabel}
                      </Link>
                    </div>
                    <div>
                      {group.entries.map((entry, index) => {
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
                              index < group.entries.length - 1 ? "border-b border-slate-100" : "",
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
                  </section>
                ))
              )}
            </div>
          </div>

          <div className="w-1/2 shrink-0">
            <PlannedPurchasePanel
              defaultDateValue={defaultPlannedPurchaseDateValue}
              items={plannedPurchases}
              categories={purchaseCategories}
              isCreateDialogOpen={isCreatePurchaseDialogOpen}
              onCreateDialogOpenChange={setIsCreatePurchaseDialogOpen}
            />
          </div>
        </div>
      </div>

      {selectedPanelView === "purchase" ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-12 z-20 flex justify-end px-6 sm:bottom-6">
          <Button
            type="button"
            onClick={() => setIsCreatePurchaseDialogOpen(true)}
            className="pointer-events-auto h-14 w-14 rounded-full bg-slate-900 text-white shadow-xl hover:bg-slate-800"
            aria-label="살 것 추가"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
