const ROUTINE_TIME_ZONE = "Asia/Seoul";
const KST_OFFSET_HOURS = 9;

export function combineRoutineDateAndTime(referenceDate: Date, timeValue?: string | null) {
  if (!timeValue) {
    return null;
  }

  const [hour, minute] = timeValue.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }

  return new Date(
    Date.UTC(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      referenceDate.getDate(),
      hour - KST_OFFSET_HOURS,
      minute,
      0,
      0,
    ),
  );
}

export function formatRoutineTimeValue(value: string | Date | null | undefined) {
  if (!value) {
    return "";
  }

  const performedAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(performedAt.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: ROUTINE_TIME_ZONE,
  }).formatToParts(performedAt);

  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}
