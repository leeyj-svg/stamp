import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { SpaceThemeBackground } from "~/components/space/SpaceExperience";
import { getSession } from "~/lib/auth.server";
import { myPostsCookie } from "~/lib/cookies.server";
import { db } from "~/lib/db.server";
import { getSpaceTheme } from "~/lib/space-theme";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const postId = Number(new URL(request.url).searchParams.get("postId"));
  if (Number.isNaN(postId)) throw new Response("Not Found", { status: 404 });

  const post = await db.memoryPost.findUnique({
    where: { id: postId },
    include: { space: { select: { id: true, title: true, themeKey: true } } },
  });
  if (!post || post.spaceId !== params.spaceId) throw new Response("Not Found", { status: 404 });

  const { user } = await getSession(request);
  const cookieHeader = request.headers.get("Cookie");
  const myPostIds = (await myPostsCookie.parse(cookieHeader)) || [];
  const isMine = (user && user.id === post.writerId) || myPostIds.includes(String(post.id));

  if (!isMine) {
    throw new Response("본인이 작성한 글만 확인할 수 있습니다.", { status: 401 });
  }

  return { post, space: post.space };
}

export default function SuccessPage() {
  const { post, space } = useLoaderData<typeof loader>();
  const theme = getSpaceTheme(space.themeKey);
  const formattedDate = new Date(post.createdAt).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const mineView = post.type === "ALBUM" || post.type === "PHOTO" ? "album" : "memory";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4" style={{ color: theme.textColor }}>
      <SpaceThemeBackground themeKey={space.themeKey} />
      <section className="relative z-10 w-full max-w-md text-center">
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: theme.mutedTextColor }}>
            {space.title}
          </p>
          <h1 className="mt-3 text-2xl font-bold">기록이 안전하게 저장됐어요</h1>
          <p className="mt-2 text-sm" style={{ color: theme.mutedTextColor }}>
            공개일이 지나면 이 공간에서 함께 볼 수 있어요.
          </p>
        </div>

        <div className="mb-8 rounded-lg border border-white/15 p-5 text-left shadow-2xl backdrop-blur-md" style={{ backgroundColor: theme.cardColor, color: theme.inkColor }}>
          {post.type === "ALBUM" ? (
            <div>
              <div className="mb-4 aspect-square overflow-hidden rounded bg-slate-100">
                {post.thumbnailUrl || post.mediaUrl ? <img src={post.thumbnailUrl || post.mediaUrl || ""} alt="작성한 사진" className="h-full w-full object-cover" /> : null}
              </div>
              <p className="whitespace-pre-wrap text-base leading-relaxed">{post.content}</p>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-base leading-relaxed">{post.content}</p>
          )}
          <div className="mt-4 flex items-center justify-between border-t border-black/10 pt-3 text-xs opacity-60">
            <span>{formattedDate}</span>
            <span>{post.nickname}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Link to={`/space/${space.id}/write`} className="w-full rounded-lg py-3 font-bold text-slate-950 shadow-lg transition hover:brightness-105" style={{ backgroundColor: theme.accentColor }}>
            하나 더 남기기
          </Link>
          <Link to={`/space/${space.id}/mine?view=${mineView}`} className="text-sm underline underline-offset-4" style={{ color: theme.mutedTextColor }}>
            내가 쓴 글 보기
          </Link>
        </div>
      </section>
    </main>
  );
}
