import { Form, Link, redirect, useLoaderData, useNavigate, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Menu, MoreVertical, Plus } from "lucide-react";
import { ko } from "date-fns/locale";

import { Button } from "~/components/ui/button";
import { Calendar, CalendarDayButton } from "~/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { getSessionWithPermission } from "~/lib/auth.server";
import {
  addLedgerDays,
  getBudgetDisplayTotalAmount,
  getBudgetPeriodDayCount,
  getBudgetScopeAmount,
  getBudgetWeekRanges,
  getFixedExpenseCategoryIds,
  getStartOfBudgetWeek,
} from "~/lib/ledger-budget";
import {
  applyManualCarryToCurrentLedgerWeek,
  ensureLedgerBudgetPeriodForDate,
  getCurrentLedgerWeekBudgetSummary,
} from "~/lib/ledger-budget.server";
import { db } from "~/lib/db.server";
import { commitSession, getFlashSession } from "~/lib/session.server";
import { formatLedgerAmount, getDateKey, type LedgerEntryTypeValue } from "~/lib/ledger-entry";
import { ensureLedgerSetup, getMonthToken, shiftMonthToken } from "~/lib/ledger";
import { loadRoutineCalendarRecords } from "~/lib/routine.server";
import { cn } from "~/lib/utils";

type EntryFilterValue = "ALL" | LedgerEntryTypeValue;
type BudgetDisplayOption = "SHOW_MONTH_BUDGET" | "SHOW_WEEK_BUDGET" | "SHOW_DAY_BUDGET";
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
type BudgetPeriodSummary = {
  id: number;
  periodStartAt: string;
  periodEndAt: string;
  plans: Array<{
    type: LedgerEntryTypeValue;
    totalAmount: number;
    weekCarryMode: "NONE" | "AUTO" | "MANUAL";
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

const ALL_BUDGET_DISPLAY_OPTIONS: BudgetDisplayOption[] = [
  "SHOW_MONTH_BUDGET",
  "SHOW_WEEK_BUDGET",
  "SHOW_DAY_BUDGET",
];

const BUDGET_DISPLAY_LABELS: Record<BudgetDisplayOption, string> = {
  SHOW_MONTH_BUDGET: "월 예산",
  SHOW_WEEK_BUDGET: "주 예산",
  SHOW_DAY_BUDGET: "일 예산",
};

function parseMonthToken(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    return null;
  }

  return value;
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

function formatCalendarAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(amount);
}

function getCategoryChipClass(type: EntryFilterValue, selected: boolean, subtle = false) {
  if (!selected) {
    return subtle
      ? "border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200"
      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50";
  }

  if (type === "EXPENSE") {
    return subtle ? "border-rose-200 bg-rose-100 text-rose-500" : "border-rose-300 bg-rose-50 text-rose-500";
  }

  if (type === "INCOME") {
    return subtle ? "border-sky-200 bg-sky-100 text-sky-500" : "border-sky-300 bg-sky-50 text-sky-500";
  }

  if (type === "SAVING") {
    return subtle ? "border-emerald-200 bg-emerald-100 text-emerald-600" : "border-emerald-300 bg-emerald-50 text-emerald-600";
  }

  return subtle ? "border-slate-300 bg-slate-200 text-slate-700" : "border-slate-800 bg-slate-800 text-white";
}

function parseEntryFilter(value: string | null): EntryFilterValue {
  if (value === "INCOME" || value === "EXPENSE" || value === "SAVING") {
    return value;
  }

  return "ALL";
}

function parseBudgetDisplayOptions(value: string | null) {
  if (!value) {
    return [];
  }

  if (value === "NONE") {
    return [];
  }

  const allowed = new Set<BudgetDisplayOption>(ALL_BUDGET_DISPLAY_OPTIONS);
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is BudgetDisplayOption => allowed.has(item as BudgetDisplayOption));

  return parsed.length > 0 ? Array.from(new Set(parsed)) : [];
}

function parseCurrentWeekBudgetView(value: string | null) {
  return value === "1";
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

function encodeBudgetDisplayOptions(options: BudgetDisplayOption[]) {
  return ALL_BUDGET_DISPLAY_OPTIONS.filter((option) => options.includes(option)).join(",");
}

function buildLedgerMonthLink(
  monthToken: string,
  filter: EntryFilterValue,
  selectedDisplayOptions: BudgetDisplayOption[],
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

  const display = encodeBudgetDisplayOptions(selectedDisplayOptions);
  if (display) {
    params.set("display", display);
  }

  if (showCurrentWeekBudget) {
    params.set("currentWeek", "1");
  }

  return `/ledger?${params.toString()}`;
}

function buildLedgerDateLink(
  dateToken: string,
  monthToken: string,
  filter: EntryFilterValue,
  selectedDisplayOptions: BudgetDisplayOption[],
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

  const display = encodeBudgetDisplayOptions(selectedDisplayOptions);
  if (display) {
    params.set("display", display);
  }

  if (showCurrentWeekBudget) {
    params.set("currentWeek", "1");
  }

  return `/ledger/${dateToken}?${params.toString()}`;
}

function buildBudgetQuery(
  selectedDisplayOptions: BudgetDisplayOption[],
  showCurrentWeekBudget = false,
  selectedCategoryIds: number[] = [],
) {
  const params = new URLSearchParams();
  const display = encodeBudgetDisplayOptions(selectedDisplayOptions);
  if (display) {
    params.set("display", display);
  }

  if (showCurrentWeekBudget) {
    params.set("currentWeek", "1");
  }

  if (selectedCategoryIds.length > 0) {
    params.set("categoryIds", selectedCategoryIds.join(","));
  }

  return params.toString();
}

function buildLedgerBudgetLink(monthToken: string, filter: EntryFilterValue) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  return `/ledger/budgets?${params.toString()}`;
}

function buildLedgerListLink(
  monthToken: string,
  filter: EntryFilterValue,
  selectedDisplayOptions: BudgetDisplayOption[],
  showCurrentWeekBudget = false,
  selectedCategoryIds: number[] = [],
) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  const budgetQuery = buildBudgetQuery(selectedDisplayOptions, showCurrentWeekBudget, selectedCategoryIds);
  if (budgetQuery) {
    for (const [key, value] of new URLSearchParams(budgetQuery)) {
      params.set(key, value);
    }
  }

  return `/ledger/list?${params.toString()}`;
}

