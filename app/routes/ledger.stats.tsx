import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { useMemo, useState } from "react";
import { useFetcher, type ActionFunctionArgs, type ShouldRevalidateFunctionArgs } from "react-router";
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
import type {
  LedgerGeneralQuestionResult,
  LedgerGeneralQuestionSnapshot,
  LedgerAiAnalysisMode,
  LedgerAiSummaryResult,
  LedgerAiSummarySnapshot,
  LedgerPurchaseAdviceResult,
  LedgerPurchaseAdviceSnapshot,
} from "~/lib/ledger-ai";
import { generateLedgerGeneralQuestion, generateLedgerPurchaseAdvice, generateLedgerStatsSummary, hasGeminiApiKey } from "~/lib/gemini.server";
import { ensureLedgerSetup, getLedgerPeriodLabel, getLedgerReferenceDateForMonthToken, getMonthToken, shiftMonthToken } from "~/lib/ledger";
import { cn } from "~/lib/utils";

type EntryFilterValue = "ALL" | LedgerEntryTypeValue;
type StatsTabValue = "SUMMARY" | "ANALYSIS" | "FLOW";
type CategoryChartViewValue = "DONUT" | "BAR";
type WeekStartDayValue = "MONDAY" | "SUNDAY";
type LedgerStatsAiActionData = {
  requestKey: string;
  report?: LedgerAiSummarySnapshot;
  summary?: LedgerAiSummaryResult;
  error?: string;
  generatedAt?: string;
};
type LedgerPurchaseAdviceActionData = {
  requestKey: string;
  question?: string;
  snapshot?: LedgerPurchaseAdviceSnapshot;
  advice?: LedgerPurchaseAdviceResult;
  error?: string;
  generatedAt?: string;
};
type LedgerGeneralQuestionActionData = {
  requestKey: string;
  question?: string;
  snapshot?: LedgerGeneralQuestionSnapshot;
  answer?: LedgerGeneralQuestionResult;
  error?: string;
  generatedAt?: string;
};
type LedgerAiAnalysisModeOption = {
  id: LedgerAiAnalysisMode;
  label: string;
  description: string;
};
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
  linkedAmount: number;
  countPercent: number;
  amountPercent: number;
};

