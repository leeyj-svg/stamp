// 팀 점수판 공용 상수/타입 (클라이언트 안전)

// teams=팀 개별(사회자 숨김), hostSum=사회자 vs 팀합산, hostEach=사회자 vs 팀개별
export type ScoreboardMode = "teams" | "hostSum" | "hostEach";

export const SCOREBOARD_LIMITS = {
  amount: { min: 1, max: 100000 },
  width: { min: 140, max: 640 },
  height: { min: 120, max: 700 },
} as const;

export const DEFAULT_CARD_WIDTH = 320;
export const DEFAULT_CARD_HEIGHT = 200;

// 팀 카드 색상 (index 기준, 무제한이라 순환)
export const SCORE_COLORS = [
  "bg-red-600",
  "bg-blue-600",
  "bg-green-600",
  "bg-yellow-500",
  "bg-purple-600",
  "bg-orange-500",
  "bg-pink-600",
  "bg-cyan-600",
  "bg-lime-600",
  "bg-rose-600",
  "bg-indigo-600",
  "bg-teal-600",
] as const;

export function colorFor(index: number): string {
  return SCORE_COLORS[index % SCORE_COLORS.length];
}

// 배경 테마 (관리자 선택). 글씨가 흰색이라 어두운 계열.
export const SCOREBOARD_THEMES: { key: string; label: string; bg: string }[] = [
  { key: "slate", label: "기본", bg: "bg-slate-900" },
  { key: "black", label: "검정", bg: "bg-black" },
  { key: "midnight", label: "미드나잇", bg: "bg-gradient-to-b from-slate-900 to-indigo-950" },
  { key: "ocean", label: "오션", bg: "bg-gradient-to-b from-slate-900 to-teal-950" },
  { key: "sunset", label: "석양", bg: "bg-gradient-to-b from-slate-900 to-rose-950" },
  { key: "forest", label: "포레스트", bg: "bg-gradient-to-b from-slate-900 to-emerald-950" },
  { key: "gold", label: "골드", bg: "bg-yellow-800" },
];

export function themeBg(key: string): string {
  return (SCOREBOARD_THEMES.find((t) => t.key === key) ?? SCOREBOARD_THEMES[0]).bg;
}

// 프리셋 키 → 기준 색(hex)
const PRESET_HEX: Record<string, string> = {
  slate: "#0f172a",
  black: "#0a0a0a",
  midnight: "#1e1b4b",
  ocean: "#042f2e",
  sunset: "#4c0519",
  forest: "#052e16",
  gold: "#854d0e",
};

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

// amt>0: 흰색 쪽으로, amt<0: 검정 쪽으로 섞는다
function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const t = amt >= 0 ? 255 : 0;
  const k = Math.abs(amt);
  return `rgb(${clampByte(r + (t - r) * k)}, ${clampByte(g + (t - g) * k)}, ${clampByte(b + (t - b) * k)})`;
}

// 테마(프리셋 키 또는 hex) → 색 팔레트. cardColor(hex)가 있으면 카드색으로 직접 사용,
// 없으면 배경보다 확실히 어둡게 파생(어떤 색이든 구분되게).
export function themePalette(theme: string, cardColor?: string | null): { bg: string; surface: string; header: string; border: string } {
  const base = theme.startsWith("#") ? theme : (PRESET_HEX[theme] ?? PRESET_HEX.slate);
  const customCard = cardColor && /^#[0-9a-fA-F]{6}$/.test(cardColor);
  const surface = customCard ? cardColor : shade(base, -0.38);
  return {
    bg: base,
    surface,
    header: shade(base, -0.22), // 상단 바
    border: shade(base, 0.12), // 테두리: 살짝 밝게
  };
}
