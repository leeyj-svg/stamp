export const ENTRY_TYPES = ["INCOME", "EXPENSE", "SAVING"] as const;
export const PAYMENT_METHODS = ["CASH", "CARD", "ACCOUNT_TRANSFER"] as const;

export type LedgerEntryTypeValue = (typeof ENTRY_TYPES)[number];
export type LedgerPaymentMethodValue = (typeof PAYMENT_METHODS)[number];

export function formatLedgerAmount(amount: number) {
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(amount)}원`;
}

export function getDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseOptionalDateToken(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

export function parseRequiredDateToken(value: string | undefined) {
  const parsed = parseOptionalDateToken(value ?? null);
  if (!parsed) {
    throw new Response("날짜를 찾을 수 없습니다.", { status: 404 });
  }

  return parsed;
}

export function getTypeLabel(type: LedgerEntryTypeValue) {
  if (type === "INCOME") return "수입";
  if (type === "EXPENSE") return "지출";
  return "저축";
}

export function getPaymentMethodLabel(method: LedgerPaymentMethodValue | null | undefined) {
  if (method === "CARD") return "카드";
  if (method === "ACCOUNT_TRANSFER") return "계좌이체";
  if (method === "CASH") return "현금";
  return "";
}