type TagMetricValue = "COUNT" | "AMOUNT";

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
type CategoryBudgetUsageSection = {
  type: LedgerEntryTypeValue;
  items: CategoryBudgetUsageItem[];
  fixedSummary: {
    fixedPlanned: number;
    fixedActual: number;
    variablePlanned: number;
    variableActual: number;
  };
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
const LEDGER_AI_SNAPSHOT_MAX_LENGTH = 20_000;
const LEDGER_AI_ANALYSIS_MODES: LedgerAiAnalysisModeOption[] = [
  {
    id: "OVERVIEW",
    label: "전체 진단",
    description: "기간 전체의 수입, 지출, 저축, 남은 돈과 특이한 날짜를 봐요.",
  },
  {
    id: "SAVING_POINTS",
    label: "절약 포인트",
    description: "지출을 줄일 수 있는 카테고리와 반복 소비를 찾아요.",
  },
  {
    id: "BUDGET_COMPARE",
    label: "예산 비교",
    description: "설정한 예산 대비 초과, 위험, 여유 카테고리를 점검해요.",
  },
  {
    id: "LIFE_PATTERN",
    label: "생활 패턴",
    description: "요일, 주말, 기간 초중후반 소비 흐름을 살펴봐요.",
  },
  {
    id: "CASH_FLOW",
    label: "저축/현금흐름",
    description: "수입 대비 지출, 저축률, 남은 돈 흐름을 확인해요.",
  },
  {
    id: "CATEGORY_REPORT",
    label: "카테고리 리포트",
    description: "카테고리별 우선순위와 유지/점검 포인트를 정리해요.",
  },
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

function parseLedgerAiAnalysisMode(value: FormDataEntryValue | string | null): LedgerAiAnalysisMode {
  if (typeof value === "string" && LEDGER_AI_ANALYSIS_MODES.some((mode) => mode.id === value)) {
    return value as LedgerAiAnalysisMode;
  }

  return "OVERVIEW";
}

function getLedgerAiAnalysisModeOption(mode: LedgerAiAnalysisMode) {
  return LEDGER_AI_ANALYSIS_MODES.find((option) => option.id === mode) ?? LEDGER_AI_ANALYSIS_MODES[0];
}

function buildLedgerAiRequestKey(monthToken: string, filter: EntryFilterValue, mode: LedgerAiAnalysisMode) {
  return `${monthToken}:${filter}:${mode}`;
}

function buildLedgerPurchaseAdviceRequestKey(monthToken: string, filter: EntryFilterValue, question: string) {
  return `${monthToken}:${filter}:${question.trim().toLowerCase()}`;
}

function buildLedgerGeneralQuestionRequestKey(monthToken: string, filter: EntryFilterValue, question: string) {
  return `${monthToken}:${filter}:general:${question.trim().toLowerCase()}`;
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

function getTagChipClass(type: LedgerEntryTypeValue, selected: boolean) {
  if (!selected) {
    return "border-slate-200 bg-white text-slate-500 hover:bg-slate-50";
  }

  if (type === "INCOME") {
    return "border-sky-300 bg-sky-50 text-sky-600";
  }

  if (type === "EXPENSE") {
    return "border-rose-300 bg-rose-50 text-rose-500";
  }

  return "border-emerald-300 bg-emerald-50 text-emerald-600";
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
    return ["#60a5fa", "#8b5cf6", "#f59e0b", "#94a3b8", "#38bdf8", "#c084fc"];
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

type LedgerAiReportEntry = {
  type: LedgerEntryTypeValue;
  amount: number;
  usedAt: string;
  categoryName: string | null;
};

type LedgerAiBudgetPlanInput = {
  type: LedgerEntryTypeValue;
  allocations: Array<{
    categoryName: string;
    plannedAmount: number;
    isFixed: boolean;
  }>;
};

function formatDateToken(date: Date) {
  return new Intl.DateTimeFormat("sv-SE").format(date);
}

function getInclusiveEndDateToken(endExclusive: Date) {
  const endDate = new Date(endExclusive);
  endDate.setDate(endDate.getDate() - 1);
  return formatDateToken(endDate);
}

function getDayIndexInPeriod(dateToken: string, periodStart: Date) {
  const date = new Date(`${dateToken}T12:00:00`);
  const start = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate(), 12, 0, 0, 0);
  return Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function getWeekdayLabel(dateToken: string) {
  return new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(new Date(`${dateToken}T12:00:00`));
}

function getPeriodSegmentLabel(dayIndex: number, periodDayCount: number) {
  const ratio = dayIndex / Math.max(periodDayCount, 1);
  if (ratio <= 1 / 3) {
    return "초반";
  }

  if (ratio <= 2 / 3) {
    return "중반";
  }

  return "후반";
}

function buildLedgerAiSummarySnapshot({
  analysisMode,
  entries,
  budgetPlans,
  selectedFilter,
  periodLabel,
  periodStart,
  periodEnd,
}: {
  analysisMode: LedgerAiAnalysisMode;
  entries: LedgerAiReportEntry[];
  budgetPlans: LedgerAiBudgetPlanInput[];
  selectedFilter: EntryFilterValue;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
}): LedgerAiSummarySnapshot {
  const analysisModeOption = getLedgerAiAnalysisModeOption(analysisMode);
  const visibleEntries = selectedFilter === "ALL" ? entries : entries.filter((entry) => entry.type === selectedFilter);
  const visibleTypes: LedgerEntryTypeValue[] =
    selectedFilter === "ALL" ? ["INCOME", "EXPENSE", "SAVING"] : [selectedFilter];
  const periodDayCount = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)));

  const totals = visibleEntries.reduce(
    (acc, entry) => {
      if (entry.type === "INCOME") acc.income += entry.amount;
      if (entry.type === "EXPENSE") acc.expense += entry.amount;
      if (entry.type === "SAVING") acc.saving += entry.amount;
      return acc;
    },
    { income: 0, expense: 0, saving: 0 },
  );
  const dailyMap = new Map<
    string,
    {
      income: number;
      expense: number;
      saving: number;
      categories: Map<string, { typeLabel: string; categoryName: string; amount: number; count: number }>;
    }
  >();
  const categoryMap = new Map<LedgerEntryTypeValue, Map<string, { amount: number; count: number }>>();
  const weekdayMap = new Map<string, { income: number; expense: number; saving: number; entryCount: number }>();
  const segmentMap = new Map<string, { income: number; expense: number; saving: number; entryCount: number }>();

  for (const entry of visibleEntries) {
    const dateToken = entry.usedAt.slice(0, 10);
    const categoryName = entry.categoryName ?? "미분류";
    const weekdayLabel = getWeekdayLabel(dateToken);
    const segmentLabel = getPeriodSegmentLabel(getDayIndexInPeriod(dateToken, periodStart), periodDayCount);
    const daily = dailyMap.get(dateToken) ?? {
      income: 0,
      expense: 0,
      saving: 0,
      categories: new Map<string, { typeLabel: string; categoryName: string; amount: number; count: number }>(),
    };

    if (entry.type === "INCOME") daily.income += entry.amount;
    if (entry.type === "EXPENSE") daily.expense += entry.amount;
    if (entry.type === "SAVING") daily.saving += entry.amount;

    const dailyCategoryKey = `${entry.type}:${categoryName}`;
    const dailyCategory = daily.categories.get(dailyCategoryKey) ?? {
      typeLabel: getTypeLabel(entry.type),
      categoryName,
      amount: 0,
      count: 0,
    };
    dailyCategory.amount += entry.amount;
    dailyCategory.count += 1;
    daily.categories.set(dailyCategoryKey, dailyCategory);
    dailyMap.set(dateToken, daily);

    const typeCategories = categoryMap.get(entry.type) ?? new Map<string, { amount: number; count: number }>();
    const category = typeCategories.get(categoryName) ?? { amount: 0, count: 0 };
    category.amount += entry.amount;
    category.count += 1;
    typeCategories.set(categoryName, category);
    categoryMap.set(entry.type, typeCategories);

    const weekday = weekdayMap.get(weekdayLabel) ?? { income: 0, expense: 0, saving: 0, entryCount: 0 };
    if (entry.type === "INCOME") weekday.income += entry.amount;
    if (entry.type === "EXPENSE") weekday.expense += entry.amount;
    if (entry.type === "SAVING") weekday.saving += entry.amount;
    weekday.entryCount += 1;
    weekdayMap.set(weekdayLabel, weekday);

    const segment = segmentMap.get(segmentLabel) ?? { income: 0, expense: 0, saving: 0, entryCount: 0 };
    if (entry.type === "INCOME") segment.income += entry.amount;
    if (entry.type === "EXPENSE") segment.expense += entry.amount;
    if (entry.type === "SAVING") segment.saving += entry.amount;
    segment.entryCount += 1;
    segmentMap.set(segmentLabel, segment);
  }

  let cumulativeNet = 0;
  const dailyRows = Array.from(dailyMap.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([dateToken, value]) => {
      const net = value.income - value.expense - value.saving;
      cumulativeNet += net;
      const dayIndex = getDayIndexInPeriod(dateToken, periodStart);

      return {
        dateToken,
        dateLabel: formatStatsDay(dateToken),
        weekdayLabel: getWeekdayLabel(dateToken),
        periodSegment: getPeriodSegmentLabel(dayIndex, periodDayCount),
        dayIndex,
        income: Math.round(value.income),
        expense: Math.round(value.expense),
        saving: Math.round(value.saving),
        net: Math.round(net),
        cumulativeNet: Math.round(cumulativeNet),
        categories: Array.from(value.categories.values())
          .sort((left, right) => right.amount - left.amount || left.categoryName.localeCompare(right.categoryName, "ko"))
          .slice(0, 8)
          .map((item) => ({
            ...item,
            amount: Math.round(item.amount),
          })),
      };
    });

  const categorySections = visibleTypes.map((type) => {
    const grouped = categoryMap.get(type) ?? new Map<string, { amount: number; count: number }>();
    const totalAmount = Array.from(grouped.values()).reduce((sum, item) => sum + item.amount, 0);

    return {
      type,
      typeLabel: getTypeLabel(type),
      totalAmount: Math.round(totalAmount),
      items: Array.from(grouped.entries())
        .sort((left, right) => right[1].amount - left[1].amount || left[0].localeCompare(right[0], "ko"))
        .map(([categoryName, item]) => ({
          categoryName,
          amount: Math.round(item.amount),
          percent: roundPercent(item.amount, totalAmount),
          count: item.count,
        })),
    };
  });
  const budgetCategorySections = visibleTypes.map((type) => {
    const actualCategories = categoryMap.get(type) ?? new Map<string, { amount: number; count: number }>();
    const plan = budgetPlans.find((item) => item.type === type);
    const allocationMap = new Map(
      (plan?.allocations ?? []).map((allocation) => [
        allocation.categoryName,
        {
          plannedAmount: allocation.plannedAmount,
          isFixed: allocation.isFixed,
        },
      ]),
    );
    const categoryNames = new Set([...allocationMap.keys(), ...actualCategories.keys()]);

    return {
      type,
      typeLabel: getTypeLabel(type),
      items: Array.from(categoryNames)
        .map((categoryName) => {
          const allocation = allocationMap.get(categoryName);
          const actualAmount = actualCategories.get(categoryName)?.amount ?? 0;
          const plannedAmount = allocation?.plannedAmount ?? 0;
          const remainingAmount = plannedAmount - actualAmount;

          return {
            categoryName,
            plannedAmount: Math.round(plannedAmount),
            actualAmount: Math.round(actualAmount),
            remainingAmount: Math.round(remainingAmount),
            progressPercent: plannedAmount > 0 ? Math.round((actualAmount / plannedAmount) * 100) : actualAmount > 0 ? 100 : 0,
            isFixed: allocation?.isFixed ?? false,
            hasBudget: Boolean(allocation),
          };
        })
        .filter((item) => item.plannedAmount > 0 || item.actualAmount > 0)
        .sort((left, right) => {
          const leftRisk = left.plannedAmount > 0 ? left.actualAmount / left.plannedAmount : left.actualAmount > 0 ? 999 : 0;
          const rightRisk = right.plannedAmount > 0 ? right.actualAmount / right.plannedAmount : right.actualAmount > 0 ? 999 : 0;
          return rightRisk - leftRisk || right.actualAmount - left.actualAmount || left.categoryName.localeCompare(right.categoryName, "ko");
        }),
    };
  });
  const weekdayOrder = ["월", "화", "수", "목", "금", "토", "일"];
  const weekdaySummary = Array.from(weekdayMap.entries())
    .map(([weekdayLabel, value]) => ({
      weekdayLabel,
      income: Math.round(value.income),
      expense: Math.round(value.expense),
      saving: Math.round(value.saving),
      net: Math.round(value.income - value.expense - value.saving),
      entryCount: value.entryCount,
    }))
    .sort((left, right) => weekdayOrder.indexOf(left.weekdayLabel) - weekdayOrder.indexOf(right.weekdayLabel));
  const periodSegments = ["초반", "중반", "후반"]
    .map((segmentLabel) => {
      const value = segmentMap.get(segmentLabel) ?? { income: 0, expense: 0, saving: 0, entryCount: 0 };

      return {
        segmentLabel,
        income: Math.round(value.income),
        expense: Math.round(value.expense),
        saving: Math.round(value.saving),
        net: Math.round(value.income - value.expense - value.saving),
        entryCount: value.entryCount,
      };
    })
    .filter((item) => item.entryCount > 0);
  const recurringExpenseCandidates = Array.from(categoryMap.get("EXPENSE")?.entries() ?? [])
    .map(([categoryName, value]) => ({
      categoryName,
      amount: Math.round(value.amount),
      count: value.count,
    }))
    .filter((item) => item.count >= 2)
    .sort((left, right) => right.count - left.count || right.amount - left.amount)
    .slice(0, 6);
  const notableDays = [
    ...dailyRows
      .filter((item) => item.expense > 0)
      .sort((left, right) => right.expense - left.expense)
      .slice(0, 1)
      .map((item) => ({
        dateToken: item.dateToken,
        dateLabel: item.dateLabel,
        reason: "지출이 가장 큰 날",
        amount: item.expense,
      })),
    ...dailyRows
      .filter((item) => item.saving > 0)
      .sort((left, right) => right.saving - left.saving)
      .slice(0, 1)
      .map((item) => ({
        dateToken: item.dateToken,
        dateLabel: item.dateLabel,
        reason: "저축이 가장 큰 날",
        amount: item.saving,
      })),
    ...dailyRows
      .filter((item) => item.income > 0)
      .sort((left, right) => right.income - left.income)
      .slice(0, 1)
      .map((item) => ({
        dateToken: item.dateToken,
        dateLabel: item.dateLabel,
        reason: "수입이 가장 큰 날",
        amount: item.income,
      })),
  ];

  return {
    analysisMode,
    analysisModeLabel: analysisModeOption.label,
    focusLabel: selectedFilter === "ALL" ? "전체" : getTypeLabel(selectedFilter),
    periodLabel,
    periodStartDate: formatDateToken(periodStart),
    periodEndDate: getInclusiveEndDateToken(periodEnd),
    periodDayCount,
    entryCount: visibleEntries.length,
    totals: {
      income: Math.round(totals.income),
      expense: Math.round(totals.expense),
      saving: Math.round(totals.saving),
      net: Math.round(totals.income - totals.expense - totals.saving),
      savingRatePercent: roundPercent(totals.saving, totals.income),
      expenseRatePercent: roundPercent(totals.expense, totals.income),
    },
    dailyRows,
    categorySections,
    budgetCategorySections,
    weekdaySummary,
    periodSegments,
    recurringExpenseCandidates,
    notableDays,
  };
}

function buildLedgerPurchaseAdviceSnapshot({
  question,
  entries,
  budgetPlans,
  selectedFilter,
  periodLabel,
  periodStart,
  periodEnd,
}: {
  question: string;
  entries: LedgerAiReportEntry[];
  budgetPlans: LedgerAiBudgetPlanInput[];
  selectedFilter: EntryFilterValue;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
}): LedgerPurchaseAdviceSnapshot {
  const totals = entries.reduce(
    (acc, entry) => {
      if (entry.type === "INCOME") acc.income += entry.amount;
      if (entry.type === "EXPENSE") acc.expense += entry.amount;
      if (entry.type === "SAVING") acc.saving += entry.amount;
      return acc;
    },
    { income: 0, expense: 0, saving: 0 },
  );
  const actualMap = new Map<LedgerEntryTypeValue, Map<string, number>>();

  for (const entry of entries) {
    const categoryName = entry.categoryName ?? "미분류";
    const typeMap = actualMap.get(entry.type) ?? new Map<string, number>();
    typeMap.set(categoryName, (typeMap.get(categoryName) ?? 0) + entry.amount);
    actualMap.set(entry.type, typeMap);
  }

  const budgetCategories = (["EXPENSE", "SAVING", "INCOME"] as LedgerEntryTypeValue[]).flatMap((type) => {
    const plan = budgetPlans.find((item) => item.type === type);
    const allocationMap = new Map(
      (plan?.allocations ?? []).map((allocation) => [
        allocation.categoryName,
        {
          plannedAmount: allocation.plannedAmount,
          isFixed: allocation.isFixed,
        },
      ]),
    );
    const categoryNames = new Set([...allocationMap.keys(), ...(actualMap.get(type)?.keys() ?? [])]);

    return Array.from(categoryNames)
      .map((categoryName) => {
        const plannedAmount = allocationMap.get(categoryName)?.plannedAmount ?? 0;
        const actualAmount = actualMap.get(type)?.get(categoryName) ?? 0;
        const remainingAmount = plannedAmount - actualAmount;

        return {
          type,
          typeLabel: getTypeLabel(type),
          categoryName,
          plannedAmount: Math.round(plannedAmount),
          actualAmount: Math.round(actualAmount),
          remainingAmount: Math.round(remainingAmount),
          progressPercent: plannedAmount > 0 ? Math.round((actualAmount / plannedAmount) * 100) : actualAmount > 0 ? 100 : 0,
          isFixed: allocationMap.get(categoryName)?.isFixed ?? false,
        };
      })
      .filter((item) => item.plannedAmount > 0 || item.actualAmount > 0)
      .sort((left, right) => {
        if (left.type === "EXPENSE" && right.type !== "EXPENSE") return -1;
        if (left.type !== "EXPENSE" && right.type === "EXPENSE") return 1;
        return right.actualAmount - left.actualAmount || right.plannedAmount - left.plannedAmount;
      });
  });

  return {
    question,
    periodLabel,
    periodStartDate: formatDateToken(periodStart),
    periodEndDate: getInclusiveEndDateToken(periodEnd),
    focusLabel: selectedFilter === "ALL" ? "전체" : getTypeLabel(selectedFilter),
    totals: {
      income: Math.round(totals.income),
      expense: Math.round(totals.expense),
      saving: Math.round(totals.saving),
      net: Math.round(totals.income - totals.expense - totals.saving),
    },
    budgetCategories,
  };
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

  const initialBudgetResult = await ensureLedgerBudgetPeriodForDate(db, user.id, monthStart);
  const statsReferenceDate = getLedgerReferenceDateForMonthToken(
    monthToken,
    initialBudgetResult.settings.defaultPeriodBasis as LedgerPeriodBasis,
    initialBudgetResult.settings.paydayDay ?? 25,
  );
  const currentBudgetResult =
    statsReferenceDate.getTime() === monthStart.getTime()
      ? initialBudgetResult
      : await ensureLedgerBudgetPeriodForDate(db, user.id, statsReferenceDate);
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  if (intent !== "generate_ai_summary" && intent !== "ask_purchase_advice" && intent !== "ask_general_question") {
    return new Response("Bad Request", { status: 400 });
  }

  const monthToken =
    parseMonthToken(typeof formData.get("monthToken") === "string" ? String(formData.get("monthToken")) : null) ??
    getMonthToken(new Date());
  const selectedFilter = parseEntryFilter(typeof formData.get("type") === "string" ? String(formData.get("type")) : null);

  if (intent === "ask_general_question") {
    const question = typeof formData.get("question") === "string" ? String(formData.get("question")).trim() : "";
    const requestKey = buildLedgerGeneralQuestionRequestKey(monthToken, selectedFilter, question);

    if (question.length < 2) {
      return {
        requestKey,
        error: "궁금한 내용을 조금 더 적어주세요.",
      } satisfies LedgerGeneralQuestionActionData;
    }

    if (!hasGeminiApiKey()) {
      return {
        requestKey,
        question,
        error: "GEMINI_API_KEY를 설정하면 자유 질문을 바로 쓸 수 있어요.",
      } satisfies LedgerGeneralQuestionActionData;
    }

    await ensureLedgerSetup(db, user.id);
    const { ensureLedgerBudgetPeriodForDate } = await import("~/lib/ledger-budget.server");
    const monthStart = getMonthStart(monthToken);
    const initialBudgetResult = await ensureLedgerBudgetPeriodForDate(db, user.id, monthStart);
    const statsReferenceDate = getLedgerReferenceDateForMonthToken(
      monthToken,
      initialBudgetResult.settings.defaultPeriodBasis as LedgerPeriodBasis,
      initialBudgetResult.settings.paydayDay ?? 25,
    );
    const currentBudgetResult =
      statsReferenceDate.getTime() === monthStart.getTime()
        ? initialBudgetResult
        : await ensureLedgerBudgetPeriodForDate(db, user.id, statsReferenceDate);
    const periodStart = new Date(currentBudgetResult.period.periodStartAt);
    const periodEnd = new Date(currentBudgetResult.period.periodEndAt);
    const entries = await db.ledgerEntry.findMany({
      where: {
        userId: user.id,
        excludeFromStats: false,
        usedAt: {
          gte: periodStart,
          lt: periodEnd,
        },
      },
      select: {
        type: true,
        amount: true,
        usedAt: true,
        category: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ usedAt: "asc" }, { id: "asc" }],
    });
    const report = buildLedgerAiSummarySnapshot({
      analysisMode: "OVERVIEW",
      entries: entries.map((entry) => ({
        type: entry.type,
        amount: Number(entry.amount),
        usedAt: entry.usedAt.toISOString(),
        categoryName: entry.category?.name ?? null,
      })),
      budgetPlans: currentBudgetResult.period.plans.map((plan) => ({
        type: plan.type,
        allocations: plan.allocations.map((allocation) => ({
          categoryName: allocation.category.name,
          plannedAmount: Number(allocation.plannedAmount),
          isFixed: allocation.isFixed,
        })),
      })),
      selectedFilter,
      periodLabel: getLedgerPeriodLabel(periodStart, periodEnd),
      periodStart,
      periodEnd,
    });

    if (report.entryCount <= 0) {
      return {
        requestKey,
        question,
        error: "질문에 참고할 내역이 아직 없어요.",
      } satisfies LedgerGeneralQuestionActionData;
    }

    const snapshot = { question, report } satisfies LedgerGeneralQuestionSnapshot;
    const snapshotJson = JSON.stringify(snapshot);
    if (snapshotJson.length > LEDGER_AI_SNAPSHOT_MAX_LENGTH) {
      return {
        requestKey,
        question,
        error: "Gemini에 보낼 가계부 정보가 너무 커요. 필터를 좁히고 다시 시도해 주세요.",
      } satisfies LedgerGeneralQuestionActionData;
    }

    const answer = await generateLedgerGeneralQuestion(snapshot);
    if (!answer) {
      return {
        requestKey,
        question,
        snapshot,
        error: "Gemini 답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
      } satisfies LedgerGeneralQuestionActionData;
    }

    return {
      requestKey,
      question,
      snapshot,
      answer,
      generatedAt: new Date().toISOString(),
    } satisfies LedgerGeneralQuestionActionData;
  }

  if (intent === "ask_purchase_advice") {
    const question = typeof formData.get("question") === "string" ? String(formData.get("question")).trim() : "";
    const requestKey = buildLedgerPurchaseAdviceRequestKey(monthToken, selectedFilter, question);

    if (question.length < 2) {
      return {
        requestKey,
        error: "사고 싶은 물건과 예상 가격을 같이 적어주세요.",
      } satisfies LedgerPurchaseAdviceActionData;
    }

    if (!hasGeminiApiKey()) {
      return {
        requestKey,
        question,
        error: "GEMINI_API_KEY를 설정하면 구매 상담을 바로 쓸 수 있어요.",
      } satisfies LedgerPurchaseAdviceActionData;
    }

    await ensureLedgerSetup(db, user.id);
    const { ensureLedgerBudgetPeriodForDate } = await import("~/lib/ledger-budget.server");
    const monthStart = getMonthStart(monthToken);
    const initialBudgetResult = await ensureLedgerBudgetPeriodForDate(db, user.id, monthStart);
    const statsReferenceDate = getLedgerReferenceDateForMonthToken(
      monthToken,
      initialBudgetResult.settings.defaultPeriodBasis as LedgerPeriodBasis,
      initialBudgetResult.settings.paydayDay ?? 25,
    );
    const currentBudgetResult =
      statsReferenceDate.getTime() === monthStart.getTime()
        ? initialBudgetResult
        : await ensureLedgerBudgetPeriodForDate(db, user.id, statsReferenceDate);
    const periodStart = new Date(currentBudgetResult.period.periodStartAt);
    const periodEnd = new Date(currentBudgetResult.period.periodEndAt);
    const entries = await db.ledgerEntry.findMany({
      where: {
        userId: user.id,
        excludeFromStats: false,
        usedAt: {
          gte: periodStart,
          lt: periodEnd,
        },
      },
      select: {
        type: true,
        amount: true,
        usedAt: true,
        category: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ usedAt: "asc" }, { id: "asc" }],
    });
    const snapshot = buildLedgerPurchaseAdviceSnapshot({
      question,
      entries: entries.map((entry) => ({
        type: entry.type,
        amount: Number(entry.amount),
        usedAt: entry.usedAt.toISOString(),
        categoryName: entry.category?.name ?? null,
      })),
      budgetPlans: currentBudgetResult.period.plans.map((plan) => ({
        type: plan.type,
        allocations: plan.allocations.map((allocation) => ({
          categoryName: allocation.category.name,
          plannedAmount: Number(allocation.plannedAmount),
          isFixed: allocation.isFixed,
        })),
      })),
      selectedFilter,
      periodLabel: getLedgerPeriodLabel(periodStart, periodEnd),
      periodStart,
      periodEnd,
    });

    if (snapshot.budgetCategories.length <= 0) {
      return {
        requestKey,
        question,
        error: "비교할 카테고리 예산이 아직 없어요.",
      } satisfies LedgerPurchaseAdviceActionData;
    }

    const snapshotJson = JSON.stringify(snapshot);
    if (snapshotJson.length > LEDGER_AI_SNAPSHOT_MAX_LENGTH) {
      return {
        requestKey,
        question,
        error: "Gemini에 보낼 예산 정보가 너무 커요. 질문을 조금 좁혀 다시 시도해 주세요.",
      } satisfies LedgerPurchaseAdviceActionData;
    }

    const advice = await generateLedgerPurchaseAdvice(snapshot);
    if (!advice) {
      return {
        requestKey,
        question,
        snapshot,
        error: "Gemini 구매 상담을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
      } satisfies LedgerPurchaseAdviceActionData;
    }

    return {
      requestKey,
      question,
      snapshot,
      advice,
      generatedAt: new Date().toISOString(),
    } satisfies LedgerPurchaseAdviceActionData;
  }

  const analysisMode = parseLedgerAiAnalysisMode(formData.get("analysisMode"));
  const requestKey = buildLedgerAiRequestKey(monthToken, selectedFilter, analysisMode);

  if (!hasGeminiApiKey()) {
    return {
      requestKey,
      error: "GEMINI_API_KEY를 설정하면 AI 통계 요약을 바로 쓸 수 있어요.",
    } satisfies LedgerStatsAiActionData;
  }

  await ensureLedgerSetup(db, user.id);
  const { ensureLedgerBudgetPeriodForDate } = await import("~/lib/ledger-budget.server");
  const monthStart = getMonthStart(monthToken);
  const initialBudgetResult = await ensureLedgerBudgetPeriodForDate(db, user.id, monthStart);
  const statsReferenceDate = getLedgerReferenceDateForMonthToken(
    monthToken,
    initialBudgetResult.settings.defaultPeriodBasis as LedgerPeriodBasis,
    initialBudgetResult.settings.paydayDay ?? 25,
  );
  const currentBudgetResult =
    statsReferenceDate.getTime() === monthStart.getTime()
      ? initialBudgetResult
      : await ensureLedgerBudgetPeriodForDate(db, user.id, statsReferenceDate);
  const periodStart = new Date(currentBudgetResult.period.periodStartAt);
  const periodEnd = new Date(currentBudgetResult.period.periodEndAt);
  const entries = await db.ledgerEntry.findMany({
    where: {
      userId: user.id,
      excludeFromStats: false,
      usedAt: {
        gte: periodStart,
        lt: periodEnd,
      },
    },
    select: {
      type: true,
      amount: true,
      usedAt: true,
      category: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ usedAt: "asc" }, { id: "asc" }],
  });
  const report = buildLedgerAiSummarySnapshot({
    analysisMode,
    entries: entries.map((entry) => ({
      type: entry.type,
      amount: Number(entry.amount),
      usedAt: entry.usedAt.toISOString(),
      categoryName: entry.category?.name ?? null,
    })),
    budgetPlans: currentBudgetResult.period.plans.map((plan) => ({
      type: plan.type,
      allocations: plan.allocations.map((allocation) => ({
        categoryName: allocation.category.name,
        plannedAmount: Number(allocation.plannedAmount),
        isFixed: allocation.isFixed,
      })),
    })),
    selectedFilter,
    periodLabel: getLedgerPeriodLabel(periodStart, periodEnd),
    periodStart,
    periodEnd,
  });

  if (report.entryCount <= 0) {
    return {
      requestKey,
      error: "분석할 내역이 아직 없어요.",
    } satisfies LedgerStatsAiActionData;
  }

  const reportJson = JSON.stringify(report);
  if (reportJson.length > LEDGER_AI_SNAPSHOT_MAX_LENGTH) {
    return {
      requestKey,
      error: "AI에 보낼 통계 요약이 너무 커요. 필터를 좁히고 다시 시도해 주세요.",
    } satisfies LedgerStatsAiActionData;
  }

  const summary = await generateLedgerStatsSummary(report);
  if (!summary) {
    return {
      requestKey,
      report,
      error: "Gemini 요약을 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
    } satisfies LedgerStatsAiActionData;
  }

  return {
    requestKey,
    report,
    summary,
    generatedAt: new Date().toISOString(),
  } satisfies LedgerStatsAiActionData;
};

