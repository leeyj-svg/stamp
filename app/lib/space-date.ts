const KOREA_TIME_ZONE = "Asia/Seoul";

const koreanDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KOREA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function parseKoreanDateInput(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getKoreanDateKey(value: Date | string | number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = koreanDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function hasSpacePublicDatePassed(targetDate: Date | string) {
  const todayKey = getKoreanDateKey(Date.now());
  const targetKey = getKoreanDateKey(targetDate);
  return Boolean(todayKey && targetKey && todayKey >= targetKey);
}

export function formatKoreanDate(value: Date | string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}
