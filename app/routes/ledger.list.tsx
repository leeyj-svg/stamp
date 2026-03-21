import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, MoreVertical } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import {
  formatLedgerAmount,
  getDateKey,
  getPaymentMethodLabel,
  type LedgerEntryTypeValue,
} from "~/lib/ledger-entry";
import { ensureLedgerSetup, getMonthToken, shiftMonthToken } from "~/lib/ledger";
import { cn } from "~/lib/utils";

type EntryFilterValue = "ALL" | LedgerEntryTypeValue;

function parseMonthToken(value: string | null) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

function parseEntryFilter(value: string | null): EntryFilterValue {
  if (value === "INCOME" || value === "EXPENSE" || value === "SAVING") {
    return value;
  }

  return "ALL";
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

function parseCurrentWeekBudgetView(value: string | null) {
  return value === "1";
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

function buildBudgetQuery(displayParam: string | null, showCurrentWeekBudget: boolean, selectedCategoryIds: number[] = []) {
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

function buildLedgerListLink(
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

function buildLedgerMonthLink(
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

function buildLedgerDateLink(
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

function toggleEntryFilter(currentFilter: EntryFilterValue, nextFilter: LedgerEntryTypeValue): EntryFilterValue {
  return currentFilter === nextFilter ? "ALL" : nextFilter;
}

function formatEntryTimeLine(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function getCategoryChipClass(type: EntryFilterValue, selected: boolean) {
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
  const displayParam = url.searchParams.get("display");
  const monthStart = getMonthStart(monthToken);
  const nextMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1, 0, 0, 0, 0);

  const [entries, categories] = await Promise.all([
    db.ledgerEntry.findMany({
      where: {
        userId: user.id,
        usedAt: {
          gte: monthStart,
          lt: nextMonthStart,
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
    }),
    loadLedgerCategories(db, user.id),
  ]);

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

  return {
    monthToken,
    monthLabel: getMonthLabel(monthStart),
    prevMonthToken: shiftMonthToken(monthToken, -1),
    nextMonthToken: shiftMonthToken(monthToken, 1),
    selectedFilter,
    selectedCategoryIds,
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
    showCurrentWeekBudget,
    displayParam,
    categories,
    entries,
  } = useLoaderData<typeof loader>();
  const [isCategoryFiltersExpanded, setIsCategoryFiltersExpanded] = useState(false);

  const filteredEntries = useMemo(() => {
    const typeEntries = selectedFilter === "ALL" ? entries : entries.filter((entry) => entry.type === selectedFilter);
    return selectedCategoryIds.length === 0
      ? typeEntries
      : typeEntries.filter((entry) => entry.categoryId !== null && selectedCategoryIds.includes(entry.categoryId));
  }, [entries, selectedCategoryIds, selectedFilter]);

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
    buildLedgerListLink(
      monthToken,
      selectedFilter,
      displayParam,
      showCurrentWeekBudget,
      selectedCategoryIds.includes(categoryId)
        ? selectedCategoryIds.filter((id) => id !== categoryId)
        : [...selectedCategoryIds, categoryId],
    );

  return (
    <>
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
                <Link to={buildLedgerListLink(prevMonthToken, selectedFilter, displayParam, showCurrentWeekBudget, selectedCategoryIds)}>
                  <ChevronLeft className="h-6 w-6" />
                </Link>
              </Button>
              <div className="min-w-0 text-center">
                <h1 className="text-[1.15rem] font-semibold text-slate-900">{monthLabel}</h1>
              </div>
              <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
                <Link to={buildLedgerListLink(nextMonthToken, selectedFilter, displayParam, showCurrentWeekBudget, selectedCategoryIds)}>
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
                  <Link
                    to={`/ledger/stats?month=${monthToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}${
                      buildBudgetQuery(displayParam, showCurrentWeekBudget, selectedCategoryIds)
                        ? `&${buildBudgetQuery(displayParam, showCurrentWeekBudget, selectedCategoryIds)}`
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
                  <Link to={`/ledger/budgets?month=${monthToken}${selectedFilter !== "ALL" ? `&type=${selectedFilter}` : ""}`}>이 달 예산 수정</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="grid grid-cols-3 border-b bg-white">
          <Link
            to={buildLedgerListLink(monthToken, toggleEntryFilter(selectedFilter, "INCOME"), displayParam, showCurrentWeekBudget)}
            className={cn("py-3 text-center transition-colors", selectedFilter === "INCOME" ? "bg-sky-50" : "hover:bg-slate-50")}
          >
            <p className="text-sm font-medium text-slate-900">수입</p>
            <p className="mt-1 text-sm font-semibold text-sky-500">{formatLedgerAmount(summary.income)}</p>
          </Link>
          <Link
            to={buildLedgerListLink(monthToken, toggleEntryFilter(selectedFilter, "EXPENSE"), displayParam, showCurrentWeekBudget)}
            className={cn("py-3 text-center transition-colors", selectedFilter === "EXPENSE" ? "bg-rose-50" : "hover:bg-slate-50")}
          >
            <p className="text-sm font-medium text-slate-900">지출</p>
            <p className="mt-1 text-sm font-semibold text-rose-400">{formatLedgerAmount(summary.expense)}</p>
          </Link>
          <Link
            to={buildLedgerListLink(monthToken, toggleEntryFilter(selectedFilter, "SAVING"), displayParam, showCurrentWeekBudget)}
            className={cn("py-3 text-center transition-colors", selectedFilter === "SAVING" ? "bg-emerald-50" : "hover:bg-slate-50")}
          >
            <p className="text-sm font-medium text-slate-900">저축</p>
            <p className="mt-1 text-sm font-semibold text-emerald-600">{formatLedgerAmount(summary.saving)}</p>
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
                    to={buildLedgerDateLink(group.dateKey, monthToken, selectedFilter, displayParam, showCurrentWeekBudget, selectedCategoryIds)}
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
                    const amountClass =
                      entry.type === "INCOME" ? "text-sky-500" : entry.type === "EXPENSE" ? "text-rose-500" : "text-emerald-600";

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

                          <p className={cn("shrink-0 whitespace-nowrap pt-1 text-right text-[0.8rem] font-medium", amountClass)}>
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
    </>
  );
}
