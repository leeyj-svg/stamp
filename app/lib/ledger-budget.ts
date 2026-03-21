import type { LedgerEntryTypeValue } from "~/lib/ledger-entry";

export type LedgerPeriodBasisValue = "CALENDAR" | "PAYDAY";
export type LedgerBudgetTotals = Record<LedgerEntryTypeValue, number>;
export type LedgerWeekStartDayValue = "SUNDAY" | "MONDAY";
export type LedgerWeekCarryModeValue = "NONE" | "AUTO" | "MANUAL";

export const LEDGER_BUDGET_TYPE_ORDER: LedgerEntryTypeValue[] = ["EXPENSE", "INCOME", "SAVING"];
export const LEDGER_BUDGET_TEMPLATE_LABEL = "기본 예산 템플릿";

export function createEmptyBudgetTotals(): LedgerBudgetTotals {
  return {
    EXPENSE: 0,
    INCOME: 0,
    SAVING: 0,
  };
}

export function getBudgetSectionMeta(type: LedgerEntryTypeValue) {
  if (type === "EXPENSE") {
    return {
      totalLabel: "월 지출 예산",
      dailyLabel: "하루 지출 예산",
      saveErrorLabel: "지출 예산",
    };
  }

  if (type === "INCOME") {
    return {
      totalLabel: "월 수입 목표",
      dailyLabel: "하루 수입 목표",
      saveErrorLabel: "수입 목표",
    };
  }

  return {
    totalLabel: "월 저축 목표",
    dailyLabel: "하루 저축 목표",
    saveErrorLabel: "저축 목표",
  };
}

export function parseBudgetInput(value: string) {
  const normalized = value.replace(/[^\d]/g, "").trim();
  if (normalized === "") {
    return 0;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

export function formatBudgetInput(amount: number) {
  if (amount <= 0) {
    return "";
  }

  return `${Math.trunc(amount).toLocaleString("ko-KR")}원`;
}

export function getBudgetPeriodDayCount(period: {
  periodStartAt: Date | string;
  periodEndAt: Date | string;
}) {
  const start = new Date(period.periodStartAt);
  const end = new Date(period.periodEndAt);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

export function addLedgerDays(baseDate: Date, days: number) {
  const nextDate = new Date(baseDate);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

export function getStartOfBudgetWeek(date: Date, weekStartDay: LedgerWeekStartDayValue) {
  const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const currentDay = normalizedDate.getDay();
  const desiredStart = weekStartDay === "MONDAY" ? 1 : 0;
  const distance = (currentDay - desiredStart + 7) % 7;
  return addLedgerDays(normalizedDate, -distance);
}

export function getBudgetWeekRanges(
  periodStartAt: Date | string,
  periodEndAt: Date | string,
  weekStartDay: LedgerWeekStartDayValue,
) {
  const normalizedStart = new Date(periodStartAt);
  const normalizedEnd = new Date(periodEndAt);
  const ranges: Array<{ start: Date; end: Date }> = [];
  let cursor = getStartOfBudgetWeek(normalizedStart, weekStartDay);

  while (cursor < normalizedEnd) {
    const rangeStart = cursor < normalizedStart ? normalizedStart : cursor;
    const nextCursor = addLedgerDays(cursor, 7);
    const rangeEnd = nextCursor > normalizedEnd ? normalizedEnd : nextCursor;

    if (rangeStart < rangeEnd) {
      ranges.push({ start: rangeStart, end: rangeEnd });
    }

    cursor = nextCursor;
  }

  return ranges;
}

export function getBudgetScopeAmount(
  amount: number,
  scope: "MONTH" | "WEEK" | "DAY",
  dayCount: number,
  weekCount: number,
) {
  if (scope === "DAY") {
    return amount / Math.max(dayCount, 1);
  }

  if (scope === "WEEK") {
    return amount / Math.max(weekCount, 1);
  }

  return amount;
}

