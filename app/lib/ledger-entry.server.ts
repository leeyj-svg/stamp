import { Prisma, type PrismaClient } from "@prisma/client";
import { redirect } from "react-router";
import * as z from "zod";

import { ENTRY_TYPES, PAYMENT_METHODS } from "~/lib/ledger-entry";
import { getMonthToken, normalizeTagNames } from "~/lib/ledger";
import { commitSession, getFlashSession } from "~/lib/session.server";

const LEGACY_DEFAULT_CATEGORY_NAMES = [
  "식비",
  "카페",
  "교통",
  "생활",
  "쇼핑",
  "구독",
  "기타",
  "월급",
  "부수입",
  "용돈",
  "환급",
  "비상금",
  "생활비 저축",
  "여행",
  "투자",
] as const;

export type CategoryFetcherData = {
  ok?: boolean;
  intent?: "create_category" | "update_category" | "toggle_category" | "delete_category";
  error?: string;
};

type LedgerDbClient = PrismaClient | Prisma.TransactionClient;

const optionalCategoryIdSchema = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return value;
}, z.number().int().positive().nullable());

const optionalPaymentMethodSchema = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  return value;
}, z.enum(PAYMENT_METHODS).optional());

const baseEntrySchema = z.object({
  type: z.enum(ENTRY_TYPES),
  categoryId: optionalCategoryIdSchema,
  amount: z.coerce.number().positive(),
  usedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: optionalPaymentMethodSchema,
  paymentSourceName: z.string().trim().max(50).optional(),
  memo: z.string().trim().max(300).optional(),
  tagNames: z.string().trim().max(200).optional(),
});

export const createEntrySchema = baseEntrySchema.extend({
  intent: z.literal("create_entry"),
});

export const updateEntrySchema = baseEntrySchema.extend({
  intent: z.literal("update_entry"),
  entryId: z.coerce.number().int().positive(),
});

const createCategorySchema = z.object({
  intent: z.literal("create_category"),
  type: z.enum(ENTRY_TYPES),
  name: z.string().trim().min(1).max(30),
});

const updateCategorySchema = z.object({
  intent: z.literal("update_category"),
  categoryId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(30),
});

