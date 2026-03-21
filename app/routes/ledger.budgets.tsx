import { Form, Link, redirect, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, MoreVertical, Plus, Trash2 } from "lucide-react";

import {
  createEmptyBudgetTotals,
  formatBudgetInput,
  getBudgetSectionMeta,
  LEDGER_BUDGET_TYPE_ORDER,
  parseBudgetInput,
} from "~/lib/ledger-budget";
import {
  cloneLedgerBudgetPeriodData,
  ensureCurrentLedgerBudgetPeriod,
  ensureLedgerBudgetTemplatePeriod,
} from "~/lib/ledger-budget.server";
import { Button } from "~/components/ui/button";
import { ColorSwatchInput } from "~/components/color-swatch-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { formatLedgerAmount, getTypeLabel, type LedgerEntryTypeValue } from "~/lib/ledger-entry";
import { type CategoryFetcherData, handleCategoryIntent } from "~/lib/ledger-entry.server";
import { getMonthToken, shiftMonthToken } from "~/lib/ledger";
import { commitSession, getFlashSession } from "~/lib/session.server";
import { cn } from "~/lib/utils";

type WeekCarryModeValue = "NONE" | "AUTO" | "MANUAL";
const CATEGORY_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

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

function parseSelectedType(value: string | null): LedgerEntryTypeValue {
  if (value === "INCOME" || value === "EXPENSE" || value === "SAVING") {
    return value;
  }

  return "EXPENSE";
}

function getBudgetSettingsRedirectTarget(monthToken: string, type: LedgerEntryTypeValue) {
  return `/ledger/budgets?month=${monthToken}&type=${type}`;
}

function getTypeAccent(type: LedgerEntryTypeValue) {
  if (type === "INCOME") {
    return {
      text: "text-sky-500",
      border: "border-sky-200",
      bg: "bg-sky-50",
    };
  }

  if (type === "EXPENSE") {
    return {
      text: "text-rose-500",
      border: "border-rose-200",
      bg: "bg-rose-50",
    };
  }

  return {
    text: "text-emerald-600",
    border: "border-emerald-200",
    bg: "bg-emerald-50",
  };
}

function getCategoryAllocationRatio(totalAmount: number, amount: number) {
  if (totalAmount <= 0 || amount <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((amount / totalAmount) * 100)));
}

function getAllocationSegmentColor(type: LedgerEntryTypeValue, index: number) {
  const palette =
    type === "INCOME"
      ? ["#38bdf8", "#0ea5e9", "#2563eb", "#60a5fa", "#0284c7", "#1d4ed8"]
      : type === "EXPENSE"
        ? ["#fb7185", "#f43f5e", "#ef4444", "#f97316", "#e11d48", "#dc2626"]
        : ["#34d399", "#10b981", "#22c55e", "#14b8a6", "#059669", "#16a34a"];

  return palette[index % palette.length];
}

function parseWeekCarryMode(value: FormDataEntryValue | null): WeekCarryModeValue | null {
  if (value === "NONE" || value === "AUTO" || value === "MANUAL") {
    return value;
  }

  return null;
}

function getWeekCarryModeLabel(value: WeekCarryModeValue) {
  if (value === "AUTO") {
    return "자동 이월";
  }

  if (value === "MANUAL") {
    return "수동 이월";
  }

  return "이월 안 함";
}

function parseFixedFlag(value: FormDataEntryValue | null) {
  return value === "true";
}

function normalizeCategoryColor(value: string | null | undefined) {
  return value && CATEGORY_COLOR_PATTERN.test(value) ? value : "#94a3b8";
}

async function redirectWithToast(
  request: Request,
  type: "success" | "error",
  message: string,
  monthToken: string,
  selectedType: LedgerEntryTypeValue = "EXPENSE",
) {
  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  flashSession.flash("toast", { type, message });

  return redirect(getBudgetSettingsRedirectTarget(monthToken, selectedType), {
    headers: {
      "Set-Cookie": await commitSession(flashSession),
    },
  });
}

