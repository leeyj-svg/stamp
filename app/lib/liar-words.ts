import type { Difficulty, DifficultyFilter } from "./game-difficulty";

// 라이어 게임 단어 풀 (카테고리 × 난이도)
// 새 라운드 시작 시 카테고리+난이도에서 제시어를 뽑고, 가짜 단어 모드면 같은 조건의 다른 단어를 뽑는다.

export const CATEGORIES: Record<string, Record<Difficulty, string[]>> = {
  음식: {
    easy: ["사과", "바나나", "김치", "라면", "피자", "치킨", "밥", "빵", "우유", "계란", "사탕", "아이스크림"],
    normal: ["초밥", "파스타", "떡볶이", "김밥", "만두", "삼겹살", "짜장면", "돈까스", "볶음밥", "순대", "김치찌개", "부침개"],
    hard: ["마카롱", "리조또", "뇨끼", "라따뚜이", "타르트", "무스", "카나페", "샤브샤브", "감바스", "크루아상", "파에야", "티라미수"],
  },
  동물: {
    easy: ["개", "고양이", "토끼", "사자", "호랑이", "코끼리", "곰", "원숭이", "기린", "돼지", "소", "닭"],
    normal: ["여우", "늑대", "낙타", "하마", "표범", "코뿔소", "캥거루", "펭귄", "돌고래", "부엉이", "다람쥐", "두더지"],
    hard: ["오소리", "스라소니", "카피바라", "아르마딜로", "미어캣", "왈라비", "카멜레온", "이구아나", "나무늘보", "오카피", "맥", "천산갑"],
  },
  장소: {
    easy: ["학교", "집", "병원", "공원", "시장", "도서관", "카페", "영화관", "놀이공원", "바다", "산", "수영장"],
    normal: ["박물관", "미술관", "공항", "항구", "온천", "찜질방", "경기장", "동물원", "식물원", "전망대", "캠핑장", "수족관"],
    hard: ["천문대", "등대", "성당", "사원", "요새", "유적지", "실험실", "발전소", "조선소", "채석장", "광산", "부두"],
  },
  직업: {
    easy: ["의사", "선생님", "경찰", "소방관", "요리사", "가수", "배우", "농부", "화가", "간호사", "운동선수", "군인"],
    normal: ["변호사", "건축가", "프로그래머", "디자이너", "파일럿", "승무원", "수의사", "약사", "기자", "검사", "통역사", "회계사"],
    hard: ["심리학자", "고고학자", "큐레이터", "조향사", "성우", "지질학자", "항해사", "재단사", "조련사", "감정사", "속기사", "도예가"],
  },
  사물: {
    easy: ["우산", "시계", "안경", "가방", "지갑", "핸드폰", "노트북", "칫솔", "베개", "거울", "신발", "모자"],
    normal: ["선풍기", "냉장고", "청소기", "다리미", "드라이기", "전자레인지", "헤드폰", "삼각대", "손전등", "계산기", "앨범", "지구본"],
    hard: ["나침반", "망원경", "현미경", "청진기", "재봉틀", "만년필", "자물쇠", "확성기", "온도계", "저울", "부채", "오르골"],
  },
  스포츠: {
    easy: ["축구", "농구", "야구", "배구", "탁구", "수영", "태권도", "달리기", "줄넘기", "스키", "배드민턴", "자전거"],
    normal: ["테니스", "골프", "볼링", "양궁", "복싱", "펜싱", "스케이트", "유도", "씨름", "승마", "조정", "카누"],
    hard: ["컬링", "럭비", "하키", "세팍타크로", "바이애슬론", "봅슬레이", "근대5종", "트라이애슬론", "핸드볼", "수구", "역도", "조정"],
  },
};

export const CATEGORY_NAMES = Object.keys(CATEGORIES);

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function randomCategory(): string {
  return randomItem(CATEGORY_NAMES);
}

function wordsFor(category: string, difficulty: DifficultyFilter): string[] {
  const byDiff = CATEGORIES[category] ?? CATEGORIES[randomCategory()];
  if (difficulty === "all") {
    return [...byDiff.easy, ...byDiff.normal, ...byDiff.hard];
  }
  return byDiff[difficulty];
}

export function pickWord(category: string, difficulty: DifficultyFilter = "all"): string {
  const pool = wordsFor(category || randomCategory(), difficulty);
  return randomItem(pool);
}

/** 같은 카테고리·난이도에서 word 와 다른 단어 하나 */
export function pickFakeWord(category: string, difficulty: DifficultyFilter, word: string): string {
  const pool = wordsFor(category || randomCategory(), difficulty).filter((item) => item !== word);
  if (pool.length === 0) return word;
  return randomItem(pool);
}
