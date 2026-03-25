import { Prisma } from "@prisma/client";

import type { PrismaClient } from "@prisma/client";
import { parseBudgetInput } from "~/lib/ledger-budget";

export const LEDGER_PLANNED_PURCHASE_STATUS_VALUES = ["PLANNED", "HOLD", "PURCHASED", "CANCELED"] as const;

export type LedgerPlannedPurchaseStatusValue = (typeof LEDGER_PLANNED_PURCHASE_STATUS_VALUES)[number];

export type LedgerPlannedPurchaseSummary = {
  id: number;
  title: string;
  amount: number;
  memo: string | null;
  plannedFor: string;
  status: LedgerPlannedPurchaseStatusValue;
  categoryId: number | null;
  categoryName: string | null;
  createdAt: string;
  updatedAt: string;
};

type LedgerPlannedPurchaseRow = {
  id: number;
  title: string;
  amount: Prisma.Decimal | number | string;
  memo: string | null;
  plannedFor: Date;
  status: LedgerPlannedPurchaseStatusValue;
  categoryId: number | null;
  categoryName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function parseLedgerPlannedPurchaseStatus(value: FormDataEntryValue | null): LedgerPlannedPurchaseStatusValue | null {
  if (typeof value !== "string") {
    return null;
  }

  return LEDGER_PLANNED_PURCHASE_STATUS_VALUES.find((status) => status === value) ?? null;
}

export function parseLedgerPlannedPurchaseId(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseLedgerPlannedPurchaseDate(value: FormDataEntryValue | null, fallbackDate: Date) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(fallbackDate.getFullYear(), fallbackDate.getMonth(), fallbackDate.getDate(), 12, 0, 0, 0);
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function parseLedgerPlannedPurchaseAmount(value: FormDataEntryValue | null) {
  return parseBudgetInput(typeof value === "string" ? value : "");
}

export async function listLedgerPlannedPurchasesForMonth(
  db: PrismaClient,
  userId: string,
  monthStart: Date,
  nextMonthStart: Date,
) {
  const rows = await db.$queryRaw<LedgerPlannedPurchaseRow[]>(Prisma.sql`
    SELECT
      purchase.id,
      purchase.title,
      purchase.amount,
      purchase.memo,
      purchase.plannedFor,
      purchase.status,
      purchase.categoryId,
      category.name AS categoryName,
      purchase.createdAt,
      purchase.updatedAt
    FROM \`LedgerPlannedPurchase\` AS purchase
    LEFT JOIN \`LedgerCategory\` AS category ON category.id = purchase.categoryId
    WHERE purchase.userId = ${userId}
      AND purchase.plannedFor >= ${monthStart}
      AND purchase.plannedFor < ${nextMonthStart}
    ORDER BY
      CASE purchase.status
        WHEN 'PLANNED' THEN 0
        WHEN 'HOLD' THEN 1
        WHEN 'PURCHASED' THEN 2
        ELSE 3
      END,
      purchase.plannedFor ASC,
      purchase.createdAt DESC
  `);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    amount: Number(row.amount),
    memo: row.memo,
    plannedFor: row.plannedFor.toISOString(),
    status: row.status,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })) satisfies LedgerPlannedPurchaseSummary[];
}

export async function createLedgerPlannedPurchase(
  db: PrismaClient,
  userId: string,
  input: {
    title: string;
    amount: number;
    memo: string | null;
    plannedFor: Date;
    categoryId: number | null;
  },
) {
  const now = new Date();
  await db.$executeRaw(Prisma.sql`
    INSERT INTO \`LedgerPlannedPurchase\` (
      \`userId\`,
      \`categoryId\`,
      \`title\`,
      \`amount\`,
      \`memo\`,
      \`plannedFor\`,
      \`status\`,
      \`createdAt\`,
      \`updatedAt\`
    )
    VALUES (
      ${userId},
      ${input.categoryId},
      ${input.title},
      ${input.amount},
      ${input.memo},
      ${input.plannedFor},
      'PLANNED',
      ${now},
      ${now}
    )
  `);
}

export async function updateLedgerPlannedPurchaseStatus(
  db: PrismaClient,
  userId: string,
  purchaseId: number,
  status: LedgerPlannedPurchaseStatusValue,
) {
  const now = new Date();
  await db.$executeRaw(Prisma.sql`
    UPDATE \`LedgerPlannedPurchase\`
    SET \`status\` = ${status}, \`updatedAt\` = ${now}
    WHERE \`id\` = ${purchaseId} AND \`userId\` = ${userId}
  `);
}

export async function deleteLedgerPlannedPurchase(db: PrismaClient, userId: string, purchaseId: number) {
  await db.$executeRaw(Prisma.sql`
    DELETE FROM \`LedgerPlannedPurchase\`
    WHERE \`id\` = ${purchaseId} AND \`userId\` = ${userId}
  `);
}
