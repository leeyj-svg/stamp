import type { CardColor, TeamColor } from "./codename-session";

// Tailwind 클래스는 반드시 완전한 문자열 리터럴로 둔다(purge 대상 인식용).

export const COLOR_LABEL: Record<CardColor, string> = {
  red: "빨강",
  blue: "파랑",
  green: "초록",
  yellow: "노랑",
  purple: "보라",
  gray: "중립",
  black: "블랙요원",
};

// 게임판: 공개된 카드 배경
export const CARD_REVEALED_CLASS: Record<CardColor, string> = {
  red: "bg-red-600 border-red-800 text-white",
  blue: "bg-blue-600 border-blue-800 text-white",
  green: "bg-green-600 border-green-800 text-white",
  yellow: "bg-yellow-400 border-yellow-600 text-black",
  purple: "bg-purple-600 border-purple-800 text-white",
  gray: "bg-slate-400 border-slate-500 text-black",
  black: "bg-black border-slate-600 text-white",
};

// 정답판: 불투명 단색 배경
export const KEY_COLOR_CLASS: Record<CardColor, string> = {
  red: "bg-red-600 border-red-800 text-white",
  blue: "bg-blue-600 border-blue-800 text-white",
  green: "bg-green-600 border-green-800 text-white",
  yellow: "bg-yellow-400 border-yellow-600 text-black",
  purple: "bg-purple-600 border-purple-800 text-white",
  gray: "bg-slate-400 border-slate-500 text-black",
  black: "bg-black border-slate-600 text-white",
};

// 팀 색 텍스트/배경 (점수판·현재 턴)
export const TEAM_TEXT_CLASS: Record<TeamColor, string> = {
  red: "text-red-500",
  blue: "text-blue-500",
  green: "text-green-500",
  yellow: "text-yellow-500",
  purple: "text-purple-400",
};

export const TEAM_DOT_CLASS: Record<TeamColor, string> = {
  red: "bg-red-500",
  blue: "bg-blue-500",
  green: "bg-green-500",
  yellow: "bg-yellow-400",
  purple: "bg-purple-500",
};

export const TEAM_RING_CLASS: Record<TeamColor, string> = {
  red: "ring-red-500 bg-red-500/10",
  blue: "ring-blue-500 bg-blue-500/10",
  green: "ring-green-500 bg-green-500/10",
  yellow: "ring-yellow-400 bg-yellow-400/10",
  purple: "ring-purple-500 bg-purple-500/10",
};
