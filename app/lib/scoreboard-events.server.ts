// 점수판 변경 알림용 인메모리 이벤트 버스 (SSE 푸시용).
// pm2 fork(단일 인스턴스) 기준. HMR/멀티요청에도 유지되도록 globalThis에 보관한다.

type Listener = () => void;

const g = globalThis as unknown as { __scoreboardListeners?: Set<Listener> };
const listeners = g.__scoreboardListeners ?? (g.__scoreboardListeners = new Set<Listener>());

export function subscribeScoreboard(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function notifyScoreboard(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* 개별 리스너 오류 무시 */
    }
  }
}
