import type { LoaderFunctionArgs } from "react-router";
import { subscribeWord } from "~/lib/word-game-events.server";

// SSE: 단어게임 상태가 바뀌면 즉시 "change" 이벤트 푸시 → 클라이언트 revalidate.
export async function loader({ request }: LoaderFunctionArgs) {
  const encoder = new TextEncoder();
  let unsub = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* 닫힘 */
        }
      };
      send("data: init\n\n");
      unsub = subscribeWord(() => send("data: change\n\n"));
      heartbeat = setInterval(() => send(": ping\n\n"), 25000);
      request.signal.addEventListener("abort", () => {
        if (heartbeat) clearInterval(heartbeat);
        unsub();
        try {
          controller.close();
        } catch {
          /* noop */
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsub();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
