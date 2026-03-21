import type { MemoryPost } from "@prisma/client";
import type { JsonValue } from "@prisma/client/runtime/library";

export type SpacePost = MemoryPost;

export type SpaceAiStyle = {
  x?: number;
  y?: number;
  theme?: string;
  scale?: number;
  animDuration?: string;
};

function isJsonRecord(value: JsonValue | null): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSpaceAiStyle(value: JsonValue | null): SpaceAiStyle {
  if (!isJsonRecord(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const aiStyle: SpaceAiStyle = {};

  if (typeof record.x === "number") {
    aiStyle.x = record.x;
  }

  if (typeof record.y === "number") {
    aiStyle.y = record.y;
  }

  if (typeof record.theme === "string") {
    aiStyle.theme = record.theme;
  }

  if (typeof record.scale === "number") {
    aiStyle.scale = record.scale;
  }

  if (typeof record.animDuration === "string") {
    aiStyle.animDuration = record.animDuration;
  }

  return aiStyle;
}

export function parseStoredPostIds(value: string | null): number[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is number => typeof item === "number");
  } catch {
    return [];
  }
}
