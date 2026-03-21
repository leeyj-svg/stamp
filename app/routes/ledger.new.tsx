import { type ActionFunctionArgs, type LoaderFunctionArgs, useLoaderData } from "react-router";

import { LedgerEntryForm } from "~/components/ledger-entry-form";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import {
  createEntrySchema,
  handleCategoryIntent,
  loadLedgerCategories,
  redirectWithToastAndTarget,
  resolveLedgerTagIds,
} from "~/lib/ledger-entry.server";
import { ensureLedgerBudgetPeriodForDate } from "~/lib/ledger-budget.server";
import { type LedgerEntryTypeValue, getDateKey, parseOptionalDateToken } from "~/lib/ledger-entry";
import { ensureLedgerSetup, getMonthToken } from "~/lib/ledger";

function parseEntryType(value: string | null): LedgerEntryTypeValue | null {
  if (value === "INCOME" || value === "EXPENSE" || value === "SAVING") {
    return value;
  }

  return null;
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  await ensureLedgerSetup(db, user.id);

  const url = new URL(request.url);
  const selectedDate = parseOptionalDateToken(url.searchParams.get("date")) ?? new Date();
  const selectedType = parseEntryType(url.searchParams.get("type"));
  const requestedCategoryIds = parseCategoryIds(url.searchParams);
  const showCurrentWeekBudget = parseCurrentWeekBudgetView(url.searchParams.get("currentWeek"));
  const dateToken = getDateKey(selectedDate);
  const categories = await loadLedgerCategories(db, user.id);
  const normalizedSelectedCategoryIds =
    selectedType !== null
      ? requestedCategoryIds.filter((categoryId) =>
          categories.some((category) => category.id === categoryId && category.type === selectedType),
        )
      : [];
  const defaultCategoryId = normalizedSelectedCategoryIds.length === 1 ? normalizedSelectedCategoryIds[0] : null;

  const backParams = new URLSearchParams({ month: getMonthToken(selectedDate) });
  if (selectedType) {
    backParams.set("type", selectedType);
  }

  if (normalizedSelectedCategoryIds.length > 0) {
    backParams.set("categoryIds", normalizedSelectedCategoryIds.join(","));
  }

  if (showCurrentWeekBudget) {
    backParams.set("currentWeek", "1");
  }

  return {
    dateToken,
    dateLabel: selectedDate.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    }),
    backTo: `/ledger/${dateToken}?${backParams.toString()}`,
    categories,
    selectedType,
    selectedCategoryId: defaultCategoryId,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  await ensureLedgerSetup(db, user.id);

  const formData = await request.formData();
  const categoryResponse = await handleCategoryIntent(db, user.id, formData);
  if (categoryResponse) {
    return categoryResponse;
  }

  const parsed = createEntrySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fallbackDate = typeof formData.get("usedAt") === "string" ? (formData.get("usedAt") as string) : getDateKey(new Date());
    return redirectWithToastAndTarget(request, "error", "입력한 내용을 다시 확인해 주세요.", fallbackDate);
  }

  if (parsed.data.categoryId !== null) {
    const category = await db.ledgerCategory.findFirst({
      where: {
        id: parsed.data.categoryId,
        userId: user.id,
        type: parsed.data.type,
        isActive: true,
      },
      select: { id: true },
    });

    if (!category) {
      return redirectWithToastAndTarget(request, "error", "선택한 카테고리를 찾을 수 없습니다.", parsed.data.usedAt);
    }
  }

  await db.$transaction(async (tx) => {
    const entryDate = new Date(`${parsed.data.usedAt}T12:00:00`);
    const { period } = await ensureLedgerBudgetPeriodForDate(tx, user.id, entryDate);

    const entry = await tx.ledgerEntry.create({
      data: {
        userId: user.id,
        categoryId: parsed.data.categoryId,
        budgetPeriodId: period.id,
        type: parsed.data.type,
        amount: parsed.data.amount,
        usedAt: entryDate,
        paymentMethod: parsed.data.type === "EXPENSE" ? parsed.data.paymentMethod ?? null : null,
        paymentSourceName: parsed.data.type === "EXPENSE" ? parsed.data.paymentSourceName || null : null,
        memo: parsed.data.memo || null,
      },
      select: { id: true },
    });

    const tagIds = await resolveLedgerTagIds(tx, user.id, parsed.data.tagNames);
    if (tagIds.length > 0) {
      await tx.ledgerEntryTag.createMany({
        data: tagIds.map((tagId) => ({ entryId: entry.id, tagId })),
      });
    }
  });

  return redirectWithToastAndTarget(request, "success", "가계부 내역을 저장했습니다.", parsed.data.usedAt);
};

export default function LedgerNewPage() {
  const { dateToken, dateLabel, backTo, categories, selectedType, selectedCategoryId } = useLoaderData<typeof loader>();

  return (
    <LedgerEntryForm
      mode="create"
      dateToken={dateToken}
      dateLabel={dateLabel}
      backTo={backTo}
      categories={categories}
      submitLabel="저장하기"
      defaultValues={{
        type: selectedType ?? "EXPENSE",
        categoryId: selectedCategoryId !== null ? String(selectedCategoryId) : "",
        amount: "",
        paymentMethod: "",
        paymentSourceName: "",
        memo: "",
        tagNames: "",
      }}
    />
  );
}
