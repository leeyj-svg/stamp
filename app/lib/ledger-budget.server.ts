import type { Prisma, PrismaClient } from "@prisma/client";

import {
  LEDGER_BUDGET_TEMPLATE_LABEL,
  LEDGER_BUDGET_TYPE_ORDER,
  createEmptyBudgetTotals,
  getBudgetScopeAmount,
  getBudgetPeriodDayCount,
  getBudgetWeekRanges,
  type LedgerBudgetTotals,
  type LedgerWeekCarryModeValue,
  type LedgerWeekStartDayValue,
} from "~/lib/ledger-budget";
import { type LedgerEntryTypeValue } from "~/lib/ledger-entry";
import { ensureLedgerSetup, getLedgerPeriodLabel, getLedgerPeriodRange } from "~/lib/ledger";
import { loadLedgerCategories } from "~/lib/ledger-entry.server";

type LedgerDbClient = PrismaClient | Prisma.TransactionClient;
type EnsureBudgetPeriodOptions = {
  templateMode?: boolean;
  seedFromTemplate?: boolean;
};
type CurrentWeekBudgetContext = {
  summary: CurrentLedgerWeekBudgetSummary;
  currentWeekRowId: number | null;
  previousWeekRowId: number | null;
};

const LEGACY_BUDGET_RESERVE_CATEGORY_NAMES = new Set([
  "__LEDGER_BUDGET_RESERVE_EXPENSE__",
  "__LEDGER_BUDGET_RESERVE_INCOME__",
  "__LEDGER_BUDGET_RESERVE_SAVING__",
]);

export type CurrentLedgerWeekBudgetSummary = {
  type: LedgerEntryTypeValue;
  weekCarryMode: LedgerWeekCarryModeValue;
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

function roundBudgetAmount(amount: number) {
  return Math.round(amount * 100) / 100;
}

function startOfNextDay(referenceDate: Date) {
  return new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate() + 1,
    0,
    0,
    0,
    0,
  );
}

function formatWeekLabel(start: Date, end: Date) {
  const endDate = new Date(end);
  endDate.setDate(endDate.getDate() - 1);

  return `${start.getMonth() + 1}.${start.getDate()} ~ ${endDate.getMonth() + 1}.${endDate.getDate()}`;
}

async function syncLedgerBudgetWeeks(
  db: LedgerDbClient,
  planId: number,
  totalAmount: number,
  periodStartAt: Date,
  periodEndAt: Date,
  weekStartDay: LedgerWeekStartDayValue,
) {
  const weekRanges = getBudgetWeekRanges(periodStartAt, periodEndAt, weekStartDay);
  const dayCount = getBudgetPeriodDayCount({ periodStartAt, periodEndAt });
  const weekCount = Math.max(weekRanges.length, 1);
  const plannedAmount = roundBudgetAmount(getBudgetScopeAmount(totalAmount, "WEEK", dayCount, weekCount));
  const existingWeeks = await db.ledgerBudgetWeekPlan.findMany({
    where: { planId },
    orderBy: { weekIndex: "asc" },
  });
  const existingWeekByIndex = new Map(existingWeeks.map((week) => [week.weekIndex, week]));

  for (let index = 0; index < weekRanges.length; index += 1) {
    const weekIndex = index + 1;
    const range = weekRanges[index];
    const existingWeek = existingWeekByIndex.get(weekIndex);

    if (!existingWeek) {
      await db.ledgerBudgetWeekPlan.create({
        data: {
          planId,
          weekIndex,
          weekStartAt: range.start,
          weekEndAt: range.end,
          plannedAmount,
        },
      });
      continue;
    }

    const hasChanged =
      Number(existingWeek.plannedAmount) !== plannedAmount ||
      existingWeek.weekStartAt.getTime() !== range.start.getTime() ||
      existingWeek.weekEndAt.getTime() !== range.end.getTime();

    if (hasChanged) {
      await db.ledgerBudgetWeekPlan.update({
        where: { id: existingWeek.id },
        data: {
          plannedAmount,
          weekStartAt: range.start,
          weekEndAt: range.end,
        },
      });
    }
  }

  if (existingWeeks.length > weekRanges.length) {
    await db.ledgerBudgetWeekPlan.deleteMany({
      where: {
        planId,
        weekIndex: {
          gt: weekRanges.length,
        },
      },
    });
  }
}

