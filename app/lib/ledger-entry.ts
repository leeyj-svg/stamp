export const ENTRY_TYPES = ["INCOME", "EXPENSE", "SAVING"] as const;
export const PAYMENT_METHODS = ["CASH", "CARD", "ACCOUNT_TRANSFER"] as const;

export type LedgerEntryTypeValue = (typeof ENTRY_TYPES)[number];
export type LedgerPaymentMethodValue = (typeof PAYMENT_METHODS)[number];

export function formatLedgerAmount(amount: number) {
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(amount)}원`;
}

export function parseLedgerBenefitTagAmount(tagName: string) {
  const compactTagName = tagName.replace(/\s+/g, "");
  if (!/(포인트|캐시|쿠폰|상품권|마일리지|적립금|페이|할인)/i.test(compactTagName)) {
    return 0;
  }

  const match = compactTagName.match(/(\d[\d,]*(?:\.\d+)?)(만원|천원|원|만|천)?/);
  if (!match) {
    return 0;
  }

  const numericAmount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return 0;
  }

  const unit = match[2] ?? "";
  if (unit === "만원" || unit === "만") {
    return Math.round(numericAmount * 10_000);
  }

  if (unit === "천원" || unit === "천") {
    return Math.round(numericAmount * 1_000);
  }

  return Math.round(numericAmount);
}

export function getLedgerBenefitTagAmount(tagNames: string[]) {
  return tagNames.reduce((sum, tagName) => sum + parseLedgerBenefitTagAmount(tagName), 0);
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
