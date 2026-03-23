import {
  addLedgerDays,
  getBudgetDisplayTotalAmount,
  getBudgetPeriodDayCount,
  getBudgetScopeAmount,
  getBudgetWeekRanges,
  getFixedExpenseCategoryIds,
  getStartOfBudgetWeek,
  type LedgerWeekCarryModeValue,
  type LedgerWeekStartDayValue,
} from "~/lib/ledger-budget";
import { getDateKey, type LedgerEntryTypeValue } from "~/lib/ledger-entry";

export type EntryFilterValue = "ALL" | LedgerEntryTypeValue;

export type LedgerListBudgetPeriodSummary = {
  id: number;
  periodStartAt: string;
  periodEndAt: string;
  plans: Array<{
    type: LedgerEntryTypeValue;
    totalAmount: number;
    weekCarryMode: LedgerWeekCarryModeValue;
    weeks: Array<{
      weekIndex: number;
      weekStartAt: string;
      weekEndAt: string;
      plannedAmount: number;
      carryInAmount: number;
      carryOutAmount: number;
    }>;
    allocations: Array<{
      categoryId: number;
      plannedAmount: number;
      isFixed: boolean;
    }>;
  }>;
};

export type LedgerListBudgetEntrySummary = {
  type: LedgerEntryTypeValue;
  amount: number;
  usedAt: string;
  excludeFromStats: boolean;
  categoryId: number | null;
};

export type LedgerWeeklyBudgetState = {
  startAt: string;
  endAt: string;
  displayDateToken: string;
  target: number;
  value: number;
  dayBudget: number;
};

function getBudgetDisplayAmount(type: LedgerEntryTypeValue, budgetAmount: number, actualAmount: number) {
  if (type === "EXPENSE") {
    return budgetAmount - actualAmount;
  }

  return actualAmount;
}

export function parseMonthToken(value: string | null) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

export function parseEntryFilter(value: string | null): EntryFilterValue {
  if (value === "INCOME" || value === "EXPENSE" || value === "SAVING") {
    return value;
  }

  return "ALL";
}

export function parseCurrentWeekBudgetView(value: string | null) {
  return value === "1";
}

export function parseCategoryId(value: string | null) {
  const categoryId = Number(value);
  return Number.isInteger(categoryId) && categoryId > 0 ? categoryId : null;
}

export function parseCategoryIds(searchParams: URLSearchParams) {
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

export function getMonthStart(monthToken: string) {
  const [year, month] = monthToken.split("-").map(Number);
  return new Date(year, month - 1, 1, 12, 0, 0, 0);
}

export function getMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
  }).format(date);
}

export function buildBudgetQuery(
  displayParam: string | null,
  showCurrentWeekBudget: boolean,
  selectedCategoryIds: number[] = [],
) {
  const params = new URLSearchParams();
  if (displayParam && displayParam.trim().length > 0) {
    params.set("display", displayParam);
  }

  if (showCurrentWeekBudget) {
    params.set("currentWeek", "1");
  }

  if (selectedCategoryIds.length > 0) {
    params.set("categoryIds", selectedCategoryIds.join(","));
  }

  return params.toString();
}

export function buildLedgerMonthLink(
  monthToken: string,
  filter: EntryFilterValue,
  displayParam: string | null,
  showCurrentWeekBudget: boolean,
  selectedCategoryIds: number[] = [],
) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  const budgetQuery = buildBudgetQuery(displayParam, showCurrentWeekBudget, selectedCategoryIds);
  if (budgetQuery) {
    for (const [key, value] of new URLSearchParams(budgetQuery)) {
      params.set(key, value);
    }
  }

  return `/ledger?${params.toString()}`;
}

export function buildLedgerDateLink(
  dateToken: string,
  monthToken: string,
  filter: EntryFilterValue,
  displayParam: string | null,
  showCurrentWeekBudget: boolean,
  selectedCategoryIds: number[] = [],
) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  const budgetQuery = buildBudgetQuery(displayParam, showCurrentWeekBudget, selectedCategoryIds);
  if (budgetQuery) {
    for (const [key, value] of new URLSearchParams(budgetQuery)) {
      params.set(key, value);
    }
  }

  return `/ledger/${dateToken}?${params.toString()}`;
}