function buildLedgerWeekListLink(
  monthToken: string,
  filter: EntryFilterValue,
  selectedDisplayOptions: BudgetDisplayOption[],
  showCurrentWeekBudget = false,
  selectedCategoryIds: number[] = [],
) {
  const params = new URLSearchParams({ month: monthToken });
  if (filter !== "ALL") {
    params.set("type", filter);
  }

  const budgetQuery = buildBudgetQuery(selectedDisplayOptions, showCurrentWeekBudget, selectedCategoryIds);
  if (budgetQuery) {
    for (const [key, value] of new URLSearchParams(budgetQuery)) {
      params.set(key, value);
    }
  }

  return `/ledger/weeks?${params.toString()}`;
}

function toggleEntryFilter(currentFilter: EntryFilterValue, nextFilter: LedgerEntryTypeValue): EntryFilterValue {
  return currentFilter === nextFilter ? "ALL" : nextFilter;
}

function toggleBudgetDisplayOption(currentOptions: BudgetDisplayOption[], nextOption: BudgetDisplayOption) {
  return currentOptions.includes(nextOption)
    ? currentOptions.filter((option) => option !== nextOption)
    : [...currentOptions, nextOption];
}

function getDailyAmountText(amount: number) {
  if (amount <= 0) {
    return "";
  }

  return formatCalendarAmount(amount);
}

function formatBudgetRemainingText(amount: number) {
  const rounded = Math.round(amount);
  const absoluteAmount = formatCalendarAmount(Math.abs(rounded));

  if (rounded < 0) {
    return `-${absoluteAmount}`;
  }

  return absoluteAmount;
}

function getCurrentWeekBudgetInlineLabel(type: LedgerEntryTypeValue, amount: number) {
  const valueText = formatLedgerAmount(Math.abs(amount));

  if (type === "EXPENSE") {
    return amount < 0 ? `초과 ${valueText}` : `남은 ${valueText}`;
  }

  return `달성 ${formatLedgerAmount(amount)}`;
}

function formatCompactBudgetRangeLabel(start: Date, endExclusive: Date) {
  const endInclusive = addLedgerDays(endExclusive, -1);
  const startMonth = start.getMonth() + 1;
  const endMonth = endInclusive.getMonth() + 1;
  const startDay = start.getDate();
  const endDay = endInclusive.getDate();

  if (startMonth === endMonth) {
    return `${startMonth}/${startDay}-${endDay}`;
  }

  return `${startMonth}/${startDay}-${endMonth}/${endDay}`;
}

function getBudgetBoundaryDate(value: Date | string) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function getBudgetDisplayAmount(type: LedgerEntryTypeValue, budgetAmount: number, actualAmount: number) {
  if (type === "EXPENSE") {
    return budgetAmount - actualAmount;
  }

  return actualAmount;
}

function getBudgetDisplayTextClass(type: LedgerEntryTypeValue, value: number, targetAmount: number, emphasis = false) {
  if (type === "EXPENSE") {
    if (value < 0) {
      return emphasis ? "text-rose-400" : "text-rose-300";
    }

    return emphasis ? "text-slate-500" : "text-slate-300";
  }

  if (type === "INCOME") {
    if (value >= targetAmount) {
      return emphasis ? "text-sky-500" : "text-sky-300";
    }

    return emphasis ? "text-slate-500" : "text-slate-300";
  }

  if (value >= targetAmount) {
    return emphasis ? "text-emerald-600" : "text-emerald-300";
  }

  return emphasis ? "text-slate-500" : "text-slate-300";
}

function getRoutineMarkerClass(status: "SUCCESS" | "FAIL" | "SKIPPED", isOutsideMonth: boolean) {
  if (status === "SUCCESS") {
    return isOutsideMonth ? "opacity-55" : "opacity-100";
  }

  if (status === "FAIL") {
    return isOutsideMonth ? "opacity-30" : "opacity-45";
  }

  return isOutsideMonth ? "opacity-20" : "opacity-30";
}

