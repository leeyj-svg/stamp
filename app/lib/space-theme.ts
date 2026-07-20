import type { JsonValue } from "@prisma/client/runtime/library";

export const SPACE_VIEWPORTS = ["DESKTOP", "MOBILE"] as const;
export const SPACE_SURFACES = ["MEMORY", "ALBUM"] as const;

export type SpaceViewport = (typeof SPACE_VIEWPORTS)[number];
export type SpaceSurface = (typeof SPACE_SURFACES)[number];
export type SpacePostKind = "MESSAGE" | "ALBUM" | "PHOTO";

export type SpaceThemeKey =
  | "galaxy"
  | "camping_night"
  | "spring_petals"
  | "summer_sea"
  | "autumn_leaves"
  | "winter_snow"
  | "film_polaroid"
  | "birthday_party";

export type SpaceTheme = {
  key: SpaceThemeKey;
  label: string;
  shortLabel: string;
  description: string;
  accentColor: string;
  textColor: string;
  mutedTextColor: string;
  panelColor: string;
  cardColor: string;
  inkColor: string;
  background: {
    base: string;
    overlay: string;
    patternColor: string;
  };
  lockedTitle: string;
  unlockedTitle: string;
  memoryLabel: string;
  albumLabel: string;
  layouts: Record<SpaceViewport, Record<SpaceSurface, string>>;
};

export type SpaceAppearanceRecord = {
  viewport: SpaceViewport;
  surface: SpaceSurface;
  layoutKey: string;
  config: JsonValue | null;
};

export type SpacePostAppearanceRecord = {
  viewport: SpaceViewport;
  surface: SpaceSurface;
  style: JsonValue | null;
  sortOrder: number;
};

export type SpacePostForTheme = {
  id: number;
  type: string;
  content: string | null;
  mediaUrl: string | null;
  thumbnailUrl?: string | null;
  nickname: string;
  createdAt: Date | string;
  appearances?: SpacePostAppearanceRecord[];
};

