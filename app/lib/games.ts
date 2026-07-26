// 게임 레지스트리
// 새 게임을 추가할 때: 아래 GAMES 배열에 한 항목을 추가하고,
//   app/routes/game/<slug>/ 폴더에 화면을 만든 뒤 app/routes.ts 에 라우트를 등록한다.
// sessionId 는 GameSession 테이블에서 게임별로 고정 사용하는 정수 id 다 (중복 금지).

export type GameEntry = {
  /** URL 및 폴더 이름으로 쓰는 식별자 */
  slug: string;
  /** 허브에 표시할 게임 이름 */
  title: string;
  /** 허브 카드에 표시할 한 줄 설명 */
  description: string;
  /** 진행자(호스트) 화면 경로. 없으면 단일 화면 게임 */
  hostPath?: string;
  /** 참가자/플레이 화면 경로 */
  playPath: string;
  /** GameSession 고정 id (게임별 유일) */
  sessionId: number;
  /** 허브 노출 여부 (준비 중 게임은 false) */
  enabled: boolean;
};

export const GAMES: GameEntry[] = [
  {
    slug: "telepathy",
    title: "텔레파시 팀 배틀",
    description: "팀별로 같은 글자를 떠올려 맞추는 실시간 팀 게임.",
    hostPath: "/game/telepathy/host",
    playPath: "/game/telepathy/play",
    sessionId: 1,
    enabled: true,
  },
  {
    slug: "codename",
    title: "코드네임",
    description: "팀별로 배정된 단어 카드를 먼저 다 찾는 추리 게임. (2~5팀)",
    hostPath: "/game/codename/host",
    playPath: "/game/codename/play",
    sessionId: 2,
    enabled: true,
  },
];

export function getGame(slug: string): GameEntry | undefined {
  return GAMES.find((game) => game.slug === slug);
}

export const enabledGames = () => GAMES.filter((game) => game.enabled);