function getLedgerBudgetTemplateRange() {
  return {
    start: new Date(1900, 0, 1, 0, 0, 0, 0),
    end: new Date(1900, 1, 1, 0, 0, 0, 0),
  };
}

async function loadHydratedLedgerBudgetPeriod(db: LedgerDbClient, periodId: number) {
  return db.ledgerBudgetPeriod.findUnique({
    where: { id: periodId },
    include: {
      plans: {
        orderBy: { type: "asc" },
        include: {
          allocations: {
            orderBy: [{ category: { name: "asc" } }],
            include: {
              category: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  isActive: true,
                },
              },
            },
          },
          weeks: {
            orderBy: { weekIndex: "asc" },
          },
        },
      },
    },
  });
}

async function seedTemplateBudgetFromLegacyBudgets(
  db: LedgerDbClient,
  userId: string,
  basis: "CALENDAR" | "PAYDAY",
  period: NonNullable<Awaited<ReturnType<typeof loadHydratedLedgerBudgetPeriod>>>,
) {
  const legacyBudgets = await db.ledgerBudget.findMany({
    where: {
      userId,
      periodBasis: basis,
    },
    select: {
      amount: true,
      categoryId: true,
      category: {
        select: {
          name: true,
          type: true,
        },
      },
    },
  });

  if (legacyBudgets.length === 0) {
    return false;
  }

  const totalsByType = createEmptyBudgetTotals();

  for (const legacyBudget of legacyBudgets) {
    totalsByType[legacyBudget.category.type] += Number(legacyBudget.amount);
  }

  for (const plan of period.plans) {
    await db.ledgerBudgetPlan.update({
      where: { id: plan.id },
      data: {
        totalAmount: totalsByType[plan.type],
      },
    });
  }

  for (const legacyBudget of legacyBudgets) {
    if (LEGACY_BUDGET_RESERVE_CATEGORY_NAMES.has(legacyBudget.category.name)) {
      continue;
    }

    const plan = period.plans.find((item) => item.type === legacyBudget.category.type);
    if (!plan || Number(legacyBudget.amount) <= 0) {
      continue;
    }

    await db.ledgerBudgetCategoryAllocation.upsert({
      where: {
        planId_categoryId: {
          planId: plan.id,
          categoryId: legacyBudget.categoryId,
        },
      },
      update: {
        plannedAmount: legacyBudget.amount,
      },
      create: {
        planId: plan.id,
        categoryId: legacyBudget.categoryId,
        plannedAmount: legacyBudget.amount,
      },
    });
  }

  return true;
}

async function copyBudgetDataFromSourcePeriod(
  db: LedgerDbClient,
  sourcePeriod: NonNullable<Awaited<ReturnType<typeof loadHydratedLedgerBudgetPeriod>>>,
  targetPeriod: NonNullable<Awaited<ReturnType<typeof loadHydratedLedgerBudgetPeriod>>>,
) {
  for (const targetPlan of targetPeriod.plans) {
    const sourcePlan = sourcePeriod.plans.find((plan) => plan.type === targetPlan.type);
    if (!sourcePlan) {
      continue;
    }

    await db.ledgerBudgetPlan.update({
      where: { id: targetPlan.id },
      data: {
        totalAmount: sourcePlan.totalAmount,
        weekCarryMode: sourcePlan.weekCarryMode,
      },
    });

    await db.ledgerBudgetCategoryAllocation.deleteMany({
      where: { planId: targetPlan.id },
    });

    if (sourcePlan.allocations.length > 0) {
      await db.ledgerBudgetCategoryAllocation.createMany({
        data: sourcePlan.allocations.map((allocation) => ({
          planId: targetPlan.id,
          categoryId: allocation.categoryId,
          plannedAmount: allocation.plannedAmount,
          isFixed: allocation.isFixed,
        })),
      });
    }
  }
}

export function hasLedgerBudgetData(
  period: NonNullable<Awaited<ReturnType<typeof loadHydratedLedgerBudgetPeriod>>>,
) {
  return period.plans.some((plan) => Number(plan.totalAmount) > 0 || plan.allocations.length > 0);
}

export async function cloneLedgerBudgetPeriodData(
  db: LedgerDbClient,
  sourcePeriodId: number,
  targetPeriodId: number,
) {
  const sourcePeriod = await loadHydratedLedgerBudgetPeriod(db, sourcePeriodId);
  const targetPeriod = await loadHydratedLedgerBudgetPeriod(db, targetPeriodId);

  if (!sourcePeriod || !targetPeriod) {
    throw new Error("복사할 예산 기간을 찾을 수 없습니다.");
  }

  await copyBudgetDataFromSourcePeriod(db, sourcePeriod, targetPeriod);
}