export type SpaceAlbumPage = {
  items: SpacePostForTheme[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type DesktopMemoryStyle = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  color: string;
  delay: number;
};

export type DesktopAlbumStyle = {
  rotation: number;
  offsetY: number;
  tapeColor: string;
  featured: boolean;
  delay: number;
};

export type MobileCardStyle = {
  lane: -1 | 0 | 1;
  offsetX: number;
  offsetY: number;
  rotation: number;
  scale: number;
  variant: string;
  delay: number;
};

export const DEFAULT_SPACE_THEME_KEY: SpaceThemeKey = "galaxy";

/**
 * SPACE theme rules:
 * - MemorySpace.themeKey is the single selected world for the space.
 * - Desktop/mobile do not have independent themes; they have independent layouts.
 * - MEMORY/ALBUM are separate surfaces so notes and photos can be optimized separately.
 * - Guest authors may write content. Only ADMIN or the linked owner may change themes.
 * - Theme changes regenerate appearances, but never duplicate or delete content.
 */
export const SPACE_THEMES: Record<SpaceThemeKey, SpaceTheme> = {
  galaxy: {
    key: "galaxy",
    label: "은하수 별자리",
    shortLabel: "은하수",
    description: "별처럼 흩어진 쪽지와 깊은 밤하늘 앨범",
    accentColor: "#8b5cf6",
    textColor: "#f8fafc",
    mutedTextColor: "#c4b5fd",
    panelColor: "rgba(15, 23, 42, 0.76)",
    cardColor: "rgba(15, 23, 42, 0.92)",
    inkColor: "#ffffff",
    background: {
      base: "radial-gradient(circle at 20% 20%, rgba(124,58,237,0.36), transparent 32%), radial-gradient(circle at 80% 70%, rgba(14,165,233,0.22), transparent 32%), linear-gradient(135deg, #050314 0%, #10102e 52%, #030712 100%)",
      overlay: "linear-gradient(120deg, rgba(236,72,153,0.10), rgba(99,102,241,0.08))",
      patternColor: "rgba(255,255,255,0.72)",
    },
    lockedTitle: "아직 별빛이 모이는 중이에요",
    unlockedTitle: "모두의 마음이 별처럼 펼쳐졌어요",
    memoryLabel: "별 쪽지",
    albumLabel: "우주 앨범",
    layouts: {
      DESKTOP: { MEMORY: "star_map", ALBUM: "polaroid_constellation" },
      MOBILE: { MEMORY: "constellation_stack", ALBUM: "starlit_photo_story" },
    },
  },
  camping_night: {
    key: "camping_night",
    label: "밤하늘 캠핑",
    shortLabel: "캠핑",
    description: "모닥불 주변에 따뜻하게 모이는 쪽지와 사진",
    accentColor: "#f97316",
    textColor: "#fff7ed",
    mutedTextColor: "#fed7aa",
    panelColor: "rgba(30, 20, 12, 0.78)",
    cardColor: "rgba(48, 30, 18, 0.92)",
    inkColor: "#fff7ed",
    background: {
      base: "radial-gradient(circle at 50% 78%, rgba(249,115,22,0.38), transparent 24%), linear-gradient(160deg, #06111f 0%, #132033 45%, #1c120b 100%)",
      overlay: "linear-gradient(180deg, rgba(14,165,233,0.08), rgba(249,115,22,0.14))",
      patternColor: "rgba(253,186,116,0.70)",
    },
    lockedTitle: "모닥불 곁에 마음을 데우는 중이에요",
    unlockedTitle: "따뜻한 밤공기 속 마음이 모였어요",
    memoryLabel: "캠프 쪽지",
    albumLabel: "캠프 앨범",
    layouts: {
      DESKTOP: { MEMORY: "campfire_orbit", ALBUM: "camp_snapshot_wall" },
      MOBILE: { MEMORY: "warm_story_stack", ALBUM: "camp_photo_trail" },
    },
  },
  spring_petals: {
    key: "spring_petals",
    label: "봄날 꽃잎",
    shortLabel: "봄꽃",
    description: "꽃잎처럼 가볍게 흩날리는 부드러운 분위기",
    accentColor: "#f472b6",
    textColor: "#fff1f2",
    mutedTextColor: "#fecdd3",
    panelColor: "rgba(80, 28, 54, 0.72)",
    cardColor: "rgba(255, 241, 242, 0.94)",
    inkColor: "#7f1d1d",
    background: {
      base: "linear-gradient(145deg, #5b1438 0%, #be567f 48%, #ffd7df 100%)",
      overlay: "radial-gradient(circle at 18% 20%, rgba(255,255,255,0.24), transparent 24%), radial-gradient(circle at 86% 12%, rgba(253,164,175,0.28), transparent 30%)",
      patternColor: "rgba(255,228,230,0.82)",
    },
    lockedTitle: "아직 꽃봉오리처럼 간직 중이에요",
    unlockedTitle: "꽃잎처럼 마음이 펼쳐졌어요",
    memoryLabel: "꽃잎 쪽지",
    albumLabel: "봄날 앨범",
    layouts: {
      DESKTOP: { MEMORY: "floating_petals", ALBUM: "petal_polaroid_wall" },
      MOBILE: { MEMORY: "petal_letter_stack", ALBUM: "soft_photo_feed" },
    },
  },
  summer_sea: {
    key: "summer_sea",
    label: "여름 바다",
    shortLabel: "여름",
    description: "물결과 햇빛처럼 시원하게 반짝이는 테마",
    accentColor: "#06b6d4",
    textColor: "#ecfeff",
    mutedTextColor: "#a5f3fc",
    panelColor: "rgba(8, 47, 73, 0.74)",
    cardColor: "rgba(236, 254, 255, 0.94)",
    inkColor: "#164e63",
    background: {
      base: "linear-gradient(160deg, #083344 0%, #0e7490 48%, #67e8f9 100%)",
      overlay: "linear-gradient(180deg, rgba(255,255,255,0.20), rgba(8,145,178,0.12))",
      patternColor: "rgba(207,250,254,0.72)",
    },
    lockedTitle: "파도 아래 마음을 안전하게 보관 중이에요",
    unlockedTitle: "물빛 추억이 환하게 열렸어요",
    memoryLabel: "물결 쪽지",
    albumLabel: "바다 앨범",
    layouts: {
      DESKTOP: { MEMORY: "wave_cards", ALBUM: "shoreline_gallery" },
      MOBILE: { MEMORY: "wave_note_flow", ALBUM: "sea_photo_feed" },
    },
  },
  autumn_leaves: {
    key: "autumn_leaves",
    label: "가을 낙엽",
    shortLabel: "가을",
    description: "따뜻한 종이와 낙엽 사이에 내려앉는 공간",
    accentColor: "#b45309",
    textColor: "#fff7ed",
    mutedTextColor: "#fed7aa",
    panelColor: "rgba(67, 36, 16, 0.76)",
    cardColor: "rgba(255, 247, 237, 0.94)",
    inkColor: "#7c2d12",
    background: {
      base: "linear-gradient(150deg, #3b1f0f 0%, #92400e 50%, #f59e0b 100%)",
      overlay: "radial-gradient(circle at 78% 18%, rgba(254,215,170,0.24), transparent 28%), linear-gradient(180deg, rgba(120,53,15,0.12), rgba(67,20,7,0.28))",
      patternColor: "rgba(254,215,170,0.74)",
    },
    lockedTitle: "낙엽 아래 마음을 잠시 덮어두었어요",
    unlockedTitle: "따뜻한 마음이 낙엽처럼 내려앉았어요",
    memoryLabel: "낙엽 쪽지",
    albumLabel: "가을 앨범",
    layouts: {
      DESKTOP: { MEMORY: "falling_leaves", ALBUM: "warm_album_wall" },
      MOBILE: { MEMORY: "warm_timeline", ALBUM: "autumn_photo_notes" },
    },
  },
  winter_snow: {
    key: "winter_snow",
    label: "겨울 눈",
    shortLabel: "겨울",
    description: "조용한 눈밭에 마음이 하나씩 반짝이는 테마",
    accentColor: "#93c5fd",
    textColor: "#eff6ff",
    mutedTextColor: "#bfdbfe",
    panelColor: "rgba(15, 23, 42, 0.78)",
    cardColor: "rgba(239, 246, 255, 0.95)",
    inkColor: "#1e3a8a",
    background: {
      base: "linear-gradient(160deg, #020617 0%, #1e3a8a 54%, #dbeafe 100%)",
      overlay: "radial-gradient(circle at 50% 10%, rgba(255,255,255,0.24), transparent 24%), linear-gradient(180deg, rgba(147,197,253,0.12), rgba(15,23,42,0.20))",
      patternColor: "rgba(239,246,255,0.84)",
    },
    lockedTitle: "눈처럼 조용히 마음이 쌓이는 중이에요",
    unlockedTitle: "하얀 눈빛처럼 마음이 밝혀졌어요",
    memoryLabel: "눈빛 쪽지",
    albumLabel: "겨울 앨범",
    layouts: {
      DESKTOP: { MEMORY: "snowfield_notes", ALBUM: "frosted_gallery" },
      MOBILE: { MEMORY: "quiet_snow_stack", ALBUM: "winter_photo_feed" },
    },
  },
  film_polaroid: {
    key: "film_polaroid",
    label: "필름 폴라로이드",
    shortLabel: "필름",
    description: "사진과 날짜가 살아나는 빈티지 필름 테마",
    accentColor: "#f59e0b",
    textColor: "#fffbeb",
    mutedTextColor: "#fde68a",
    panelColor: "rgba(28, 25, 23, 0.80)",
    cardColor: "rgba(250, 250, 249, 0.96)",
    inkColor: "#292524",
    background: {
      base: "linear-gradient(145deg, #1c1917 0%, #44403c 52%, #d6d3d1 100%)",
      overlay: "linear-gradient(90deg, rgba(245,158,11,0.16), rgba(120,113,108,0.10))",
      patternColor: "rgba(254,243,199,0.78)",
    },
    lockedTitle: "필름 한 장면처럼 현상되는 중이에요",
    unlockedTitle: "추억이 필름처럼 이어졌어요",
    memoryLabel: "필름 노트",
    albumLabel: "필름 앨범",
    layouts: {
      DESKTOP: { MEMORY: "film_notes", ALBUM: "film_strip_wall" },
      MOBILE: { MEMORY: "ticket_notes", ALBUM: "film_roll_feed" },
    },
  },
  birthday_party: {
    key: "birthday_party",
    label: "생일파티",
    shortLabel: "생일",
    description: "풍선과 색종이 사이에서 축하가 터지는 테마",
    accentColor: "#ec4899",
    textColor: "#fff1f2",
    mutedTextColor: "#fbcfe8",
    panelColor: "rgba(112, 26, 117, 0.74)",
    cardColor: "rgba(255, 241, 242, 0.95)",
    inkColor: "#831843",
    background: {
      base: "linear-gradient(145deg, #701a75 0%, #db2777 45%, #fef3c7 100%)",
      overlay: "radial-gradient(circle at 20% 22%, rgba(255,255,255,0.24), transparent 22%), radial-gradient(circle at 78% 30%, rgba(253,224,71,0.24), transparent 24%)",
      patternColor: "rgba(252,231,243,0.84)",
    },
    lockedTitle: "축하가 터질 시간을 기다리고 있어요",
    unlockedTitle: "오늘의 축하가 활짝 열렸어요",
    memoryLabel: "축하 카드",
    albumLabel: "파티 앨범",
    layouts: {
      DESKTOP: { MEMORY: "confetti_burst", ALBUM: "party_photo_wall" },
      MOBILE: { MEMORY: "party_card_stack", ALBUM: "birthday_photo_feed" },
    },
  },
};

export const SPACE_THEME_OPTIONS = Object.values(SPACE_THEMES);

export function getSpaceTheme(themeKey: string | null | undefined): SpaceTheme {
  return SPACE_THEMES[(themeKey || DEFAULT_SPACE_THEME_KEY) as SpaceThemeKey] ?? SPACE_THEMES[DEFAULT_SPACE_THEME_KEY];
}

export function isSpaceThemeKey(value: FormDataEntryValue | string | null | undefined): value is SpaceThemeKey {
  return typeof value === "string" && value in SPACE_THEMES;
}

export function getSurfaceForPostType(type: string): SpaceSurface {
  return type === "ALBUM" || type === "PHOTO" ? "ALBUM" : "MEMORY";
}

export function getSpaceLayoutKey(themeKey: string | null | undefined, viewport: SpaceViewport, surface: SpaceSurface) {
  return getSpaceTheme(themeKey).layouts[viewport][surface];
}

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomUnit(seed: string) {
  const value = Math.sin(hashSeed(seed)) * 10000;
  return value - Math.floor(value);
}

function randomRange(seed: string, min: number, max: number) {
  return min + randomUnit(seed) * (max - min);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pick<T>(items: readonly T[], seed: string): T {
  return items[Math.floor(randomUnit(seed) * items.length)] ?? items[0];
}

const CARD_COLORS = ["pink", "violet", "cyan", "amber", "emerald", "rose", "blue"] as const;
const TAPE_COLORS = ["#fde68a", "#fecdd3", "#bae6fd", "#bbf7d0", "#ddd6fe", "#fed7aa"] as const;

export function generateSpaceAppearanceConfig(themeKey: string, viewport: SpaceViewport, surface: SpaceSurface) {
  const theme = getSpaceTheme(themeKey);
  return {
    themeKey: theme.key,
    accentColor: theme.accentColor,
    headline: surface === "MEMORY" ? theme.memoryLabel : theme.albumLabel,
    emptyText: surface === "MEMORY" ? "아직 작성된 쪽지가 없어요." : "아직 올려진 사진이 없어요.",
    density: viewport === "DESKTOP" ? "wide" : "cozy",
  };
}

export function generatePostAppearanceStyle(args: {
  postId: number;
  index: number;
  total: number;
  themeKey: string;
  viewport: SpaceViewport;
  surface: SpaceSurface;
}) {
  const { postId, index, total, themeKey, viewport, surface } = args;
  const theme = getSpaceTheme(themeKey);
  const seed = `${theme.key}:${viewport}:${surface}:${postId}:${index}`;

  if (viewport === "DESKTOP" && surface === "MEMORY") {
    const angle = index * 2.399963 + randomRange(`${seed}:angle`, -0.25, 0.25);
    const radiusBase = 120 + (index % 6) * 58 + randomRange(`${seed}:radius`, -24, 46);
    const wave = theme.key === "summer_sea" ? Math.sin(index * 0.7) * 90 : 0;
    const x = Math.round(clampNumber(Math.cos(angle) * radiusBase + randomRange(`${seed}:x`, -80, 80), -520, 520));
    const y = Math.round(clampNumber(Math.sin(angle) * (radiusBase * 0.62) + wave + randomRange(`${seed}:y`, -54, 54), -260, 260));
    const style: DesktopMemoryStyle = {
      x,
      y,
      scale: Number(randomRange(`${seed}:scale`, 0.88, total > 20 ? 1.16 : 1.34).toFixed(2)),
      rotation: Math.round(randomRange(`${seed}:rotation`, -8, 8)),
      color: pick(CARD_COLORS, `${seed}:color`),
      delay: Math.round(index * 55 + randomRange(`${seed}:delay`, 0, 60)),
    };
    return style;
  }

  if (viewport === "DESKTOP" && surface === "ALBUM") {
    const style: DesktopAlbumStyle = {
      rotation: Math.round(randomRange(`${seed}:rotation`, -5, 5)),
      offsetY: Math.round(randomRange(`${seed}:offset`, -10, 22)),
      tapeColor: pick(TAPE_COLORS, `${seed}:tape`),
      featured: index % 7 === 0,
      delay: Math.round(index * 45),
    };
    return style;
  }

  const lanes = [-1, 0, 1] as const;
  const isMemorySurface = surface === "MEMORY";
  const style: MobileCardStyle = {
    lane: pick(lanes, `${seed}:lane`),
    offsetX: Math.round(randomRange(`${seed}:offsetX`, isMemorySurface ? -12 : -6, isMemorySurface ? 12 : 6)),
    offsetY: Math.round(randomRange(`${seed}:offsetY`, isMemorySurface ? -10 : -4, isMemorySurface ? 10 : 12)),
    rotation: Math.round(randomRange(`${seed}:rotation`, -3, 3)),
    scale: Number(randomRange(`${seed}:scale`, 0.96, 1.03).toFixed(2)),
    variant: surface === "ALBUM" ? `${theme.key}_photo` : `${theme.key}_note`,
    delay: Math.round(index * 70),
  };
  return style;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getPostAppearance(post: SpacePostForTheme, viewport: SpaceViewport, surface: SpaceSurface) {
  return post.appearances?.find((appearance) => appearance.viewport === viewport && appearance.surface === surface) ?? null;
}

export function getPostSortOrder(post: SpacePostForTheme, viewport: SpaceViewport, surface: SpaceSurface) {
  return getPostAppearance(post, viewport, surface)?.sortOrder ?? post.id;
}

export function parseDesktopMemoryStyle(value: JsonValue | null | undefined, fallbackIndex = 0): DesktopMemoryStyle {
  if (!isRecord(value)) {
    return {
      x: Math.round(Math.cos(fallbackIndex * 2.399963) * 180),
      y: Math.round(Math.sin(fallbackIndex * 2.399963) * 120),
      scale: 1,
      rotation: 0,
      color: "violet",
      delay: fallbackIndex * 50,
    };
  }

  return {
    x: typeof value.x === "number" ? value.x : 0,
    y: typeof value.y === "number" ? value.y : 0,
    scale: typeof value.scale === "number" ? value.scale : 1,
    rotation: typeof value.rotation === "number" ? value.rotation : 0,
    color: typeof value.color === "string" ? value.color : "violet",
    delay: typeof value.delay === "number" ? value.delay : fallbackIndex * 50,
  };
}

export function parseDesktopAlbumStyle(value: JsonValue | null | undefined, fallbackIndex = 0): DesktopAlbumStyle {
  if (!isRecord(value)) {
    return {
      rotation: (fallbackIndex % 5) - 2,
      offsetY: 0,
      tapeColor: TAPE_COLORS[fallbackIndex % TAPE_COLORS.length] ?? "#fde68a",
      featured: fallbackIndex % 7 === 0,
      delay: fallbackIndex * 45,
    };
  }

  return {
    rotation: typeof value.rotation === "number" ? value.rotation : 0,
    offsetY: typeof value.offsetY === "number" ? value.offsetY : 0,
    tapeColor: typeof value.tapeColor === "string" ? value.tapeColor : "#fde68a",
    featured: value.featured === true,
    delay: typeof value.delay === "number" ? value.delay : fallbackIndex * 45,
  };
}

export function parseMobileCardStyle(value: JsonValue | null | undefined, fallbackIndex = 0): MobileCardStyle {
  if (!isRecord(value)) {
    return {
      lane: ([-1, 0, 1] as const)[fallbackIndex % 3] ?? 0,
      offsetX: 0,
      offsetY: 0,
      rotation: (fallbackIndex % 5) - 2,
      scale: 1,
      variant: "note",
      delay: fallbackIndex * 60,
    };
  }

  const lane = value.lane === -1 || value.lane === 0 || value.lane === 1 ? value.lane : 0;
  return {
    lane,
    offsetX: typeof value.offsetX === "number" ? value.offsetX : 0,
    offsetY: typeof value.offsetY === "number" ? value.offsetY : 0,
    rotation: typeof value.rotation === "number" ? value.rotation : 0,
    scale: typeof value.scale === "number" ? value.scale : 1,
    variant: typeof value.variant === "string" ? value.variant : "note",
    delay: typeof value.delay === "number" ? value.delay : fallbackIndex * 60,
  };
}