async function redirectWithLedgerToast(
  request: Request,
  type: "success" | "error",
  message: string,
  monthToken: string,
  filter: EntryFilterValue,
  selectedDisplayOptions: BudgetDisplayOption[],
  showCurrentWeekBudget: boolean,
  selectedCategoryIds: number[],
) {
  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  flashSession.flash("toast", { type, message });

  return redirect(buildLedgerMonthLink(monthToken, filter, selectedDisplayOptions, showCurrentWeekBudget, selectedCategoryIds), {
    headers: {
      "Set-Cookie": await commitSession(flashSession),
    },
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  const url = new URL(request.url);
  const monthToken = parseMonthToken(url.searchParams.get("month")) ?? getMonthToken(new Date());
  const selectedFilter = parseEntryFilter(url.searchParams.get("type"));
  const selectedDisplayOptions = parseBudgetDisplayOptions(url.searchParams.get("display"));
  const showCurrentWeekBudget = parseCurrentWeekBudgetView(url.searchParams.get("currentWeek"));
  const selectedCategoryIds = parseCategoryIds(url.searchParams);
  const formData = await request.formData();

  if (formData.get("intent") !== "apply_week_carry") {
    return redirect(
      buildLedgerMonthLink(monthToken, selectedFilter, selectedDisplayOptions, showCurrentWeekBudget, selectedCategoryIds),
    );
  }

  const requestedType = formData.get("type");
  const budgetType: LedgerEntryTypeValue =
    requestedType === "INCOME" || requestedType === "EXPENSE" || requestedType === "SAVING"
      ? requestedType
      : selectedFilter === "ALL"
        ? "EXPENSE"
        : selectedFilter;

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
      monthToken,
      selectedFilter,
      selectedDisplayOptions,
      showCurrentWeekBudget,
      selectedCategoryIds,
    );
  } catch (error) {
    return redirectWithLedgerToast(
      request,
      "error",
      error instanceof Error ? error.message : "이번 주 예산을 이월하지 못했습니다.",
      monthToken,
      selectedFilter,
      selectedDisplayOptions,
      showCurrentWeekBudget,
      selectedCategoryIds,
    );
  }
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
  const selectedDisplayOptions = parseBudgetDisplayOptions(url.searchParams.get("display"));
  const showCurrentWeekBudget = parseCurrentWeekBudgetView(url.searchParams.get("currentWeek"));
  const requestedCategoryIds = parseCategoryIds(url.searchParams);
  const budgetFocusType: LedgerEntryTypeValue = selectedFilter === "ALL" ? "EXPENSE" : selectedFilter;
  const monthStart = getMonthStart(monthToken);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 12, 0, 0, 0);
  const nextMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1, 0, 0, 0, 0);

  const routineRangeStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - 7, 0, 0, 0, 0);
  const routineRangeEnd = new Date(nextMonthStart.getFullYear(), nextMonthStart.getMonth(), 1 + 7, 0, 0, 0, 0);

  const [firstBudgetPeriodResult, lastBudgetPeriodResult, currentWeekBudget, categories, routineRecords] = await Promise.all([
    ensureLedgerBudgetPeriodForDate(db, user.id, monthStart),
    ensureLedgerBudgetPeriodForDate(db, user.id, monthEnd),
    monthToken === todayMonthToken ? getCurrentLedgerWeekBudgetSummary(db, user.id, budgetFocusType, today) : Promise.resolve(null),
    loadLedgerCategories(db, user.id),
    loadRoutineCalendarRecords(db, user.id, routineRangeStart, routineRangeEnd),
  ]);

  const budgetPeriodsById = new Map<number, BudgetPeriodSummary>();
  for (const period of [firstBudgetPeriodResult.period, lastBudgetPeriodResult.period]) {
      budgetPeriodsById.set(period.id, {
        id: period.id,
        periodStartAt: period.periodStartAt.toISOString(),
        periodEndAt: period.periodEndAt.toISOString(),
        plans: period.plans.map((plan: any) => ({
          type: plan.type,
          totalAmount: Number(plan.totalAmount),
          weekCarryMode: plan.weekCarryMode,
          weeks: plan.weeks.map((week: any) => ({
            weekIndex: week.weekIndex,
            weekStartAt: week.weekStartAt.toISOString(),
            weekEndAt: week.weekEndAt.toISOString(),
            plannedAmount: Number(week.plannedAmount),
            carryInAmount: Number(week.carryInAmount),
            carryOutAmount: Number(week.carryOutAmount),
          })),
          allocations: plan.allocations.map((allocation: any) => ({
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
      const periodStartAt = getBudgetBoundaryDate(period.periodStartAt);
      return periodStartAt < start ? periodStartAt : start;
    },
    new Date(monthStart.getFullYear(), monthStart.getMonth(), 1, 0, 0, 0, 0),
  );
  const entryRangeEnd = budgetPeriods.reduce(
    (end, period) => {
      const periodEndAt = getBudgetBoundaryDate(period.periodEndAt);
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
    select: {
      type: true,
      amount: true,
      usedAt: true,
      excludeFromStats: true,
      categoryId: true,
    },
  });

  const selectedCategoryIds =
    selectedFilter !== "ALL"
      ? requestedCategoryIds.filter((categoryId) =>
          categories.some((category) => category.id === categoryId && category.type === selectedFilter),
        )
      : [];

  return {
    monthToken,
    selectedFilter,
    selectedCategoryIds,
    selectedDisplayOptions,
    showCurrentWeekBudget,
    currentWeekBudget,
    monthLabel: getMonthLabel(monthStart),
    prevMonthToken: shiftMonthToken(monthToken, -1),
    nextMonthToken: shiftMonthToken(monthToken, 1),
    settings: {
      weekStartDay: firstBudgetPeriodResult.settings.weekStartDay,
    },
    categories: categories.map((category: any) => ({
      id: category.id,
      type: category.type,
      name: category.name,
    })),
    budgetPeriods,
    entries: entries.map((entry) => ({
      type: entry.type,
      amount: Number(entry.amount),
      usedAt: entry.usedAt.toISOString(),
      excludeFromStats: entry.excludeFromStats,
      categoryId: entry.categoryId,
    })),
    routineRecords: routineRecords.map((record: any) => ({
      id: record.id,
      typeId: record.typeId,
      status: record.status,
      recordDate: record.recordDate.toISOString(),
      createdAt: record.createdAt.toISOString(),
      type: {
        id: record.type.id,
        color: record.type.color,
        sortOrder: record.type.sortOrder,
      },
    })),
  };
};

export default function LedgerPage() {
  const {
    monthToken,
    selectedFilter,
    selectedCategoryIds,
    selectedDisplayOptions,
    showCurrentWeekBudget,
    currentWeekBudget,
    monthLabel,
    prevMonthToken,
    nextMonthToken,
    settings,
    categories,
    budgetPeriods,
    entries,
    routineRecords,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const currentYear = Number(monthToken.slice(0, 4));
  const [isJumpPickerOpen, setIsJumpPickerOpen] = useState(false);
  const [isDisplayOptionsOpen, setIsDisplayOptionsOpen] = useState(() => showCurrentWeekBudget || selectedDisplayOptions.length > 0);
  const [isCategoryFiltersExpanded, setIsCategoryFiltersExpanded] = useState(false);
  const [jumpYear, setJumpYear] = useState(currentYear);
  const calendarMonth = useMemo(() => getMonthStart(monthToken), [monthToken]);
  const monthEnd = useMemo(
    () => new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0, 12, 0, 0, 0),
    [calendarMonth],
  );
  const nextCalendarMonth = useMemo(
    () => new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1, 0, 0, 0, 0),
    [calendarMonth],
  );
  const visibleCalendarStart = useMemo(
    () => getStartOfBudgetWeek(calendarMonth, settings.weekStartDay),
    [calendarMonth, settings.weekStartDay],
  );
  const visibleCalendarEnd = useMemo(
    () => addLedgerDays(getStartOfBudgetWeek(monthEnd, settings.weekStartDay), 7),
    [monthEnd, settings.weekStartDay],
  );
  const today = useMemo(() => new Date(), []);
  const todayMonthToken = getMonthToken(today);
  const todayDateToken = getDateKey(today);
  const budgetFocusType: LedgerEntryTypeValue = selectedFilter === "ALL" ? "EXPENSE" : selectedFilter;
  const selectedBudgetDisplaySet = useMemo(() => new Set<BudgetDisplayOption>(selectedDisplayOptions), [selectedDisplayOptions]);
  const canShowCurrentWeekBudget = monthToken === todayMonthToken && currentWeekBudget !== null;
  const currentWeekRange = useMemo(
    () => {
      if (!canShowCurrentWeekBudget) {
        return null;
      }

      const start = getStartOfBudgetWeek(today, settings.weekStartDay);
      return {
        start,
        end: addLedgerDays(start, 7),
      };
    },
    [canShowCurrentWeekBudget, settings.weekStartDay, today],
  );
  const currentWeekVisibleStartToken = useMemo(() => {
    if (!currentWeekRange) {
      return null;
    }

    const visibleStart = currentWeekRange.start < calendarMonth ? calendarMonth : currentWeekRange.start;
    if (visibleStart >= nextCalendarMonth) {
      return null;
    }

    return getDateKey(visibleStart);
  }, [calendarMonth, currentWeekRange, nextCalendarMonth]);
  const primaryBudgetPeriod = useMemo(
    () =>
      budgetPeriods.find((period) => {
        const periodStartAt = getBudgetBoundaryDate(period.periodStartAt);
        const periodEndAt = getBudgetBoundaryDate(period.periodEndAt);
        return calendarMonth >= periodStartAt && calendarMonth < periodEndAt;
      }) ?? budgetPeriods[0] ?? null,
    [budgetPeriods, calendarMonth],
  );
  const budgetStartDateTokens = useMemo(() => {
    return new Set(
      budgetPeriods
        .map((period) => getDateKey(new Date(period.periodStartAt)))
        .filter((dateToken) => {
          const date = new Date(`${dateToken}T12:00:00`);
          return date >= visibleCalendarStart && date < visibleCalendarEnd;
        }),
    );
  }, [budgetPeriods, visibleCalendarEnd, visibleCalendarStart]);
  const currentBudgetPlan = useMemo(
    () => primaryBudgetPeriod?.plans.find((plan) => plan.type === budgetFocusType) ?? null,
    [budgetFocusType, primaryBudgetPeriod],
  );
  const monthEntries = useMemo(
    () =>
      entries.filter((entry) => {
        const usedAt = new Date(entry.usedAt);
        return usedAt >= calendarMonth && usedAt < nextCalendarMonth;
      }),
    [calendarMonth, entries, nextCalendarMonth],
  );
  const filteredEntries = useMemo(
    () => {
      const typeEntries =
        selectedFilter === "ALL" ? monthEntries : monthEntries.filter((entry) => entry.type === selectedFilter);

      return selectedCategoryIds.length === 0
        ? typeEntries
        : typeEntries.filter((entry) => entry.categoryId !== null && selectedCategoryIds.includes(entry.categoryId));
    },
    [monthEntries, selectedCategoryIds, selectedFilter],
  );
  const budgetStatsEntries = useMemo(
    () => entries.filter((entry) => !entry.excludeFromStats && entry.type === budgetFocusType),
    [budgetFocusType, entries],
  );
  const visibleCategories = useMemo(() => {
    if (selectedFilter === "ALL") {
      return [];
    }

    const monthCategoryIds = new Set(
      monthEntries
        .filter((entry) => entry.type === selectedFilter && entry.categoryId !== null)
        .map((entry) => entry.categoryId as number),
    );

      return categories.filter(
        (category: any) => category.type === selectedFilter && (monthCategoryIds.has(category.id) || selectedCategoryIds.includes(category.id)),
      );
  }, [categories, monthEntries, selectedCategoryIds, selectedFilter]);
  const routineMarkersByDate = useMemo(() => {
    const grouped = new Map<
      string,
      Map<
        number,
        {
          color: string | null;
          sortOrder: number;
          status: "SUCCESS" | "FAIL" | "SKIPPED";
          createdAt: string;
        }
      >
    >();

    for (const record of routineRecords) {
      if (record.status !== "SUCCESS") {
        continue;
      }

      const dateKey = getDateKey(new Date(record.recordDate));
      const dateGroup = grouped.get(dateKey) ?? new Map();
      const existing = dateGroup.get(record.typeId);

      if (!existing || new Date(record.createdAt) > new Date(existing.createdAt)) {
        dateGroup.set(record.typeId, {
          color: record.type.color,
          sortOrder: record.type.sortOrder,
          status: record.status,
          createdAt: record.createdAt,
        });
      }

      grouped.set(dateKey, dateGroup);
    }

    return new Map(
      Array.from(grouped.entries()).map(([dateKey, dateGroup]) => [
        dateKey,
        Array.from(dateGroup.values()).sort((left, right) => left.sortOrder - right.sortOrder),
      ]),
    );
  }, [routineRecords]);
  const canCollapseCategoryFilters = visibleCategories.length > 6;
  const shouldShowCategoryFilters = !canCollapseCategoryFilters || isCategoryFiltersExpanded || selectedCategoryIds.length > 0;
  const weeklyBudgetStateByDate = useMemo(() => {
    const weeklyState = new Map<string, { target: number; value: number; dayBudget: number }>();

    for (const period of budgetPeriods) {
      const plan = period.plans.find((item) => item.type === budgetFocusType);
      if (!plan || plan.totalAmount <= 0) {
        continue;
      }

      const displayTotalAmount = getBudgetDisplayTotalAmount(
        budgetFocusType,
        plan.totalAmount,
        plan.allocations,
      );
      if (displayTotalAmount <= 0) {
        continue;
      }

      const periodStartAt = new Date(period.periodStartAt);
      const periodEndAt = new Date(period.periodEndAt);
      const normalizedPeriodStartAt = getBudgetBoundaryDate(period.periodStartAt);
      const normalizedPeriodEndAt = getBudgetBoundaryDate(period.periodEndAt);
      const weekRanges = getBudgetWeekRanges(normalizedPeriodStartAt, normalizedPeriodEndAt, settings.weekStartDay);
      if (weekRanges.length === 0) {
        continue;
      }

      const dayCount = getBudgetPeriodDayCount({ periodStartAt: normalizedPeriodStartAt, periodEndAt: normalizedPeriodEndAt });
      const dailyBudgetAmount = getBudgetScopeAmount(displayTotalAmount, "DAY", dayCount, 1);
      const weekRowByIndex = new Map(plan.weeks.map((week) => [week.weekIndex, week]));
      const fixedExpenseCategoryIds =
        budgetFocusType === "EXPENSE" ? getFixedExpenseCategoryIds(plan.allocations) : new Set<number>();
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

          if (
            budgetFocusType === "EXPENSE" &&
            entry.categoryId !== null &&
            fixedExpenseCategoryIds.has(entry.categoryId)
          ) {
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

        weeklyState.set(getDateKey(range.start), {
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
  }, [budgetFocusType, budgetPeriods, budgetStatsEntries, settings.weekStartDay]);

  const dailySummaryByDate = useMemo(() => {
    const grouped = new Map<string, { income: number; expense: number; saving: number }>();

    for (const entry of filteredEntries) {
      const key = getDateKey(new Date(entry.usedAt));
      const current = grouped.get(key) ?? { income: 0, expense: 0, saving: 0 };

      if (entry.type === "INCOME") current.income += entry.amount;
      if (entry.type === "EXPENSE") current.expense += entry.amount;
      if (entry.type === "SAVING") current.saving += entry.amount;

      grouped.set(key, current);
    }

    return grouped;
  }, [filteredEntries]);

  const summary = useMemo(
    () =>
      monthEntries.reduce(
        (acc, entry) => {
          if (entry.type === "INCOME") acc.income += entry.amount;
          if (entry.type === "EXPENSE") acc.expense += entry.amount;
          if (entry.type === "SAVING") acc.saving += entry.amount;
          return acc;
        },
        { income: 0, expense: 0, saving: 0 },
      ),
    [monthEntries],
  );

  const budgetRemainingByDate = useMemo(() => {
    const budgetMap = new Map<
      string,
      {
        day: { value: number; target: number } | null;
        week: { value: number; target: number } | null;
        month: { value: number; target: number } | null;
      }
    >();
    for (let currentDate = new Date(visibleCalendarStart); currentDate < visibleCalendarEnd; currentDate = addLedgerDays(currentDate, 1)) {
      const currentDateStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 0, 0, 0, 0);
      const nextDate = addLedgerDays(currentDateStart, 1);
      const currentDateToken = getDateKey(currentDate);
      const matchingPeriod = budgetPeriods.find((period) => {
        const periodStartAt = getBudgetBoundaryDate(period.periodStartAt);
        const periodEndAt = getBudgetBoundaryDate(period.periodEndAt);
        return currentDateStart >= periodStartAt && currentDateStart < periodEndAt;
      });

      if (!matchingPeriod) {
        budgetMap.set(currentDateToken, { day: null, week: null, month: null });
        continue;
      }

      const matchingPlan = matchingPeriod.plans.find((plan) => plan.type === budgetFocusType);
      if (!matchingPlan || matchingPlan.totalAmount <= 0) {
        budgetMap.set(currentDateToken, { day: null, week: null, month: null });
        continue;
      }

      const displayTotalAmount = getBudgetDisplayTotalAmount(
        budgetFocusType,
        matchingPlan.totalAmount,
        matchingPlan.allocations,
      );
      if (displayTotalAmount <= 0) {
        budgetMap.set(currentDateToken, { day: null, week: null, month: null });
        continue;
      }

      const periodStartAt = getBudgetBoundaryDate(matchingPeriod.periodStartAt);
      const periodEndAt = getBudgetBoundaryDate(matchingPeriod.periodEndAt);
      const periodDayCount = getBudgetPeriodDayCount({
        periodStartAt,
        periodEndAt,
      });
      const weekRanges = getBudgetWeekRanges(periodStartAt, periodEndAt, settings.weekStartDay);
      const weekRange =
        weekRanges.find((range) => currentDate >= range.start && currentDate < range.end) ?? { start: periodStartAt, end: periodEndAt };
      const fixedExpenseCategoryIds =
        budgetFocusType === "EXPENSE" ? getFixedExpenseCategoryIds(matchingPlan.allocations) : new Set<number>();

      const getBudgetAmount = (scope: "MONTH" | "WEEK" | "DAY") => {
        if (displayTotalAmount <= 0) {
          return 0;
        }

        if (scope === "WEEK") {
          const rangeDayCount = Math.max(1, getBudgetPeriodDayCount({ periodStartAt: weekRange.start, periodEndAt: weekRange.end }));
          return getBudgetScopeAmount(displayTotalAmount, "DAY", periodDayCount, 1) * rangeDayCount;
        }

        return getBudgetScopeAmount(displayTotalAmount, scope, periodDayCount, 1);
      };

      const getSpentAmount = (scope: "MONTH" | "WEEK" | "DAY") => {
        return budgetStatsEntries.reduce((sum, entry) => {
          const usedAt = new Date(entry.usedAt);
          if (
            budgetFocusType === "EXPENSE" &&
            entry.categoryId !== null &&
            fixedExpenseCategoryIds.has(entry.categoryId)
          ) {
            return sum;
          }

          if (scope === "DAY") {
            return usedAt >= currentDateStart && usedAt < nextDate ? sum + entry.amount : sum;
          }

          if (scope === "WEEK") {
            return usedAt >= weekRange.start && usedAt < weekRange.end ? sum + entry.amount : sum;
          }

          return usedAt >= periodStartAt && usedAt < periodEndAt ? sum + entry.amount : sum;
        }, 0);
      };

      const monthBudgetAmount = getBudgetAmount("MONTH");
      const weekBudgetState = weeklyBudgetStateByDate.get(getDateKey(weekRange.start)) ?? null;
      const dayBudgetAmount = getBudgetAmount("DAY");
      const monthSpent = getSpentAmount("MONTH");
      const daySpent = getSpentAmount("DAY");
      const shouldShowDayBudget = selectedBudgetDisplaySet.has("SHOW_DAY_BUDGET");
      const weekDisplayDate = new Date(weekRange.end);
      weekDisplayDate.setDate(weekDisplayDate.getDate() - 1);
      const monthDisplayDate = new Date(periodEndAt);
      monthDisplayDate.setDate(monthDisplayDate.getDate() - 1);
      const shouldShowWeekBudget = selectedBudgetDisplaySet.has("SHOW_WEEK_BUDGET") && getDateKey(weekDisplayDate) === currentDateToken;
      const shouldShowMonthBudget = selectedBudgetDisplaySet.has("SHOW_MONTH_BUDGET") && getDateKey(monthDisplayDate) === currentDateToken;
      const isCurrentWeekDate =
        showCurrentWeekBudget &&
        currentWeekRange !== null &&
        currentDate >= currentWeekRange.start &&
        currentDate < currentWeekRange.end;

      budgetMap.set(currentDateToken, {
        day:
          (shouldShowDayBudget || isCurrentWeekDate) && dayBudgetAmount > 0
            ? { value: getBudgetDisplayAmount(budgetFocusType, dayBudgetAmount, daySpent), target: dayBudgetAmount }
            : null,
        week:
          shouldShowWeekBudget && weekBudgetState !== null
            ? weekBudgetState
            : null,
        month:
          shouldShowMonthBudget && monthBudgetAmount > 0
            ? { value: getBudgetDisplayAmount(budgetFocusType, monthBudgetAmount, monthSpent), target: monthBudgetAmount }
            : null,
      });
    }

    return budgetMap;
  }, [
    budgetFocusType,
    budgetPeriods,
    calendarMonth,
    currentWeekBudget,
    currentWeekRange,
    currentWeekVisibleStartToken,
    entries,
    monthEnd,
    weeklyBudgetStateByDate,
    selectedBudgetDisplaySet,
    settings.weekStartDay,
    showCurrentWeekBudget,
    visibleCalendarEnd,
    visibleCalendarStart,
  ]);
  const currentWeekInlineSegments = useMemo(() => {
    if (!currentWeekRange) {
      if (!currentWeekBudget) {
        return [];
      }

      return [
        {
          key: "current",
          label: currentWeekBudget.weekLabel,
          amount: currentWeekBudget.displayAmount,
        },
      ];
    }

    const segments: Array<{
      key: string;
      label: string;
      amount: number;
      start: Date;
      end: Date;
    }> = [];

    for (let cursor = new Date(currentWeekRange.start); cursor < currentWeekRange.end; cursor = addLedgerDays(cursor, 1)) {
      const matchingPeriod = budgetPeriods.find((period) => {
        const periodStartAt = getBudgetBoundaryDate(period.periodStartAt);
        const periodEndAt = getBudgetBoundaryDate(period.periodEndAt);
        return cursor >= periodStartAt && cursor < periodEndAt;
      });
      const dayBudget = budgetRemainingByDate.get(getDateKey(cursor))?.day;

      if (!matchingPeriod || !dayBudget) {
        continue;
      }

      const lastSegment = segments[segments.length - 1];
      if (lastSegment && lastSegment.key === String(matchingPeriod.id)) {
        lastSegment.amount += dayBudget.value;
        lastSegment.end = addLedgerDays(cursor, 1);
        lastSegment.label = formatCompactBudgetRangeLabel(lastSegment.start, lastSegment.end);
        continue;
      }

      segments.push({
        key: String(matchingPeriod.id),
        label: formatCompactBudgetRangeLabel(cursor, addLedgerDays(cursor, 1)),
        amount: dayBudget.value,
        start: new Date(cursor),
        end: addLedgerDays(cursor, 1),
      });
    }

    return segments.map(({ key, label, amount }) => ({
      key,
      label,
      amount,
    }));
  }, [budgetPeriods, budgetRemainingByDate, currentWeekBudget, currentWeekRange]);

  const toggleBudgetDisplay = (option: BudgetDisplayOption) => {
    navigate(
      buildLedgerMonthLink(
        monthToken,
        selectedFilter,
        toggleBudgetDisplayOption(selectedDisplayOptions, option),
        showCurrentWeekBudget,
        selectedCategoryIds,
      ),
    );
  };

  const toggleCurrentWeekBudgetView = () => {
    navigate(buildLedgerMonthLink(monthToken, selectedFilter, selectedDisplayOptions, !showCurrentWeekBudget, selectedCategoryIds));
  };

  const toggleCategoryFilter = (categoryId: number) => {
    const nextCategoryIds = selectedCategoryIds.includes(categoryId)
      ? selectedCategoryIds.filter((id) => id !== categoryId)
      : [...selectedCategoryIds, categoryId];
    navigate(
      buildLedgerMonthLink(
        monthToken,
        selectedFilter,
        selectedDisplayOptions,
        showCurrentWeekBudget,
        nextCategoryIds,
      ),
    );
  };

  const openDateRoute = (date: Date | undefined) => {
    if (!date) {
      return;
    }

    navigate(
      buildLedgerDateLink(
        getDateKey(date),
        monthToken,
        selectedFilter,
        selectedDisplayOptions,
        showCurrentWeekBudget,
        selectedCategoryIds,
      ),
    );
  };

  const openMonthJumpPicker = (open: boolean) => {
    setIsJumpPickerOpen(open);
    if (open) {
      setJumpYear(currentYear);
    }
  };

  const jumpToPickedMonth = (monthIndex: number) => {
    setIsJumpPickerOpen(false);
    navigate(
      buildLedgerMonthLink(
        getMonthToken(new Date(jumpYear, monthIndex, 1, 12, 0, 0, 0)),
        selectedFilter,
        selectedDisplayOptions,
        showCurrentWeekBudget,
        selectedCategoryIds,
      ),
    );
  };

  return (
    <>
      <div className="min-h-screen bg-white">
        <div className="border-b bg-white">
          <div className="flex items-center justify-between px-2 py-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full text-slate-700">
                  <Menu className="h-7 w-7" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="text-[0.82rem]">
                <DropdownMenuItem asChild>
                  <Link to="/">홈</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/mypage">내정보</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center gap-1">
              <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
                <Link
                  to={buildLedgerMonthLink(
                    prevMonthToken,
                    selectedFilter,
                    selectedDisplayOptions,
                    showCurrentWeekBudget,
                    selectedCategoryIds,
                  )}
                >
                  <ChevronLeft className="h-6 w-6" />
                </Link>
              </Button>
              <Popover open={isJumpPickerOpen} onOpenChange={openMonthJumpPicker}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="min-w-[8rem] rounded-md px-2 py-1 text-center text-[1.05rem] font-semibold tracking-tight text-slate-900 transition-colors hover:bg-slate-100"
                    aria-label="원하는 월로 이동"
                  >
                    {monthLabel}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="center" side="bottom" sideOffset={10} className="w-[17rem] rounded-2xl p-3 shadow-lg">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full text-slate-700"
                        onClick={() => setJumpYear((year) => year - 1)}
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </Button>
                      <p className="text-[0.92rem] font-semibold text-slate-900">{jumpYear}년</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full text-slate-700"
                        onClick={() => setJumpYear((year) => year + 1)}
                      >
                        <ChevronRight className="h-5 w-5" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {Array.from({ length: 12 }, (_, monthIndex) => {
                        const isCurrentMonth = jumpYear === calendarMonth.getFullYear() && monthIndex === calendarMonth.getMonth();

                        return (
                          <button
                            key={monthIndex}
                            type="button"
                            className={cn(
                              "rounded-xl border px-3 py-3 text-[0.82rem] font-medium transition-colors",
                              isCurrentMonth
                                ? "border-slate-800 bg-slate-800 text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                            )}
                            onClick={() => jumpToPickedMonth(monthIndex)}
                          >
                            {monthIndex + 1}월
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
                <Link
                  to={buildLedgerMonthLink(
                    nextMonthToken,
                    selectedFilter,
                    selectedDisplayOptions,
                    showCurrentWeekBudget,
                    selectedCategoryIds,
                  )}
                >
                  <ChevronRight className="h-6 w-6" />
                </Link>
              </Button>
            </div>

            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full text-slate-700">
                    <MoreVertical className="h-6 w-6" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-[0.82rem]">
                  <DropdownMenuItem asChild>
                    <Link
                      to={buildLedgerMonthLink(
                        todayMonthToken,
                        selectedFilter,
                        selectedDisplayOptions,
                        showCurrentWeekBudget,
                        selectedCategoryIds,
                      )}
                    >
                      이번 달
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      to={`/ledger/stats?month=${monthToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}${
                        buildBudgetQuery(selectedDisplayOptions, showCurrentWeekBudget, selectedCategoryIds)
                          ? `&${buildBudgetQuery(selectedDisplayOptions, showCurrentWeekBudget, selectedCategoryIds)}`
                          : ""
                      }`}
                    >
                      통계
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/ledger/settings">설정</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to={buildLedgerBudgetLink(monthToken, selectedFilter)}>이 달 예산 수정</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      to={buildLedgerListLink(
                        monthToken,
                        selectedFilter,
                        selectedDisplayOptions,
                        showCurrentWeekBudget,
                        selectedCategoryIds,
                      )}
                      reloadDocument
                    >
                      월 리스트 보기
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      to={buildLedgerWeekListLink(
                        monthToken,
                        selectedFilter,
                        selectedDisplayOptions,
                        showCurrentWeekBudget,
                        selectedCategoryIds,
                      )}
                      reloadDocument
                    >
                      주별 리스트 보기
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 border-b bg-white">
          <Link
            to={buildLedgerMonthLink(monthToken, toggleEntryFilter(selectedFilter, "INCOME"), selectedDisplayOptions, showCurrentWeekBudget)}
            className={cn("py-3 text-center transition-colors", selectedFilter === "INCOME" ? "bg-sky-50" : "hover:bg-slate-50")}
          >
            <p className="text-[0.82rem] font-medium text-slate-900">수입</p>
            <p className="mt-1 text-[0.82rem] font-semibold text-sky-500">{formatLedgerAmount(summary.income)}</p>
          </Link>
          <Link
            to={buildLedgerMonthLink(monthToken, toggleEntryFilter(selectedFilter, "EXPENSE"), selectedDisplayOptions, showCurrentWeekBudget)}
            className={cn("py-3 text-center transition-colors", selectedFilter === "EXPENSE" ? "bg-rose-50" : "hover:bg-slate-50")}
          >
            <p className="text-[0.82rem] font-medium text-slate-900">지출</p>
            <p className="mt-1 text-[0.82rem] font-semibold text-rose-400">{formatLedgerAmount(summary.expense)}</p>
          </Link>
          <Link
            to={buildLedgerMonthLink(monthToken, toggleEntryFilter(selectedFilter, "SAVING"), selectedDisplayOptions, showCurrentWeekBudget)}
            className={cn("py-3 text-center transition-colors", selectedFilter === "SAVING" ? "bg-emerald-50" : "hover:bg-slate-50")}
          >
            <p className="text-[0.82rem] font-medium text-slate-900">저축</p>
            <p className="mt-1 text-[0.82rem] font-semibold text-emerald-600">{formatLedgerAmount(summary.saving)}</p>
          </Link>
        </div>

        <div className="bg-white">
          <button
            type="button"
            className="relative flex h-2.5 w-full items-center justify-center bg-white"
            onClick={() => setIsDisplayOptionsOpen((open) => !open)}
            aria-label={isDisplayOptionsOpen ? "표시 항목 접기" : "표시 항목 펼치기"}
          >
            <span className="relative z-10 inline-flex h-4 w-8 -translate-y-1 items-center justify-center bg-white">
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-slate-400 transition-transform duration-200",
                  isDisplayOptionsOpen && "rotate-180",
                )}
              />
            </span>
          </button>

          {isDisplayOptionsOpen ? (
            <div className="space-y-2 px-2 pb-2 pt-1">
              <div className="overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="inline-flex gap-1.5">
                  {ALL_BUDGET_DISPLAY_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
                        getCategoryChipClass(budgetFocusType, selectedBudgetDisplaySet.has(option), true),
                      )}
                      onClick={() => toggleBudgetDisplay(option)}
                    >
                      {BUDGET_DISPLAY_LABELS[option]}
                    </button>
                  ))}
                  {canShowCurrentWeekBudget ? (
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
                          showCurrentWeekBudget
                            ? "border-slate-300 bg-slate-100 text-slate-700"
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                        )}
                        onClick={toggleCurrentWeekBudgetView}
                      >
                        이번주 예산 보기
                      </button>
                      {showCurrentWeekBudget && currentWeekInlineSegments.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {currentWeekInlineSegments.map((segment) => (
                            <span key={segment.key} className="text-[10px] font-medium text-slate-500">
                              {getCurrentWeekBudgetInlineLabel(budgetFocusType, segment.amount)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
              {canShowCurrentWeekBudget &&
              showCurrentWeekBudget &&
              currentWeekBudget?.weekCarryMode === "MANUAL" &&
              currentWeekBudget.canApplyCarry ? (
                    <Form method="post" className="inline-flex">
                      <input type="hidden" name="intent" value="apply_week_carry" />
                      <input type="hidden" name="type" value={budgetFocusType} />
                      <Button
                        type="submit"
                        variant="outline"
                        className="h-6 rounded-full border-slate-300 px-2.5 text-[10px] text-slate-600"
                      >
                        이월하기
                      </Button>
                    </Form>
                  ) : null}
                </div>
              </div>
              {selectedFilter !== "ALL" && visibleCategories.length > 0 ? (
                <div className="space-y-1">
                  {canCollapseCategoryFilters ? (
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-50"
                      onClick={() => setIsCategoryFiltersExpanded((open) => !open)}
                    >
                      <span>카테고리 {visibleCategories.length}개</span>
                      <ChevronDown
                        className={cn("h-3.5 w-3.5 transition-transform duration-200", shouldShowCategoryFilters && "rotate-180")}
                      />
                    </button>
                  ) : null}
                  {shouldShowCategoryFilters ? (
                    <div className="overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <div className="inline-flex gap-1.5">
                        {visibleCategories.map((category: any) => (
                          <button
                            key={category.id}
                            type="button"
                            className={cn(
                              "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
                              getCategoryChipClass(selectedFilter, selectedCategoryIds.includes(category.id)),
                            )}
                            onClick={() => toggleCategoryFilter(category.id)}
                          >
                            {category.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <Calendar
          mode="single"
          locale={ko}
          showOutsideDays
          month={calendarMonth}
          onSelect={openDateRoute}
          disableNavigation
          className="w-full max-w-none overflow-hidden bg-white p-0 [--cell-size:3.5rem]"
          classNames={{
            root: "w-full",
            months: "w-full",
            month: "w-full gap-0",
            nav: "hidden",
            month_caption: "hidden",
            table: "w-full table-fixed border-l border-t border-slate-200",
            weekdays: "grid grid-cols-7 border-b border-slate-200 bg-white",
            weekday:
              "py-2 text-center text-[0.65rem] font-medium text-slate-700 [&:first-child]:text-rose-400 [&:last-child]:text-sky-500",
            week: "mt-0 grid grid-cols-7",
            day: "relative min-w-0 w-full border-b border-r border-slate-200 p-0 align-top",
            day_button: "hidden",
            today: "bg-transparent text-inherit",
            selected: "bg-transparent text-inherit",
          }}
          components={{
            DayButton: ({ day, modifiers, className, ...props }) => {
              const daySummary = dailySummaryByDate.get(getDateKey(day.date)) ?? { income: 0, expense: 0, saving: 0 };
              const dayBudget = budgetRemainingByDate.get(getDateKey(day.date)) ?? { day: null, week: null, month: null };
              const isBudgetStartDate = budgetStartDateTokens.has(getDateKey(day.date));
              const routineMarkers = routineMarkersByDate.get(getDateKey(day.date)) ?? [];
              const dayOfWeek = day.date.getDay();
              const isOutsideMonth = modifiers.outside;
              const isToday = getDateKey(day.date) === todayDateToken;
              const isInCurrentWeekRange =
                showCurrentWeekBudget && currentWeekRange ? day.date >= currentWeekRange.start && day.date < currentWeekRange.end : false;
              const dateColorClass =
                isToday
                  ? "text-white"
                  : isOutsideMonth
                    ? dayOfWeek === 0
                      ? "text-rose-200"
                      : dayOfWeek === 6
                        ? "text-sky-300"
                        : "text-slate-300"
                  : dayOfWeek === 0
                    ? "text-rose-300"
                    : dayOfWeek === 6
                      ? "text-sky-400"
                      : "text-slate-500";

              return (
                <CalendarDayButton
                  day={day}
                  modifiers={modifiers}
                  className={cn(
                    className,
                    "flex h-full min-h-[7.25rem] w-full min-w-0 flex-col items-start justify-between rounded-none bg-white px-1 py-1 text-left hover:bg-slate-50",
                    isOutsideMonth && "bg-slate-50/70 hover:bg-slate-50",
                    isInCurrentWeekRange && "bg-amber-50/70",
                    isBudgetStartDate &&
                      "before:pointer-events-none before:absolute before:left-0 before:top-0 before:h-3 before:w-3 before:border-l before:border-t before:border-rose-300",
                    isToday && "bg-slate-100",
                  )}
                  {...props}
                  >
                    <div className="relative inline-flex items-start">
                      <span
                        className={cn(
                          "inline-flex min-w-[1.15rem] items-center justify-center px-0 py-0 text-[0.78rem] font-normal leading-none",
                          dateColorClass,
                          isToday && "bg-slate-500 shadow-sm",
                        )}
                      >
                        {day.date.getDate()}
                      </span>
                      {routineMarkers.length > 0 ? (
                        <div className="pointer-events-none absolute left-full top-0.5 ml-0.5 flex min-w-0 items-center gap-0.5">
                          {routineMarkers.slice(0, routineMarkers.length >= 4 ? 2 : 3).map((marker, index) => (
                            <span
                              key={`${marker.sortOrder}-${index}`}
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                getRoutineMarkerClass(marker.status, isOutsideMonth),
                              )}
                              style={{ backgroundColor: marker.color ?? "#94a3b8" }}
                            />
                          ))}
                          {routineMarkers.length >= 4 ? (
                            <span className={cn("text-[8px] font-medium text-slate-400", isOutsideMonth && "opacity-60")}>
                              +{routineMarkers.length - 2}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  <div className="flex w-full flex-col items-end gap-0.5 text-right">
                    <span className={cn("min-h-[0.72rem] truncate text-[0.58rem] font-medium leading-none", isOutsideMonth ? "text-sky-300" : "text-sky-500")}>
                      {getDailyAmountText(daySummary.income)}
                    </span>
                    <span className={cn("min-h-[0.72rem] truncate text-[0.58rem] font-medium leading-none", isOutsideMonth ? "text-rose-300" : "text-rose-400")}>
                      {getDailyAmountText(daySummary.expense)}
                    </span>
                    <span className={cn("min-h-[0.72rem] truncate text-[0.58rem] font-medium leading-none", isOutsideMonth ? "text-emerald-300" : "text-emerald-600")}>
                      {getDailyAmountText(daySummary.saving)}
                    </span>
                    {isDisplayOptionsOpen && dayBudget.month !== null ? (
                      <span
                        className={cn(
                          "min-h-[0.72rem] truncate text-[0.58rem] font-medium leading-none",
                          getBudgetDisplayTextClass(budgetFocusType, dayBudget.month.value, dayBudget.month.target),
                          isOutsideMonth && "opacity-60",
                        )}
                      >
                        {formatBudgetRemainingText(dayBudget.month.value)}
                      </span>
                    ) : null}
                    {isDisplayOptionsOpen && dayBudget.week !== null ? (
                      <span
                        className={cn(
                          "min-h-[0.72rem] truncate text-[0.58rem] font-medium leading-none",
                          getBudgetDisplayTextClass(budgetFocusType, dayBudget.week.value, dayBudget.week.target),
                          isOutsideMonth && "opacity-60",
                        )}
                      >
                        {formatBudgetRemainingText(dayBudget.week.value)}
                      </span>
                    ) : null}
                    {isDisplayOptionsOpen && dayBudget.day !== null ? (
                      <span
                        className={cn(
                          "min-h-[0.72rem] truncate text-[0.58rem] font-medium leading-none",
                          getBudgetDisplayTextClass(budgetFocusType, dayBudget.day.value, dayBudget.day.target),
                          isOutsideMonth && "opacity-60",
                        )}
                      >
                        {formatBudgetRemainingText(dayBudget.day.value)}
                      </span>
                    ) : null}
                  </div>
                </CalendarDayButton>
              );
            },
          }}
        />
      </div>

      <Button
        asChild
        size="icon"
        className="fixed bottom-5 right-5 z-30 h-14 w-14 rounded-full bg-slate-900 shadow-lg hover:bg-slate-800"
      >
        <Link
          to={`/ledger/new?date=${todayDateToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}${
            buildBudgetQuery(selectedDisplayOptions, showCurrentWeekBudget, selectedCategoryIds)
              ? `&${buildBudgetQuery(selectedDisplayOptions, showCurrentWeekBudget, selectedCategoryIds)}`
              : ""
          }`}
          aria-label="오늘 날짜로 가계부 추가"
        >
          <Plus className="h-6 w-6" />
        </Link>
      </Button>
    </>
  );
}