export function buildLedgerListLink(
  monthToken: string,
  filter: EntryFilterValue,
  displayParam: string | null,
  showCurrentWeekBudget: boolean,
  selectedCategoryIds: number[] = [],
) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  const budgetQuery = buildBudgetQuery(displayParam, showCurrentWeekBudget, selectedCategoryIds);
  if (budgetQuery) {
    for (const [key, value] of new URLSearchParams(budgetQuery)) {
      params.set(key, value);
    }
  }

  return `/ledger/list?${params.toString()}`;
}

export function buildLedgerBudgetLink(monthToken: string, filter: EntryFilterValue) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  return `/ledger/budgets?${params.toString()}`;
}

export function buildLedgerWeekListLink(
  monthToken: string,
  filter: EntryFilterValue,
  displayParam: string | null,
  showCurrentWeekBudget: boolean,
  selectedCategoryIds: number[] = [],
) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  const budgetQuery = buildBudgetQuery(displayParam, showCurrentWeekBudget, selectedCategoryIds);
  if (budgetQuery) {
    for (const [key, value] of new URLSearchParams(budgetQuery)) {
      params.set(key, value);
    }
  }

  return `/ledger/weeks?${params.toString()}`;
}

export function toggleEntryFilter(currentFilter: EntryFilterValue, nextFilter: LedgerEntryTypeValue): EntryFilterValue {
  return currentFilter === nextFilter ? "ALL" : nextFilter;
}

