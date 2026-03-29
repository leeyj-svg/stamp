export const DEVLOG_DEFAULT_STATUSES = [
  { key: "TODO", label: "할 일" },
  { key: "IN_PROGRESS", label: "진행중" },
  { key: "BLOCKED", label: "막힘" },
  { key: "DONE", label: "완료" },
  { key: "ARCHIVED", label: "보관" },
] as const;

export type DevlogDefaultStatusKey = (typeof DEVLOG_DEFAULT_STATUSES)[number]["key"];
export type DevlogStatusValue = string;

export const DEVLOG_STATUS_VALUES = DEVLOG_DEFAULT_STATUSES.map((status) => status.key) as DevlogDefaultStatusKey[];

export const DEVLOG_STATUS_LABELS: Record<DevlogDefaultStatusKey, string> = Object.fromEntries(
  DEVLOG_DEFAULT_STATUSES.map((status) => [status.key, status.label]),
) as Record<DevlogDefaultStatusKey, string>;

export const DEVLOG_NEXT_WORK_STATUS_PRIORITY = ["IN_PROGRESS", "TODO", "BLOCKED"] as const;
export const DEVLOG_CLOSED_STATUS_KEYS = ["DONE", "ARCHIVED"] as const;
export const DEVLOG_HIDDEN_BOARD_STATUS_KEYS = ["ARCHIVED"] as const;

export function getDefaultDevlogStatuses() {
  return DEVLOG_DEFAULT_STATUSES.map((status, index) => ({
    statusKey: status.key,
    label: status.label,
    sortOrder: (index + 1) * 10,
  }));
}

export function getDevlogStatusLabel(status: string, labels?: Record<string, string>) {
  return labels?.[status] ?? DEVLOG_STATUS_LABELS[status as DevlogDefaultStatusKey] ?? status;
}

export function createDevlogStatusKey(label: string, existingKeys: string[]) {
  const normalizedBase = label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);

  const base = normalizedBase ? `CUSTOM_${normalizedBase}` : "CUSTOM_STATUS";
  if (!existingKeys.includes(base)) {
    return base;
  }

  let suffix = 2;
  while (existingKeys.includes(`${base}_${suffix}`)) {
    suffix += 1;
  }

  return `${base}_${suffix}`;
}

export function formatDevlogWorkItemReference(workItemId: number) {
  return `#${workItemId}`;
}

export type DevlogWorkItemReferencePart =
  | { type: "text"; value: string }
  | { type: "reference"; value: string; workItemId: number };

export function extractDevlogWorkItemReferenceIds(...values: Array<string | null | undefined>) {
  const seen = new Set<number>();
  const workItemIds: number[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const match of value.matchAll(/#(\d+)\b/g)) {
      const workItemId = Number(match[1]);
      if (!Number.isInteger(workItemId) || workItemId < 1 || seen.has(workItemId)) {
        continue;
      }

      seen.add(workItemId);
      workItemIds.push(workItemId);
    }
  }

  return workItemIds;
}

export function getDevlogWorkItemReferenceParts(text: string) {
  const parts: DevlogWorkItemReferencePart[] = [];

  let cursor = 0;
  for (const match of text.matchAll(/#(\d+)\b/g)) {
    const index = match.index ?? 0;
    const rawValue = match[0];
    const workItemId = Number(match[1]);

    if (index > cursor) {
      parts.push({
        type: "text",
        value: text.slice(cursor, index),
      });
    }

    parts.push({
      type: "reference",
      value: rawValue,
      workItemId,
    });

    cursor = index + rawValue.length;
  }

  if (cursor < text.length) {
    parts.push({
      type: "text",
      value: text.slice(cursor),
    });
  }

  return parts.length > 0 ? parts : ([{ type: "text", value: text }] satisfies DevlogWorkItemReferencePart[]);
}
