import { Form, Link, redirect, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, MoreVertical } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { formatBudgetInput, getBudgetSectionMeta, LEDGER_BUDGET_TYPE_ORDER, parseBudgetInput } from "~/lib/ledger-budget";
import {
  cloneLedgerBudgetPeriodData,
  ensureLedgerBudgetTemplatePeriod,
  hasLedgerBudgetData,
  sumAllocatedTotalsByType,
  sumPlanTotalsByType,
} from "~/lib/ledger-budget.server";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { getMonthToken } from "~/lib/ledger";
import { formatLedgerAmount, getTypeLabel, type LedgerEntryTypeValue } from "~/lib/ledger-entry";
import { commitSession, getFlashSession } from "~/lib/session.server";
import { cn } from "~/lib/utils";

type LedgerPeriodBasisValue = "CALENDAR" | "PAYDAY";
type LedgerWeekStartDayValue = "SUNDAY" | "MONDAY";

function parsePeriodBasis(value: FormDataEntryValue | null): LedgerPeriodBasisValue | null {
  if (value === "CALENDAR" || value === "PAYDAY") {
    return value;
  }

  return null;
}

function parseWeekStartDay(value: FormDataEntryValue | null): LedgerWeekStartDayValue | null {
  if (value === "SUNDAY" || value === "MONDAY") {
    return value;
  }

  return null;
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

async function redirectWithToast(request: Request, type: "success" | "error", message: string) {
  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  flashSession.flash("toast", { type, message });

  return redirect("/ledger/settings", {
    headers: {
      "Set-Cookie": await commitSession(flashSession),
    },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  const { settings, period } = await ensureLedgerBudgetTemplatePeriod(db, user.id);

  const totalsByType = sumPlanTotalsByType(period.plans);
  const allocatedByType = sumAllocatedTotalsByType(period.plans);

  return {
    settings,
    currentMonthToken: getMonthToken(new Date()),
    budgetSummaryByType: LEDGER_BUDGET_TYPE_ORDER.map((type) => {
      const plan = period.plans.find((item) => item.type === type);

      return {
        type,
        totalAmount: totalsByType[type],
        allocatedAmount: allocatedByType[type],
        categoryCount: plan?.allocations.length ?? 0,
        allocations:
          plan?.allocations
            .map((allocation) => ({
              categoryId: allocation.categoryId,
              categoryName: allocation.category.name,
              plannedAmount: Number(allocation.plannedAmount),
            }))
            .filter((allocation) => allocation.plannedAmount > 0) ?? [],
        };
      }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update_settings") {
    const { settings: currentSettings, period: currentTemplatePeriod } = await ensureLedgerBudgetTemplatePeriod(db, user.id);
    const defaultPeriodBasis = parsePeriodBasis(formData.get("defaultPeriodBasis"));
    const weekStartDay = parseWeekStartDay(formData.get("weekStartDay"));
    const paydayDayField = formData.get("paydayDay");
    const paydayDayRaw = typeof paydayDayField === "string" ? paydayDayField.trim() : "";
    const paydayDay = paydayDayRaw === "" ? null : Number(paydayDayRaw);

    if (!defaultPeriodBasis) {
      return redirectWithToast(request, "error", "월 시작 기준을 다시 확인해 주세요.");
    }

    if (!weekStartDay) {
      return redirectWithToast(request, "error", "주 시작 요일을 다시 확인해 주세요.");
    }

    if (paydayDayRaw !== "" && (!Number.isInteger(paydayDay ?? Number.NaN) || (paydayDay ?? 0) < 1 || (paydayDay ?? 0) > 31)) {
      return redirectWithToast(request, "error", "급여일은 1일부터 31일 사이로 입력해 주세요.");
    }

    if (defaultPeriodBasis === "PAYDAY" && paydayDay === null) {
      return redirectWithToast(request, "error", "급여일 기준을 쓰려면 급여일을 입력해 주세요.");
    }

    const basisChanged = currentSettings.defaultPeriodBasis !== defaultPeriodBasis;

    await db.ledgerSettings.update({
      where: { userId: user.id },
      data: {
        defaultPeriodBasis,
        paydayDay: paydayDay ?? 25,
        weekStartDay,
      },
    });

    if (basisChanged && hasLedgerBudgetData(currentTemplatePeriod)) {
      const { period: nextTemplatePeriod } = await ensureLedgerBudgetTemplatePeriod(db, user.id);
      await cloneLedgerBudgetPeriodData(db, currentTemplatePeriod.id, nextTemplatePeriod.id);
    }

    return redirectWithToast(request, "success", "가계부 기준 설정을 저장했습니다.");
  }

  if (intent === "save_budget_totals") {
    const { period } = await ensureLedgerBudgetTemplatePeriod(db, user.id);
    const allocatedByType = sumAllocatedTotalsByType(period.plans);

    const totalsByType = {
      EXPENSE: 0,
      INCOME: 0,
      SAVING: 0,
    } satisfies Record<LedgerEntryTypeValue, number>;

    for (const type of LEDGER_BUDGET_TYPE_ORDER) {
      const amountField = formData.get(`quickTotalBudget_${type}`);
      const amount = typeof amountField === "string" ? parseBudgetInput(amountField) : 0;

      if (!Number.isFinite(amount) || amount < 0) {
        return redirectWithToast(request, "error", `${getBudgetSectionMeta(type).totalLabel}은 0 이상의 숫자로 입력해 주세요.`);
      }

      if (amount < allocatedByType[type]) {
        return redirectWithToast(
          request,
          "error",
          `${getBudgetSectionMeta(type).saveErrorLabel}은 이미 배정한 금액 ${formatLedgerAmount(allocatedByType[type])}보다 작을 수 없습니다.`,
        );
      }

      totalsByType[type] = amount;
    }

    await db.$transaction(
      period.plans.map((plan) =>
        db.ledgerBudgetPlan.update({
          where: { id: plan.id },
          data: {
            totalAmount: totalsByType[plan.type],
          },
        }),
      ),
    );

    return redirectWithToast(request, "success", "기본 예산 총액을 저장했습니다.");
  }

  return redirectWithToast(request, "error", "처리할 설정 작업을 찾지 못했습니다.");
};

export default function LedgerSettingsPage() {
  const { settings, currentMonthToken, budgetSummaryByType } = useLoaderData<typeof loader>();
  const [selectedBudgetType, setSelectedBudgetType] = useState<LedgerEntryTypeValue>("EXPENSE");
  const [quickBudgetTotals, setQuickBudgetTotals] = useState<Record<LedgerEntryTypeValue, string>>(
    Object.fromEntries(
      budgetSummaryByType.map((summary) => [summary.type, formatBudgetInput(summary.totalAmount)]),
    ) as Record<LedgerEntryTypeValue, string>,
  );
  const selectedBudgetSummary = useMemo(
    () => budgetSummaryByType.find((summary) => summary.type === selectedBudgetType) ?? budgetSummaryByType[0],
    [budgetSummaryByType, selectedBudgetType],
  );
  const selectedBudgetAccent = getTypeAccent(selectedBudgetType);
  const selectedBudgetAllocationRatios = selectedBudgetSummary.allocations.map((allocation) => ({
    ...allocation,
    ratio: getCategoryAllocationRatio(selectedBudgetSummary.totalAmount, allocation.plannedAmount),
  }));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b bg-white px-2 py-3">
        <div className="relative flex items-start gap-2">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
            <Link to="/ledger">
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>

          <div className="min-w-0 flex-1 pt-2 pr-12 text-left">
            <h1 className="text-[1.05rem] font-semibold text-slate-900">가계부 설정</h1>
            <p className="text-xs text-slate-500">기준과 기본 예산을 한 번에 정해 둘 수 있어요.</p>
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
                  <Link to="/ledger">달력으로</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/ledger/settings/budgets">예산 상세</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/ledger/settings/categories">카테고리 관리</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/ledger/stats">통계</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4 pb-8">
        <section className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">기간 기준</h2>
          </div>

          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="update_settings" />

            <div className="flex flex-wrap items-center gap-2">
              <label
                className={cn(
                  "flex cursor-pointer items-center rounded-2xl border px-4 py-2.5 text-sm font-medium transition-colors",
                  settings.defaultPeriodBasis === "CALENDAR" ? "border-slate-900 bg-slate-50" : "border-slate-200",
                )}
              >
                <input
                  type="radio"
                  name="defaultPeriodBasis"
                  value="CALENDAR"
                  defaultChecked={settings.defaultPeriodBasis === "CALENDAR"}
                />
                <span className="ml-2 text-slate-900">1일부터</span>
              </label>

              <label
                className={cn(
                  "flex min-w-0 cursor-pointer items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-colors",
                  settings.defaultPeriodBasis === "PAYDAY" ? "border-slate-900 bg-slate-50" : "border-slate-200",
                )}
              >
                <input
                  type="radio"
                  name="defaultPeriodBasis"
                  value="PAYDAY"
                  defaultChecked={settings.defaultPeriodBasis === "PAYDAY"}
                />
                <span className="ml-2 shrink-0 text-slate-900">급여</span>
                <Input
                  name="paydayDay"
                  type="number"
                  min={1}
                  max={31}
                  defaultValue={settings.paydayDay ?? 25}
                  className="h-8 w-16 rounded-xl border-slate-200 px-2 text-center text-sm"
                />
                <span className="shrink-0 text-slate-900">일</span>
              </label>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">주 시작 요일</p>
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={cn(
                    "flex cursor-pointer items-center justify-center rounded-2xl border px-4 py-3 text-sm font-medium transition-colors",
                    settings.weekStartDay === "MONDAY" ? "border-slate-900 bg-slate-50 text-slate-900" : "border-slate-200 text-slate-600",
                  )}
                >
                  <input
                    type="radio"
                    name="weekStartDay"
                    value="MONDAY"
                    defaultChecked={settings.weekStartDay === "MONDAY"}
                  />
                  <span className="ml-2">월요일 시작</span>
                </label>
                <label
                  className={cn(
                    "flex cursor-pointer items-center justify-center rounded-2xl border px-4 py-3 text-sm font-medium transition-colors",
                    settings.weekStartDay === "SUNDAY" ? "border-slate-900 bg-slate-50 text-slate-900" : "border-slate-200 text-slate-600",
                  )}
                >
                  <input
                    type="radio"
                    name="weekStartDay"
                    value="SUNDAY"
                    defaultChecked={settings.weekStartDay === "SUNDAY"}
                  />
                  <span className="ml-2">일요일 시작</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" className="rounded-xl bg-slate-900 px-5 hover:bg-slate-800">
                기준 저장
              </Button>
            </div>
          </Form>
        </section>

        <section className="space-y-2.5 rounded-2xl border border-slate-200 bg-white px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">기본 예산</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  새 달 예산이 처음 만들어질 때 여기 설정한 기본값으로 시작해요.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" className="h-8 rounded-xl border-slate-200 px-3 text-xs">
                  <Link to={`/ledger/budgets?month=${currentMonthToken}`}>이 달 예산</Link>
                </Button>
                <Button asChild variant="outline" className="h-8 rounded-xl border-slate-200 px-3 text-xs">
                  <Link to="/ledger/settings/budgets">상세 설정</Link>
                </Button>
              </div>
          </div>

          <Form method="post" className="space-y-2">
            <input type="hidden" name="intent" value="save_budget_totals" />
            {LEDGER_BUDGET_TYPE_ORDER.map((type) => (
              <input key={type} type="hidden" name={`quickTotalBudget_${type}`} value={quickBudgetTotals[type] ?? ""} />
            ))}

            <div className="grid grid-cols-3 gap-1.5">
              {LEDGER_BUDGET_TYPE_ORDER.map((type) => {
                const accent = getTypeAccent(type);
                const isSelected = selectedBudgetType === type;

                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSelectedBudgetType(type)}
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

              <div className={cn("overflow-hidden rounded-3xl border bg-white", selectedBudgetAccent.border)}>
                <div className="space-y-2 px-3 py-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5">
                  {selectedBudgetAllocationRatios.length === 0 ? (
                    <div className="rounded-xl bg-white px-3 py-4 text-xs text-slate-500">아직 배정한 카테고리가 없습니다.</div>
                  ) : (
                    <div className="space-y-2">
                      <div className="overflow-hidden rounded-2xl bg-slate-200">
                        <div className="flex h-14 w-full">
                          {selectedBudgetAllocationRatios.map((allocation, index) => (
                            <div
                              key={allocation.categoryId}
                              className="flex min-w-0 items-center justify-center px-2 text-center text-[10px] font-semibold text-white"
                              style={{
                                width: `${allocation.ratio}%`,
                                backgroundColor: getAllocationSegmentColor(selectedBudgetType, index),
                              }}
                              title={`${allocation.categoryName} ${allocation.ratio}% ${formatLedgerAmount(allocation.plannedAmount)}`}
                            >
                              <span className="truncate">{allocation.categoryName}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        {selectedBudgetAllocationRatios.map((allocation, index) => (
                          <div key={allocation.categoryId} className="flex items-center justify-between gap-3 text-xs">
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: getAllocationSegmentColor(selectedBudgetType, index) }}
                              />
                              <span className="truncate text-slate-700">{allocation.categoryName}</span>
                            </div>
                            <div className="shrink-0 text-right">
                              <span className="font-semibold text-slate-900">{allocation.ratio}%</span>
                              <span className="ml-2 text-[11px] text-slate-500">{formatLedgerAmount(allocation.plannedAmount)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                  <label className="flex items-center gap-3 border-b border-slate-200 pb-2">
                    <div className="w-28 shrink-0">
                      <p className="text-xs font-medium text-slate-600">{getBudgetSectionMeta(selectedBudgetType).totalLabel}</p>
                    </div>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={quickBudgetTotals[selectedBudgetType] ?? ""}
                      onChange={(event) =>
                        setQuickBudgetTotals((current) => ({
                          ...current,
                          [selectedBudgetType]: formatBudgetInput(parseBudgetInput(event.target.value)),
                        }))
                      }
                      placeholder="0"
                      className="h-8 flex-1 rounded-none border-0 bg-transparent px-0 text-right text-xs font-semibold shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </label>
                </div>
              </div>

            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500">여기서는 총액만 빠르게 바꾸고, 카테고리별 배정과 주별 이월은 상세 설정에서 이어서 할 수 있어요.</p>
              <Button type="submit" className="h-8 shrink-0 rounded-xl bg-slate-900 px-4 text-xs hover:bg-slate-800">
                총액 저장
              </Button>
            </div>
          </Form>
        </section>

      </div>
    </div>
  );
}

