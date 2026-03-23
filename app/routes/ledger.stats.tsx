import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, MoreVertical } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { type LedgerPeriodBasis } from "@prisma/client";

import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import {
  formatLedgerAmount,
  getPaymentMethodLabel,
  getTypeLabel,
  type LedgerEntryTypeValue,
  type LedgerPaymentMethodValue,
} from "~/lib/ledger-entry";
import {
  createEmptyBudgetTotals,
  getBudgetPeriodDayCount,
  getFixedExpenseCategoryIds,
} from "~/lib/ledger-budget";
import { ensureLedgerSetup, getMonthToken, shiftMonthToken } from "~/lib/ledger";
import { cn } from "~/lib/utils";

type EntryFilterValue = "ALL" | LedgerEntryTypeValue;
type StatsTabValue = "SUMMARY" | "ANALYSIS" | "FLOW";
type CategoryChartViewValue = "DONUT" | "BAR";
type WeekStartDayValue = "MONDAY" | "SUNDAY";
type BudgetPeriodSummary = {
  id: number;
  periodStartAt: string;
  periodEndAt: string;
  plans: Array<{
    type: LedgerEntryTypeValue;
    totalAmount: number;
    allocations: Array<{
      categoryId: number;
      categoryName: string;
      plannedAmount: number;
      isFixed: boolean;
    }>;
  }>;
};

type AmountBreakdownItem = {
  label: string;
  amount: number;
  percent: number;
};

type TagBreakdownItem = {
  label: string;
  count: number;
  percent: number;
  linkedAmount: number;
};

type PaymentMethodDetailItem = {
  label: string;
  amount: number;
  percent: number;
  sources: Array<{
    label: string;
    amount: number;
    percent: number;
  }>;
};

type DonutTone = "category" | "payment";
type CategoryBudgetUsageItem = {
  label: string;
  plannedAmount: number;
  actualAmount: number;
  remainingAmount: number;
  progressRaw: number;
  progressValue: number;
  isFixed: boolean;
};

type HighlightDayCardItem = {
  title: string;
  dateLabel: string;
  amount: number;
  toneClassName: string;
  softBgClassName: string;
};

type WeeklyGoalRateItem = {
  id: string;
  type: LedgerEntryTypeValue;
  label: string;
  actual: number;
  target: number;
  progressRaw: number;
  progressValue: number;
  gapAmount: number;
  labelClassName: string;
  barClassName: string;
};

type GoalSummaryShareItem = {
  id: string;
  label: string;
  actual: number;
  labelClassName: string;
};

const WEEKLY_STACK_BAR_CLASSES = [
  "bg-sky-300",
  "bg-rose-300",
  "bg-emerald-300",
  "bg-violet-300",
  "bg-amber-300",
  "bg-cyan-300",
  "bg-fuchsia-300",
  "bg-slate-400",
] as const;

function parseMonthToken(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    return null;
  }

  return value;
}

function parseEntryFilter(value: string | null): EntryFilterValue {
  if (value === "INCOME" || value === "EXPENSE" || value === "SAVING") {
    return value;
  }

  return "ALL";
}

function getMonthStart(monthToken: string) {
  const [year, month] = monthToken.split("-").map(Number);
  return new Date(year, month - 1, 1, 12, 0, 0, 0);
}

function getMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
  }).format(date);
}

function buildLedgerStatsLink(monthToken: string, filter: EntryFilterValue) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  return `/ledger/stats?${params.toString()}`;
}

function buildLedgerMonthLink(monthToken: string, filter: EntryFilterValue) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  return `/ledger?${params.toString()}`;
}

function buildLedgerDateLink(dateToken: string, monthToken: string, filter: EntryFilterValue) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  return `/ledger/${dateToken}?${params.toString()}`;
}

function buildLedgerBudgetLink(monthToken: string, filter: EntryFilterValue) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  return `/ledger/budgets?${params.toString()}`;
}

function buildLedgerListLink(monthToken: string, filter: EntryFilterValue) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  return `/ledger/list?${params.toString()}`;
}

function buildLedgerWeekListLink(monthToken: string, filter: EntryFilterValue) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  return `/ledger/weeks?${params.toString()}`;
}

function toggleEntryFilter(currentFilter: EntryFilterValue, nextFilter: LedgerEntryTypeValue): EntryFilterValue {
  return currentFilter === nextFilter ? "ALL" : nextFilter;
}

function roundPercent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

function getAmountBarWidth(percent: number) {
  if (percent <= 0) {
    return 0;
  }

  return Math.max(percent, 8);
}

function formatStatsDay(dateToken: string) {
  const date = new Date(`${dateToken}T12:00:00`);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatWeekRangeLabel(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
  });

  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatSignedLedgerAmount(amount: number) {
  if (amount === 0) {
    return formatLedgerAmount(0);
  }

  return `${amount > 0 ? "+" : "-"}${formatLedgerAmount(Math.abs(amount))}`;
}

function formatComparisonAmount(amount: number) {
  return amount < 0 ? formatSignedLedgerAmount(amount) : formatLedgerAmount(amount);
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function getOverlapDayCount(rangeStart: Date, rangeEnd: Date, periodStart: Date, periodEnd: Date) {
  const start = Math.max(rangeStart.getTime(), periodStart.getTime());
  const end = Math.min(rangeEnd.getTime(), periodEnd.getTime());
  if (end <= start) {
    return 0;
  }

  return (end - start) / (1000 * 60 * 60 * 24);
}

function getStartOfBudgetWeek(date: Date, weekStartDay: WeekStartDayValue) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  const currentDay = result.getDay();
  const desiredStart = weekStartDay === "MONDAY" ? 1 : 0;
  const diff = (currentDay - desiredStart + 7) % 7;
  result.setDate(result.getDate() - diff);
  return result;
}

function getMonthWeekRanges(monthStart: Date, nextMonthStart: Date, weekStartDay: WeekStartDayValue) {
  const rawRanges: Array<{ start: Date; end: Date }> = [];
  let cursor = getStartOfBudgetWeek(monthStart, weekStartDay);

  while (cursor < nextMonthStart) {
    const rawStart = new Date(cursor);
    const rawEnd = new Date(cursor);
    rawEnd.setDate(rawEnd.getDate() + 7);
    const start = rawStart < monthStart ? new Date(monthStart) : rawStart;
    const end = rawEnd > nextMonthStart ? new Date(nextMonthStart) : rawEnd;

    if (start < end) {
      rawRanges.push({ start, end });
    }

    cursor = rawEnd;
  }

  let ranges = rawRanges;

  while (ranges.length > 5) {
    const firstRange = ranges[0];
    const lastRange = ranges[ranges.length - 1];
    const firstDays = getOverlapDayCount(firstRange.start, firstRange.end, monthStart, nextMonthStart);
    const lastDays = getOverlapDayCount(lastRange.start, lastRange.end, monthStart, nextMonthStart);

    if (firstDays <= lastDays && ranges.length > 1) {
      ranges = [{ start: firstRange.start, end: ranges[1].end }, ...ranges.slice(2)];
    } else if (ranges.length > 1) {
      ranges = [...ranges.slice(0, -2), { start: ranges[ranges.length - 2].start, end: lastRange.end }];
    }
  }

  return ranges.map((range, index) => ({
    ...range,
    label: `${index + 1}주차`,
  }));
}

function getBudgetMeta(type: LedgerEntryTypeValue) {
  if (type === "INCOME") {
    return {
      label: "수입 목표",
      colorClass: "text-sky-500",
      ringClass: "stroke-sky-500",
      trackClass: "stroke-sky-100",
      softBgClass: "bg-sky-50",
    };
  }

  if (type === "EXPENSE") {
    return {
      label: "지출 예산",
      colorClass: "text-rose-500",
      ringClass: "stroke-rose-500",
      trackClass: "stroke-rose-100",
      softBgClass: "bg-rose-50",
    };
  }

  return {
    label: "저축 목표",
    colorClass: "text-emerald-600",
    ringClass: "stroke-emerald-600",
    trackClass: "stroke-emerald-100",
    softBgClass: "bg-emerald-50",
  };
}

function getTypeStatMeta(type: LedgerEntryTypeValue) {
  if (type === "INCOME") {
    return {
      labelClass: "text-sky-600",
      barClassName: "bg-sky-500",
    };
  }

  if (type === "EXPENSE") {
    return {
      labelClass: "text-rose-500",
      barClassName: "bg-rose-400",
    };
  }

  return {
    labelClass: "text-emerald-600",
    barClassName: "bg-emerald-600",
  };
}

