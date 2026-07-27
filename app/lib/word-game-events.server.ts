// 단어게임 변경 알림용 인메모리 이벤트 버스 (SSE 푸시). globalThis 보관.

type Listener = () => void;

const g = globalThis as unknown as { __wordGameListeners?: Set<Listener> };
const listeners = g.__wordGameListeners ?? (g.__wordGameListeners = new Set<Listener>());

export function subscribeWord(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function notifyWord(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* noop */
    }
  }
}
