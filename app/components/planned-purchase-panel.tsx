import { useEffect, useMemo, useRef, useState } from "react";
import { Form, useFetcher, useRevalidator } from "react-router";
import { EyeOff, MessageSquareText, Pencil, RotateCcw, Settings2, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import type { LedgerPlannedPurchaseStatusValue } from "~/lib/ledger-planned-purchase.server";
import { formatLedgerAmount } from "~/lib/ledger-entry";
import { cn } from "~/lib/utils";

export type PlannedPurchasePanelItem = {
  id: number;
  title: string;
  amount: number;
  memo: string | null;
  plannedFor: string;
  status: LedgerPlannedPurchaseStatusValue;
  categoryId: number | null;
  categoryName: string | null;
  budgetPeriodKey: string | null;
  budgetPeriodLabel: string | null;
  overallRemainingAmount: number | null;
  overallAfterAmount: number | null;
  categoryRemainingAmount: number | null;
  categoryAfterAmount: number | null;
  hasCategoryBudget: boolean;
};

type PlannedPurchasePanelProps = {
  defaultDateValue: string;
  items: PlannedPurchasePanelItem[];
  isCreateDialogOpen: boolean;
  onCreateDialogOpenChange: (open: boolean) => void;
  categories: Array<{
    id: number;
    name: string;
    isActive: boolean;
    entryCount: number;
    budgetAllocationCount: number;
  }>;
};

type PlannedPurchaseSummaryMode = "overall" | "category";

type PlannedPurchaseDateGroup = {
  dateKey: string;
  label: string;
  items: PlannedPurchasePanelItem[];
};

type CategoryFetcherData = {
  ok?: boolean;
  intent?: "create_category" | "update_category" | "toggle_category" | "delete_category";
  error?: string;
};

const NO_CATEGORY_VALUE = "__none__";

const STATUS_META: Record<LedgerPlannedPurchaseStatusValue, { textClassName: string }> = {
  PLANNED: {
    textClassName: "text-sky-600",
  },
  HOLD: {
    textClassName: "text-amber-700",
  },
  PURCHASED: {
    textClassName: "text-emerald-700",
  },
  CANCELED: {
    textClassName: "text-slate-500",
  },
};

function getBudgetToneClass(amount: number | null) {
  if (amount === null) {
    return "text-slate-400";
  }

  if (amount < 0) {
    return "text-rose-500";
  }

  return "text-slate-500";
}

function renderAfterBudgetLabel(amount: number | null) {
  if (amount === null) {
    return "비교 예산 없음";
  }

  if (amount < 0) {
    return `${formatLedgerAmount(Math.abs(amount))} 초과`;
  }

  return `${formatLedgerAmount(amount)} 남음`;
}

function getPlannedDate(dateValue: string) {
  return new Date(dateValue);
}

function getPlannedDateKey(dateValue: string) {
  const date = getPlannedDate(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPlannedDateLabel(dateValue: string) {
  const date = getPlannedDate(dateValue);
  return `${date.getDate()}일`;
}

export function PlannedPurchasePanel({
  defaultDateValue,
  items,
  categories,
  isCreateDialogOpen,
  onCreateDialogOpenChange,
}: PlannedPurchasePanelProps) {
  const categoryFetcher = useFetcher<CategoryFetcherData>();
  const revalidator = useRevalidator();
  const eligiblePurchaseIds = useMemo(
    () => items.filter((item) => item.status !== "PURCHASED" && item.status !== "CANCELED").map((item) => item.id),
    [items],
  );
  const [selectedIds, setSelectedIds] = useState<number[]>(() => eligiblePurchaseIds);
  const [summaryMode, setSummaryMode] = useState<PlannedPurchaseSummaryMode>("overall");
  const [expandedMemoIds, setExpandedMemoIds] = useState<number[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const previousEligibleIdsRef = useRef<number[]>(eligiblePurchaseIds);

  useEffect(() => {
    const previousEligibleSet = new Set(previousEligibleIdsRef.current);
    const eligibleSet = new Set(eligiblePurchaseIds);

    setSelectedIds((current) => {
      const retained = current.filter((id) => eligibleSet.has(id));
      const retainedSet = new Set(retained);
      const newlyEligible = eligiblePurchaseIds.filter((id) => !previousEligibleSet.has(id));
      return [...retained, ...newlyEligible.filter((id) => !retainedSet.has(id))];
    });

    previousEligibleIdsRef.current = eligiblePurchaseIds;
  }, [eligiblePurchaseIds]);

  const visibleCategories = useMemo(
    () => categories.filter((category) => category.isActive || String(category.id) === selectedCategoryId),
    [categories, selectedCategoryId],
  );

  const activeCategories = useMemo(
    () => categories.filter((category) => category.isActive),
    [categories],
  );

  const inactiveCategories = useMemo(
    () => categories.filter((category) => !category.isActive && String(category.id) !== selectedCategoryId),
    [categories, selectedCategoryId],
  );

  useEffect(() => {
    if (!categoryFetcher.data?.ok) {
      return;
    }

    if (categoryFetcher.data.intent === "create_category") {
      setNewCategoryName("");
    }

    if (categoryFetcher.data.intent === "update_category") {
      setEditingCategoryId(null);
      setEditingCategoryName("");
    }

    if (categoryFetcher.data.intent === "toggle_category" || categoryFetcher.data.intent === "delete_category") {
      setEditingCategoryId(null);
      setEditingCategoryName("");
    }

    revalidator.revalidate();
  }, [categoryFetcher.data, revalidator]);

  useEffect(() => {
    if (selectedCategoryId === "") {
      return;
    }

    if (visibleCategories.some((category) => String(category.id) === selectedCategoryId)) {
      return;
    }

    setSelectedCategoryId("");
  }, [selectedCategoryId, visibleCategories]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id) && item.status !== "PURCHASED" && item.status !== "CANCELED"),
    [items, selectedIds],
  );

  const overallSummaries = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string;
        label: string;
        remainingAmount: number | null;
        selectedAmount: number;
        afterAmount: number | null;
      }
    >();

    for (const item of items) {
      const key = item.budgetPeriodKey ?? "none";
      const current = grouped.get(key) ?? {
        key,
        label: item.budgetPeriodLabel ?? "예산 없음",
        remainingAmount: item.overallRemainingAmount,
        selectedAmount: 0,
        afterAmount: item.overallRemainingAmount,
      };

      if (selectedIds.includes(item.id) && item.status !== "PURCHASED" && item.status !== "CANCELED") {
        current.selectedAmount += item.amount;
      }

      current.afterAmount =
        current.remainingAmount === null
          ? null
          : Math.round((current.remainingAmount - current.selectedAmount) * 100) / 100;
      grouped.set(key, current);
    }

    return Array.from(grouped.values());
  }, [items, selectedIds]);

  const categorySummaries = useMemo(() => {
    const eligibleCategoryKeys = new Set(
      items
        .filter((item) => item.status !== "PURCHASED" && item.status !== "CANCELED")
        .map((item) => `${item.budgetPeriodKey ?? "none"}:${item.categoryId ?? "none"}`),
    );

    const grouped = new Map<
      string,
      {
        key: string;
        label: string;
        periodLabel: string | null;
        remainingAmount: number | null;
        selectedAmount: number;
        afterAmount: number | null;
        hasBudget: boolean;
      }
    >();

    for (const item of items) {
      const key = `${item.budgetPeriodKey ?? "none"}:${item.categoryId ?? "none"}`;
      const current = grouped.get(key) ?? {
        key,
        label: item.categoryName ?? "카테고리 없음",
        periodLabel: item.budgetPeriodLabel,
        remainingAmount: item.categoryRemainingAmount,
        selectedAmount: 0,
        afterAmount: item.categoryRemainingAmount,
        hasBudget: item.hasCategoryBudget,
      };

      if (selectedIds.includes(item.id) && item.status !== "PURCHASED" && item.status !== "CANCELED") {
        current.selectedAmount += item.amount;
      }

      current.afterAmount =
        current.remainingAmount === null
          ? null
          : Math.round((current.remainingAmount - current.selectedAmount) * 100) / 100;
      grouped.set(key, current);
    }

    return Array.from(grouped.entries())
      .filter(([key]) => eligibleCategoryKeys.has(key))
      .map(([, value]) => value)
      .sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));
  }, [items, selectedIds]);

  const selectedTotalAmount = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.amount, 0),
    [selectedItems],
  );

  const groupedItems = useMemo<PlannedPurchaseDateGroup[]>(() => {
    const sortedItems = [...items].sort((a, b) => {
      const aDateKey = getPlannedDateKey(a.plannedFor);
      const bDateKey = getPlannedDateKey(b.plannedFor);

      if (aDateKey !== bDateKey) {
        return aDateKey.localeCompare(bDateKey);
      }

      return a.id - b.id;
    });

    const grouped = new Map<string, PlannedPurchasePanelItem[]>();
    for (const item of sortedItems) {
      const dateKey = getPlannedDateKey(item.plannedFor);
      const current = grouped.get(dateKey) ?? [];
      current.push(item);
      grouped.set(dateKey, current);
    }

    return Array.from(grouped.entries()).map(([dateKey, groupedDateItems]) => ({
      dateKey,
      label: formatPlannedDateLabel(groupedDateItems[0]?.plannedFor ?? dateKey),
      items: groupedDateItems,
    }));
  }, [items]);

  const toggleSelected = (purchaseId: number) => {
    setSelectedIds((current) =>
      current.includes(purchaseId) ? current.filter((id) => id !== purchaseId) : [...current, purchaseId],
    );
  };

  const toggleMemo = (purchaseId: number) => {
    setExpandedMemoIds((current) =>
      current.includes(purchaseId) ? current.filter((id) => id !== purchaseId) : [...current, purchaseId],
    );
  };

  return (
    <div className="min-h-full bg-white">
      <div className="border-b border-slate-100 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.76rem] font-semibold text-slate-800">현재 남은 지출 예산</p>
            <p className="mt-1 text-[0.68rem] text-slate-400">체크한 항목만 계산해요</p>
          </div>
          <div className="inline-flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSummaryMode("overall")}
              className={cn(
                "border-b border-transparent px-0 py-1 text-[0.68rem] transition-colors",
                summaryMode === "overall" ? "border-slate-500 text-slate-900" : "text-slate-400",
              )}
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setSummaryMode("category")}
              className={cn(
                "border-b border-transparent px-0 py-1 text-[0.68rem] transition-colors",
                summaryMode === "category" ? "border-slate-500 text-slate-900" : "text-slate-400",
              )}
            >
              카테고리
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-b border-slate-100 py-2">
          <span className="text-[0.72rem] text-slate-400">선택 합계</span>
          <span className="text-[0.82rem] font-semibold text-slate-900">{formatLedgerAmount(selectedTotalAmount)}</span>
        </div>

        <div className="mt-2">
          {summaryMode === "overall"
            ? overallSummaries.map((summary) => (
                <div key={summary.key} className="border-b border-slate-100 py-2.5 last:border-b-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[0.72rem] font-medium text-slate-700">{summary.label}</p>
                    <p className={cn("text-[0.72rem] font-medium", getBudgetToneClass(summary.remainingAmount))}>
                      {summary.remainingAmount === null ? "비교 불가" : formatLedgerAmount(summary.remainingAmount)}
                    </p>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[0.68rem]">
                    <span className="text-slate-400">체크 금액</span>
                    <span className="text-slate-600">{formatLedgerAmount(summary.selectedAmount)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[0.68rem]">
                    <span className="text-slate-400">구매 후</span>
                    <span className={cn("font-medium", getBudgetToneClass(summary.afterAmount))}>
                      {renderAfterBudgetLabel(summary.afterAmount)}
                    </span>
                  </div>
                </div>
              ))
            : categorySummaries.map((summary) => (
                <div key={summary.key} className="border-b border-slate-100 py-2.5 last:border-b-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[0.72rem] font-medium text-slate-700">{summary.label}</p>
                      {summary.periodLabel ? (
                        <p className="mt-0.5 text-[0.62rem] text-slate-400">{summary.periodLabel}</p>
                      ) : null}
                    </div>
                    <p className={cn("text-[0.72rem] font-medium", getBudgetToneClass(summary.remainingAmount))}>
                      {!summary.hasBudget
                        ? "예산 미설정"
                        : summary.remainingAmount === null
                          ? "비교 불가"
                          : formatLedgerAmount(summary.remainingAmount)}
                    </p>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[0.68rem]">
                    <span className="text-slate-400">체크 금액</span>
                    <span className="text-slate-600">{formatLedgerAmount(summary.selectedAmount)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[0.68rem]">
                    <span className="text-slate-400">구매 후</span>
                    <span className={cn("font-medium", getBudgetToneClass(summary.afterAmount))}>
                      {!summary.hasBudget ? "예산 미설정" : renderAfterBudgetLabel(summary.afterAmount)}
                    </span>
                  </div>
                </div>
              ))}
        </div>
      </div>

      <div className="pb-20">
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-[0.8rem] text-slate-400">이번 달 살 것을 아직 적어두지 않았어요.</div>
        ) : (
          <div className="px-4 py-2">
            {groupedItems.map((group) => (
              <section key={group.dateKey} className="py-2">
                <p className="pb-1 text-[0.72rem] font-semibold text-slate-500">{group.label}</p>
                <div className="divide-y divide-slate-100">
                  {group.items.map((item) => {
                    const statusMeta = STATUS_META[item.status];
                    const isIncludedInBudget = item.status !== "PURCHASED" && item.status !== "CANCELED";
                    const isChecked = isIncludedInBudget && selectedIds.includes(item.id);

                    return (
                      <article
                        key={item.id}
                        className={cn(
                          "py-3",
                          item.status === "PURCHASED" && "bg-emerald-50/20",
                          item.status === "CANCELED" && "opacity-60",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!isIncludedInBudget) {
                                return;
                              }

                              toggleSelected(item.id);
                            }}
                            disabled={!isIncludedInBudget}
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                              isChecked
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-300 bg-white text-transparent",
                              !isIncludedInBudget && "cursor-default border-slate-200 bg-slate-50 text-transparent",
                            )}
                            aria-label={`${item.title} 포함 여부`}
                          >
                            <span className="text-[10px]">✓</span>
                          </button>

                          <div className="min-w-0 flex-1">
                            <button className="truncate text-left text-[0.86rem] font-semibold text-slate-900" type="button">
                              <span className={cn(item.status === "PURCHASED" && "text-slate-400 line-through")}>
                                {item.title}
                              </span>
                            </button>
                          </div>

                          <p
                            className={cn(
                              "shrink-0 text-[0.82rem] font-semibold text-slate-900",
                              item.status === "PURCHASED" && "text-slate-400 line-through",
                            )}
                          >
                            {formatLedgerAmount(item.amount)}
                          </p>

                          <Form method="post" className="shrink-0">
                            <input type="hidden" name="intent" value="update_planned_purchase_status" />
                            <input type="hidden" name="purchaseId" value={item.id} />
                            <select
                              name="status"
                              defaultValue={item.status}
                              onChange={(event) => event.currentTarget.form?.requestSubmit()}
                              className={cn(
                                "h-7 rounded-none border-0 border-b border-slate-200 bg-transparent px-1 text-[0.65rem] font-medium outline-none",
                                statusMeta.textClassName,
                              )}
                            >
                              <option value="PLANNED">예정</option>
                              <option value="HOLD">보류</option>
                              <option value="PURCHASED">구매함</option>
                            </select>
                          </Form>

                          <button
                            type="button"
                            onClick={() => toggleMemo(item.id)}
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center text-slate-400 transition-colors hover:text-slate-600",
                              !item.memo && "text-slate-200 hover:text-slate-300",
                            )}
                            aria-label={`${item.title} 메모 보기`}
                          >
                            <MessageSquareText className="h-3.5 w-3.5" />
                          </button>

                          <Form method="post" className="shrink-0">
                            <input type="hidden" name="intent" value="delete_planned_purchase" />
                            <input type="hidden" name="purchaseId" value={item.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 rounded-none text-slate-400 hover:bg-transparent hover:text-slate-600"
                              aria-label={`${item.title} 삭제`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </Form>
                        </div>

                        {item.memo && expandedMemoIds.includes(item.id) ? (
                          <p className="mt-2 border-l border-slate-200 pl-3 text-[0.74rem] leading-6 text-slate-500">{item.memo}</p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          onCreateDialogOpenChange(open);
          if (!open) {
            setSelectedCategoryId("");
          }
        }}
      >
        <DialogContent className="rounded-3xl p-5 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>살 것 추가</DialogTitle>
            <DialogDescription>이번 달 사고 싶은 것과 가격을 적어둘 수 있어요.</DialogDescription>
          </DialogHeader>

          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="create_planned_purchase" />

            <div className="grid grid-cols-[minmax(0,1fr)_6.75rem] gap-3">
              <Input
                name="title"
                placeholder="살 것 이름"
                required
                className="h-10 rounded-2xl border-slate-200 text-[0.82rem]"
              />
              <Input
                name="amount"
                inputMode="numeric"
                placeholder="0원"
                required
                className="h-10 rounded-2xl border-slate-200 text-right text-[0.82rem]"
              />
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_2.25rem_8rem] gap-2">
              <div className="min-w-0">
                <input type="hidden" name="categoryId" value={selectedCategoryId} />
                <Select value={selectedCategoryId || undefined} onValueChange={(value) => setSelectedCategoryId(value === NO_CATEGORY_VALUE ? "" : value)}>
                  <SelectTrigger className="h-10 rounded-2xl border-slate-200 bg-white text-[0.8rem] text-slate-700 shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:text-slate-400 [&>svg]:opacity-100">
                    <SelectValue placeholder="카테고리 선택" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 overflow-y-auto rounded-xl border-slate-200 bg-white shadow-lg">
                    <SelectItem value={NO_CATEGORY_VALUE}>카테고리 없음</SelectItem>
                    {visibleCategories.map((category) => (
                      <SelectItem key={category.id} value={String(category.id)}>
                        {category.name}
                        {!category.isActive ? " (숨김)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-9 rounded-full text-slate-500"
                onClick={() => setIsCategoryDialogOpen(true)}
                aria-label="카테고리 관리"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
              <Input
                type="date"
                name="plannedFor"
                defaultValue={defaultDateValue}
                className="h-10 rounded-2xl border-slate-200 text-[0.76rem]"
              />
            </div>

            <Textarea
              name="memo"
              placeholder="메모"
              className="min-h-[84px] rounded-2xl border-slate-200 text-[0.8rem]"
            />

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" className="rounded-2xl" onClick={() => onCreateDialogOpenChange(false)}>
                닫기
              </Button>
              <Button type="submit" className="rounded-2xl bg-slate-700 hover:bg-slate-800">
                추가
              </Button>
            </div>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-3xl p-5 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>지출 카테고리 관리</DialogTitle>
            <DialogDescription>살 것에 쓸 카테고리를 바로 만들고 정리할 수 있어요.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {categoryFetcher.data?.error ? (
              <p className="rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{categoryFetcher.data.error}</p>
            ) : null}

            <categoryFetcher.Form method="post" className="space-y-2 rounded-2xl border bg-slate-50 p-4">
              <input type="hidden" name="intent" value="create_category" />
              <input type="hidden" name="type" value="EXPENSE" />
              <Label htmlFor="newPlannedPurchaseCategoryName" className="text-xs">
                새 카테고리
              </Label>
              <div className="flex gap-2">
                <Input
                  id="newPlannedPurchaseCategoryName"
                  name="name"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="예: 식비, 취미, 선물"
                  className="rounded-2xl bg-white"
                />
                <Button type="submit" className="rounded-2xl">
                  추가
                </Button>
              </div>
            </categoryFetcher.Form>

            {editingCategoryId !== null ? (
              <categoryFetcher.Form method="post" className="space-y-2 rounded-2xl border bg-white p-3">
                <input type="hidden" name="intent" value="update_category" />
                <input type="hidden" name="categoryId" value={editingCategoryId} />
                <Label htmlFor="editingPlannedPurchaseCategoryName" className="text-xs">
                  카테고리 이름 수정
                </Label>
                <Input
                  id="editingPlannedPurchaseCategoryName"
                  name="name"
                  value={editingCategoryName}
                  onChange={(event) => setEditingCategoryName(event.target.value)}
                  className="rounded-2xl"
                />
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1 rounded-2xl">
                    저장
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 rounded-2xl"
                    onClick={() => {
                      setEditingCategoryId(null);
                      setEditingCategoryName("");
                    }}
                  >
                    취소
                  </Button>
                </div>
              </categoryFetcher.Form>
            ) : null}

            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-900">사용 중인 카테고리</p>
              {activeCategories.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 px-4 py-4 text-xs text-slate-500">아직 저장한 카테고리가 없습니다.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {activeCategories.map((category) => (
                    <div key={category.id} className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1.5">
                      <span className="text-xs font-medium text-slate-900">{category.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-full text-slate-500"
                        aria-label={`${category.name} 수정`}
                        title="수정"
                        onClick={() => {
                          setEditingCategoryId(category.id);
                          setEditingCategoryName(category.name);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <categoryFetcher.Form method="post">
                        <input type="hidden" name="intent" value="toggle_category" />
                        <input type="hidden" name="categoryId" value={category.id} />
                        <input type="hidden" name="nextActive" value="false" />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded-full text-slate-500"
                          aria-label={`${category.name} 숨기기`}
                          title="숨기기"
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                        </Button>
                      </categoryFetcher.Form>
                      {category.entryCount === 0 && category.budgetAllocationCount === 0 ? (
                        <categoryFetcher.Form method="post">
                          <input type="hidden" name="intent" value="delete_category" />
                          <input type="hidden" name="categoryId" value={category.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-full text-rose-500"
                            aria-label={`${category.name} 삭제`}
                            title="완전 삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </categoryFetcher.Form>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {inactiveCategories.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-900">숨긴 카테고리</p>
                <div className="flex flex-wrap gap-2">
                  {inactiveCategories.map((category) => (
                    <div key={category.id} className="inline-flex items-center gap-1 rounded-full border border-dashed bg-slate-50 px-3 py-1.5">
                      <span className="text-xs text-slate-600">{category.name}</span>
                      <categoryFetcher.Form method="post">
                        <input type="hidden" name="intent" value="toggle_category" />
                        <input type="hidden" name="categoryId" value={category.id} />
                        <input type="hidden" name="nextActive" value="true" />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded-full text-slate-500"
                          aria-label={`${category.name} 복원`}
                          title="복원"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </categoryFetcher.Form>
                      {category.entryCount === 0 && category.budgetAllocationCount === 0 ? (
                        <categoryFetcher.Form method="post">
                          <input type="hidden" name="intent" value="delete_category" />
                          <input type="hidden" name="categoryId" value={category.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-full text-rose-500"
                            aria-label={`${category.name} 삭제`}
                            title="완전 삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </categoryFetcher.Form>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