export function formatEntryTimeLine(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function getCategoryChipClass(type: EntryFilterValue, selected: boolean) {
  if (!selected) {
    return "border-slate-200 bg-white text-slate-600 hover:bg-slate-50";
  }

  if (type === "EXPENSE") {
    return "border-rose-300 bg-rose-50 text-rose-500";
  }

  if (type === "INCOME") {
    return "border-sky-300 bg-sky-50 text-sky-500";
  }

  if (type === "SAVING") {
    return "border-emerald-300 bg-emerald-50 text-emerald-600";
  }

  return "border-slate-800 bg-slate-800 text-white";
}

export function getBudgetStatusLabel(type: LedgerEntryTypeValue, scope: "MONTH" | "WEEK") {
  if (type === "EXPENSE") {
    return scope === "MONTH" ? "남은 월 예산" : "이번 주 남은 예산";
  }

  if (type === "INCOME") {
    return scope === "MONTH" ? "월 달성 금액" : "이번 주 달성 금액";
  }

  return scope === "MONTH" ? "월 저축 금액" : "이번 주 저축 금액";
}

export function buildWeeklyBudgetStateByDate(params: {
  budgetPeriods: LedgerListBudgetPeriodSummary[];
  budgetFocusType: LedgerEntryTypeValue;
  budgetStatsEntries: LedgerListBudgetEntrySummary[];
  weekStartDay: LedgerWeekStartDayValue;
}) {
  const { budgetPeriods, budgetFocusType, budgetStatsEntries, weekStartDay } = params;
  const weeklyState = new Map<string, LedgerWeeklyBudgetState>();

  for (const period of budgetPeriods) {
    const plan = period.plans.find((item) => item.type === budgetFocusType);
    if (!plan || plan.totalAmount <= 0) {
      continue;
    }

    const displayTotalAmount = getBudgetDisplayTotalAmount(budgetFocusType, plan.totalAmount, plan.allocations);
    if (displayTotalAmount <= 0) {
      continue;
    }

    const periodStartAt = new Date(period.periodStartAt);
    const periodEndAt = new Date(period.periodEndAt);
    const weekRanges = getBudgetWeekRanges(periodStartAt, periodEndAt, weekStartDay);
    if (weekRanges.length === 0) {
      continue;
    }

    const dayCount = getBudgetPeriodDayCount(period);
    const dailyBudgetAmount = getBudgetScopeAmount(displayTotalAmount, "DAY", dayCount, 1);
    const weekRowByIndex = new Map(plan.weeks.map((week) => [week.weekIndex, week]));
    const fixedExpenseCategoryIds = budgetFocusType === "EXPENSE" ? getFixedExpenseCategoryIds(plan.allocations) : new Set<number>();
    let rollingCarry = 0;

    for (let index = 0; index < weekRanges.length; index += 1) {
      const weekIndex = index + 1;
      const range = weekRanges[index];
      const weekRow = weekRowByIndex.get(weekIndex);
      const rangeDayCount = Math.max(1, getBudgetPeriodDayCount({ periodStartAt: range.start, periodEndAt: range.end }));
      const fallbackPlannedAmount = Math.round(dailyBudgetAmount * rangeDayCount * 100) / 100;
      const plannedAmount = Number(weekRow?.plannedAmount ?? fallbackPlannedAmount);
      const spentAmount = budgetStatsEntries.reduce((sum, entry) => {
        const usedAt = new Date(entry.usedAt);
        if (usedAt < range.start || usedAt >= range.end) {
          return sum;
        }

        if (budgetFocusType === "EXPENSE" && entry.categoryId !== null && fixedExpenseCategoryIds.has(entry.categoryId)) {
          return sum;
        }

        return sum + entry.amount;
      }, 0);

      const carryInAmount =
        plan.weekCarryMode === "AUTO"
          ? rollingCarry
          : plan.weekCarryMode === "MANUAL"
            ? Number(weekRow?.carryInAmount ?? 0)
            : 0;
      const targetAmount = Math.round((plannedAmount + carryInAmount) * 100) / 100;
      const value = getBudgetDisplayAmount(budgetFocusType, targetAmount, spentAmount);
      const weekDayCount = Math.max(1, getBudgetPeriodDayCount({ periodStartAt: range.start, periodEndAt: range.end }));
      const displayDate = addLedgerDays(range.end, -1);

      weeklyState.set(getDateKey(range.start), {
        startAt: range.start.toISOString(),
        endAt: range.end.toISOString(),
        displayDateToken: getDateKey(displayDate),
        target: targetAmount,
        value,
        dayBudget: dailyBudgetAmount,
      });

      if (plan.weekCarryMode === "AUTO") {
        rollingCarry = Math.round((targetAmount - spentAmount) * 100) / 100;
      }
    }
  }

  return weeklyState;
}

export function buildPeriodRemainingBudget(params: {
  budgetPeriods: LedgerListBudgetPeriodSummary[];
  budgetFocusType: LedgerEntryTypeValue;
  budgetStatsEntries: LedgerListBudgetEntrySummary[];
  referenceDate: Date;
}) {
  const { budgetPeriods, budgetFocusType, budgetStatsEntries, referenceDate } = params;
  const matchingPeriod =
    budgetPeriods.find((period) => {
      const periodStartAt = new Date(period.periodStartAt);
      const periodEndAt = new Date(period.periodEndAt);
      return referenceDate >= periodStartAt && referenceDate < periodEndAt;
    }) ?? null;

  if (!matchingPeriod) {
    return null;
  }

  const matchingPlan = matchingPeriod.plans.find((plan) => plan.type === budgetFocusType);
  if (!matchingPlan || matchingPlan.totalAmount <= 0) {
    return null;
  }

  const displayTotalAmount = getBudgetDisplayTotalAmount(budgetFocusType, matchingPlan.totalAmount, matchingPlan.allocations);
  if (displayTotalAmount <= 0) {
    return null;
  }

  const periodStartAt = new Date(matchingPeriod.periodStartAt);
  const periodEndAt = new Date(matchingPeriod.periodEndAt);
  const fixedExpenseCategoryIds =
    budgetFocusType === "EXPENSE" ? getFixedExpenseCategoryIds(matchingPlan.allocations) : new Set<number>();
  const spentAmount = budgetStatsEntries.reduce((sum, entry) => {
    const usedAt = new Date(entry.usedAt);
    if (usedAt < periodStartAt || usedAt >= periodEndAt) {
      return sum;
    }

    if (budgetFocusType === "EXPENSE" && entry.categoryId !== null && fixedExpenseCategoryIds.has(entry.categoryId)) {
      return sum;
    }

    return sum + entry.amount;
  }, 0);

  return {
    target: displayTotalAmount,
    value: getBudgetDisplayAmount(budgetFocusType, displayTotalAmount, spentAmount),
    periodStartAt: matchingPeriod.periodStartAt,
    periodEndAt: matchingPeriod.periodEndAt,
  };
}

export function buildPeriodRemainingBudgetUntilDate(params: {
  budgetPeriods: LedgerListBudgetPeriodSummary[];
  budgetFocusType: LedgerEntryTypeValue;
  budgetStatsEntries: LedgerListBudgetEntrySummary[];
  referenceEnd: Date;
}) {
  const { budgetPeriods, budgetFocusType, budgetStatsEntries, referenceEnd } = params;
  const referencePoint = new Date(referenceEnd.getTime() - 1);
  const matchingPeriod =
    budgetPeriods.find((period) => {
      const periodStartAt = new Date(period.periodStartAt);
      const periodEndAt = new Date(period.periodEndAt);
      return referencePoint >= periodStartAt && referencePoint < periodEndAt;
    }) ?? null;

  if (!matchingPeriod) {
    return null;
  }

  const matchingPlan = matchingPeriod.plans.find((plan) => plan.type === budgetFocusType);
  if (!matchingPlan || matchingPlan.totalAmount <= 0) {
    return null;
  }

  const displayTotalAmount = getBudgetDisplayTotalAmount(budgetFocusType, matchingPlan.totalAmount, matchingPlan.allocations);
  if (displayTotalAmount <= 0) {
    return null;
  }

  const periodStartAt = new Date(matchingPeriod.periodStartAt);
  const periodEndAt = new Date(matchingPeriod.periodEndAt);
  const fixedExpenseCategoryIds =
    budgetFocusType === "EXPENSE" ? getFixedExpenseCategoryIds(matchingPlan.allocations) : new Set<number>();
  const actualAmount = budgetStatsEntries.reduce((sum, entry) => {
    const usedAt = new Date(entry.usedAt);
    if (usedAt < periodStartAt || usedAt >= periodEndAt || usedAt >= referenceEnd) {
      return sum;
    }

    if (budgetFocusType === "EXPENSE" && entry.categoryId !== null && fixedExpenseCategoryIds.has(entry.categoryId)) {
      return sum;
    }

    return sum + entry.amount;
  }, 0);

  return {
    target: displayTotalAmount,
    actualAmount,
    remainingAmount: Math.round((displayTotalAmount - actualAmount) * 100) / 100,
    periodStartAt: matchingPeriod.periodStartAt,
    periodEndAt: matchingPeriod.periodEndAt,
  };
}

export function getMonthWeekRanges(monthStart: Date, nextMonthStart: Date, weekStartDay: LedgerWeekStartDayValue) {
  const ranges: Array<{ start: Date; end: Date }> = [];
  let cursor = getStartOfBudgetWeek(monthStart, weekStartDay);

  while (cursor < nextMonthStart) {
    const rawStart = new Date(cursor);
    const rawEnd = addLedgerDays(cursor, 7);
    const start = rawStart < monthStart ? new Date(monthStart) : rawStart;
    const end = rawEnd > nextMonthStart ? new Date(nextMonthStart) : rawEnd;

    if (start < end) {
      ranges.push({ start, end });
    }

    cursor = rawEnd;
  }

  return ranges;
}

export function findWeeklyBudgetStateForRange(
  range: { start: Date; end: Date },
  weeklyBudgetStateByDate: Map<string, LedgerWeeklyBudgetState>,
) {
  for (const state of weeklyBudgetStateByDate.values()) {
    const stateStart = new Date(state.startAt);
    const stateEnd = new Date(state.endAt);
    if (stateStart < range.end && stateEnd > range.start) {
      return state;
    }
  }

  return null;
}
