import { LedgerPeriodBasis, type Prisma, type PrismaClient } from "@prisma/client";

function getLastDayOfMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getClampedDate(year: number, monthIndex: number, day: number) {
  return new Date(year, monthIndex, Math.min(day, getLastDayOfMonth(year, monthIndex)), 0, 0, 0, 0);
}

export function getMonthToken(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

export function shiftMonthToken(monthToken: string, diff: number) {
  const [year, month] = monthToken.split("-").map(Number);
  const shifted = new Date(year, month - 1 + diff, 1);
  return getMonthToken(shifted);
}

export function getLedgerReferenceDateForMonthToken(
  monthToken: string,
  basis: LedgerPeriodBasis,
  paydayDay: number,
) {
  const [year, month] = monthToken.split("-").map(Number);
  const monthStart = new Date(year, month - 1, 1, 12, 0, 0, 0);

  if (basis !== LedgerPeriodBasis.PAYDAY) {
    return monthStart;
  }

  const safePayday = Math.min(Math.max(paydayDay, 1), getLastDayOfMonth(year, month - 1));
  return new Date(year, month - 1, safePayday, 12, 0, 0, 0);
}

export function getLedgerPeriodRange(referenceDate: Date, basis: LedgerPeriodBasis, paydayDay: number) {
  if (basis === LedgerPeriodBasis.CALENDAR) {
    const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1, 0, 0, 0, 0);
    return { start, end };
  }

  const safePayday = Math.min(Math.max(paydayDay, 1), 31);
  const currentMonthPayday = getClampedDate(referenceDate.getFullYear(), referenceDate.getMonth(), safePayday);
  const start =
    referenceDate >= currentMonthPayday
      ? currentMonthPayday
      : getClampedDate(referenceDate.getFullYear(), referenceDate.getMonth() - 1, safePayday);
  const end = getClampedDate(start.getFullYear(), start.getMonth() + 1, safePayday);

  return { start, end };
}

export function getLedgerPeriodLabel(start: Date, endExclusive: Date) {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const endInclusive = new Date(endExclusive);
  endInclusive.setDate(endInclusive.getDate() - 1);

  return `${formatter.format(start)} ~ ${formatter.format(endInclusive)}`;
}

export function normalizeTagNames(raw: string) {
  return [...new Set(raw.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

export async function ensureLedgerSetup(db: PrismaClient | Prisma.TransactionClient, userId: string) {
  await db.ledgerSettings.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      defaultPeriodBasis: LedgerPeriodBasis.CALENDAR,
      paydayDay: 25,
      weekStartDay: "MONDAY",
    },
  });
}