async function ensureLedgerBudgetPeriodRecord(
  db: LedgerDbClient,
  userId: string,
  referenceDate = new Date(),
  options: EnsureBudgetPeriodOptions = {},
) {
  const { templateMode = false, seedFromTemplate = !templateMode } = options;
  await ensureLedgerSetup(db, userId);

  const settings = await db.ledgerSettings.findUnique({
    where: { userId },
    select: {
      defaultPeriodBasis: true,
      paydayDay: true,
      weekStartDay: true,
    },
  });

  if (!settings) {
    throw new Error("가계부 설정을 찾을 수 없습니다.");
  }

  const periodRange = templateMode
    ? getLedgerBudgetTemplateRange()
    : getLedgerPeriodRange(referenceDate, settings.defaultPeriodBasis, settings.paydayDay ?? 25);
  const label = templateMode ? LEDGER_BUDGET_TEMPLATE_LABEL : getLedgerPeriodLabel(periodRange.start, periodRange.end);

  const period = await db.ledgerBudgetPeriod.upsert({
    where: {
      userId_basis_periodStartAt_periodEndAt: {
        userId,
        basis: settings.defaultPeriodBasis,
        periodStartAt: periodRange.start,
        periodEndAt: periodRange.end,
      },
    },
    update: {
      label,
    },
    create: {
      userId,
      basis: settings.defaultPeriodBasis,
      periodStartAt: periodRange.start,
      periodEndAt: periodRange.end,
      label,
    },
    select: {
      id: true,
    },
  });

  await Promise.all(
    LEDGER_BUDGET_TYPE_ORDER.map((type) =>
      db.ledgerBudgetPlan.upsert({
        where: {
          periodId_type: {
            periodId: period.id,
            type,
          },
        },
        update: {},
        create: {
          periodId: period.id,
          type,
          totalAmount: 0,
        },
      }),
    ),
  );

  let hydratedPeriod = await loadHydratedLedgerBudgetPeriod(db, period.id);

  if (!hydratedPeriod) {
    throw new Error("가계부 예산 기간을 찾을 수 없습니다.");
  }

  const hasBudgetData = hasLedgerBudgetData(hydratedPeriod);

  if (!hasBudgetData) {
    if (templateMode) {
      const wasSeededFromLegacy = await seedTemplateBudgetFromLegacyBudgets(
        db,
        userId,
        settings.defaultPeriodBasis,
        hydratedPeriod,
      );

      if (wasSeededFromLegacy) {
        hydratedPeriod = await loadHydratedLedgerBudgetPeriod(db, period.id);
      }
    } else if (seedFromTemplate) {
      const templateResult = await ensureLedgerBudgetPeriodRecord(db, userId, referenceDate, {
        templateMode: true,
        seedFromTemplate: false,
      });
      const templateHasBudgetData = hasLedgerBudgetData(templateResult.period);

      if (templateHasBudgetData) {
        await copyBudgetDataFromSourcePeriod(db, templateResult.period, hydratedPeriod);
        hydratedPeriod = await loadHydratedLedgerBudgetPeriod(db, period.id);
      }
    }

    if (!hydratedPeriod) {
      throw new Error("가계부 예산 기간을 다시 불러오지 못했습니다.");
    }
  }

  return {
    settings,
    period: hydratedPeriod,
  };
}

export async function ensureLedgerBudgetPeriodForDate(db: LedgerDbClient, userId: string, referenceDate = new Date()) {
  return ensureLedgerBudgetPeriodRecord(db, userId, referenceDate);
}

export async function ensureLedgerBudgetTemplatePeriod(db: LedgerDbClient, userId: string) {
  const result = await ensureLedgerBudgetPeriodRecord(db, userId, new Date(1900, 0, 1, 0, 0, 0, 0), {
    templateMode: true,
    seedFromTemplate: false,
  });
  const categories = await loadLedgerCategories(db, userId);

  return {
    ...result,
    categories,
  };
}

export async function ensureCurrentLedgerBudgetPeriod(db: LedgerDbClient, userId: string, referenceDate = new Date()) {
  const result = await ensureLedgerBudgetPeriodRecord(db, userId, referenceDate);
  const categories = await loadLedgerCategories(db, userId);

  return {
    ...result,
    categories,
  };
}

