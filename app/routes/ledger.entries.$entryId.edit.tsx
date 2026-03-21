import { type ActionFunctionArgs, type LoaderFunctionArgs, useLoaderData } from "react-router";

import { LedgerEntryForm } from "~/components/ledger-entry-form";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import {
  handleCategoryIntent,
  loadLedgerCategories,
  redirectWithToastAndTarget,
  resolveLedgerTagIds,
  updateEntrySchema,
} from "~/lib/ledger-entry.server";
import { ensureLedgerBudgetPeriodForDate } from "~/lib/ledger-budget.server";
import { type LedgerEntryTypeValue, type LedgerPaymentMethodValue, getDateKey, parseOptionalDateToken } from "~/lib/ledger-entry";
import { ensureLedgerSetup, getMonthToken } from "~/lib/ledger";

function parseEntryId(value: string | undefined) {
  const entryId = Number(value);
  if (!Number.isInteger(entryId) || entryId <= 0) {
    throw new Response("내역을 찾을 수 없습니다.", { status: 404 });
  }

  return entryId;
}

function parseMonthToken(value: string | null) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  await ensureLedgerSetup(db, user.id);

  const entryId = parseEntryId(params.entryId);
  const entry = await db.ledgerEntry.findFirst({
    where: { id: entryId, userId: user.id },
    include: {
      tags: {
        select: {
          tag: {
            select: { name: true },
          },
        },
      },
    },
  });

  if (!entry) {
    throw new Response("내역을 찾을 수 없습니다.", { status: 404 });
  }

  const categories = await loadLedgerCategories(db, user.id);
  const url = new URL(request.url);
  const dateToken = getDateKey(entry.usedAt);
  const monthToken = parseMonthToken(url.searchParams.get("month")) ?? getMonthToken(entry.usedAt);
  const selectedType = parseEntryType(url.searchParams.get("type"));
  const selectedCategoryIds = parseCategoryIds(url.searchParams);
  const showCurrentWeekBudget = parseCurrentWeekBudgetView(url.searchParams.get("currentWeek"));
  const backParams = new URLSearchParams({ month: monthToken });
  if (selectedType) {
    backParams.set("type", selectedType);
  }

  const normalizedSelectedCategoryIds =
    selectedType !== null
      ? selectedCategoryIds.filter((categoryId) =>
          categories.some((category) => category.id === categoryId && category.type === selectedType),
        )
      : [];

  if (normalizedSelectedCategoryIds.length > 0) {
    backParams.set("categoryIds", normalizedSelectedCategoryIds.join(","));
  }

  if (showCurrentWeekBudget) {
    backParams.set("currentWeek", "1");
  }

  return {
    entryId: entry.id,
    dateToken,
    dateLabel: entry.usedAt.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    }),
    backTo: `/ledger/${dateToken}?${backParams.toString()}`,
    categories,
    defaultValues: {
      type: entry.type,
      categoryId: entry.categoryId ? String(entry.categoryId) : "",
      amount: String(Number(entry.amount)),
      paymentMethod: (entry.paymentMethod ?? "") as LedgerPaymentMethodValue | "",
      paymentSourceName: entry.paymentSourceName ?? "",
      memo: entry.memo ?? "",
      tagNames: entry.tags.map((item) => item.tag.name).join(", "),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  await ensureLedgerSetup(db, user.id);

  const formData = await request.formData();
  if (formData.get("intent") === "delete_entry") {
    const entryId = Number(formData.get("entryId"));
    const fallbackDate = typeof formData.get("usedAt") === "string" ? (formData.get("usedAt") as string) : getDateKey(new Date());

    if (!Number.isInteger(entryId) || entryId <= 0) {
      return redirectWithToastAndTarget(request, "error", "삭제할 내역을 찾을 수 없습니다.", fallbackDate);
    }

    const existingEntry = await db.ledgerEntry.findFirst({
      where: { id: entryId, userId: user.id },
      select: { id: true, usedAt: true },
    });

    if (!existingEntry) {
      return redirectWithToastAndTarget(request, "error", "삭제할 내역을 찾을 수 없습니다.", fallbackDate);
    }

    await db.$transaction(async (tx) => {
      await tx.ledgerEntryTag.deleteMany({
        where: { entryId: existingEntry.id },
      });

      await tx.ledgerEntry.delete({
        where: { id: existingEntry.id },
      });
    });

    return redirectWithToastAndTarget(request, "success", "가계부 내역을 삭제했습니다.", getDateKey(existingEntry.usedAt));
  }

  const categoryResponse = await handleCategoryIntent(db, user.id, formData);
  if (categoryResponse) {
    return categoryResponse;
  }

  const parsed = updateEntrySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fallbackDate = typeof formData.get("usedAt") === "string" ? (formData.get("usedAt") as string) : getDateKey(new Date());
    return redirectWithToastAndTarget(request, "error", "입력한 내용을 다시 확인해 주세요.", fallbackDate);
  }

  const existingEntry = await db.ledgerEntry.findFirst({
    where: { id: parsed.data.entryId, userId: user.id },
    select: { id: true, categoryId: true },
  });

  if (!existingEntry) {
    return redirectWithToastAndTarget(request, "error", "수정할 내역을 찾을 수 없습니다.", parsed.data.usedAt);
  }

  if (parsed.data.categoryId !== null) {
    const category = await db.ledgerCategory.findFirst({
      where: {
        id: parsed.data.categoryId,
        userId: user.id,
        type: parsed.data.type,
        OR: existingEntry.categoryId !== null ? [{ isActive: true }, { id: existingEntry.categoryId }] : [{ isActive: true }],
      },
      select: { id: true },
    });

    if (!category) {
      return redirectWithToastAndTarget(request, "error", "선택한 카테고리를 사용할 수 없습니다.", parsed.data.usedAt);
    }
  }

  await db.$transaction(async (tx) => {
    const entryDate = new Date(`${parsed.data.usedAt}T12:00:00`);
    const { period } = await ensureLedgerBudgetPeriodForDate(tx, user.id, entryDate);

    await tx.ledgerEntry.update({
      where: { id: parsed.data.entryId },
      data: {
        categoryId: parsed.data.categoryId,
        budgetPeriodId: period.id,
        type: parsed.data.type,
        amount: parsed.data.amount,
        usedAt: entryDate,
        paymentMethod: parsed.data.type === "EXPENSE" ? parsed.data.paymentMethod ?? null : null,
        paymentSourceName: parsed.data.type === "EXPENSE" ? parsed.data.paymentSourceName || null : null,
        memo: parsed.data.memo || null,
      },
    });

    await tx.ledgerEntryTag.deleteMany({
      where: { entryId: parsed.data.entryId },
    });

    const tagIds = await resolveLedgerTagIds(tx, user.id, parsed.data.tagNames);
    if (tagIds.length > 0) {
      await tx.ledgerEntryTag.createMany({
        data: tagIds.map((tagId) => ({ entryId: parsed.data.entryId, tagId })),
      });
    }
  });

  return redirectWithToastAndTarget(request, "success", "가계부 내역을 수정했습니다.", parsed.data.usedAt);
};

export default function LedgerEntryEditPage() {
  const { entryId, dateToken, dateLabel, backTo, categories, defaultValues } = useLoaderData<typeof loader>();

  return (
    <LedgerEntryForm
      mode="edit"
      entryId={entryId}
      dateToken={dateToken}
      dateLabel={dateLabel}
      backTo={backTo}
      categories={categories}
      submitLabel="수정하기"
      defaultValues={defaultValues}
    />
  );
}
