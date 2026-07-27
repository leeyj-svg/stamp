// 게임 공용 난이도 정의 (코드네임·라이어 등에서 사용)

export type Difficulty = "easy" | "normal" | "hard";
export type DifficultyFilter = Difficulty | "all";

export const DIFFICULTY_LABEL: Record<DifficultyFilter, string> = {
  all: "전체",
  easy: "쉬움",
  normal: "보통",
  hard: "어려움",
};

export const DIFFICULTY_OPTIONS: DifficultyFilter[] = ["all", "easy", "normal", "hard"];