async function resolveCurrentLedgerWeekBudgetContext(
  db: LedgerDbClient,
  userId: string,
  type: LedgerEntryTypeValue,
  referenceDate = new Date(),
): Promise<CurrentWeekBudgetContext | null> {
  const { settings, period } = await ensureLedgerBudgetPeriodForDate(db, userId, referenceDate);
  const plan = period.plans.find((item) => item.type === type);

  if (!plan || Number(plan.totalAmount) <= 0) {
    return null;
  }

  const periodStartAt = new Date(period.periodStartAt);
  const periodEndAt = new Date(period.periodEndAt);
  const weekRanges = getBudgetWeekRanges(periodStartAt, periodEndAt, settings.weekStartDay as LedgerWeekStartDayValue);
  const currentWeekIndex = weekRanges.findIndex((range) => referenceDate >= range.start && referenceDate < range.end);

  if (currentWeekIndex < 0) {
    return null;
  }

  await syncLedgerBudgetWeeks(
    db,
    plan.id,
    Number(plan.totalAmount),
    periodStartAt,
    periodEndAt,
    settings.weekStartDay as LedgerWeekStartDayValue,
  );

  const refreshedPlan = await db.ledgerBudgetPlan.findUnique({
    where: { id: plan.id },
    include: {
      weeks: {
        orderBy: { weekIndex: "asc" },
      },
    },
  });

  if (!refreshedPlan) {
    return null;
  }

  const currentWeekNumber = currentWeekIndex + 1;
  const currentRange = weekRanges[currentWeekIndex];
  const nextDay = startOfNextDay(referenceDate);
  const statsEntries = await db.ledgerEntry.findMany({
    where: {
      userId,
      type,
      excludeFromStats: false,
      usedAt: {
        gte: periodStartAt,
        lt: periodEndAt,
      },
    },
    select: {
      amount: true,
      usedAt: true,
    },
    orderBy: { usedAt: "asc" },
  });
  const weekRowByIndex = new Map(refreshedPlan.weeks.map((week) => [week.weekIndex, week]));
  const fullSpentByWeek = new Map<number, number>();
  const toDateSpentByWeek = new Map<number, number>();

  for (let index = 0; index < weekRanges.length; index += 1) {
    const weekIndex = index + 1;
    const range = weekRanges[index];
    const fullSpent = statsEntries.reduce((sum, entry) => {
      const usedAt = new Date(entry.usedAt);
      return usedAt >= range.start && usedAt < range.end ? sum + Number(entry.amount) : sum;
    }, 0);
    const toDateSpent = statsEntries.reduce((sum, entry) => {
      const usedAt = new Date(entry.usedAt);
      return usedAt >= range.start && usedAt < nextDay ? sum + Number(entry.amount) : sum;
    }, 0);

    fullSpentByWeek.set(weekIndex, fullSpent);
    toDateSpentByWeek.set(weekIndex, toDateSpent);
  }

  let carryInAmount = 0;
  if (refreshedPlan.weekCarryMode === "AUTO") {
    let rollingCarry = 0;

    for (let weekIndex = 1; weekIndex <= currentWeekNumber; weekIndex += 1) {
      const weekRow = weekRowByIndex.get(weekIndex);
      const plannedAmount = Number(weekRow?.plannedAmount ?? 0);
      const spentAmount =
        weekIndex === currentWeekNumber
          ? Number(toDateSpentByWeek.get(weekIndex) ?? 0)
          : Number(fullSpentByWeek.get(weekIndex) ?? 0);

      if (weekIndex === currentWeekNumber) {
        carryInAmount = rollingCarry;
        break;
      }

      rollingCarry = roundBudgetAmount(plannedAmount + rollingCarry - spentAmount);
    }
  } else if (refreshedPlan.weekCarryMode === "MANUAL") {
    carryInAmount = Number(weekRowByIndex.get(currentWeekNumber)?.carryInAmount ?? 0);
  }

  const currentWeekRow = weekRowByIndex.get(currentWeekNumber) ?? null;
  const previousWeekRow = currentWeekNumber > 1 ? (weekRowByIndex.get(currentWeekNumber - 1) ?? null) : null;
  const currentWeekPlannedAmount = Number(currentWeekRow?.plannedAmount ?? 0);
  const currentWeekTargetAmount = roundBudgetAmount(currentWeekPlannedAmount + carryInAmount);
  const currentWeekSpentAmount = Number(toDateSpentByWeek.get(currentWeekNumber) ?? 0);

  let availableCarryAmount = 0;
  if (refreshedPlan.weekCarryMode === "MANUAL" && previousWeekRow) {
    const previousWeekBudget = Number(previousWeekRow.plannedAmount) + Number(previousWeekRow.carryInAmount);
    const previousWeekSpentAmount = Number(fullSpentByWeek.get(currentWeekNumber - 1) ?? 0);
    const previousWeekCarriedAmount = Number(previousWeekRow.carryOutAmount ?? 0);
    availableCarryAmount = roundBudgetAmount(previousWeekBudget - previousWeekSpentAmount - previousWeekCarriedAmount);
  }

  return {
    currentWeekRowId: currentWeekRow?.id ?? null,
    previousWeekRowId: previousWeekRow?.id ?? null,
    summary: {
      type,
      weekCarryMode: refreshedPlan.weekCarryMode,
      weekLabel: formatWeekLabel(currentRange.start, currentRange.end),
      weekStartAt: currentRange.start.toISOString(),
      weekEndAt: currentRange.end.toISOString(),
      displayAmount: type === "EXPENSE" ? currentWeekTargetAmount - currentWeekSpentAmount : currentWeekSpentAmount,
      targetAmount: currentWeekTargetAmount,
      plannedAmount: currentWeekPlannedAmount,
      carryInAmount,
      spentAmount: currentWeekSpentAmount,
      availableCarryAmount,
      canApplyCarry:
        refreshedPlan.weekCarryMode === "MANUAL" &&
        availableCarryAmount !== 0 &&
        currentWeekRow !== null &&
        previousWeekRow !== null,
    },
  };
}