function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value}%`;
}

function getComparisonDeltaMeta(type: LedgerEntryTypeValue | "NET", delta: number, current: number, previous: number) {
  const displayDelta = type === "EXPENSE" ? -delta : delta;
  const rawPercent = previous > 0 ? Math.round((delta / previous) * 100) : current > 0 ? 100 : 0;
  const displayPercent = type === "EXPENSE" ? -rawPercent : rawPercent;

  let deltaLabel = "0%";
  if (previous > 0) {
    deltaLabel = formatSignedPercent(displayPercent);
  } else if (current > 0) {
    deltaLabel = "신규";
  }

  let deltaClassName = "text-slate-500";
  if (displayDelta > 0) {
    deltaClassName = type === "SAVING" ? "text-emerald-600" : "text-sky-500";
  } else if (displayDelta < 0) {
    deltaClassName = "text-rose-500";
  }

  return {
    displayDelta,
    deltaLabel,
    deltaClassName,
  };
}

function getDonutPalette(tone: DonutTone) {
  if (tone === "payment") {
    return ["#fb7185", "#f97316", "#f59e0b", "#ef4444", "#f43f5e", "#fda4af"];
  }

  return ["#0f766e", "#0284c7", "#7c3aed", "#f97316", "#e11d48", "#64748b"];
}

function buildDonutBreakdown(items: AmountBreakdownItem[], maxSegments = 5) {
  if (items.length <= maxSegments) {
    return items;
  }

  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const visibleItems = items.slice(0, maxSegments - 1);
  const remainderAmount = items.slice(maxSegments - 1).reduce((sum, item) => sum + item.amount, 0);

  return [
    ...visibleItems,
    {
      label: "기타",
      amount: remainderAmount,
      percent: roundPercent(remainderAmount, total),
    },
  ];
}

function buildAmountBreakdown<T extends { amount: number }>(
  entries: T[],
  getLabel: (entry: T, index: number) => string,
): AmountBreakdownItem[] {
  const grouped = new Map<string, number>();

  entries.forEach((entry, index) => {
    const label = getLabel(entry, index);
    grouped.set(label, (grouped.get(label) ?? 0) + entry.amount);
  });

  const total = Array.from(grouped.values()).reduce((sum, amount) => sum + amount, 0);

  return Array.from(grouped.entries())
    .map(([label, amount]) => ({
      label,
      amount,
      percent: roundPercent(amount, total),
    }))
    .sort((left, right) => right.amount - left.amount);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  await ensureLedgerSetup(db, user.id);
  const { ensureLedgerBudgetPeriodForDate, getCurrentLedgerWeekBudgetSummary } = await import("~/lib/ledger-budget.server");

  const url = new URL(request.url);
  const monthToken = parseMonthToken(url.searchParams.get("month")) ?? getMonthToken(new Date());
  const selectedFilter = parseEntryFilter(url.searchParams.get("type"));
  const monthStart = getMonthStart(monthToken);
  const prevMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1, 0, 0, 0, 0);
  const entrySelect = {
    type: true,
    amount: true,
    usedAt: true,
    paymentMethod: true,
    paymentSourceName: true,
    category: {
      select: {
        id: true,
        name: true,
      },
    },
    tags: {
      select: {
        tag: {
          select: {
            name: true,
          },
        },
      },
    },
  } as const;

  const mapEntry = (entry: {
    type: LedgerEntryTypeValue;
    amount: { toString(): string } | number;
    usedAt: Date;
    paymentMethod: LedgerPaymentMethodValue | null;
    paymentSourceName: string | null;
    category: { id: number; name: string } | null;
    tags: Array<{ tag: { name: string } }>;
  }) => ({
    type: entry.type,
    amount: Number(entry.amount),
    usedAt: entry.usedAt.toISOString(),
    paymentMethod: entry.paymentMethod,
    paymentSourceName: entry.paymentSourceName,
    categoryId: entry.category?.id ?? null,
    categoryName: entry.category?.name ?? null,
    tagNames: entry.tags.map((item) => item.tag.name),
  });

  const currentBudgetResult = await ensureLedgerBudgetPeriodForDate(db, user.id, monthStart);
  const currentPeriodStart = new Date(currentBudgetResult.period.periodStartAt);
  const currentPeriodEnd = new Date(currentBudgetResult.period.periodEndAt);
  const previousPeriodReference = new Date(currentPeriodStart);
  previousPeriodReference.setDate(previousPeriodReference.getDate() - 1);
  const previousBudgetResult = await ensureLedgerBudgetPeriodForDate(db, user.id, previousPeriodReference);

  const previousPeriodStart = new Date(previousBudgetResult.period.periodStartAt);
  const previousPeriodEnd = new Date(previousBudgetResult.period.periodEndAt);

  const [entries, prevEntries] = await Promise.all([
    db.ledgerEntry.findMany({
      where: {
        userId: user.id,
        excludeFromStats: false,
        usedAt: {
          gte: currentPeriodStart,
          lt: currentPeriodEnd,
        },
      },
      select: entrySelect,
      orderBy: [{ usedAt: "asc" }, { id: "asc" }],
    }),
    db.ledgerEntry.findMany({
      where: {
        userId: user.id,
        excludeFromStats: false,
        usedAt: {
          gte: previousPeriodStart,
          lt: previousPeriodEnd,
        },
      },
      select: entrySelect,
      orderBy: [{ usedAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const today = new Date();
  const todayMonthToken = getMonthToken(today);
  const isCurrentMonth = monthToken === todayMonthToken;
  const currentExpenseWeekBudget =
    isCurrentMonth ? await getCurrentLedgerWeekBudgetSummary(db, user.id, "EXPENSE", today) : null;

  const budgetPeriods = Array.from(
    new Map(
      [currentBudgetResult.period].map((period) => [
        period.id,
        {
          id: period.id,
          periodStartAt: period.periodStartAt.toISOString(),
          periodEndAt: period.periodEndAt.toISOString(),
          plans: period.plans.map((plan) => ({
            type: plan.type,
            totalAmount: Number(plan.totalAmount),
            allocations: plan.allocations.map((allocation) => ({
              categoryId: allocation.categoryId,
              categoryName: allocation.category.name,
              plannedAmount: Number(allocation.plannedAmount),
              isFixed: allocation.isFixed,
            })),
          })),
        } satisfies BudgetPeriodSummary,
      ]),
    ).values(),
  );

  return {
    monthToken,
    monthLabel: getMonthLabel(monthStart),
    periodBasis: currentBudgetResult.settings.defaultPeriodBasis as LedgerPeriodBasis,
    periodLabel: currentBudgetResult.period.label ?? getMonthLabel(monthStart),
    previousPeriodLabel: previousBudgetResult.period.label ?? getMonthLabel(prevMonthStart),
    currentPeriodStartAt: currentBudgetResult.period.periodStartAt.toISOString(),
    currentPeriodEndAt: currentBudgetResult.period.periodEndAt.toISOString(),
    prevMonthToken: shiftMonthToken(monthToken, -1),
    nextMonthToken: shiftMonthToken(monthToken, 1),
    todayMonthToken,
    todayDateToken: new Intl.DateTimeFormat("sv-SE").format(today),
    isCurrentMonth,
    currentExpenseWeekBudget: currentExpenseWeekBudget
      ? {
          weekLabel: currentExpenseWeekBudget.weekLabel,
          weekStartAt: currentExpenseWeekBudget.weekStartAt,
          weekEndAt: currentExpenseWeekBudget.weekEndAt,
          displayAmount: currentExpenseWeekBudget.displayAmount,
          targetAmount: currentExpenseWeekBudget.targetAmount,
          plannedAmount: currentExpenseWeekBudget.plannedAmount,
          carryInAmount: currentExpenseWeekBudget.carryInAmount,
          spentAmount: currentExpenseWeekBudget.spentAmount,
        }
      : null,
    selectedFilter,
    weekStartDay: currentBudgetResult.settings.weekStartDay,
    primaryBudgetPeriodId: currentBudgetResult.period.id,
    budgetPeriods,
    entries: entries.map(mapEntry),
    prevEntries: prevEntries.map(mapEntry),
  };
};

export default function LedgerStatsPage() {
  const {
    monthToken,
    monthLabel,
    periodBasis,
    periodLabel,
    previousPeriodLabel,
    currentPeriodStartAt,
    currentPeriodEndAt,
    prevMonthToken,
    nextMonthToken,
    todayMonthToken,
    todayDateToken,
    isCurrentMonth,
    currentExpenseWeekBudget,
    selectedFilter,
    weekStartDay,
    primaryBudgetPeriodId,
    budgetPeriods,
    entries,
    prevEntries,
  } =
    useLoaderData<typeof loader>();

  const periodStart = useMemo(() => new Date(currentPeriodStartAt), [currentPeriodStartAt]);
  const periodEnd = useMemo(() => new Date(currentPeriodEndAt), [currentPeriodEndAt]);
  const statsRangeLabel = periodBasis === "PAYDAY" ? periodLabel : monthLabel;
  const shortMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
      }).format(getMonthStart(monthToken)),
    [monthToken],
  );
  const prevShortMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
      }).format(getMonthStart(prevMonthToken)),
    [prevMonthToken],
  );
  const prevStatsRangeLabel = periodBasis === "PAYDAY" ? previousPeriodLabel : getMonthLabel(getMonthStart(prevMonthToken));
  const todayStart = useMemo(() => new Date(`${todayDateToken}T00:00:00`), [todayDateToken]);
  const nextDayStart = useMemo(() => new Date(`${todayDateToken}T23:59:59.999`), [todayDateToken]);

  const filteredEntries = useMemo(
    () => (selectedFilter === "ALL" ? entries : entries.filter((entry) => entry.type === selectedFilter)),
    [entries, selectedFilter],
  );

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

  const previousSummary = useMemo(
    () =>
      prevEntries.reduce(
        (acc, entry) => {
          if (entry.type === "INCOME") acc.income += entry.amount;
          if (entry.type === "EXPENSE") acc.expense += entry.amount;
          if (entry.type === "SAVING") acc.saving += entry.amount;
          return acc;
        },
        { income: 0, expense: 0, saving: 0 },
      ),
    [prevEntries],
  );

  const expenseBudgetPeriods = useMemo(
    () =>
      budgetPeriods.map((period) => {
        const expensePlan = period.plans.find((plan) => plan.type === "EXPENSE") ?? null;
        return {
          start: new Date(period.periodStartAt),
          end: new Date(period.periodEndAt),
          fixedCategoryIds: expensePlan ? getFixedExpenseCategoryIds(expensePlan.allocations) : new Set<number>(),
        };
      }),
    [budgetPeriods],
  );

  const primaryBudgetPeriod = useMemo(
    () => budgetPeriods.find((period) => period.id === primaryBudgetPeriodId) ?? budgetPeriods[0] ?? null,
    [budgetPeriods, primaryBudgetPeriodId],
  );

  const planBudgetTargets = useMemo(() => {
    const totals = createEmptyBudgetTotals();

    if (!primaryBudgetPeriod) {
      return totals;
    }

    for (const plan of primaryBudgetPeriod.plans) {
      totals[plan.type] += plan.totalAmount;
    }

    return {
      INCOME: Math.round(totals.INCOME),
      EXPENSE: Math.round(totals.EXPENSE),
      SAVING: Math.round(totals.SAVING),
    };
  }, [primaryBudgetPeriod]);

  const budgetCards = useMemo(() => {
    const allTypes: LedgerEntryTypeValue[] = ["INCOME", "EXPENSE", "SAVING"];

    return allTypes.map((type) => {
      const actual = summary[type.toLowerCase() as "income" | "expense" | "saving"];
      const target = planBudgetTargets[type];
      const hasTarget = target > 0;
      const progressRaw = hasTarget ? Math.round((actual / target) * 100) : null;
      const remaining = hasTarget ? target - actual : null;

      return {
        type,
        actual,
        target,
        progressRaw,
        progressValue: progressRaw === null ? 0 : clampPercent(progressRaw),
        remaining,
        hasTarget,
        meta: getBudgetMeta(type),
      };
    });
  }, [planBudgetTargets, summary]);

  const visibleBudgetCards = useMemo(
    () => (selectedFilter === "ALL" ? budgetCards : budgetCards.filter((card) => card.type === selectedFilter)),
    [budgetCards, selectedFilter],
  );

  const netResult = useMemo(
    () => summary.income - summary.expense - summary.saving,
    [summary],
  );

  const previousNetResult = useMemo(
    () => previousSummary.income - previousSummary.expense - previousSummary.saving,
    [previousSummary],
  );

  const budgetNetTarget = useMemo(
    () => planBudgetTargets.INCOME - planBudgetTargets.EXPENSE - planBudgetTargets.SAVING,
    [planBudgetTargets],
  );
  const budgetPlanStatus = useMemo(() => {
    if (budgetNetTarget > 0) {
      return {
        label: "미배정 금액",
        amountLabel: formatLedgerAmount(budgetNetTarget),
        amountClassName: "text-amber-600",
      };
    }

    if (budgetNetTarget < 0) {
      return {
        label: "초과 계획",
        amountLabel: formatLedgerAmount(Math.abs(budgetNetTarget)),
        amountClassName: "text-rose-500",
      };
    }

    return {
      label: "계획 균형",
      amountLabel: "0원",
      amountClassName: "text-emerald-600",
    };
  }, [budgetNetTarget]);
  const currentExpenseBudgetCards = useMemo(() => {
    if (!isCurrentMonth || !currentExpenseWeekBudget) {
      return null;
    }

    const weekStart = new Date(currentExpenseWeekBudget.weekStartAt);
    const weekEnd = new Date(currentExpenseWeekBudget.weekEndAt);
    const weekDayCount = Math.max(1, Math.round((weekEnd.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24)));
    const dayTarget = Math.round((currentExpenseWeekBudget.targetAmount / weekDayCount) * 100) / 100;
    const todayExpense = entries.reduce((sum, entry) => {
      if (entry.type !== "EXPENSE") {
        return sum;
      }

      const usedAt = new Date(entry.usedAt);
      if (usedAt < todayStart || usedAt > nextDayStart) {
        return sum;
      }

      const matchingPeriod = expenseBudgetPeriods.find((period) => usedAt >= period.start && usedAt < period.end);
      if (
        matchingPeriod &&
        entry.categoryId !== null &&
        matchingPeriod.fixedCategoryIds.has(entry.categoryId)
      ) {
        return sum;
      }

      return sum + entry.amount;
    }, 0);

    return {
      week: {
        label: "이번 주 남은 예산",
        amount: currentExpenseWeekBudget.displayAmount,
        target: currentExpenseWeekBudget.targetAmount,
        meta: currentExpenseWeekBudget.weekLabel,
      },
      day: {
        label: "오늘 남은 예산",
        amount: Math.round((dayTarget - todayExpense) * 100) / 100,
        target: dayTarget,
        meta: `오늘 지출 ${formatLedgerAmount(todayExpense)}`,
      },
    };
  }, [currentExpenseWeekBudget, entries, expenseBudgetPeriods, isCurrentMonth, nextDayStart, todayStart]);

  const comparisonCards = useMemo(() => {
    const visibleTypes: LedgerEntryTypeValue[] =
      selectedFilter === "ALL" ? ["INCOME", "EXPENSE", "SAVING"] : [selectedFilter];

    return visibleTypes.map((type) => {
      const key = type.toLowerCase() as "income" | "expense" | "saving";
      const current = summary[key];
      const previous = previousSummary[key];
      const delta = current - previous;
      const meta = getBudgetMeta(type);
      const comparisonMeta = getComparisonDeltaMeta(type, delta, current, previous);

      return {
        type,
        label: getTypeLabel(type),
        current,
        previous,
        delta: comparisonMeta.displayDelta,
        deltaLabel: comparisonMeta.deltaLabel,
        deltaClassName: comparisonMeta.deltaClassName,
        meta,
      };
    });
  }, [previousSummary, selectedFilter, summary]);
  const comparisonGraphItems = useMemo(() => {
    const items = comparisonCards.map((card) => ({
      label: card.label,
      current: card.current,
      previous: card.previous,
      delta: card.delta,
      deltaLabel: card.deltaLabel,
      deltaClassName: card.deltaClassName,
      valueClassName: card.meta.colorClass,
      barClassName:
        card.type === "INCOME" ? "bg-sky-500" : card.type === "EXPENSE" ? "bg-rose-400" : "bg-emerald-600",
    }));

    if (selectedFilter === "ALL") {
      const netDelta = netResult - previousNetResult;
      const comparisonMeta = getComparisonDeltaMeta("NET", netDelta, netResult, Math.abs(previousNetResult));

      items.push({
        label: "남은 금액",
        current: netResult,
        previous: previousNetResult,
        delta: comparisonMeta.displayDelta,
        deltaLabel: comparisonMeta.deltaLabel,
        deltaClassName: comparisonMeta.deltaClassName,
        valueClassName: netResult >= 0 ? "text-sky-500" : "text-rose-500",
        barClassName: netResult >= 0 ? "bg-sky-500" : "bg-rose-400",
      });
    }

    return items;
  }, [comparisonCards, netResult, previousNetResult, selectedFilter]);

  const categorySections = useMemo(() => {
    const visibleTypes: LedgerEntryTypeValue[] =
      selectedFilter === "ALL" ? ["INCOME", "EXPENSE", "SAVING"] : [selectedFilter];

    const sections = visibleTypes.map((type) => {
      const items = buildAmountBreakdown(
        entries.filter((entry) => entry.type === type),
        (entry) => entry.categoryName ?? "미분류",
      );
      const meta = getTypeStatMeta(type);

      return {
        type,
        title: `${getTypeLabel(type)} 카테고리`,
        items,
        emptyMessage: `아직 ${getTypeLabel(type)} 카테고리 내역이 없습니다.`,
        centerLabel: getTypeLabel(type),
        ...meta,
      };
    });

    return selectedFilter === "ALL" ? sections.filter((section) => section.items.length > 0) : sections;
  }, [entries, selectedFilter]);

  const expenseEntries = useMemo(
    () => filteredEntries.filter((entry) => entry.type === "EXPENSE"),
    [filteredEntries],
  );

  const paymentStats = useMemo(
    () =>
      buildAmountBreakdown(expenseEntries, (entry) => getPaymentMethodLabel(entry.paymentMethod) || "미선택"),
    [expenseEntries],
  );
  const paymentMethodDetails = useMemo<PaymentMethodDetailItem[]>(() => {
    const grouped = new Map<string, { amount: number; sources: Map<string, number> }>();

    for (const entry of expenseEntries) {
      const methodLabel = getPaymentMethodLabel(entry.paymentMethod) || "미선택";
      const sourceLabel = entry.paymentSourceName?.trim() || "미분류";
      const current = grouped.get(methodLabel) ?? { amount: 0, sources: new Map<string, number>() };
      current.amount += entry.amount;
      current.sources.set(sourceLabel, (current.sources.get(sourceLabel) ?? 0) + entry.amount);
      grouped.set(methodLabel, current);
    }

    const totalAmount = Array.from(grouped.values()).reduce((sum, item) => sum + item.amount, 0);

    return Array.from(grouped.entries())
      .map(([label, value]) => ({
        label,
        amount: value.amount,
        percent: roundPercent(value.amount, totalAmount),
        sources: Array.from(value.sources.entries())
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ko"))
          .map(([sourceLabel, sourceAmount]) => ({
            label: sourceLabel,
            amount: sourceAmount,
            percent: roundPercent(sourceAmount, value.amount),
          })),
      }))
      .sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label, "ko"));
  }, [expenseEntries]);

  const dailyStats = useMemo(() => {
    const grouped = new Map<string, { income: number; expense: number; saving: number }>();

    for (const entry of filteredEntries) {
      const dateToken = entry.usedAt.slice(0, 10);
      const current = grouped.get(dateToken) ?? { income: 0, expense: 0, saving: 0 };
      if (entry.type === "INCOME") current.income += entry.amount;
      if (entry.type === "EXPENSE") current.expense += entry.amount;
      if (entry.type === "SAVING") current.saving += entry.amount;
      grouped.set(dateToken, current);
    }

    return Array.from(grouped.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([dateToken, values]) => ({
        dateToken,
        label: formatStatsDay(dateToken),
        income: values.income,
        expense: values.expense,
        saving: values.saving,
        netAmount: values.income - values.expense - values.saving,
        selectedAmount:
          selectedFilter === "INCOME"
            ? values.income
            : selectedFilter === "EXPENSE"
              ? values.expense
              : selectedFilter === "SAVING"
                ? values.saving
                : values.income + values.expense + values.saving,
      }));
  }, [filteredEntries, selectedFilter]);

  const selectedFilterLabel = selectedFilter === "ALL" ? "전체" : getTypeLabel(selectedFilter);
  const maxDailySelectedAmount = useMemo(
    () => dailyStats.reduce((max, item) => Math.max(max, item.selectedAmount), 0),
    [dailyStats],
  );
  const highlightDayCards = useMemo<HighlightDayCardItem[]>(() => {
    const dailyByType: Record<LedgerEntryTypeValue, Array<{ dateLabel: string; amount: number }>> = {
      INCOME: dailyStats.map((item) => ({ dateLabel: item.label, amount: item.income })),
      EXPENSE: dailyStats.map((item) => ({ dateLabel: item.label, amount: item.expense })),
      SAVING: dailyStats.map((item) => ({ dateLabel: item.label, amount: item.saving })),
    };

    const getTopItem = (type: LedgerEntryTypeValue) =>
      dailyByType[type]
        .filter((item) => item.amount > 0)
        .sort((left, right) => right.amount - left.amount)[0] ?? null;

    const buildItem = (
      title: string,
      type: LedgerEntryTypeValue,
      toneClassName: string,
      softBgClassName: string,
    ) => {
      const topItem = getTopItem(type);
      if (!topItem) {
        return null;
      }

      return {
        title,
        dateLabel: topItem.dateLabel,
        amount: topItem.amount,
        toneClassName,
        softBgClassName,
      };
    };

    if (selectedFilter === "INCOME") {
      return [buildItem("가장 많이 번 날", "INCOME", "text-sky-500", "bg-sky-50")].filter(
        Boolean,
      ) as HighlightDayCardItem[];
    }

    if (selectedFilter === "EXPENSE") {
      return [buildItem("가장 많이 쓴 날", "EXPENSE", "text-rose-500", "bg-rose-50")].filter(
        Boolean,
      ) as HighlightDayCardItem[];
    }

    if (selectedFilter === "SAVING") {
      return [buildItem("가장 많이 저축한 날", "SAVING", "text-emerald-600", "bg-emerald-50")].filter(
        Boolean,
      ) as HighlightDayCardItem[];
    }

    return [
      buildItem("가장 많이 번 날", "INCOME", "text-sky-500", "bg-sky-50"),
      buildItem("가장 많이 쓴 날", "EXPENSE", "text-rose-500", "bg-rose-50"),
      buildItem("가장 많이 저축한 날", "SAVING", "text-emerald-600", "bg-emerald-50"),
    ].filter(Boolean) as HighlightDayCardItem[];
  }, [dailyStats, selectedFilter]);
  const [statsTab, setStatsTab] = useState<StatsTabValue>("SUMMARY");
  const [categoryTab, setCategoryTab] = useState<LedgerEntryTypeValue>("EXPENSE");
  const [categoryChartView, setCategoryChartView] = useState<CategoryChartViewValue>("DONUT");
  const [tagTypeTab, setTagTypeTab] = useState<LedgerEntryTypeValue>("EXPENSE");
  const [selectedTagCategoryIds, setSelectedTagCategoryIds] = useState<number[]>([]);
  const activeCategorySection = useMemo(() => {
    if (selectedFilter !== "ALL") {
      return categorySections[0] ?? null;
    }

    return categorySections.find((section) => section.type === categoryTab) ?? categorySections[0] ?? null;
  }, [categorySections, categoryTab, selectedFilter]);
  const tagFocusType: LedgerEntryTypeValue = selectedFilter === "ALL" ? tagTypeTab : selectedFilter;
  const tagCategoryOptions = useMemo(() => {
    const grouped = new Map<number, string>();

    for (const entry of entries) {
      if (entry.type !== tagFocusType || entry.categoryId === null || !entry.categoryName) {
        continue;
      }

      grouped.set(entry.categoryId, entry.categoryName);
    }

    return Array.from(grouped.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "ko"));
  }, [entries, tagFocusType]);
  const effectiveSelectedTagCategoryIds = useMemo(
    () => selectedTagCategoryIds.filter((id) => tagCategoryOptions.some((category) => category.id === id)),
    [selectedTagCategoryIds, tagCategoryOptions],
  );
  const tagEntries = useMemo(() => {
    const baseEntries = entries.filter((entry) => entry.type === tagFocusType);

    if (effectiveSelectedTagCategoryIds.length === 0) {
      return baseEntries;
    }

    const selectedIdSet = new Set(effectiveSelectedTagCategoryIds);
    return baseEntries.filter((entry) => entry.categoryId !== null && selectedIdSet.has(entry.categoryId));
  }, [effectiveSelectedTagCategoryIds, entries, tagFocusType]);
  const toggleTagCategoryFilter = (categoryId: number) => {
    setSelectedTagCategoryIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId],
    );
  };
  const tagStats = useMemo(() => {
    const grouped = new Map<string, { count: number; linkedAmount: number }>();

    for (const entry of tagEntries) {
      for (const tagName of entry.tagNames) {
        const current = grouped.get(tagName) ?? { count: 0, linkedAmount: 0 };
        current.count += 1;
        current.linkedAmount += entry.amount;
        grouped.set(tagName, current);
      }
    }

    const totalCount = Array.from(grouped.values()).reduce((sum, item) => sum + item.count, 0);

    return Array.from(grouped.entries())
      .map(([label, value]) => ({
        label,
        count: value.count,
        linkedAmount: value.linkedAmount,
        percent: roundPercent(value.count, totalCount),
      }))
      .sort((left, right) => right.count - left.count || right.linkedAmount - left.linkedAmount);
  }, [tagEntries]);
  const categoryBudgetSections = useMemo(() => {
    const totalsByType = new Map<LedgerEntryTypeValue, Map<number, CategoryBudgetUsageItem>>();

    for (const period of budgetPeriods) {
      const periodStartAt = new Date(period.periodStartAt);
      const periodEndAt = new Date(period.periodEndAt);
      const overlapDays = getOverlapDayCount(periodStart, periodEnd, periodStartAt, periodEndAt);
      if (overlapDays <= 0) {
        continue;
      }

      const overlapRatio = overlapDays / Math.max(getBudgetPeriodDayCount(period), 1);
      for (const plan of period.plans) {
        let sectionMap = totalsByType.get(plan.type);
        if (!sectionMap) {
          sectionMap = new Map();
          totalsByType.set(plan.type, sectionMap);
        }

        for (const allocation of plan.allocations) {
          const current = sectionMap.get(allocation.categoryId) ?? {
            label: allocation.categoryName,
            plannedAmount: 0,
            actualAmount: 0,
            remainingAmount: 0,
            progressRaw: 0,
            progressValue: 0,
            isFixed: allocation.isFixed,
          };
          current.plannedAmount += allocation.plannedAmount * overlapRatio;
          current.isFixed = current.isFixed || allocation.isFixed;
          sectionMap.set(allocation.categoryId, current);
        }
      }
    }

    for (const entry of entries) {
      if (!entry.categoryId) {
        continue;
      }

      const sectionMap = totalsByType.get(entry.type);
      if (!sectionMap) {
        continue;
      }

      const current = sectionMap.get(entry.categoryId);
      if (!current) {
        continue;
      }

      current.actualAmount += entry.amount;
    }

    const visibleTypes: LedgerEntryTypeValue[] =
      selectedFilter === "ALL" ? ["INCOME", "EXPENSE", "SAVING"] : [selectedFilter];

    return visibleTypes.map((type) => {
      const sectionMap = totalsByType.get(type) ?? new Map<number, CategoryBudgetUsageItem>();
      const items = Array.from(sectionMap.values())
        .map((item) => {
          const plannedAmount = Math.round(item.plannedAmount);
          const actualAmount = Math.round(item.actualAmount);
          const remainingAmount = plannedAmount - actualAmount;
          const progressRaw = plannedAmount > 0 ? Math.round((actualAmount / plannedAmount) * 100) : 0;

          return {
            ...item,
            plannedAmount,
            actualAmount,
            remainingAmount,
            progressRaw,
            progressValue: clampPercent(progressRaw),
          };
        })
        .sort((left, right) => right.plannedAmount - left.plannedAmount || right.actualAmount - left.actualAmount);

      const fixedSummary = items.reduce(
        (acc, item) => {
          if (item.isFixed) {
            acc.fixedPlanned += item.plannedAmount;
            acc.fixedActual += item.actualAmount;
          } else {
            acc.variablePlanned += item.plannedAmount;
            acc.variableActual += item.actualAmount;
          }
          return acc;
        },
        { fixedPlanned: 0, fixedActual: 0, variablePlanned: 0, variableActual: 0 },
      );

      return {
        type,
        items,
        fixedSummary,
      };
    });
  }, [budgetPeriods, entries, periodEnd, periodStart, selectedFilter]);
  const activeCategoryBudgetSection = useMemo(() => {
    if (selectedFilter !== "ALL") {
      return categoryBudgetSections[0] ?? null;
    }

    return categoryBudgetSections.find((section) => section.type === categoryTab) ?? categoryBudgetSections[0] ?? null;
  }, [categoryBudgetSections, categoryTab, selectedFilter]);
  const weeklyStats = useMemo(() => {
    const ranges = getMonthWeekRanges(periodStart, periodEnd, weekStartDay);

    return ranges
      .map((range) => {
        let income = 0;
        let expense = 0;
        let saving = 0;

        for (const entry of filteredEntries) {
          const usedAt = new Date(entry.usedAt);
          if (usedAt < range.start || usedAt >= range.end) {
            continue;
          }

          if (entry.type === "INCOME") income += entry.amount;
          if (entry.type === "EXPENSE") expense += entry.amount;
          if (entry.type === "SAVING") saving += entry.amount;
        }

        const selectedAmount =
          selectedFilter === "INCOME"
            ? income
            : selectedFilter === "EXPENSE"
              ? expense
              : selectedFilter === "SAVING"
                ? saving
                : income + expense + saving;

        return {
          label: range.label,
          rangeLabel: formatWeekRangeLabel(range.start, new Date(range.end.getTime() - 1000 * 60 * 60 * 24)),
          income,
          expense,
          saving,
          selectedAmount,
        };
      })
      .filter((item) => item.income > 0 || item.expense > 0 || item.saving > 0);
  }, [filteredEntries, periodEnd, periodStart, selectedFilter, weekStartDay]);
  const maxWeeklySelectedAmount = useMemo(
    () => weeklyStats.reduce((max, item) => Math.max(max, item.selectedAmount), 0),
    [weeklyStats],
  );
  const riskyCategoryItems = useMemo(() => {
    if (!activeCategoryBudgetSection) {
      return [];
    }

    const items = activeCategoryBudgetSection.items.filter((item) => item.plannedAmount > 0);
    if (activeCategoryBudgetSection.type === "EXPENSE") {
      return items
        .filter((item) => item.progressRaw >= 80 || item.remainingAmount <= 0)
        .sort((left, right) => left.remainingAmount - right.remainingAmount || right.progressRaw - left.progressRaw)
        .slice(0, 5);
    }

    return items
      .filter((item) => item.progressRaw < 100)
      .sort((left, right) => right.remainingAmount - left.remainingAmount || left.progressRaw - right.progressRaw)
      .slice(0, 5);
  }, [activeCategoryBudgetSection]);
  const monthlyGoalFocusType: LedgerEntryTypeValue = selectedFilter === "ALL" ? categoryTab : selectedFilter;
  const activeMonthlyGoalBudgetCard = useMemo(
    () => budgetCards.find((card) => card.type === monthlyGoalFocusType) ?? null,
    [budgetCards, monthlyGoalFocusType],
  );
  const monthlyGoalStats = useMemo(() => {
    const meta = getTypeStatMeta(monthlyGoalFocusType);
    const activeSection =
      selectedFilter === "ALL"
        ? categoryBudgetSections.find((section) => section.type === monthlyGoalFocusType) ?? null
        : categoryBudgetSections[0] ?? null;

    if (!activeSection) {
      return [];
    }

    return [
      {
        label: `${getTypeLabel(monthlyGoalFocusType)} 카테고리`,
        rangeLabel: statsRangeLabel,
        overallTarget: activeMonthlyGoalBudgetCard?.target ?? 0,
        summaryRates: buildAmountBreakdown(
          entries.filter((entry) => entry.type === monthlyGoalFocusType),
          (entry) => entry.categoryName ?? "미분류",
        )
          .filter((item) => item.amount > 0)
          .map((item) => ({
            id: item.label,
            label: item.label,
            actual: item.amount,
            labelClassName: meta.labelClass,
          })),
        rates: (() => {
          const usageByLabel = new Map(
            buildAmountBreakdown(
              entries.filter((entry) => entry.type === monthlyGoalFocusType),
              (entry) => entry.categoryName ?? "미분류",
            ).map((item) => [item.label, item.amount] as const),
          );

          const rateMap = new Map<string, WeeklyGoalRateItem>();

          for (const item of activeSection.items) {
            rateMap.set(item.label, {
              id: item.label,
              type: monthlyGoalFocusType,
              label: item.label,
              actual: item.actualAmount,
              target: item.plannedAmount,
              progressRaw: item.progressRaw,
              progressValue: item.progressValue,
              gapAmount: item.remainingAmount,
              labelClassName: meta.labelClass,
              barClassName: meta.barClassName,
            });
          }

          for (const [label, actualAmount] of usageByLabel.entries()) {
            if (rateMap.has(label)) {
              continue;
            }

            rateMap.set(label, {
              id: label,
              type: monthlyGoalFocusType,
              label,
              actual: actualAmount,
              target: 0,
              progressRaw: 0,
              progressValue: 0,
              gapAmount: -actualAmount,
              labelClassName: meta.labelClass,
              barClassName: meta.barClassName,
            });
          }

          return Array.from(rateMap.values())
            .filter((item) => item.target > 0 || item.actual > 0)
            .sort((left, right) => right.actual - left.actual || right.target - left.target);
        })(),
      },
    ];
  }, [activeMonthlyGoalBudgetCard?.target, categoryBudgetSections, entries, monthlyGoalFocusType, selectedFilter, statsRangeLabel]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b bg-white px-2 py-3">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
            <Link to={buildLedgerMonthLink(monthToken, selectedFilter)}>
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>

          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
              <Link to={buildLedgerStatsLink(prevMonthToken, selectedFilter)}>
                <ChevronLeft className="h-6 w-6" />
              </Link>
            </Button>
            <div className="min-w-[9rem] text-center">
              <h1 className="text-[0.96rem] font-semibold text-slate-900">통계</h1>
              <p className="text-[0.74rem] text-slate-500">{statsRangeLabel}</p>
            </div>
            <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
              <Link to={buildLedgerStatsLink(nextMonthToken, selectedFilter)}>
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
                <Link to={buildLedgerMonthLink(monthToken, selectedFilter)}>달력으로</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={buildLedgerListLink(monthToken, selectedFilter)} reloadDocument>
                  월 리스트 보기
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={buildLedgerWeekListLink(monthToken, selectedFilter)} reloadDocument>
                  주별 리스트 보기
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/ledger/settings">설정</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={buildLedgerBudgetLink(monthToken, selectedFilter)}>이 달 예산 수정</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={buildLedgerDateLink(todayDateToken, todayMonthToken, selectedFilter)}>오늘 내역</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-3 border-b bg-white">
        <Link
          to={buildLedgerStatsLink(monthToken, toggleEntryFilter(selectedFilter, "INCOME"))}
          className={cn("py-3 text-center transition-colors", selectedFilter === "INCOME" ? "bg-sky-50" : "hover:bg-slate-50")}
        >
          <p className="text-[0.82rem] font-medium text-slate-900">수입</p>
          <p className="mt-1 text-[0.92rem] font-semibold text-sky-500">{formatLedgerAmount(summary.income)}</p>
        </Link>
        <Link
          to={buildLedgerStatsLink(monthToken, toggleEntryFilter(selectedFilter, "EXPENSE"))}
          className={cn("py-3 text-center transition-colors", selectedFilter === "EXPENSE" ? "bg-rose-50" : "hover:bg-slate-50")}
        >
          <p className="text-[0.82rem] font-medium text-slate-900">지출</p>
          <p className="mt-1 text-[0.92rem] font-semibold text-rose-500">{formatLedgerAmount(summary.expense)}</p>
        </Link>
        <Link
          to={buildLedgerStatsLink(monthToken, toggleEntryFilter(selectedFilter, "SAVING"))}
          className={cn("py-3 text-center transition-colors", selectedFilter === "SAVING" ? "bg-emerald-50" : "hover:bg-slate-50")}
        >
          <p className="text-[0.82rem] font-medium text-slate-900">저축</p>
          <p className="mt-1 text-[0.92rem] font-semibold text-emerald-600">{formatLedgerAmount(summary.saving)}</p>
        </Link>
      </div>

      <div className="space-y-4 px-4 py-4 pb-8">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.82rem] font-medium text-slate-900">{selectedFilterLabel} 기준</p>
              <p className="mt-1 text-[0.72rem] text-slate-500">{filteredEntries.length}건의 내역을 보고 있어요.</p>
            </div>
            {selectedFilter !== "ALL" ? (
              <Link
                to={buildLedgerStatsLink(monthToken, "ALL")}
                className="rounded-full border border-slate-200 px-3 py-1 text-[0.72rem] font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                전체 보기
              </Link>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-3 overflow-hidden rounded-xl bg-slate-100 p-1">
          {([
            { id: "SUMMARY", label: "요약" },
            { id: "ANALYSIS", label: "분석" },
            { id: "FLOW", label: "흐름" },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatsTab(tab.id)}
              className={cn(
                "rounded-lg px-2 py-2 text-[0.78rem] font-medium transition-colors",
                statsTab === tab.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {statsTab === "SUMMARY" ? (
          <>
            <StatSection title="예산 진행">
              <div className="grid gap-3 md:grid-cols-3">
                {visibleBudgetCards.map((card) => (
                  <BudgetRingCard
                    key={card.type}
                    label={card.meta.label}
                    actual={card.actual}
                    target={card.target}
                    progressValue={card.progressValue}
                    progressRaw={card.progressRaw}
                    remaining={card.remaining}
                    hasTarget={card.hasTarget}
                    type={card.type}
                  />
                ))}
              </div>

              <div className="mt-3 rounded-xl bg-slate-50 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.78rem] font-medium text-slate-700">실제 남은 돈</p>
                    <p className="mt-1 text-[0.68rem] text-slate-400">{shortMonthLabel}</p>
                    <p className="mt-0.5 text-[0.68rem] text-slate-400">수입 - 지출 - 저축</p>
                  </div>
                  <p className={cn("text-[0.88rem] font-semibold", netResult >= 0 ? "text-sky-500" : "text-rose-500")}>
                    {formatLedgerAmount(netResult)}
                  </p>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.72rem] text-slate-400">{budgetPlanStatus.label}</p>
                    <p className="mt-0.5 text-[0.66rem] text-slate-300">수입 목표 - 지출 예산 - 저축 목표</p>
                  </div>
                  <p className={cn("text-[0.78rem] font-medium", budgetPlanStatus.amountClassName)}>{budgetPlanStatus.amountLabel}</p>
                </div>
              </div>
            </StatSection>

            {(selectedFilter === "ALL" || selectedFilter === "EXPENSE") ? (
              <StatSection title="지출 운영 예산">
                {!isCurrentMonth ? (
                  <EmptyState message="이번 달 통계에서만 확인할 수 있어요." />
                ) : !currentExpenseBudgetCards ? (
                  <EmptyState message="지출 예산이 아직 설정되지 않았어요." />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {[currentExpenseBudgetCards.week, currentExpenseBudgetCards.day].map((item) => {
                      const isOver = item.amount < 0;

                      return (
                        <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[0.76rem] font-medium text-slate-700">{item.label}</p>
                          <p className={cn("mt-1 text-[0.88rem] font-semibold", isOver ? "text-rose-500" : "text-slate-900")}>
                            {isOver ? `-${formatLedgerAmount(Math.abs(item.amount))}` : formatLedgerAmount(item.amount)}
                          </p>
                          <p className="mt-1 text-[0.68rem] text-slate-400">기준 {formatLedgerAmount(item.target)}</p>
                          <p className="mt-1 text-[0.68rem] text-slate-400">{item.meta}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </StatSection>
            ) : null}

            <StatSection title="전월 대비 증감" description={`${prevShortMonthLabel}과 비교했어요.`}>
              <ComparisonGraphList items={comparisonGraphItems} previousLabel={prevShortMonthLabel} currentLabel={shortMonthLabel} />
            </StatSection>
          </>
        ) : null}

        {statsTab === "ANALYSIS" ? (
          <>
            <StatSection title="카테고리별">
              {selectedFilter === "ALL" && categorySections.length > 0 ? (
                <div className="mb-4 grid grid-cols-3 overflow-hidden rounded-xl bg-slate-100 p-1">
                  {(["INCOME", "EXPENSE", "SAVING"] as LedgerEntryTypeValue[]).map((type) => {
                    const isActive = categoryTab === type;
                    const meta = getTypeStatMeta(type);

                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setCategoryTab(type)}
                        className={cn(
                          "rounded-lg px-2 py-2 text-[0.78rem] font-medium transition-colors",
                          isActive ? `bg-white shadow-sm ${meta.labelClass}` : "text-slate-500",
                        )}
                      >
                        {getTypeLabel(type)}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {!activeCategorySection ? (
                <EmptyState message="아직 집계된 카테고리 내역이 없습니다." />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className={cn("text-[0.78rem] font-semibold", activeCategorySection.labelClass)}>{activeCategorySection.title}</h3>
                    <p className="text-[0.72rem] text-slate-400">{activeCategorySection.items.length}개 카테고리</p>
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setCategoryChartView((current) => (current === "DONUT" ? "BAR" : "DONUT"))}
                      className="absolute left-0 top-0 z-10 rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[0.64rem] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                    >
                      {categoryChartView === "DONUT" ? "막대그래프로 보기" : "원형그래프로 보기"}
                    </button>

                    {categoryChartView === "DONUT" ? (
                      <BreakdownDonutCard items={activeCategorySection.items} tone="category" centerLabel={activeCategorySection.centerLabel} />
                    ) : (
                      <div className="pt-8">
                        <AmountStatList
                          items={activeCategorySection.items}
                          emptyMessage={activeCategorySection.emptyMessage}
                          barClassName={activeCategorySection.barClassName}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </StatSection>

            <StatSection title="카테고리 예산 사용률">
              {!activeCategoryBudgetSection || activeCategoryBudgetSection.items.length === 0 ? (
                <EmptyState message="설정된 카테고리 예산이 없습니다." />
              ) : (
                <div className="space-y-3">
                  {activeCategoryBudgetSection.items.map((item) => (
                    <div key={item.label} className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[0.76rem] font-medium text-slate-800">{item.label}</p>
                          <p className="mt-1 text-[0.72rem] text-slate-400">
                            {formatLedgerAmount(item.actualAmount)} / {formatLedgerAmount(item.plannedAmount)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={cn("text-[0.82rem] font-semibold", item.remainingAmount >= 0 ? "text-slate-800" : "text-rose-500")}>
                            {item.remainingAmount >= 0 ? formatLedgerAmount(item.remainingAmount) : `초과 ${formatLedgerAmount(Math.abs(item.remainingAmount))}`}
                          </p>
                          <p className="text-[0.72rem] text-slate-400">{item.progressRaw}%</p>
                        </div>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            item.progressRaw > 100 ? "bg-rose-400" : item.isFixed ? "bg-violet-500" : "bg-slate-600",
                          )}
                          style={{ width: `${getAmountBarWidth(item.progressValue)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </StatSection>

            {activeCategoryBudgetSection?.type === "EXPENSE" ? (
              <StatSection title="예산 위험 카테고리">
                <BudgetRiskList
                  type="EXPENSE"
                  items={riskyCategoryItems}
                  emptyMessage="지금은 위험한 지출 카테고리가 없습니다."
                />
              </StatSection>
            ) : null}

            {selectedFilter === "EXPENSE" && activeCategoryBudgetSection ? (
              <StatSection title="고정비 / 변동비">
                <FixedVariableCard
                  items={activeCategoryBudgetSection.items}
                  fixedPlanned={activeCategoryBudgetSection.fixedSummary.fixedPlanned}
                  fixedActual={activeCategoryBudgetSection.fixedSummary.fixedActual}
                  variablePlanned={activeCategoryBudgetSection.fixedSummary.variablePlanned}
                  variableActual={activeCategoryBudgetSection.fixedSummary.variableActual}
                />
              </StatSection>
            ) : null}

            {selectedFilter === "EXPENSE" ? (
              <StatSection
                title="결제수단별"
                description="현재 지출 내역만 기준으로 계산했어요."
              >
                <BreakdownDonutCard items={paymentStats} tone="payment" centerLabel="지출" />
                <PaymentMethodDetailList items={paymentMethodDetails} emptyMessage="아직 지출 결제수단 내역이 없습니다." />
              </StatSection>
            ) : null}

            <StatSection title="태그별 사용">
              {selectedFilter === "ALL" ? (
                <div className="mb-3 grid grid-cols-3 rounded-xl bg-slate-100 p-1">
                  {(["INCOME", "EXPENSE", "SAVING"] as const).map((type) => {
                    const isActive = tagFocusType === type;

                    return (
                      <button
                        key={type}
                        type="button"
                        className={cn(
                          "rounded-lg px-2 py-1.5 text-[0.74rem] font-medium transition-colors",
                          isActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
                        )}
                        onClick={() => setTagTypeTab(type)}
                      >
                        {getTypeLabel(type)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {tagCategoryOptions.length > 0 ? (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-medium transition-colors",
                      effectiveSelectedTagCategoryIds.length === 0
                        ? "border-slate-300 bg-slate-100 text-slate-700"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                    )}
                    onClick={() => setSelectedTagCategoryIds([])}
                  >
                    전체
                  </button>
                  {tagCategoryOptions.map((category) => {
                    const isSelected = effectiveSelectedTagCategoryIds.includes(category.id);

                    return (
                      <button
                        key={category.id}
                        type="button"
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-medium transition-colors",
                          isSelected
                            ? "border-slate-300 bg-slate-100 text-slate-700"
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                        )}
                        onClick={() => toggleTagCategoryFilter(category.id)}
                      >
                        {category.name}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <TagStatList
                items={tagStats}
                emptyMessage={
                  effectiveSelectedTagCategoryIds.length > 0
                    ? "선택한 카테고리에는 아직 태그가 달린 내역이 없습니다."
                    : "아직 태그가 달린 내역이 없습니다."
                }
              />
            </StatSection>

            <StatSection title="이번 달 포인트">
              <HighlightDayCardList items={highlightDayCards} emptyMessage="아직 비교할 만한 내역이 없습니다." />
            </StatSection>
          </>
        ) : null}

        {statsTab === "FLOW" ? (
          <>
            <StatSection title="월 목표 달성률">
              {selectedFilter === "ALL" ? (
                <div className="mb-3 grid grid-cols-3 rounded-xl bg-slate-100 p-1">
                  {(["INCOME", "EXPENSE", "SAVING"] as const).map((type) => {
                    const isActive = categoryTab === type;

                    return (
                      <button
                        key={type}
                        type="button"
                        className={cn(
                          "rounded-lg px-2 py-1.5 text-[0.74rem] font-medium transition-colors",
                          isActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
                        )}
                        onClick={() => setCategoryTab(type)}
                      >
                        {getTypeLabel(type)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <WeeklyGoalOverviewCard
                type={monthlyGoalFocusType}
                actual={activeMonthlyGoalBudgetCard?.actual ?? 0}
                target={activeMonthlyGoalBudgetCard?.target ?? 0}
                progressRaw={activeMonthlyGoalBudgetCard?.progressRaw ?? 0}
                remaining={activeMonthlyGoalBudgetCard?.remaining ?? 0}
              />
              <div className="mt-3">
                <WeeklyGoalCompactList items={monthlyGoalStats} emptyMessage="아직 월 목표를 계산할 예산이 없습니다." />
              </div>
            </StatSection>

            <StatSection title="주차별 흐름">
              {weeklyStats.length === 0 ? (
                <EmptyState message="아직 집계된 주차별 내역이 없습니다." />
              ) : selectedFilter === "ALL" ? (
                <div className="space-y-3">
                  {weeklyStats.map((item) => (
                    <div key={item.label} className="grid grid-cols-[6.6rem_1fr] gap-3 rounded-xl bg-slate-50 px-3 py-3">
                      <div>
                        <p className="text-[0.8rem] font-medium text-slate-700">{item.rangeLabel}</p>
                        <p className="mt-1 text-[0.64rem] text-slate-400">{item.label}</p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-right text-[0.72rem]">
                        <div>
                          <p className="text-slate-400">수입</p>
                          <p className="mt-1 text-[0.58rem] font-semibold text-sky-500">{item.income > 0 ? formatLedgerAmount(item.income) : "-"}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">지출</p>
                          <p className="mt-1 text-[0.58rem] font-semibold text-rose-500">{item.expense > 0 ? formatLedgerAmount(item.expense) : "-"}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">저축</p>
                          <p className="mt-1 text-[0.58rem] font-semibold text-emerald-600">{item.saving > 0 ? formatLedgerAmount(item.saving) : "-"}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {weeklyStats.map((item) => {
                    const percent = roundPercent(item.selectedAmount, maxWeeklySelectedAmount || item.selectedAmount || 1);
                    const amountClass =
                      selectedFilter === "INCOME" ? "text-sky-500" : selectedFilter === "EXPENSE" ? "text-rose-500" : "text-emerald-600";
                    const barClass =
                      selectedFilter === "INCOME" ? "bg-sky-500" : selectedFilter === "EXPENSE" ? "bg-rose-400" : "bg-emerald-600";

                    return (
                        <div key={item.label} className="rounded-xl bg-slate-50 px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[0.8rem] font-medium text-slate-700">{item.rangeLabel}</p>
                              <p className="mt-1 text-[0.64rem] text-slate-400">{item.label}</p>
                            </div>
                            <p className={cn("text-[0.58rem] font-semibold", amountClass)}>{formatLedgerAmount(item.selectedAmount)}</p>
                          </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                          <div className={cn("h-full rounded-full", barClass)} style={{ width: `${getAmountBarWidth(percent)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </StatSection>

            <StatSection title="일자별 흐름">
              {dailyStats.length === 0 ? (
                <EmptyState message="아직 집계된 일자별 내역이 없습니다." />
              ) : selectedFilter === "ALL" ? (
                <div className="space-y-3">
                  {dailyStats.map((item) => (
                    <div key={item.dateToken} className="grid grid-cols-[5.5rem_1fr] gap-3 rounded-xl bg-slate-50 px-3 py-3">
                      <div>
                        <Link to={buildLedgerDateLink(item.dateToken, monthToken, selectedFilter)} className="text-[0.82rem] font-medium text-slate-700">
                          {item.label}
                        </Link>
                        <p className={cn("mt-1 text-[0.64rem] font-medium", item.netAmount >= 0 ? "text-sky-500" : "text-rose-500")}>
                          {item.netAmount >= 0 ? formatLedgerAmount(item.netAmount) : `-${formatLedgerAmount(Math.abs(item.netAmount))}`}
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-right text-[0.72rem]">
                        <div>
                          <p className="text-slate-400">수입</p>
                          <p className="mt-1 text-[0.58rem] font-semibold text-sky-500">{item.income > 0 ? formatLedgerAmount(item.income) : "-"}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">지출</p>
                          <p className="mt-1 text-[0.58rem] font-semibold text-rose-500">{item.expense > 0 ? formatLedgerAmount(item.expense) : "-"}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">저축</p>
                          <p className="mt-1 text-[0.58rem] font-semibold text-emerald-600">{item.saving > 0 ? formatLedgerAmount(item.saving) : "-"}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {dailyStats.map((item) => {
                    const percent = roundPercent(item.selectedAmount, maxDailySelectedAmount || item.selectedAmount || 1);
                    const amountClass =
                      selectedFilter === "INCOME" ? "text-sky-500" : selectedFilter === "EXPENSE" ? "text-rose-500" : "text-emerald-600";
                    const barClass =
                      selectedFilter === "INCOME" ? "bg-sky-500" : selectedFilter === "EXPENSE" ? "bg-rose-400" : "bg-emerald-600";

                    return (
                      <Link key={item.dateToken} to={buildLedgerDateLink(item.dateToken, monthToken, selectedFilter)} className="block rounded-xl bg-slate-50 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[0.82rem] font-medium text-slate-700">{item.label}</p>
                            <p className={cn("mt-1 text-[0.64rem] font-medium", item.netAmount >= 0 ? "text-sky-500" : "text-rose-500")}>
                              결과 {item.netAmount >= 0 ? formatLedgerAmount(item.netAmount) : `-${formatLedgerAmount(Math.abs(item.netAmount))}`}
                            </p>
                          </div>
                          <p className={cn("text-[0.58rem] font-semibold", amountClass)}>{formatLedgerAmount(item.selectedAmount)}</p>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                          <div className={cn("h-full rounded-full", barClass)} style={{ width: `${getAmountBarWidth(percent)}%` }} />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </StatSection>
          </>
        ) : null}
      </div>
    </div>
  );
}

function StatSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <div className="mb-4">
        <h2 className="text-[0.92rem] font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-1 text-[0.72rem] text-slate-500">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function AmountStatList({
  items,
  emptyMessage,
  barClassName,
}: {
  items: AmountBreakdownItem[];
  emptyMessage: string;
  barClassName: string;
}) {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-[0.82rem] font-medium text-slate-800">{item.label}</p>
            <div className="shrink-0 text-right">
              <p className="text-[0.82rem] font-semibold text-slate-900">{formatLedgerAmount(item.amount)}</p>
              <p className="text-[0.72rem] text-slate-400">{item.percent}%</p>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={cn("h-full rounded-full", barClassName)} style={{ width: `${getAmountBarWidth(item.percent)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function getPaymentMethodTone(label: string) {
  if (label.includes("카드")) {
    return {
      cardClassName: "bg-sky-50",
      labelClassName: "text-sky-600",
      chipClassName: "text-sky-700",
      sourceStackClasses: ["bg-sky-300", "bg-sky-400", "bg-cyan-300", "bg-blue-300", "bg-indigo-300", "bg-slate-300"] as const,
    };
  }

  if (label.includes("계좌")) {
    return {
      cardClassName: "bg-violet-50",
      labelClassName: "text-violet-600",
      chipClassName: "text-violet-700",
      sourceStackClasses: ["bg-violet-300", "bg-violet-400", "bg-fuchsia-300", "bg-purple-300", "bg-indigo-300", "bg-slate-300"] as const,
    };
  }

  if (label.includes("현금")) {
    return {
      cardClassName: "bg-amber-50",
      labelClassName: "text-amber-600",
      chipClassName: "text-amber-700",
      sourceStackClasses: ["bg-amber-300", "bg-amber-400", "bg-orange-300", "bg-yellow-300", "bg-lime-300", "bg-slate-300"] as const,
    };
  }

  return {
    cardClassName: "bg-slate-50",
    labelClassName: "text-slate-700",
    chipClassName: "text-slate-700",
    sourceStackClasses: ["bg-slate-300", "bg-slate-400", "bg-zinc-300", "bg-stone-300", "bg-neutral-300", "bg-gray-300"] as const,
  };
}

function PaymentMethodDetailList({
  items,
  emptyMessage,
}: {
  items: PaymentMethodDetailItem[];
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const tone = getPaymentMethodTone(item.label);

        return (
        <div key={item.label} className={cn("space-y-2 rounded-xl px-3 py-3", tone.cardClassName)}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={cn("truncate text-[0.82rem] font-medium", tone.labelClassName)}>{item.label}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[0.82rem] font-semibold text-slate-900">{formatLedgerAmount(item.amount)}</p>
              <p className="text-[0.72rem] text-slate-400">{item.percent}%</p>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/70">
            <div
              className="flex h-full overflow-hidden rounded-full"
              style={{ width: `${item.percent}%` }}
              title={`${item.label} ${item.percent}%`}
            >
              {item.sources.map((source, index) => {
                if (source.percent <= 0) {
                  return null;
                }

                return (
                  <div
                    key={`${item.label}-${source.label}-bar`}
                    className={tone.sourceStackClasses[index % tone.sourceStackClasses.length]}
                    style={{ width: `${source.percent}%` }}
                    title={`${source.label} ${source.percent}%`}
                  />
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {item.sources.map((source, index) => (
              <div key={`${item.label}-${source.label}`} className="inline-flex items-center gap-1.5 text-[0.66rem]">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    tone.sourceStackClasses[index % tone.sourceStackClasses.length],
                  )}
                />
                <span className={cn("font-medium", tone.chipClassName)}>{source.label}</span>
                <span className="text-slate-400">{source.percent}%</span>
              </div>
            ))}
          </div>
        </div>
      )})}
    </div>
  );
}

function TagStatList({ items, emptyMessage }: { items: TagBreakdownItem[]; emptyMessage: string }) {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[0.82rem] font-medium text-slate-800">{item.label}</p>
              <p className="mt-1 text-[0.72rem] text-slate-400">연결 금액 {formatLedgerAmount(item.linkedAmount)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[0.82rem] font-semibold text-slate-900">{item.count}건</p>
              <p className="text-[0.72rem] text-slate-400">{item.percent}%</p>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${getAmountBarWidth(item.percent)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function HighlightDayCardList({
  items,
  emptyMessage,
}: {
  items: HighlightDayCardItem[];
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {items.map((item) => (
        <div key={item.title} className={cn("rounded-xl px-3 py-3", item.softBgClassName)}>
          <p className="text-[0.72rem] text-slate-500">{item.title}</p>
          <p className="mt-2 text-[0.9rem] font-semibold text-slate-900">{item.dateLabel}</p>
          <p className={cn("mt-1 text-[0.84rem] font-semibold", item.toneClassName)}>{formatLedgerAmount(item.amount)}</p>
        </div>
      ))}
    </div>
  );
}

function BudgetRiskList({
  type,
  items,
  emptyMessage,
}: {
  type: LedgerEntryTypeValue;
  items: CategoryBudgetUsageItem[];
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  const isExpense = type === "EXPENSE";

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const statusClassName = isExpense
          ? item.remainingAmount <= 0
            ? "text-rose-500"
            : "text-amber-500"
          : item.remainingAmount > 0
            ? "text-amber-500"
            : "text-emerald-600";
        const statusLabel = isExpense
          ? item.remainingAmount < 0
            ? `초과 ${formatLedgerAmount(Math.abs(item.remainingAmount))}`
            : `남은 ${formatLedgerAmount(item.remainingAmount)}`
          : item.remainingAmount > 0
            ? `부족 ${formatLedgerAmount(item.remainingAmount)}`
            : `초과 달성 ${formatLedgerAmount(Math.abs(item.remainingAmount))}`;

        return (
          <div key={item.label} className="rounded-xl bg-slate-50 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[0.76rem] font-medium text-slate-800">{item.label}</p>
                <p className="mt-1 text-[0.72rem] text-slate-400">
                  {formatLedgerAmount(item.actualAmount)} / {formatLedgerAmount(item.plannedAmount)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={cn("text-[0.82rem] font-semibold", statusClassName)}>{statusLabel}</p>
                <p className="text-[0.72rem] text-slate-400">{item.progressRaw}%</p>
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className={cn(
                  "h-full rounded-full",
                  isExpense ? (item.remainingAmount <= 0 ? "bg-rose-400" : "bg-amber-400") : item.remainingAmount > 0 ? "bg-amber-400" : "bg-emerald-500",
                )}
                style={{ width: `${getAmountBarWidth(item.progressValue)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeeklyGoalOverviewCard({
  type,
  actual,
  target,
  progressRaw,
  remaining,
}: {
  type: LedgerEntryTypeValue;
  actual: number;
  target: number;
  progressRaw: number;
  remaining: number;
}) {
  const meta = getBudgetMeta(type);
  const safeProgress = Math.max(0, progressRaw);
  const remainingPercent = target > 0 ? Math.max(0, 100 - safeProgress) : null;
  const summaryLabel =
    type === "EXPENSE"
      ? remaining >= 0
        ? `남은 ${formatLedgerAmount(remaining)}`
        : `초과 ${formatLedgerAmount(Math.abs(remaining))}`
      : remaining >= 0
        ? `남은 ${formatLedgerAmount(remaining)}`
        : `초과 ${formatLedgerAmount(Math.abs(remaining))}`;

  return (
    <div className={cn("rounded-xl border border-slate-200 px-3 py-3", meta.softBgClass)}>
      <p className="text-[0.78rem] font-medium text-slate-700">{meta.label}</p>
      <p className={cn("mt-1 text-[0.9rem] font-semibold", meta.colorClass)}>
        {formatLedgerAmount(actual)} / {formatLedgerAmount(target)}
      </p>
      <p className="mt-1 text-[0.72rem] text-slate-400">
        {type === "EXPENSE"
          ? `쓴 비율 ${safeProgress}%${remainingPercent !== null ? ` · 안 쓴 비율 ${remainingPercent}%` : ""}`
          : `달성률 ${safeProgress}%${remainingPercent !== null ? ` · 남은 비율 ${remainingPercent}%` : ""}`}{" "}
        · {summaryLabel}
      </p>
    </div>
  );
}

function WeeklyGoalCompactList({
  items,
  emptyMessage,
}: {
  items: Array<{
    label: string;
    rangeLabel: string;
    overallTarget: number;
    summaryRates: GoalSummaryShareItem[];
    rates: WeeklyGoalRateItem[];
  }>;
  emptyMessage: string;
}) {
  const visibleItems = items.filter((item) => item.rates.length > 0);
  const [openLabels, setOpenLabels] = useState<string[]>([]);
  if (visibleItems.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-2">
      {visibleItems.map((item) => {
        const isOpen = openLabels.includes(item.label);
        return (() => {
          const totalTarget = item.rates.reduce((sum, rate) => sum + rate.target, 0);
          const totalActual = item.rates.reduce((sum, rate) => sum + rate.actual, 0);
          const summaryActualTotal = item.summaryRates.reduce((sum, rate) => sum + rate.actual, 0);
          const summaryTarget = item.overallTarget > 0 ? item.overallTarget : totalTarget;
          const displayBase = Math.max(summaryTarget || summaryActualTotal, 1);

          return (
            <div key={item.label} className="rounded-xl bg-slate-50 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[0.8rem] font-medium text-slate-800">{item.rangeLabel}</p>
                    <p className="mt-1 text-[0.64rem] text-slate-400">{item.label}</p>
                  </div>
                <div className="shrink-0 text-right">
                  <p className="text-[0.72rem] text-slate-500">
                    {summaryTarget > 0
                      ? `${formatLedgerAmount(summaryActualTotal)} / ${formatLedgerAmount(summaryTarget)}`
                      : formatLedgerAmount(summaryActualTotal)}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenLabels((current) =>
                        current.includes(item.label) ? current.filter((label) => label !== item.label) : [...current, item.label],
                      )
                    }
                    className="mt-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[0.64rem] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  >
                    {isOpen ? "상세 닫기" : "상세보기"}
                  </button>
                </div>
              </div>

              <div className="mt-2 h-4 overflow-hidden rounded-full bg-slate-200">
                <div className="flex h-full w-full overflow-hidden rounded-full">
                  {item.summaryRates.map((rate, index) => {
                    const width = summaryActualTotal > 0 ? (rate.actual / displayBase) * 100 : 0;
                    if (width <= 0) {
                      return null;
                    }

                    return (
                      <div
                        key={rate.id}
                        className={cn("h-full", WEEKLY_STACK_BAR_CLASSES[index % WEEKLY_STACK_BAR_CLASSES.length])}
                        style={{ width: `${width}%` }}
                        title={`${rate.label} ${roundPercent(rate.actual, summaryTarget || 1)}%`}
                      />
                    );
                  })}
                </div>
              </div>

              {item.summaryRates.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.summaryRates.map((rate) => (
                    <span
                      key={rate.id}
                      className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[0.64rem] text-slate-600"
                    >
                      <span className={cn("font-medium", rate.labelClassName)}>{rate.label}</span>
                      <span className="ml-1 text-slate-500">
                        {summaryTarget > 0 ? `${roundPercent(rate.actual, summaryTarget)}%` : "-"}
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[0.66rem] text-slate-400">아직 사용한 카테고리가 없습니다.</p>
              )}

              {isOpen ? (
                <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
                  {item.rates.map((rate) => {
                    const gapLabel =
                      rate.type === "EXPENSE"
                        ? rate.gapAmount >= 0
                          ? `남은 ${formatLedgerAmount(rate.gapAmount)}`
                          : `초과 ${formatLedgerAmount(Math.abs(rate.gapAmount))}`
                        : rate.gapAmount >= 0
                          ? `남은 ${formatLedgerAmount(rate.gapAmount)}`
                          : `초과 ${formatLedgerAmount(Math.abs(rate.gapAmount))}`;

                    return (
                      <div key={rate.id} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className={cn("text-[0.74rem] font-medium", rate.labelClassName)}>{rate.label}</p>
                            <p className="mt-1 text-[0.68rem] text-slate-400">
                              {formatLedgerAmount(rate.actual)} / {formatLedgerAmount(rate.target)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[0.78rem] font-semibold text-slate-800">{rate.target > 0 ? `${rate.progressRaw}%` : "-"}</p>
                            <p className="text-[0.68rem] text-slate-400">{rate.target > 0 ? gapLabel : "목표 없음"}</p>
                          </div>
                        </div>
                        <div className="h-3.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className={cn("h-full rounded-full", rate.barClassName)}
                            style={{ width: `${getAmountBarWidth(rate.progressValue)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })();
      })}
    </div>
  );
}

function WeeklyGoalList({
  items,
  emptyMessage,
}: {
  items: Array<{
    label: string;
    rangeLabel: string;
    rates: WeeklyGoalRateItem[];
  }>;
  emptyMessage: string;
}) {
  const visibleItems = items.filter((item) => item.rates.length > 0);
  if (visibleItems.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-3">
      {visibleItems.map((item) => (
        <div key={item.label} className="rounded-xl bg-slate-50 px-3 py-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[0.82rem] font-medium text-slate-800">{item.label}</p>
            <p className="text-[0.68rem] text-slate-400">{item.rangeLabel}</p>
          </div>

          <div className="space-y-3">
            {item.rates.map((rate) => {
              const gapLabel =
                rate.type === "EXPENSE"
                  ? rate.gapAmount >= 0
                    ? `남은 ${formatLedgerAmount(rate.gapAmount)}`
                    : `초과 ${formatLedgerAmount(Math.abs(rate.gapAmount))}`
                  : rate.gapAmount >= 0
                    ? `남은 ${formatLedgerAmount(rate.gapAmount)}`
                    : `초과 ${formatLedgerAmount(Math.abs(rate.gapAmount))}`;

              return (
                <div key={rate.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className={cn("text-[0.8rem] font-medium", rate.labelClassName)}>{rate.label}</p>
                      <p className="mt-1 text-[0.68rem] text-slate-400">
                        {formatLedgerAmount(rate.actual)} / {formatLedgerAmount(rate.target)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[0.78rem] font-semibold text-slate-800">{rate.progressRaw}%</p>
                      <p className="text-[0.68rem] text-slate-400">{gapLabel}</p>
                    </div>
                  </div>
                  <div className="h-3.5 overflow-hidden rounded-full bg-slate-200">
                    <div className={cn("h-full rounded-full", rate.barClassName)} style={{ width: `${getAmountBarWidth(rate.progressValue)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="rounded-xl bg-slate-50 px-3 py-6 text-center text-[0.82rem] text-slate-500">{message}</div>;
}

function FixedVariableCard({
  items,
  fixedPlanned,
  fixedActual,
  variablePlanned,
  variableActual,
}: {
  items: CategoryBudgetUsageItem[];
  fixedPlanned: number;
  fixedActual: number;
  variablePlanned: number;
  variableActual: number;
}) {
  const [tab, setTab] = useState<"FIXED" | "VARIABLE">("FIXED");
  const fixedItems = items.filter((item) => item.isFixed);
  const variableItems = items.filter((item) => !item.isFixed);
  const activeGroup =
    tab === "FIXED"
      ? {
          label: "고정비",
          planned: fixedPlanned,
          actual: fixedActual,
          softBgClassName: "bg-violet-50",
          textClassName: "text-violet-600",
          categories: fixedItems,
        }
      : {
          label: "변동비",
          planned: variablePlanned,
          actual: variableActual,
          softBgClassName: "bg-slate-50",
          textClassName: "text-slate-700",
          categories: variableItems,
        };
  const categoryBreakdown = activeGroup.categories
    .filter((category) => category.actualAmount > 0)
    .slice()
    .sort((left, right) => right.actualAmount - left.actualAmount || right.plannedAmount - left.plannedAmount);
  const donutItems = categoryBreakdown.map((category) => ({
    label: category.label,
    amount: category.actualAmount,
    percent: roundPercent(category.actualAmount, activeGroup.actual),
  }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setTab("FIXED")}
          className={cn(
            "rounded-lg px-2 py-2 text-[0.74rem] font-medium transition-colors",
            tab === "FIXED" ? "bg-white text-violet-600 shadow-sm" : "text-slate-500",
          )}
        >
          고정비
        </button>
        <button
          type="button"
          onClick={() => setTab("VARIABLE")}
          className={cn(
            "rounded-lg px-2 py-2 text-[0.74rem] font-medium transition-colors",
            tab === "VARIABLE" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500",
          )}
        >
          변동비
        </button>
      </div>

      <div className={cn("rounded-xl px-3 py-3", activeGroup.softBgClassName)}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={cn("text-[0.82rem] font-medium", activeGroup.textClassName)}>{activeGroup.label}</p>
            <p className="mt-1 text-[0.72rem] text-slate-400">
              예산 {formatLedgerAmount(activeGroup.planned)} · 사용 {formatLedgerAmount(activeGroup.actual)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[0.82rem] font-semibold text-slate-900">{formatLedgerAmount(activeGroup.actual)}</p>
            <p className="text-[0.72rem] text-slate-400">{roundPercent(activeGroup.actual, activeGroup.planned || activeGroup.actual || 1)}%</p>
          </div>
        </div>

        <div className="mt-3">
          <BreakdownDonutCard
            items={donutItems}
            tone="category"
            centerLabel={activeGroup.label}
          />
        </div>

        <div className="mt-3 space-y-1.5">
          {categoryBreakdown.length > 0 ? (
            categoryBreakdown.map((category) => (
              <div
                key={`${tab}-${category.label}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/70 bg-white/90 px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[0.68rem] font-medium text-slate-700">{category.label}</p>
                  <p className="mt-0.5 text-[0.62rem] text-slate-400">
                    예산 {formatLedgerAmount(category.plannedAmount)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[0.68rem] font-semibold text-slate-700">{formatLedgerAmount(category.actualAmount)}</p>
                  <p className="text-[0.62rem] text-slate-400">
                    {roundPercent(category.actualAmount, activeGroup.actual || 1)}%
                  </p>
                </div>
              </div>
            ))
          ) : (
            <span className="text-[0.66rem] text-slate-400">아직 사용한 카테고리가 없습니다.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ComparisonGraphList({
  items,
  previousLabel,
  currentLabel,
}: {
  items: Array<{
    label: string;
    current: number;
    previous: number;
    delta: number;
    deltaLabel: string;
    deltaClassName: string;
    valueClassName: string;
    barClassName: string;
  }>;
  previousLabel: string;
  currentLabel: string;
}) {
  const maxAmount = items.reduce((max, item) => Math.max(max, Math.abs(item.current), Math.abs(item.previous)), 0) || 1;

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const previousWidth = Math.max((Math.abs(item.previous) / maxAmount) * 100, item.previous === 0 ? 0 : 8);
        const currentWidth = Math.max((Math.abs(item.current) / maxAmount) * 100, item.current === 0 ? 0 : 8);

        return (
          <div key={item.label} className="rounded-xl bg-slate-50 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[0.82rem] font-medium text-slate-800">{item.label}</p>
              <div className="text-right">
                <p className={cn("text-[0.78rem] font-semibold", item.delta === 0 ? "text-slate-500" : item.deltaClassName)}>
                  {formatSignedLedgerAmount(item.delta)}
                </p>
                <p className="text-[0.68rem] text-slate-400">{item.deltaLabel}</p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-3">
                <p className="w-16 shrink-0 text-[0.68rem] text-slate-400">{previousLabel}</p>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-slate-400" style={{ width: `${previousWidth}%` }} />
                </div>
                <p className="w-24 shrink-0 text-right text-[0.72rem] font-medium text-slate-600">{formatComparisonAmount(item.previous)}</p>
              </div>

              <div className="flex items-center gap-3">
                <p className="w-16 shrink-0 text-[0.68rem] text-slate-400">{currentLabel}</p>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div className={cn("h-full rounded-full", item.barClassName)} style={{ width: `${currentWidth}%` }} />
                </div>
                <p className={cn("w-24 shrink-0 text-right text-[0.72rem] font-semibold", item.valueClassName)}>
                  {formatComparisonAmount(item.current)}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownDonutCard({
  items,
  tone,
  centerLabel,
}: {
  items: AmountBreakdownItem[];
  tone: DonutTone;
  centerLabel: string;
}) {
  if (items.length === 0) {
    return null;
  }

  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const donutItems = buildDonutBreakdown(items);
  const palette = getDonutPalette(tone);
  let currentPercent = 0;
  const gradientStops = donutItems
    .map((item, index) => {
      const start = currentPercent;
      currentPercent += item.percent;
      return `${palette[index % palette.length]} ${start}% ${currentPercent}%`;
    })
    .join(", ");

  return (
    <div className="mb-4 rounded-xl bg-slate-50 px-3 py-3">
      <div className="flex items-center gap-4">
        <div className="relative h-28 w-28 shrink-0">
          <div
            className="h-full w-full rounded-full"
            style={{
              background: gradientStops.length > 0 ? `conic-gradient(${gradientStops})` : "#e2e8f0",
            }}
          />
          <div className="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-white text-center">
            <p className="text-[0.68rem] text-slate-400">{centerLabel}</p>
            <p className="mt-1 text-[0.78rem] font-semibold text-slate-900">{formatLedgerAmount(totalAmount)}</p>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {donutItems.map((item, index) => (
            <div key={item.label} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: palette[index % palette.length] }}
                />
                <p className="truncate text-[0.78rem] font-medium text-slate-700">{item.label}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[0.78rem] font-semibold text-slate-900">{item.percent}%</p>
                <p className="text-[0.68rem] text-slate-400">{formatLedgerAmount(item.amount)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BudgetRingCard({
  label,
  actual,
  target,
  progressValue,
  progressRaw,
  remaining,
  hasTarget,
  type,
}: {
  label: string;
  actual: number;
  target: number;
  progressValue: number;
  progressRaw: number | null;
  remaining: number | null;
  hasTarget: boolean;
  type: LedgerEntryTypeValue;
}) {
  const meta = getBudgetMeta(type);
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference - (circumference * progressValue) / 100;
  const isExpenseOverBudget = type === "EXPENSE" && remaining !== null && remaining < 0;
  const progressLabel = type === "EXPENSE" ? "사용률" : "달성률";
  const remainingLabel =
    !hasTarget
      ? type === "EXPENSE"
        ? "예산 미설정"
        : "목표 미설정"
      : type === "EXPENSE"
        ? remaining! >= 0
          ? `남은 ${formatLedgerAmount(remaining!)}`
          : `초과 ${formatLedgerAmount(Math.abs(remaining!))}`
        : remaining! >= 0
          ? `남은 ${formatLedgerAmount(remaining!)}`
          : `초과 ${formatLedgerAmount(Math.abs(remaining!))}`;

  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200 px-3 py-3",
        meta.softBgClass,
        isExpenseOverBudget && "border-rose-300 bg-rose-100/70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.78rem] font-medium text-slate-700">{label}</p>
          <p className={cn("mt-1 text-[0.92rem] font-semibold", meta.colorClass)}>{formatLedgerAmount(actual)}</p>
          <p className="mt-1 text-[0.72rem] text-slate-500">{hasTarget ? `목표 ${formatLedgerAmount(target)}` : "목표 미설정"}</p>
          <p className="mt-1 text-[0.72rem] text-slate-400">{remainingLabel}</p>
          {isExpenseOverBudget ? (
            <p className="mt-1 text-[0.72rem] font-medium text-rose-600">예산을 초과했어요. 지출을 줄여보세요.</p>
          ) : null}
        </div>

        <div className="relative h-24 w-24 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              strokeWidth="10"
              className={cn("transition-colors", meta.trackClass)}
            />
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeOffset}
              className={cn("transition-all", meta.ringClass)}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <p className={cn("text-[0.88rem] font-semibold", isExpenseOverBudget ? "text-rose-600" : "text-slate-900")}>
              {progressRaw === null ? "-" : `${progressRaw}%`}
            </p>
            <p className={cn("text-[0.68rem]", isExpenseOverBudget ? "text-rose-500" : "text-slate-400")}>
              {progressRaw === null ? "목표 없음" : progressLabel}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