export function shouldRevalidate({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (
    formData?.get("intent") === "generate_ai_summary" ||
    formData?.get("intent") === "ask_purchase_advice" ||
    formData?.get("intent") === "ask_general_question"
  ) {
    return false;
  }

  return defaultShouldRevalidate;
}

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
  const aiSummaryFetcher = useFetcher<LedgerStatsAiActionData>();

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
  const [tagMetric, setTagMetric] = useState<TagMetricValue>("COUNT");
  const [aiAnalysisMode, setAiAnalysisMode] = useState<LedgerAiAnalysisMode>("OVERVIEW");
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
  const rawTagStats = useMemo(() => {
    const grouped = new Map<string, { count: number; linkedAmount: number }>();

    for (const entry of tagEntries) {
      for (const tagName of entry.tagNames) {
        const current = grouped.get(tagName) ?? { count: 0, linkedAmount: 0 };
        current.count += 1;
        current.linkedAmount += entry.amount;
        grouped.set(tagName, current);
      }
    }

    return Array.from(grouped.entries())
      .map(([label, value]) => ({
        label,
        count: value.count,
        linkedAmount: value.linkedAmount,
      }))
      .sort((left, right) => right.count - left.count || right.linkedAmount - left.linkedAmount);
  }, [tagEntries]);
  const tagStats = useMemo(() => {
    const totalCount = rawTagStats.reduce((sum, item) => sum + item.count, 0);
    const totalAmount = rawTagStats.reduce((sum, item) => sum + item.linkedAmount, 0);

    return rawTagStats
      .map((item) => ({
        ...item,
        countPercent: roundPercent(item.count, totalCount),
        amountPercent: roundPercent(item.linkedAmount, totalAmount),
      }))
      .sort((left, right) =>
        tagMetric === "AMOUNT"
          ? right.linkedAmount - left.linkedAmount || right.count - left.count
          : right.count - left.count || right.linkedAmount - left.linkedAmount,
      );
  }, [rawTagStats, tagMetric]);
  const categoryBudgetSections = useMemo<CategoryBudgetUsageSection[]>(() => {
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
  const selectedAiAnalysisMode = getLedgerAiAnalysisModeOption(aiAnalysisMode);
  const aiSummaryRequestKey = useMemo(
    () => buildLedgerAiRequestKey(monthToken, selectedFilter, aiAnalysisMode),
    [monthToken, selectedFilter, aiAnalysisMode],
  );
  const aiSummaryData = aiSummaryFetcher.data?.requestKey === aiSummaryRequestKey ? aiSummaryFetcher.data : null;
  const isAiSummaryLoading =
    aiSummaryFetcher.state !== "idle" &&
    aiSummaryFetcher.formData?.get("intent") === "generate_ai_summary" &&
    aiSummaryFetcher.formData?.get("monthToken") === monthToken &&
    String(aiSummaryFetcher.formData?.get("type") ?? "ALL") === selectedFilter &&
    String(aiSummaryFetcher.formData?.get("analysisMode") ?? "OVERVIEW") === aiAnalysisMode;
  const canRequestAiSummary = filteredEntries.length > 0;
  const requestAiSummary = () => {
    aiSummaryFetcher.submit(
      {
        intent: "generate_ai_summary",
        monthToken,
        type: selectedFilter,
        analysisMode: aiAnalysisMode,
      },
      { method: "post" },
    );
  };

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
            <StatSection title="Gemini 기간 정리" description="버튼을 누를 때만 Gemini로 최신 기간 데이터를 정리해요.">
              <div className="mb-4 grid gap-2 md:grid-cols-3">
                {LEDGER_AI_ANALYSIS_MODES.map((mode) => {
                  const isActive = mode.id === aiAnalysisMode;

                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setAiAnalysisMode(mode.id)}
                      className={cn(
                        "rounded-xl border px-3 py-3 text-left transition-colors",
                        isActive
                          ? "border-amber-300 bg-amber-50 text-slate-900 shadow-sm"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-white",
                      )}
                    >
                      <p className="text-[0.76rem] font-semibold">{mode.label}</p>
                      <p className="mt-1 text-[0.66rem] leading-5 text-slate-500">{mode.description}</p>
                    </button>
                  );
                })}
              </div>
              <LedgerAiSummaryCard
                analysisMode={selectedAiAnalysisMode}
                report={aiSummaryData?.report ?? null}
                summary={aiSummaryData?.summary ?? null}
                error={aiSummaryData?.error ?? null}
                generatedAt={aiSummaryData?.generatedAt ?? null}
                isLoading={isAiSummaryLoading}
                canRequest={canRequestAiSummary}
                onRefresh={requestAiSummary}
              />
              <div className="mt-4">
                <CategoryBudgetQuestionBox sections={categoryBudgetSections} selectedFilterLabel={selectedFilterLabel} />
              </div>
              <div className="mt-4">
                <LedgerGeneralQuestionBox monthToken={monthToken} selectedFilter={selectedFilter} />
              </div>
              <div className="mt-4">
                <PurchaseBudgetAdviceBox
                  monthToken={monthToken}
                  selectedFilter={selectedFilter}
                  sections={categoryBudgetSections}
                />
              </div>
            </StatSection>

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
                    const activeClassName =
                      type === "INCOME"
                        ? "bg-white text-sky-600 shadow-sm"
                        : type === "EXPENSE"
                          ? "bg-white text-rose-500 shadow-sm"
                          : "bg-white text-emerald-600 shadow-sm";

                    return (
                      <button
                        key={type}
                        type="button"
                        className={cn(
                          "rounded-lg px-2 py-1.5 text-[0.74rem] font-medium transition-colors",
                          isActive ? activeClassName : "text-slate-500",
                        )}
                        onClick={() => setTagTypeTab(type)}
                      >
                        {getTypeLabel(type)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="mb-3 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
                {([
                  { value: "COUNT", label: "건수" },
                  { value: "AMOUNT", label: "금액" },
                ] as const).map((option) => {
                  const isActive = tagMetric === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={cn(
                        "rounded-lg px-2 py-1.5 text-[0.74rem] font-medium transition-colors",
                        isActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
                      )}
                      onClick={() => setTagMetric(option.value)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {tagCategoryOptions.length > 0 ? (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-medium transition-colors",
                      getTagChipClass(tagFocusType, effectiveSelectedTagCategoryIds.length === 0),
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
                          getTagChipClass(tagFocusType, isSelected),
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
                metric={tagMetric}
                type={tagFocusType}
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

function LedgerAiSummaryCard({
  analysisMode,
  report,
  summary,
  error,
  generatedAt,
  isLoading,
  canRequest,
  onRefresh,
}: {
  analysisMode: LedgerAiAnalysisModeOption;
  report: LedgerAiSummarySnapshot | null;
  summary: LedgerAiSummaryResult | null;
  error: string | null;
  generatedAt: string | null;
  isLoading: boolean;
  canRequest: boolean;
  onRefresh: () => void;
}) {
  if (!canRequest) {
    return <EmptyState message="분석할 내역이 아직 없어요. 내역이 쌓이면 Gemini 요약도 같이 보여드릴게요." />;
  }

  if (!report && isLoading) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-sky-50 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.84rem] font-semibold text-slate-900">{analysisMode.label} 정리 중</p>
            <p className="mt-1 text-[0.72rem] text-slate-500">예산 기간의 최신 흐름을 {analysisMode.label} 관점으로 다시 읽고 있어요.</p>
          </div>
          <div className="h-9 w-9 shrink-0 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-3 w-full rounded-full bg-white/80" />
          <div className="h-3 w-5/6 rounded-full bg-white/80" />
          <div className="h-3 w-2/3 rounded-full bg-white/80" />
        </div>
      </div>
    );
  }

  if (!report && error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
        <p className="text-[0.84rem] font-semibold text-rose-600">AI 정리를 만들지 못했어요</p>
        <p className="mt-1 text-[0.74rem] text-rose-500">{error}</p>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-3 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-[0.72rem] font-medium text-rose-600 transition-colors hover:bg-rose-100"
        >
          다시 생성
        </button>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-sky-50 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.84rem] font-semibold text-slate-900">{analysisMode.label} 생성하기</p>
            <p className="mt-1 text-[0.72rem] text-slate-500">{analysisMode.description} 최신 내역은 버튼을 누를 때만 읽어요.</p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="shrink-0 rounded-full bg-slate-900 px-3 py-1.5 text-[0.72rem] font-medium text-white transition-colors hover:bg-slate-700"
          >
            Gemini 분석 생성
          </button>
        </div>
      </div>
    );
  }

  const generatedLabel = generatedAt
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(generatedAt))
    : null;
  const dailyNoteByDate = new Map(summary?.dailyNotes.map((item) => [item.dateToken, item.note]) ?? []);
  const categoryNoteByKey = new Map(summary?.categoryNotes.map((item) => [`${item.typeLabel}:${item.categoryName}`, item.note]) ?? []);
  const visibleCategorySections = report.categorySections.filter((section) => section.items.length > 0);

  return (
    <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-sky-50 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[0.84rem] font-semibold text-slate-900">{report.periodLabel}</p>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.64rem] font-semibold text-amber-700">
              {report.analysisModeLabel}
            </span>
          </div>
          <p className="mt-1 text-[0.72rem] text-slate-500">
            {report.periodStartDate} ~ {report.periodEndDate} · {report.focusLabel} {report.entryCount}건
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[0.72rem] font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          {isLoading ? "정리 중" : "Gemini로 다시 정리"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { label: "수입", amount: report.totals.income, className: "text-sky-600" },
          { label: "지출", amount: report.totals.expense, className: "text-rose-500" },
          { label: "저축", amount: report.totals.saving, className: "text-emerald-600" },
          { label: "남은 돈", amount: report.totals.net, className: report.totals.net >= 0 ? "text-sky-600" : "text-rose-500" },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-white/90 px-3 py-3 shadow-sm">
            <p className="text-[0.68rem] text-slate-400">{item.label}</p>
            <p className={cn("mt-1 text-[0.82rem] font-semibold", item.className)}>
              {item.label === "남은 돈" ? formatSignedLedgerAmount(item.amount) : formatLedgerAmount(item.amount)}
            </p>
          </div>
        ))}
      </div>

      {summary?.overview ? (
        <div className="mt-4 rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-[0.88rem] leading-6 text-slate-700">{summary.overview}</p>
        </div>
      ) : null}

      {summary && summary.insightCards.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {summary.insightCards.map((card) => {
            const tone = getLedgerAiInsightToneClasses(card.tone);

            return (
              <div key={`${card.title}-${card.detail}`} className={cn("rounded-2xl border px-4 py-3", tone.cardClassName)}>
                <div className="flex items-start gap-2">
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", tone.dotClassName)} />
                  <div>
                    <p className={cn("text-[0.76rem] font-semibold", tone.titleClassName)}>{card.title}</p>
                    <p className="mt-1 text-[0.7rem] leading-5 text-slate-600">{card.detail}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <LedgerAiModeSupportSections report={report} />

      <div className="mt-4 rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.76rem] font-semibold text-slate-800">날짜별 정리</p>
          <p className="text-[0.68rem] text-slate-400">{report.dailyRows.length}일</p>
        </div>
        <div className="mt-3 space-y-2">
          {report.dailyRows.map((row) => {
            const note = dailyNoteByDate.get(row.dateToken);

            return (
              <div key={row.dateToken} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[0.78rem] font-semibold text-slate-800">{row.dateLabel}</p>
                    <p className="mt-0.5 text-[0.62rem] text-slate-400">
                      {row.periodSegment} · {row.dayIndex}일차 · 누적 {formatSignedLedgerAmount(row.cumulativeNet)}
                    </p>
                  </div>
                  <p className={cn("text-[0.72rem] font-semibold", row.net >= 0 ? "text-sky-600" : "text-rose-500")}>
                    {formatSignedLedgerAmount(row.net)}
                  </p>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <p className="rounded-lg bg-white px-2 py-1 text-[0.66rem] text-sky-600">수입 {formatLedgerAmount(row.income)}</p>
                  <p className="rounded-lg bg-white px-2 py-1 text-[0.66rem] text-rose-500">지출 {formatLedgerAmount(row.expense)}</p>
                  <p className="rounded-lg bg-white px-2 py-1 text-[0.66rem] text-emerald-600">저축 {formatLedgerAmount(row.saving)}</p>
                </div>
                {row.categories.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.categories.slice(0, 4).map((category) => (
                      <span key={`${row.dateToken}-${category.typeLabel}-${category.categoryName}`} className="rounded-full bg-white px-2 py-1 text-[0.62rem] text-slate-500">
                        {category.typeLabel} · {category.categoryName} {formatLedgerAmount(category.amount)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {note ? <p className="mt-2 text-[0.7rem] leading-5 text-slate-500">{note}</p> : null}
              </div>
            );
          })}
          {report.dailyRows.length === 0 ? <EmptyState message="이 기간에는 정리할 날짜별 내역이 없습니다." /> : null}
        </div>
      </div>

      {visibleCategorySections.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {visibleCategorySections.map((section) => (
            <div key={section.type} className="rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[0.76rem] font-semibold text-slate-800">{section.typeLabel} 카테고리</p>
                <p className="text-[0.68rem] text-slate-400">{formatLedgerAmount(section.totalAmount)}</p>
              </div>
              <div className="mt-3 space-y-2">
                {section.items.map((item) => {
                  const note = categoryNoteByKey.get(`${section.typeLabel}:${item.categoryName}`);

                  return (
                    <div key={`${section.type}-${item.categoryName}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[0.72rem] font-medium text-slate-700">{item.categoryName}</p>
                          <p className="mt-0.5 text-[0.62rem] text-slate-400">{item.count}건 · {item.percent}%</p>
                        </div>
                        <p className="shrink-0 text-[0.72rem] font-semibold text-slate-800">{formatLedgerAmount(item.amount)}</p>
                      </div>
                      {note ? <p className="mt-1.5 text-[0.66rem] leading-5 text-slate-500">{note}</p> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {summary && summary.actions.length > 0 ? (
        <div className="mt-4 rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-[0.76rem] font-semibold text-slate-800">다음 액션</p>
          <div className="mt-3 space-y-2">
            {summary.actions.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <p className="text-[0.74rem] leading-5 text-slate-600">{item}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.74rem] text-slate-600">{summary?.closing ?? "정확한 금액은 현재 저장된 내역 기준으로 계산했어요."}</p>
        <p className="text-[0.68rem] text-slate-400">
          {isLoading ? "다시 읽는 중..." : generatedLabel ? `${generatedLabel} 생성` : "방금 생성"}
        </p>
      </div>

      {error ? <p className="mt-2 text-[0.68rem] text-rose-500">{error}</p> : null}
    </div>
  );
}

function getLedgerAiInsightToneClasses(tone: LedgerAiSummaryResult["insightCards"][number]["tone"]) {
  if (tone === "POSITIVE") {
    return {
      cardClassName: "border-emerald-100 bg-emerald-50/80",
      dotClassName: "bg-emerald-400",
      titleClassName: "text-emerald-700",
    };
  }

  if (tone === "CAUTION") {
    return {
      cardClassName: "border-rose-100 bg-rose-50/80",
      dotClassName: "bg-rose-400",
      titleClassName: "text-rose-600",
    };
  }

  return {
    cardClassName: "border-slate-100 bg-white/90",
    dotClassName: "bg-slate-300",
    titleClassName: "text-slate-700",
  };
}

function getBudgetCompareStatus(
  type: LedgerAiSummarySnapshot["budgetCategorySections"][number]["type"],
  item: LedgerAiSummarySnapshot["budgetCategorySections"][number]["items"][number],
) {
  if (!item.hasBudget) {
    return {
      label: "예산 없음",
      className: "text-slate-500",
    };
  }

  if (type === "EXPENSE") {
    if (item.actualAmount > item.plannedAmount) {
      return {
        label: "초과",
        className: "text-rose-500",
      };
    }

    if (item.progressPercent >= 80) {
      return {
        label: "위험",
        className: "text-amber-600",
      };
    }

    return {
      label: "여유",
      className: "text-emerald-600",
    };
  }

  if (item.actualAmount >= item.plannedAmount) {
    return {
      label: "달성",
      className: "text-emerald-600",
    };
  }

  if (item.progressPercent >= 80) {
    return {
      label: "근접",
      className: "text-sky-600",
    };
  }

  return {
    label: "진행",
    className: "text-slate-500",
  };
}

function LedgerAiModeSupportSections({ report }: { report: LedgerAiSummarySnapshot }) {
  if (report.analysisMode === "BUDGET_COMPARE") {
    const visibleBudgetSections = report.budgetCategorySections.filter((section) => section.items.length > 0);

    if (visibleBudgetSections.length === 0) {
      return null;
    }

    return (
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {visibleBudgetSections.map((section) => (
          <div key={section.type} className="rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
            <p className="text-[0.76rem] font-semibold text-slate-800">{section.typeLabel} 예산 비교</p>
            <div className="mt-3 space-y-2">
              {section.items.slice(0, 6).map((item) => {
                const status = getBudgetCompareStatus(section.type, item);

                return (
                  <div key={`${section.type}-${item.categoryName}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[0.72rem] font-medium text-slate-700">
                          {item.categoryName}
                          {item.isFixed ? <span className="ml-1 text-[0.6rem] text-slate-400">고정</span> : null}
                        </p>
                        <p className="mt-0.5 text-[0.62rem] text-slate-400">
                          실제 {formatLedgerAmount(item.actualAmount)} / 예산 {formatLedgerAmount(item.plannedAmount)}
                        </p>
                      </div>
                      <p className={cn("shrink-0 text-[0.68rem] font-semibold", status.className)}>{status.label}</p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          section.type === "EXPENSE" && item.actualAmount > item.plannedAmount ? "bg-rose-400" : "bg-amber-300",
                        )}
                        style={{ width: `${clampPercent(item.progressPercent)}%` }}
                      />
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

  if (report.analysisMode === "LIFE_PATTERN") {
    if (report.weekdaySummary.length === 0 && report.periodSegments.length === 0) {
      return null;
    }

    return (
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-[0.76rem] font-semibold text-slate-800">요일별 흐름</p>
          <div className="mt-3 space-y-2">
            {report.weekdaySummary.map((item) => (
              <div key={item.weekdayLabel} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-[0.72rem] font-medium text-slate-700">{item.weekdayLabel}요일</p>
                <p className="text-[0.68rem] text-slate-500">
                  지출 {formatLedgerAmount(item.expense)} · {item.entryCount}건
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-[0.76rem] font-semibold text-slate-800">기간 초중후반</p>
          <div className="mt-3 space-y-2">
            {report.periodSegments.map((item) => (
              <div key={item.segmentLabel} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-[0.72rem] font-medium text-slate-700">{item.segmentLabel}</p>
                <p className={cn("text-[0.68rem] font-medium", item.net >= 0 ? "text-sky-600" : "text-rose-500")}>
                  {formatSignedLedgerAmount(item.net)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (report.analysisMode === "SAVING_POINTS") {
    if (report.recurringExpenseCandidates.length === 0) {
      return null;
    }

    return (
      <div className="mt-4 rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
        <p className="text-[0.76rem] font-semibold text-slate-800">반복 지출 후보</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {report.recurringExpenseCandidates.map((item) => (
            <div key={item.categoryName} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-[0.72rem] font-medium text-slate-700">{item.categoryName}</p>
                <p className="shrink-0 text-[0.72rem] font-semibold text-rose-500">{formatLedgerAmount(item.amount)}</p>
              </div>
              <p className="mt-0.5 text-[0.62rem] text-slate-400">{item.count}번 반복됨</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (report.analysisMode === "CASH_FLOW") {
    const lastDailyRow = report.dailyRows[report.dailyRows.length - 1] ?? null;

    return (
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <div className="rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-[0.68rem] text-slate-400">지출률</p>
          <p className="mt-1 text-[0.9rem] font-semibold text-rose-500">{report.totals.expenseRatePercent}%</p>
          <p className="mt-1 text-[0.66rem] text-slate-500">수입 대비 지출</p>
        </div>
        <div className="rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-[0.68rem] text-slate-400">저축률</p>
          <p className="mt-1 text-[0.9rem] font-semibold text-emerald-600">{report.totals.savingRatePercent}%</p>
          <p className="mt-1 text-[0.66rem] text-slate-500">수입 대비 저축</p>
        </div>
        <div className="rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-[0.68rem] text-slate-400">누적 남은 돈</p>
          <p className={cn("mt-1 text-[0.9rem] font-semibold", report.totals.net >= 0 ? "text-sky-600" : "text-rose-500")}>
            {formatSignedLedgerAmount(lastDailyRow?.cumulativeNet ?? report.totals.net)}
          </p>
          <p className="mt-1 text-[0.66rem] text-slate-500">마지막 입력일 기준</p>
        </div>
      </div>
    );
  }

  if (report.analysisMode === "CATEGORY_REPORT") {
    const topCategoryItems = report.categorySections
      .flatMap((section) =>
        section.items.slice(0, 3).map((item) => ({
          ...item,
          typeLabel: section.typeLabel,
        })),
      )
      .slice(0, 6);

    if (topCategoryItems.length === 0) {
      return null;
    }

    return (
      <div className="mt-4 rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
        <p className="text-[0.76rem] font-semibold text-slate-800">우선 점검 카테고리</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {topCategoryItems.map((item) => (
            <div key={`${item.typeLabel}-${item.categoryName}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-[0.72rem] font-medium text-slate-700">
                  {item.typeLabel} · {item.categoryName}
                </p>
                <p className="shrink-0 text-[0.72rem] font-semibold text-slate-800">{formatLedgerAmount(item.amount)}</p>
              </div>
              <p className="mt-0.5 text-[0.62rem] text-slate-400">{item.count}건 · {item.percent}%</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (report.notableDays.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
      <p className="text-[0.76rem] font-semibold text-slate-800">특이한 날짜</p>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {report.notableDays.map((item) => (
          <div key={`${item.reason}-${item.dateToken}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
            <p className="text-[0.72rem] font-medium text-slate-700">{item.reason}</p>
            <p className="mt-1 text-[0.68rem] text-slate-500">{item.dateLabel}</p>
            <p className="mt-1 text-[0.72rem] font-semibold text-slate-800">{formatLedgerAmount(item.amount)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

type CategoryBudgetQuestionItem = {
  type: LedgerEntryTypeValue;
  typeLabel: string;
  label: string;
  plannedAmount: number;
  actualAmount: number;
  remainingAmount: number;
  progressRaw: number;
  progressValue: number;
  isFixed: boolean;
};

function normalizeBudgetQuestionText(value: string) {
  return value.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function getCategoryBudgetQuestionScore(question: string, itemLabel: string) {
  const compactQuestion = normalizeBudgetQuestionText(question);
  const compactLabel = normalizeBudgetQuestionText(itemLabel);
  const labelParts = itemLabel
    .split(/[\\/,\s._-]+/)
    .map(normalizeBudgetQuestionText)
    .filter((part) => part.length >= 2);

  if (!compactQuestion || !compactLabel) {
    return 0;
  }

  if (compactQuestion.includes(compactLabel)) {
    return 100;
  }

  if (compactLabel.includes(compactQuestion) && compactQuestion.length >= 2) {
    return 85;
  }

  const matchingPart = labelParts.find((part) => compactQuestion.includes(part) || part.includes(compactQuestion));
  if (matchingPart) {
    return 70 + Math.min(matchingPart.length, 10);
  }

  return 0;
}

function getBudgetQuestionResultLabel(item: CategoryBudgetQuestionItem) {
  if (item.type === "EXPENSE") {
    return item.remainingAmount >= 0
      ? {
          title: `${formatLedgerAmount(item.remainingAmount)} 남았어요.`,
          className: "text-slate-900",
          description: "지출 예산에서 아직 쓸 수 있는 금액이에요.",
        }
      : {
          title: `${formatLedgerAmount(Math.abs(item.remainingAmount))} 초과했어요.`,
          className: "text-rose-500",
          description: "이 카테고리는 이미 예산을 넘겼어요.",
        };
  }

  if (item.remainingAmount > 0) {
    return {
      title: `${formatLedgerAmount(item.remainingAmount)} 더 필요해요.`,
      className: "text-amber-600",
      description: `${item.typeLabel} 목표까지 남은 금액이에요.`,
    };
  }

  return {
    title: `${formatLedgerAmount(Math.abs(item.remainingAmount))} 초과 달성했어요.`,
    className: "text-emerald-600",
    description: `${item.typeLabel} 목표를 넘겼어요.`,
  };
}

function CategoryBudgetQuestionBox({
  sections,
  selectedFilterLabel,
}: {
  sections: CategoryBudgetUsageSection[];
  selectedFilterLabel: string;
}) {
  const [question, setQuestion] = useState("");
  const budgetItems = useMemo(
    () =>
      sections.flatMap((section) =>
        section.items.map((item) => ({
          ...item,
          type: section.type,
          typeLabel: getTypeLabel(section.type),
        })),
      ),
    [sections],
  );
  const trimmedQuestion = question.trim();
  const matches = useMemo(
    () =>
      budgetItems
        .map((item) => ({
          item,
          score: getCategoryBudgetQuestionScore(trimmedQuestion, item.label),
        }))
        .filter((match) => match.score > 0)
        .sort((left, right) => right.score - left.score || right.item.plannedAmount - left.item.plannedAmount)
        .slice(0, 3),
    [budgetItems, trimmedQuestion],
  );
  const suggestions = useMemo(
    () =>
      budgetItems
        .filter((item) => item.plannedAmount > 0)
        .sort((left, right) => right.plannedAmount - left.plannedAmount || right.actualAmount - left.actualAmount)
        .slice(0, 6),
    [budgetItems],
  );
  const categoryNames = suggestions.map((item) => item.label).join(", ");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[0.82rem] font-semibold text-slate-900">예산 빠른 질문</p>
          <p className="mt-1 text-[0.7rem] text-slate-500">
            AI 토큰 없이 {selectedFilterLabel} 카테고리 예산을 바로 찾아요. 예: 식비 얼마나 남았어?
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[0.64rem] font-medium text-slate-500">즉시 계산</span>
      </div>

      <div className="mt-3 flex gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-amber-300 focus-within:bg-white">
        <input
          type="search"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={categoryNames ? `${suggestions[0]?.label ?? "식비"} 얼마나 남았어?` : "카테고리 예산을 먼저 설정해 주세요."}
          className="min-w-0 flex-1 bg-transparent text-[0.8rem] text-slate-800 outline-none placeholder:text-slate-400"
        />
        {question ? (
          <button
            type="button"
            onClick={() => setQuestion("")}
            className="rounded-full px-2 text-[0.68rem] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            지우기
          </button>
        ) : null}
      </div>

      {suggestions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((item) => (
            <button
              key={`${item.type}-${item.label}`}
              type="button"
              onClick={() => setQuestion(`${item.label} 얼마나 남았어?`)}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[0.66rem] font-medium text-slate-500 transition-colors hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {budgetItems.length === 0 ? (
        <div className="mt-3">
          <EmptyState message="아직 질문할 수 있는 카테고리 예산이 없습니다." />
        </div>
      ) : trimmedQuestion ? (
        matches.length > 0 ? (
          <div className="mt-3 space-y-2">
            {matches.map(({ item }) => {
              const result = getBudgetQuestionResultLabel(item);

              return (
                <div key={`${item.type}-${item.label}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[0.78rem] font-semibold text-slate-800">
                        {item.typeLabel} · {item.label}
                        {item.isFixed ? <span className="ml-1 text-[0.62rem] font-medium text-slate-400">고정</span> : null}
                      </p>
                      <p className="mt-1 text-[0.68rem] text-slate-500">{result.description}</p>
                    </div>
                    <p className={cn("shrink-0 text-right text-[0.82rem] font-semibold", result.className)}>{result.title}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1.5 text-[0.64rem]">
                    <p className="rounded-lg bg-white px-2 py-1 text-slate-500">예산 {formatLedgerAmount(item.plannedAmount)}</p>
                    <p className="rounded-lg bg-white px-2 py-1 text-slate-500">사용 {formatLedgerAmount(item.actualAmount)}</p>
                    <p className="rounded-lg bg-white px-2 py-1 text-slate-500">진행 {item.progressRaw}%</p>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                    <div
                      className={cn("h-full rounded-full", item.remainingAmount < 0 ? "bg-rose-400" : "bg-amber-300")}
                      style={{ width: `${getAmountBarWidth(item.progressValue)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-3 text-[0.72rem] leading-5 text-slate-500">
            이 질문에서 맞는 카테고리를 찾지 못했어요. 카테고리 이름을 조금 더 그대로 적어보면 잘 찾아요.
          </div>
        )
      ) : null}
    </div>
  );
}

function getPurchaseAdviceVerdictTone(verdict: LedgerPurchaseAdviceResult["verdict"]) {
  if (verdict === "BUY") {
    return {
      label: "구매 가능",
      badgeClassName: "bg-emerald-100 text-emerald-700",
      titleClassName: "text-emerald-700",
      dotClassName: "bg-emerald-400",
    };
  }

  if (verdict === "WAIT") {
    return {
      label: "보류 추천",
      badgeClassName: "bg-rose-100 text-rose-600",
      titleClassName: "text-rose-600",
      dotClassName: "bg-rose-400",
    };
  }

  if (verdict === "ADJUST") {
    return {
      label: "조정 추천",
      badgeClassName: "bg-amber-100 text-amber-700",
      titleClassName: "text-amber-700",
      dotClassName: "bg-amber-400",
    };
  }

  return {
    label: "확인 필요",
    badgeClassName: "bg-slate-100 text-slate-600",
    titleClassName: "text-slate-700",
    dotClassName: "bg-slate-300",
  };
}

function LedgerGeneralQuestionBox({
  monthToken,
  selectedFilter,
}: {
  monthToken: string;
  selectedFilter: EntryFilterValue;
}) {
  const questionFetcher = useFetcher<LedgerGeneralQuestionActionData>();
  const [question, setQuestion] = useState("");
  const trimmedQuestion = question.trim();
  const requestPrefix = `${monthToken}:${selectedFilter}:general:`;
  const questionData = questionFetcher.data?.requestKey.startsWith(requestPrefix) ? questionFetcher.data : null;
  const isLoading =
    questionFetcher.state !== "idle" &&
    questionFetcher.formData?.get("intent") === "ask_general_question" &&
    questionFetcher.formData?.get("monthToken") === monthToken &&
    String(questionFetcher.formData?.get("type") ?? "ALL") === selectedFilter;
  const answer = questionData?.answer ?? null;
  const examples = [
    "이번 달 소비에서 제일 조심할 부분이 뭐야?",
    "저축을 더 늘리려면 어디부터 줄이면 좋을까?",
    "다음 주까지 지출을 어떻게 조절하면 좋을까?",
    "고정비랑 변동비 중 뭐가 더 문제야?",
  ];

  const askQuestion = () => {
    if (!trimmedQuestion || isLoading) {
      return;
    }

    questionFetcher.submit(
      {
        intent: "ask_general_question",
        monthToken,
        type: selectedFilter,
        question: trimmedQuestion,
      },
      { method: "post" },
    );
  };

  return (
    <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-white via-sky-50/70 to-indigo-50 px-4 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[0.82rem] font-semibold text-slate-900">Gemini 자유 질문</p>
          <p className="mt-1 text-[0.7rem] leading-5 text-slate-500">
            이번 기간의 가계부와 예산을 기준으로 궁금한 걸 자유롭게 물어볼 수 있어요.
          </p>
        </div>
        <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[0.64rem] font-medium text-sky-700">버튼 클릭 시 토큰 사용</span>
      </div>

      <form
        className="mt-3 space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          askQuestion();
        }}
      >
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={3}
          placeholder="예: 이번 달 식비가 너무 높은지 봐줘"
          className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-3 text-[0.8rem] leading-5 text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-300"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.66rem] text-slate-400">가계부, 예산, 절약, 현금흐름 질문에 잘 맞아요.</p>
          <button
            type="submit"
            disabled={!trimmedQuestion || isLoading}
            className="rounded-full bg-slate-900 px-3 py-1.5 text-[0.72rem] font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "답변 중" : "Gemini에게 질문하기"}
          </button>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setQuestion(example)}
            className="rounded-full border border-sky-100 bg-white/80 px-2.5 py-1 text-[0.66rem] font-medium text-slate-500 transition-colors hover:bg-sky-50 hover:text-sky-700"
          >
            {example}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="mt-4 rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.76rem] font-semibold text-slate-800">가계부를 읽는 중</p>
              <p className="mt-1 text-[0.68rem] text-slate-500">기간 내역과 예산을 함께 보고 답변하고 있어요.</p>
            </div>
            <div className="h-8 w-8 shrink-0 animate-spin rounded-full border-2 border-sky-300 border-t-transparent" />
          </div>
        </div>
      ) : null}

      {!isLoading && questionData?.error ? (
        <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
          <p className="text-[0.76rem] font-semibold text-rose-600">답변을 만들지 못했어요</p>
          <p className="mt-1 text-[0.7rem] leading-5 text-rose-500">{questionData.error}</p>
        </div>
      ) : null}

      {!isLoading && answer ? (
        <div className="mt-4 rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.86rem] font-semibold text-sky-700">{answer.title}</p>
              <p className="mt-1 text-[0.74rem] leading-5 text-slate-600">{answer.answer}</p>
            </div>
            {questionData?.generatedAt ? (
              <p className="shrink-0 text-[0.64rem] text-slate-400">
                {new Intl.DateTimeFormat("ko-KR", {
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }).format(new Date(questionData.generatedAt))}
              </p>
            ) : null}
          </div>

          {answer.highlights.length > 0 ? (
            <div className="mt-3 space-y-2">
              {answer.highlights.map((highlight) => (
                <div key={highlight} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                  <p className="text-[0.72rem] leading-5 text-slate-600">{highlight}</p>
                </div>
              ))}
            </div>
          ) : null}

          {answer.actions.length > 0 ? (
            <div className="mt-3 rounded-xl bg-sky-50/70 px-3 py-3">
              <p className="text-[0.7rem] font-semibold text-sky-700">바로 해볼 것</p>
              <div className="mt-2 space-y-1.5">
                {answer.actions.map((action) => (
                  <p key={action} className="text-[0.7rem] leading-5 text-slate-600">
                    {action}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {answer.caution ? (
            <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[0.68rem] leading-5 text-slate-500">{answer.caution}</p>
          ) : null}
          <p className="mt-3 text-[0.7rem] text-slate-500">{answer.closing}</p>
        </div>
      ) : null}
    </div>
  );
}

function PurchaseBudgetAdviceBox({
  monthToken,
  selectedFilter,
  sections,
}: {
  monthToken: string;
  selectedFilter: EntryFilterValue;
  sections: CategoryBudgetUsageSection[];
}) {
  const adviceFetcher = useFetcher<LedgerPurchaseAdviceActionData>();
  const [question, setQuestion] = useState("");
  const trimmedQuestion = question.trim();
  const requestPrefix = `${monthToken}:${selectedFilter}:`;
  const adviceData = adviceFetcher.data?.requestKey.startsWith(requestPrefix) ? adviceFetcher.data : null;
  const isLoading =
    adviceFetcher.state !== "idle" &&
    adviceFetcher.formData?.get("intent") === "ask_purchase_advice" &&
    adviceFetcher.formData?.get("monthToken") === monthToken &&
    String(adviceFetcher.formData?.get("type") ?? "ALL") === selectedFilter;
  const exampleItems = useMemo(
    () =>
      sections
        .flatMap((section) =>
          section.items.map((item) => ({
            ...item,
            type: section.type,
            typeLabel: getTypeLabel(section.type),
          })),
        )
        .filter((item) => item.type === "EXPENSE" && item.plannedAmount > 0)
        .sort((left, right) => right.remainingAmount - left.remainingAmount || right.plannedAmount - left.plannedAmount)
        .slice(0, 4),
    [sections],
  );

  const askAdvice = () => {
    if (!trimmedQuestion || isLoading) {
      return;
    }

    adviceFetcher.submit(
      {
        intent: "ask_purchase_advice",
        monthToken,
        type: selectedFilter,
        question: trimmedQuestion,
      },
      { method: "post" },
    );
  };
  const advice = adviceData?.advice ?? null;
  const tone = advice ? getPurchaseAdviceVerdictTone(advice.verdict) : null;

  return (
    <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-white via-amber-50/70 to-sky-50 px-4 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[0.82rem] font-semibold text-slate-900">Gemini 구매 상담</p>
          <p className="mt-1 text-[0.7rem] leading-5 text-slate-500">
            사고 싶은 것과 예상 가격을 적으면 최신 예산 잔액과 비교해줘요.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[0.64rem] font-medium text-amber-700">버튼 클릭 시 토큰 사용</span>
      </div>

      <form
        className="mt-3 space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          askAdvice();
        }}
      >
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={3}
          placeholder="예: 운동화 8만원 사고 싶은데 이번 지출 예산에서 괜찮을까?"
          className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-3 text-[0.8rem] leading-5 text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-amber-300"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.66rem] text-slate-400">가격을 같이 적으면 판단이 훨씬 정확해져요.</p>
          <button
            type="submit"
            disabled={!trimmedQuestion || isLoading}
            className="rounded-full bg-slate-900 px-3 py-1.5 text-[0.72rem] font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "상담 중" : "Gemini에게 물어보기"}
          </button>
        </div>
      </form>

      {exampleItems.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {exampleItems.map((item) => {
            const exampleAmount = item.remainingAmount > 0 ? Math.min(item.remainingAmount, 50_000) : 10_000;

            return (
              <button
                key={`${item.type}-${item.label}`}
                type="button"
                onClick={() => setQuestion(`${item.label}에서 ${formatLedgerAmount(exampleAmount)} 정도 쓰는 거 괜찮을까?`)}
                className="rounded-full border border-amber-100 bg-white/80 px-2.5 py-1 text-[0.66rem] font-medium text-slate-500 transition-colors hover:bg-amber-50 hover:text-amber-700"
              >
                {item.label} 상담
              </button>
            );
          })}
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-4 rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.76rem] font-semibold text-slate-800">예산이랑 비교하는 중</p>
              <p className="mt-1 text-[0.68rem] text-slate-500">최신 카테고리 예산과 사용액을 같이 보고 있어요.</p>
            </div>
            <div className="h-8 w-8 shrink-0 animate-spin rounded-full border-2 border-amber-300 border-t-transparent" />
          </div>
        </div>
      ) : null}

      {!isLoading && adviceData?.error ? (
        <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
          <p className="text-[0.76rem] font-semibold text-rose-600">상담을 만들지 못했어요</p>
          <p className="mt-1 text-[0.7rem] leading-5 text-rose-500">{adviceData.error}</p>
        </div>
      ) : null}

      {!isLoading && advice && tone ? (
        <div className="mt-4 rounded-2xl bg-white/90 px-4 py-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[0.64rem] font-semibold", tone.badgeClassName)}>
                  {tone.label}
                </span>
                {advice.matchedCategoryName ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.64rem] font-medium text-slate-500">
                    {advice.matchedCategoryName}
                  </span>
                ) : null}
              </div>
              <p className={cn("mt-2 text-[0.86rem] font-semibold", tone.titleClassName)}>{advice.title}</p>
              <p className="mt-1 text-[0.74rem] leading-5 text-slate-600">{advice.summary}</p>
            </div>
            {advice.priceEstimate > 0 ? (
              <div className="shrink-0 rounded-xl bg-slate-50 px-3 py-2 text-right">
                <p className="text-[0.62rem] text-slate-400">예상 가격</p>
                <p className="mt-0.5 text-[0.78rem] font-semibold text-slate-800">{formatLedgerAmount(advice.priceEstimate)}</p>
              </div>
            ) : null}
          </div>

          {advice.budgetImpact ? (
            <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[0.72rem] leading-5 text-slate-600">
              {advice.budgetImpact}
            </div>
          ) : null}

          {advice.reasons.length > 0 ? (
            <div className="mt-3 space-y-2">
              {advice.reasons.map((reason) => (
                <div key={reason} className="flex items-start gap-2">
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", tone.dotClassName)} />
                  <p className="text-[0.72rem] leading-5 text-slate-600">{reason}</p>
                </div>
              ))}
            </div>
          ) : null}

          {advice.suggestions.length > 0 ? (
            <div className="mt-3 rounded-xl bg-amber-50/70 px-3 py-3">
              <p className="text-[0.7rem] font-semibold text-amber-700">선택지</p>
              <div className="mt-2 space-y-1.5">
                {advice.suggestions.map((suggestion) => (
                  <p key={suggestion} className="text-[0.7rem] leading-5 text-slate-600">
                    {suggestion}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.7rem] text-slate-500">{advice.closing}</p>
            {adviceData?.generatedAt ? (
              <p className="text-[0.64rem] text-slate-400">
                {new Intl.DateTimeFormat("ko-KR", {
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }).format(new Date(adviceData.generatedAt))}{" "}
                상담
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
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
      baseColor: "#60a5fa",
      cardClassName: "bg-sky-50",
      labelClassName: "text-sky-600",
      chipClassName: "text-sky-700",
      sourceStackClasses: ["bg-sky-300", "bg-sky-400", "bg-cyan-300", "bg-blue-300", "bg-indigo-300", "bg-slate-300"] as const,
    };
  }

  if (label.includes("계좌")) {
    return {
      baseColor: "#8b5cf6",
      cardClassName: "bg-violet-50",
      labelClassName: "text-violet-600",
      chipClassName: "text-violet-700",
      sourceStackClasses: ["bg-violet-300", "bg-violet-400", "bg-fuchsia-300", "bg-purple-300", "bg-indigo-300", "bg-slate-300"] as const,
    };
  }

  if (label.includes("현금")) {
    return {
      baseColor: "#f59e0b",
      cardClassName: "bg-amber-50",
      labelClassName: "text-amber-600",
      chipClassName: "text-amber-700",
      sourceStackClasses: ["bg-amber-300", "bg-amber-400", "bg-orange-300", "bg-yellow-300", "bg-lime-300", "bg-slate-300"] as const,
    };
  }

  return {
    baseColor: "#94a3b8",
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
              style={{ width: "100%" }}
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

function TagStatList({
  items,
  metric,
  type,
  emptyMessage,
}: {
  items: TagBreakdownItem[];
  metric: TagMetricValue;
  type: LedgerEntryTypeValue;
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  const meta = getTypeStatMeta(type);

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[0.82rem] font-medium text-slate-800">{item.label}</p>
              <p className="mt-1 text-[0.72rem] text-slate-400">
                {metric === "COUNT"
                  ? `연결 금액 ${formatLedgerAmount(item.linkedAmount)}`
                  : `사용 건수 ${item.count}건`}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className={cn("text-[0.82rem] font-semibold", meta.labelClass)}>
                {metric === "COUNT" ? `${item.count}건` : formatLedgerAmount(item.linkedAmount)}
              </p>
              <p className="text-[0.72rem] text-slate-400">
                {metric === "COUNT" ? item.countPercent : item.amountPercent}%
              </p>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn("h-full rounded-full", meta.barClassName)}
              style={{
                width: `${getAmountBarWidth(metric === "COUNT" ? item.countPercent : item.amountPercent)}%`,
              }}
            />
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
  const itemColors =
    tone === "payment" ? donutItems.map((item) => getPaymentMethodTone(item.label).baseColor) : donutItems.map((_, index) => palette[index % palette.length]);
  let currentPercent = 0;
  const gradientStops = donutItems
    .map((item, index) => {
      const start = currentPercent;
      currentPercent += item.percent;
      return `${itemColors[index]} ${start}% ${currentPercent}%`;
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
                  style={{ backgroundColor: itemColors[index] }}
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