export async function getCurrentLedgerWeekBudgetSummary(
  db: LedgerDbClient,
  userId: string,
  type: LedgerEntryTypeValue,
  referenceDate = new Date(),
) {
  const context = await resolveCurrentLedgerWeekBudgetContext(db, userId, type, referenceDate);
  return context?.summary ?? null;
}

export async function applyManualCarryToCurrentLedgerWeek(
  db: PrismaClient,
  userId: string,
  type: LedgerEntryTypeValue,
  referenceDate = new Date(),
) {
  return db.$transaction(async (tx) => {
    const context = await resolveCurrentLedgerWeekBudgetContext(tx, userId, type, referenceDate);

    if (!context) {
      throw new Error("이번 주 예산을 찾을 수 없습니다.");
    }

    if (context.summary.weekCarryMode !== "MANUAL") {
      throw new Error("수동 이월이 설정된 예산만 직접 이월할 수 있습니다.");
    }

    if (!context.summary.canApplyCarry || !context.previousWeekRowId || !context.currentWeekRowId) {
      throw new Error("반영할 지난주 예산 차이가 없습니다.");
    }

    const carryAmount = roundBudgetAmount(context.summary.availableCarryAmount);

    await tx.ledgerBudgetWeekPlan.update({
      where: { id: context.previousWeekRowId },
      data: {
        carryOutAmount: {
          increment: carryAmount,
        },
      },
    });

    await tx.ledgerBudgetWeekPlan.update({
      where: { id: context.currentWeekRowId },
      data: {
        carryInAmount: {
          increment: carryAmount,
        },
      },
    });

    return carryAmount;
  });
}

export function sumPlanTotalsByType(
  plans: Array<{
    type: "INCOME" | "EXPENSE" | "SAVING";
    totalAmount: Prisma.Decimal | number;
  }>,
): LedgerBudgetTotals {
  const totals = createEmptyBudgetTotals();

  for (const plan of plans) {
    totals[plan.type] = Number(plan.totalAmount);
  }

  return totals;
}

export function sumAllocatedTotalsByType(
  plans: Array<{
    type: "INCOME" | "EXPENSE" | "SAVING";
    allocations: Array<{
      plannedAmount: Prisma.Decimal | number;
    }>;
  }>,
): LedgerBudgetTotals {
  const totals = createEmptyBudgetTotals();

  for (const plan of plans) {
    totals[plan.type] = plan.allocations.reduce((sum, allocation) => sum + Number(allocation.plannedAmount), 0);
  }

  return totals;
}