function getCategorySuccessMessage(payload: CategoryFetcherData, formData: FormData) {
  if (payload.intent === "create_category") {
    return "카테고리를 추가했습니다.";
  }

  if (payload.intent === "update_category") {
    return "카테고리를 수정했습니다.";
  }

  if (payload.intent === "toggle_category") {
    return formData.get("nextActive") === "true" ? "카테고리를 다시 보이게 했습니다." : "카테고리를 숨겼습니다.";
  }

  if (payload.intent === "delete_category") {
    return "카테고리를 삭제했습니다.";
  }

  return "카테고리 작업을 처리했습니다.";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  const url = new URL(request.url);
  const monthToken = parseMonthToken(url.searchParams.get("month")) ?? getMonthToken(new Date());
  const monthStart = getMonthStart(monthToken);
  const { period, categories } = await ensureCurrentLedgerBudgetPeriod(db, user.id, monthStart);
  const selectedType = parseSelectedType(url.searchParams.get("type"));

  const allocatedCategoryIds = new Set(period.plans.flatMap((plan) => plan.allocations.map((allocation) => allocation.categoryId)));

  return {
    monthToken,
    monthLabel: getMonthLabel(monthStart),
    prevMonthToken: shiftMonthToken(monthToken, -1),
    nextMonthToken: shiftMonthToken(monthToken, 1),
    selectedType,
    budgetPeriodLabel: period.label ?? "",
    plans: period.plans.map((plan) => ({
      id: plan.id,
      type: plan.type,
      totalAmount: Number(plan.totalAmount),
      weekCarryMode: plan.weekCarryMode,
      allocations: plan.allocations.map((allocation) => ({
        categoryId: allocation.categoryId,
        plannedAmount: Number(allocation.plannedAmount),
        isFixed: allocation.isFixed,
      })),
    })),
    categoriesByType: LEDGER_BUDGET_TYPE_ORDER.map((type) => ({
      type,
      items: categories
        .filter((category) => category.type === type && (category.isActive || allocatedCategoryIds.has(category.id)))
        .sort((left, right) => {
          if (left.isActive !== right.isActive) {
            return left.isActive ? -1 : 1;
          }

          return left.name.localeCompare(right.name, "ko");
        }),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  const formData = await request.formData();
  const url = new URL(request.url);
  const monthToken = parseMonthToken(url.searchParams.get("month")) ?? getMonthToken(new Date());
  const monthStart = getMonthStart(monthToken);
  const selectedTypeField = formData.get("selectedType");
  const typeField = formData.get("type");
  const selectedType = parseSelectedType(
    (typeof selectedTypeField === "string" ? selectedTypeField : null) ??
      (typeof typeField === "string" ? typeField : null) ??
      url.searchParams.get("type"),
  );
  const { period, categories } = await ensureCurrentLedgerBudgetPeriod(db, user.id, monthStart);
  const intent = formData.get("intent");

  if (intent === "reset_from_template") {
    const template = await ensureLedgerBudgetTemplatePeriod(db, user.id);
    await cloneLedgerBudgetPeriodData(db, template.period.id, period.id);
    return redirectWithToast(request, "success", `${getMonthLabel(monthStart)} 예산을 기본 예산으로 되돌렸습니다.`, monthToken, selectedType);
  }

  const categoryResponse = await handleCategoryIntent(db, user.id, formData);

  if (categoryResponse) {
    const payload = (await categoryResponse.json()) as CategoryFetcherData;

    if (payload.error) {
      return redirectWithToast(request, "error", payload.error, monthToken, selectedType);
    }

    return redirectWithToast(request, "success", getCategorySuccessMessage(payload, formData), monthToken, selectedType);
  }

  const categoryTypeMap = new Map(categories.map((category) => [category.id, category.type] as const));
  const plansByType = new Map(period.plans.map((plan) => [plan.type, plan] as const));
  const categoryColorsById = new Map(
    categories.map((category) => [
      category.id,
      normalizeCategoryColor(typeof formData.get(`categoryColor_${category.id}`) === "string" ? String(formData.get(`categoryColor_${category.id}`)) : category.color),
    ]),
  );

  const totalBudgetsByType = createEmptyBudgetTotals();
  const weekCarryModeByType = {} as Record<LedgerEntryTypeValue, WeekCarryModeValue>;

  for (const type of LEDGER_BUDGET_TYPE_ORDER) {
    const totalBudgetField = formData.get(`totalBudget_${type}`);
    const totalBudget = typeof totalBudgetField === "string" ? parseBudgetInput(totalBudgetField) : 0;

      if (!Number.isFinite(totalBudget) || totalBudget < 0) {
        return redirectWithToast(
          request,
          "error",
          `${getBudgetSectionMeta(type).totalLabel}은 0 이상의 숫자로 입력해 주세요.`,
          monthToken,
          selectedType,
        );
      }

      const weekCarryMode = parseWeekCarryMode(formData.get(`weekCarryMode_${type}`));
      if (!weekCarryMode) {
        return redirectWithToast(request, "error", `${getTypeLabel(type)} 주별 이월 방식을 다시 확인해 주세요.`, monthToken, selectedType);
      }

    totalBudgetsByType[type] = totalBudget;
    weekCarryModeByType[type] = weekCarryMode;
  }

  const allocationEntriesByType = {
    EXPENSE: [] as Array<{ categoryId: number; amount: number | null; isFixed: boolean }>,
    INCOME: [] as Array<{ categoryId: number; amount: number | null; isFixed: boolean }>,
    SAVING: [] as Array<{ categoryId: number; amount: number | null; isFixed: boolean }>,
  };

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("budget_") || typeof value !== "string") {
      continue;
    }

    const categoryId = Number(key.slice(7));
    const type = categoryTypeMap.get(categoryId);
    if (!type) {
      continue;
    }
    const isFixed = parseFixedFlag(formData.get(`isFixed_${categoryId}`));

    const amount = parseBudgetInput(value);
    if (amount <= 0) {
      allocationEntriesByType[type].push({ categoryId, amount: null, isFixed });
      continue;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return redirectWithToast(request, "error", "카테고리별 예산은 0 이상의 숫자로 입력해 주세요.", selectedType);
    }

    allocationEntriesByType[type].push({ categoryId, amount, isFixed });
  }

  for (const type of LEDGER_BUDGET_TYPE_ORDER) {
    const allocatedAmount = allocationEntriesByType[type].reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
    if (totalBudgetsByType[type] < allocatedAmount) {
        return redirectWithToast(
          request,
          "error",
          `${getBudgetSectionMeta(type).saveErrorLabel}은 카테고리 배정 합계 ${formatLedgerAmount(allocatedAmount)}보다 작을 수 없습니다.`,
          monthToken,
          selectedType,
        );
      }
  }

  await db.$transaction(async (tx) => {
    for (const category of categories) {
      const nextColor = categoryColorsById.get(category.id);
      if (!nextColor || nextColor === normalizeCategoryColor(category.color)) {
        continue;
      }

      await tx.ledgerCategory.update({
        where: { id: category.id },
        data: { color: nextColor },
      });
    }

    for (const type of LEDGER_BUDGET_TYPE_ORDER) {
      const plan = plansByType.get(type);
      if (!plan) {
        continue;
      }

      await tx.ledgerBudgetPlan.update({
        where: { id: plan.id },
        data: {
          totalAmount: totalBudgetsByType[type],
          weekCarryMode: weekCarryModeByType[type],
        },
      });

      for (const allocationEntry of allocationEntriesByType[type]) {
        const existingAllocation = plan.allocations.find((allocation) => allocation.categoryId === allocationEntry.categoryId);

        if (allocationEntry.amount === null) {
          await tx.ledgerBudgetCategoryAllocation.deleteMany({
            where: {
              planId: plan.id,
              categoryId: allocationEntry.categoryId,
            },
          });
          continue;
        }

        await tx.ledgerBudgetCategoryAllocation.upsert({
          where: {
            planId_categoryId: {
              planId: plan.id,
              categoryId: allocationEntry.categoryId,
            },
          },
          update: {
            plannedAmount: allocationEntry.amount,
            isFixed: allocationEntry.isFixed,
          },
          create: {
            planId: plan.id,
            categoryId: allocationEntry.categoryId,
            plannedAmount: allocationEntry.amount,
            isFixed: allocationEntry.isFixed ?? existingAllocation?.isFixed ?? false,
          },
        });
      }
    }
  });

  return redirectWithToast(request, "success", `${getMonthLabel(monthStart)} 예산을 저장했습니다.`, monthToken, selectedType);
};

export default function LedgerBudgetSettingsPage() {
  const { monthToken, monthLabel, prevMonthToken, nextMonthToken, selectedType, budgetPeriodLabel, plans, categoriesByType } =
    useLoaderData<typeof loader>();
  const [selectedBudgetType, setSelectedBudgetType] = useState<LedgerEntryTypeValue>(selectedType);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  const allocationMap = useMemo(
    () =>
      new Map(
        plans.flatMap((plan) =>
          plan.allocations.map((allocation) => [`${plan.type}:${allocation.categoryId}`, formatBudgetInput(allocation.plannedAmount)] as const),
        ),
      ),
    [plans],
  );

  const [budgetValues, setBudgetValues] = useState<Record<string, string>>(
    Object.fromEntries(Array.from(allocationMap.entries()).map(([key, amount]) => [key, amount])),
  );
  const [totalBudgets, setTotalBudgets] = useState<Record<LedgerEntryTypeValue, string>>(
    Object.fromEntries(
      LEDGER_BUDGET_TYPE_ORDER.map((type) => {
        const plan = plans.find((item) => item.type === type);
        return [type, formatBudgetInput(plan?.totalAmount ?? 0)];
      }),
    ) as Record<LedgerEntryTypeValue, string>,
  );
  const [weekCarryModes, setWeekCarryModes] = useState<Record<LedgerEntryTypeValue, WeekCarryModeValue>>(
    Object.fromEntries(
      LEDGER_BUDGET_TYPE_ORDER.map((type) => {
        const plan = plans.find((item) => item.type === type);
        return [type, (plan?.weekCarryMode ?? "NONE") as WeekCarryModeValue];
      }),
      ) as Record<LedgerEntryTypeValue, WeekCarryModeValue>,
  );
  const [fixedFlags, setFixedFlags] = useState<Record<string, boolean>>(
    Object.fromEntries(
      plans.flatMap((plan) =>
        plan.allocations.map((allocation) => [`${plan.type}:${allocation.categoryId}`, allocation.isFixed] as const),
      ),
    ),
  );
  const [categoryColors, setCategoryColors] = useState<Record<string, string>>(
    Object.fromEntries(
      categoriesByType.flatMap((group) =>
        group.items.map((category) => [`${group.type}:${category.id}`, normalizeCategoryColor(category.color)] as const),
      ),
    ),
  );

  const totalsByType = useMemo(
    () =>
      Object.fromEntries(
        LEDGER_BUDGET_TYPE_ORDER.map((type) => [type, parseBudgetInput(totalBudgets[type] ?? "")]),
      ) as Record<LedgerEntryTypeValue, number>,
    [totalBudgets],
  );

  const allocatedByType = useMemo(
    () =>
      Object.fromEntries(
        LEDGER_BUDGET_TYPE_ORDER.map((type) => {
          const categories = categoriesByType.find((group) => group.type === type)?.items ?? [];
          const allocated = categories.reduce((sum, category) => {
            return sum + parseBudgetInput(budgetValues[`${type}:${category.id}`] ?? "");
          }, 0);

          return [type, allocated];
        }),
      ) as Record<LedgerEntryTypeValue, number>,
    [budgetValues, categoriesByType],
  );

  const canSaveBudget = LEDGER_BUDGET_TYPE_ORDER.every((type) => totalsByType[type] >= allocatedByType[type]);
  const selectedAccent = getTypeAccent(selectedBudgetType);
  const selectedMeta = getBudgetSectionMeta(selectedBudgetType);
  const selectedCategories = categoriesByType.find((group) => group.type === selectedBudgetType)?.items ?? [];
  const selectedTotalBudgetAmount = totalsByType[selectedBudgetType];
  const selectedAllocatedBudgetAmount = allocatedByType[selectedBudgetType];
  const actionUrl = getBudgetSettingsRedirectTarget(monthToken, selectedBudgetType);
  const budgetFormId = "ledger-budget-settings-form";
  const selectedCategoryAllocationRatios = useMemo(
    () =>
      selectedCategories
        .map((category) => {
          const amount = parseBudgetInput(budgetValues[`${selectedBudgetType}:${category.id}`] ?? "");
          return {
            id: category.id,
            name: category.name,
            amount,
            ratio: getCategoryAllocationRatio(selectedTotalBudgetAmount, amount),
            color: categoryColors[`${selectedBudgetType}:${category.id}`] ?? normalizeCategoryColor(category.color),
          };
        })
        .filter((item) => item.amount > 0),
    [budgetValues, selectedBudgetType, selectedCategories, selectedTotalBudgetAmount],
  );

  const beginCategoryEdit = (categoryId: number, categoryName: string) => {
    setEditingCategoryId(categoryId);
    setEditingCategoryName(categoryName);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b bg-white px-2 py-3">
        <div className="relative flex items-start gap-2">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
            <Link to="/ledger/settings">
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>

          <div className="min-w-0 flex-1 pt-2 pr-12 text-left">
            <h1 className="text-[1.05rem] font-semibold text-slate-900">월 예산 수정</h1>
            <p className="text-xs text-slate-500">{monthLabel} 예산을 따로 조정할 수 있어요.</p>
          </div>

          <div className="absolute right-0 top-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`/ledger?month=${monthToken}`}>달력</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/ledger/stats?month=${monthToken}`}>통계</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/ledger/settings">설정</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/ledger/settings/budgets">기본 예산</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="px-3 py-3 pb-5">
        <section className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-1.5">
              <Button asChild variant="ghost" className="h-8 rounded-xl px-2 text-xs text-slate-600 hover:bg-white">
                <Link to={getBudgetSettingsRedirectTarget(prevMonthToken, selectedBudgetType)}>이전 달</Link>
              </Button>
              <div className="min-w-0 text-center">
                <p className="text-sm font-semibold text-slate-900">{monthLabel}</p>
              </div>
              <Button asChild variant="ghost" className="h-8 rounded-xl px-2 text-xs text-slate-600 hover:bg-white">
                <Link to={getBudgetSettingsRedirectTarget(nextMonthToken, selectedBudgetType)}>다음 달</Link>
              </Button>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">예산 상세</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  선택한 월은 <span className="font-medium text-slate-700">{monthLabel}</span>이고, 예산 적용 기간은{" "}
                  <span className="font-medium text-slate-700">{budgetPeriodLabel || monthLabel}</span>입니다.
                </p>
              </div>

                <Form method="post" action={actionUrl}>
                  <input type="hidden" name="intent" value="reset_from_template" />
                  <input type="hidden" name="selectedType" value={selectedBudgetType} />
                  <Button
                    type="submit"
                    variant="ghost"
                    className="h-7 shrink-0 rounded-xl border border-slate-200 bg-white px-2.5 text-[11px] text-slate-600 hover:bg-slate-50"
                  >
                    기본 예산으로 복원
                  </Button>
                </Form>
              </div>

            <Form id={budgetFormId} method="post" className="space-y-3">
              <input type="hidden" name="selectedType" value={selectedBudgetType} />
              {LEDGER_BUDGET_TYPE_ORDER.map((type) => (
                <div key={type}>
                  <input type="hidden" name={`totalBudget_${type}`} value={totalBudgets[type] ?? ""} />
                  <input type="hidden" name={`weekCarryMode_${type}`} value={weekCarryModes[type]} />
                </div>
              ))}
              {categoriesByType.flatMap((group) =>
                group.items.map((category) => (
                  <div key={`${group.type}:${category.id}`}>
                    <input type="hidden" name={`budget_${category.id}`} value={budgetValues[`${group.type}:${category.id}`] ?? ""} />
                    <input type="hidden" name={`isFixed_${category.id}`} value={fixedFlags[`${group.type}:${category.id}`] ? "true" : "false"} />
                    <input type="hidden" name={`categoryColor_${category.id}`} value={categoryColors[`${group.type}:${category.id}`] ?? "#94a3b8"} />
                  </div>
                )),
              )}

              <div className="grid grid-cols-3 gap-1.5">
                {LEDGER_BUDGET_TYPE_ORDER.map((type) => {
                  const accent = getTypeAccent(type);
                  const isSelected = selectedBudgetType === type;

                  return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          setSelectedBudgetType(type);
                          setEditingCategoryId(null);
                          setEditingCategoryName("");
                        }}
                        className={cn(
                        "rounded-2xl border px-3 py-2 text-xs font-medium transition-colors",
                        isSelected ? cn(accent.border, accent.bg, accent.text) : "border-slate-200 bg-white text-slate-600",
                      )}
                    >
                      {getTypeLabel(type)}
                    </button>
                  );
                })}
              </div>

              <div className={cn("overflow-hidden rounded-3xl border bg-white", selectedAccent.border)}>
                <div className="space-y-3 px-3 py-3">
                  <label className="flex items-center gap-3 border-b border-slate-200 pb-2">
                    <div className="w-28 shrink-0">
                      <p className="text-xs font-semibold text-slate-700">{selectedMeta.totalLabel}</p>
                    </div>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={totalBudgets[selectedBudgetType] ?? ""}
                      onChange={(event) =>
                        setTotalBudgets((current) => ({
                          ...current,
                          [selectedBudgetType]: formatBudgetInput(parseBudgetInput(event.target.value)),
                        }))
                      }
                      placeholder="0"
                      className="h-8 flex-1 rounded-none border-0 bg-transparent px-0 text-right text-sm font-semibold shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </label>

                  <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
                    <div className="w-28 shrink-0">
                      <span className="text-xs font-semibold text-slate-700">주별 이월 방식</span>
                    </div>
                    <div className="flex-1">
                      <Select
                        value={weekCarryModes[selectedBudgetType]}
                        onValueChange={(value) =>
                          setWeekCarryModes((current) => ({
                            ...current,
                            [selectedBudgetType]: value as WeekCarryModeValue,
                          }))
                        }
                      >
                        <SelectTrigger className="h-8 rounded-none border-0 bg-transparent px-0 text-xs shadow-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0">
                          <SelectValue placeholder="이월 방식을 선택해 주세요." />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-slate-200 bg-white shadow-lg">
                          <SelectItem value="NONE">{getWeekCarryModeLabel("NONE")}</SelectItem>
                          <SelectItem value="AUTO">{getWeekCarryModeLabel("AUTO")}</SelectItem>
                          <SelectItem value="MANUAL">{getWeekCarryModeLabel("MANUAL")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5">
                    {selectedCategoryAllocationRatios.length === 0 ? (
                      <div className="rounded-xl bg-white px-3 py-4 text-xs text-slate-500">아직 배정한 카테고리가 없습니다.</div>
                    ) : (
                      <div className="space-y-2">
                        <div className="overflow-hidden rounded-2xl bg-slate-200">
                          <div className="flex h-14 w-full">
                            {selectedCategoryAllocationRatios.map((allocation, index) => (
                              <div
                                key={allocation.id}
                                className="flex min-w-0 items-center justify-center px-2 text-center text-[10px] font-semibold text-white"
                                style={{
                                  width: `${allocation.ratio}%`,
                                  backgroundColor: allocation.color ?? getAllocationSegmentColor(selectedBudgetType, index),
                                }}
                                title={`${allocation.name} ${allocation.ratio}% ${formatLedgerAmount(allocation.amount)}`}
                              >
                                <span className="truncate">{allocation.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          {selectedCategoryAllocationRatios.map((allocation, index) => (
                            <div key={allocation.id} className="flex items-center justify-between gap-3 text-xs">
                              <div className="flex min-w-0 items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: allocation.color ?? getAllocationSegmentColor(selectedBudgetType, index) }}
                                />
                                <span className="truncate text-slate-700">{allocation.name}</span>
                              </div>
                              <div className="shrink-0 text-right">
                                <span className="font-semibold text-slate-900">{allocation.ratio}%</span>
                                <span className="ml-2 text-[11px] text-slate-500">{formatLedgerAmount(allocation.amount)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Form>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-slate-900">카테고리별 배정</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">카테고리를 눌러 이름을 바꾸고, 오른쪽 휴지통으로 바로 삭제할 수 있어요.</p>
                </div>
                <span className="text-[11px] text-slate-400">{formatLedgerAmount(selectedAllocatedBudgetAmount)} 배정</span>
              </div>

              {selectedCategories.length === 0 ? (
                <div className="mt-3 rounded-xl bg-white px-3 py-4 text-xs text-slate-500">배정할 카테고리가 아직 없습니다.</div>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {selectedCategories.map((category) => {
                    const canDelete = category.entryCount === 0 && category.budgetAllocationCount === 0;
                    const isEditing = editingCategoryId === category.id;

                    return (
                      <div key={category.id} className="flex items-center gap-2.5 border-b border-slate-200 py-2 last:border-b-0">
                        <ColorSwatchInput
                          value={categoryColors[`${selectedBudgetType}:${category.id}`] ?? normalizeCategoryColor(category.color)}
                          onChange={(event) =>
                            setCategoryColors((current) => ({
                              ...current,
                              [`${selectedBudgetType}:${category.id}`]: event.target.value,
                            }))
                          }
                        />
                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <Form method="post" action={actionUrl} className="flex items-center gap-2">
                              <input type="hidden" name="intent" value="update_category" />
                              <input type="hidden" name="type" value={selectedBudgetType} />
                              <input type="hidden" name="categoryId" value={category.id} />
                              <input type="hidden" name="color" value={categoryColors[`${selectedBudgetType}:${category.id}`] ?? normalizeCategoryColor(category.color)} />
                              <Input
                                name="name"
                                value={editingCategoryName}
                                onChange={(event) => setEditingCategoryName(event.target.value)}
                                className="h-8 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-[11px] font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                                autoFocus
                              />
                              <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-xl text-slate-500 hover:bg-white">
                                <Check className="h-4 w-4" />
                                <span className="sr-only">카테고리 수정</span>
                              </Button>
                            </Form>
                          ) : (
                            <button
                              type="button"
                              onClick={() => beginCategoryEdit(category.id, category.name)}
                              className="flex w-full min-w-0 items-center gap-2 text-left"
                            >
                              <span className="truncate text-[11px] font-medium text-slate-700">{category.name}</span>
                              {!category.isActive ? <span className="text-[11px] text-slate-400">숨김</span> : null}
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setFixedFlags((current) => ({
                              ...current,
                              [`${selectedBudgetType}:${category.id}`]: !current[`${selectedBudgetType}:${category.id}`],
                            }))
                          }
                          className={cn(
                            "ml-1 h-8 min-w-[3.9rem] shrink-0 rounded-xl border px-3 text-[10px] font-medium transition-colors",
                            fixedFlags[`${selectedBudgetType}:${category.id}`]
                              ? "border-violet-200 bg-violet-50 text-violet-600"
                              : "border-slate-200 bg-white text-slate-500",
                          )}
                        >
                          {fixedFlags[`${selectedBudgetType}:${category.id}`] ? "고정" : "변동"}
                        </button>

                        <Input
                          type="text"
                          inputMode="numeric"
                          value={budgetValues[`${selectedBudgetType}:${category.id}`] ?? ""}
                          onChange={(event) =>
                            setBudgetValues((current) => ({
                              ...current,
                              [`${selectedBudgetType}:${category.id}`]: formatBudgetInput(parseBudgetInput(event.target.value)),
                            }))
                          }
                          placeholder="0"
                          className="h-8 w-32 rounded-none border-0 bg-transparent px-0 text-right text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                        />

                        <Form method="post" action={actionUrl}>
                          <input type="hidden" name="intent" value="delete_category" />
                          <input type="hidden" name="type" value={selectedBudgetType} />
                          <input type="hidden" name="categoryId" value={category.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            disabled={!canDelete}
                            className="h-8 w-8 shrink-0 rounded-xl text-rose-500 hover:bg-white hover:text-rose-600 disabled:text-slate-300 disabled:hover:bg-transparent"
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">카테고리 삭제</span>
                          </Button>
                        </Form>
                      </div>
                    );
                  })}
                </div>
              )}

              <Form method="post" action={actionUrl} className="mt-2 flex items-center gap-3 border-t border-slate-200 pt-2">
                <input type="hidden" name="intent" value="create_category" />
                <input type="hidden" name="type" value={selectedBudgetType} />
                <ColorSwatchInput name="color" defaultValue="#94a3b8" />
                <div className="min-w-0 flex-1">
                  <Input
                    name="name"
                    placeholder="새 카테고리"
                    className="h-8 w-full rounded-none border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>
                <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-xl text-slate-500 hover:bg-white">
                  <Plus className="h-4 w-4" />
                  <span className="sr-only">카테고리 추가</span>
                </Button>
              </Form>
            </div>

            {!canSaveBudget ? (
              <p className="text-right text-xs font-medium text-rose-500">
                카테고리 배정 합계가 총예산을 넘어서 저장할 수 없어요.
              </p>
            ) : null}

            <div className="flex justify-end">
              <Button form={budgetFormId} type="submit" disabled={!canSaveBudget} className="h-8 rounded-xl bg-slate-900 px-4 text-xs hover:bg-slate-800 disabled:bg-slate-300">
                예산 저장
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