const toggleCategorySchema = z.object({
  intent: z.literal("toggle_category"),
  categoryId: z.coerce.number().int().positive(),
  nextActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

const deleteCategorySchema = z.object({
  intent: z.literal("delete_category"),
  categoryId: z.coerce.number().int().positive(),
});

export function jsonResponse(data: CategoryFetcherData, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function redirectWithToastAndTarget(request: Request, type: "success" | "error", message: string, dateToken: string) {
  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  flashSession.flash("toast", { type, message });
  const url = new URL(request.url);
  const params = new URLSearchParams({
    month: getMonthToken(new Date(`${dateToken}T12:00:00`)),
  });
  const selectedType = url.searchParams.get("type");
  if (selectedType === "INCOME" || selectedType === "EXPENSE" || selectedType === "SAVING") {
    params.set("type", selectedType);

    const categoryIds = url.searchParams.get("categoryIds");
    if (categoryIds && categoryIds.trim().length > 0) {
      params.set("categoryIds", categoryIds);
    } else {
      const categoryId = Number(url.searchParams.get("categoryId"));
      if (Number.isInteger(categoryId) && categoryId > 0) {
        params.set("categoryIds", String(categoryId));
      }
    }
  }

  if (url.searchParams.get("currentWeek") === "1") {
    params.set("currentWeek", "1");
  }

  return redirect(`/ledger/${dateToken}?${params.toString()}`, {
    headers: { "Set-Cookie": await commitSession(flashSession) },
  });
}

export async function loadLedgerCategories(db: LedgerDbClient, userId: string) {
  const categories = await db.ledgerCategory.findMany({
    where: {
      userId,
      OR: [
        { sortOrder: { gt: 0 } },
        { entries: { some: { userId } } },
        { name: { notIn: [...LEGACY_DEFAULT_CATEGORY_NAMES] } },
      ],
    },
    select: {
      id: true,
      type: true,
      name: true,
      isActive: true,
      _count: {
        select: {
          entries: true,
          budgetAllocations: true,
        },
      },
    },
    orderBy: [{ type: "asc" }, { isActive: "desc" }, { name: "asc" }],
  });

  return categories.map((category) => ({
    id: category.id,
    type: category.type,
    name: category.name,
    isActive: category.isActive,
    entryCount: category._count.entries,
    budgetAllocationCount: category._count.budgetAllocations,
  }));
}

export async function handleCategoryIntent(db: LedgerDbClient, userId: string, formData: FormData) {
  const intent = formData.get("intent");

  if (intent === "create_category") {
    const parsed = createCategorySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return jsonResponse({ error: "카테고리 이름을 다시 확인해 주세요." }, 400);
    }

    await db.ledgerCategory.upsert({
      where: {
        userId_type_name: {
          userId,
          type: parsed.data.type,
          name: parsed.data.name,
        },
      },
      update: {
        isActive: true,
        sortOrder: 1,
      },
      create: {
        userId,
        type: parsed.data.type,
        name: parsed.data.name,
        sortOrder: 1,
      },
    });

    return jsonResponse({ ok: true, intent: "create_category" });
  }

  if (intent === "update_category") {
    const parsed = updateCategorySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return jsonResponse({ error: "카테고리 이름을 다시 확인해 주세요." }, 400);
    }

    const existingCategory = await db.ledgerCategory.findFirst({
      where: { id: parsed.data.categoryId, userId },
      select: { id: true, type: true },
    });

    if (!existingCategory) {
      return jsonResponse({ error: "수정할 카테고리를 찾을 수 없습니다." }, 404);
    }

    const duplicate = await db.ledgerCategory.findFirst({
      where: {
        userId,
        type: existingCategory.type,
        name: parsed.data.name,
        NOT: { id: parsed.data.categoryId },
      },
      select: { id: true },
    });

    if (duplicate) {
      return jsonResponse({ error: "같은 이름의 카테고리가 이미 있습니다." }, 400);
    }

    await db.ledgerCategory.update({
      where: { id: parsed.data.categoryId },
      data: {
        name: parsed.data.name,
        isActive: true,
        sortOrder: 1,
      },
    });

    return jsonResponse({ ok: true, intent: "update_category" });
  }

  if (intent === "toggle_category") {
    const parsed = toggleCategorySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return jsonResponse({ error: "카테고리 상태를 바꾸지 못했습니다." }, 400);
    }

    const existingCategory = await db.ledgerCategory.findFirst({
      where: { id: parsed.data.categoryId, userId },
      select: { id: true },
    });

    if (!existingCategory) {
      return jsonResponse({ error: "카테고리를 찾을 수 없습니다." }, 404);
    }

    await db.ledgerCategory.update({
      where: { id: parsed.data.categoryId },
      data: {
        isActive: parsed.data.nextActive,
        sortOrder: 1,
      },
    });

    return jsonResponse({ ok: true, intent: "toggle_category" });
  }

  if (intent === "delete_category") {
    const parsed = deleteCategorySchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return jsonResponse({ error: "삭제할 카테고리를 확인해 주세요." }, 400);
    }

    const existingCategory = await db.ledgerCategory.findFirst({
      where: { id: parsed.data.categoryId, userId },
      select: {
        id: true,
        _count: {
          select: {
            entries: true,
            budgetAllocations: true,
          },
        },
      },
    });

    if (!existingCategory) {
      return jsonResponse({ error: "카테고리를 찾을 수 없습니다." }, 404);
    }

    if (existingCategory._count.entries > 0) {
      return jsonResponse({ error: "이미 사용한 카테고리는 삭제할 수 없습니다. 숨김을 사용해 주세요." }, 400);
    }

    if (existingCategory._count.budgetAllocations > 0) {
      return jsonResponse({ error: "예산에 배정된 카테고리는 삭제할 수 없습니다. 예산 설정에서 먼저 해제해 주세요." }, 400);
    }

    await db.ledgerCategory.delete({
      where: { id: parsed.data.categoryId },
    });

    return jsonResponse({ ok: true, intent: "delete_category" });
  }

  return null;
}

export async function resolveLedgerTagIds(db: LedgerDbClient, userId: string, rawTagNames: string | undefined) {
  const tagNames = normalizeTagNames(rawTagNames ?? "");
  if (tagNames.length === 0) {
    return [];
  }

  const tags = await Promise.all(
    tagNames.map((name) =>
      db.ledgerTag.upsert({
        where: {
          userId_name: {
            userId,
            name,
          },
        },
        update: {},
        create: {
          userId,
          name,
        },
        select: { id: true },
      }),
    ),
  );

  return tags.map((tag) => tag.id);
}
