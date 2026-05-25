import { Link, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { SpaceExperience } from "~/components/space/SpaceExperience";
import { getSession } from "~/lib/auth.server";
import { myPostsCookie } from "~/lib/cookies.server";
import { db } from "~/lib/db.server";
import { DEFAULT_SPACE_THEME_KEY, type SpaceAlbumPage, type SpacePostForTheme } from "~/lib/space-theme";

function isAlbumPost(post: SpacePostForTheme) {
  return post.type === "ALBUM" || post.type === "PHOTO";
}

async function getMyPostIds(request: Request) {
  const parsed = (await myPostsCookie.parse(request.headers.get("Cookie"))) || [];
  return Array.isArray(parsed) ? parsed.map((id) => Number(id)).filter((id) => Number.isInteger(id)) : [];
}

function getInitialView(url: URL, posts: SpacePostForTheme[]): "MEMORY" | "ALBUM" {
  const view = url.searchParams.get("view");
  if (view === "album") return "ALBUM";
  if (view === "memory") return "MEMORY";

  const hasMemory = posts.some((post) => !isAlbumPost(post));
  const hasAlbum = posts.some(isAlbumPost);
  return !hasMemory && hasAlbum ? "ALBUM" : "MEMORY";
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (!params.spaceId) throw new Response("Not Found", { status: 404 });

  const { user } = await getSession(request);
  const myPostIds = await getMyPostIds(request);
  const space = await db.memorySpace.findUnique({
    where: { id: params.spaceId },
    select: {
      id: true,
      title: true,
      targetDate: true,
      themeKey: true,
    },
  });
  if (!space) throw new Response("Not Found", { status: 404 });

  const ownershipFilters = [
    ...(user ? [{ writerId: user.id }] : []),
    ...(myPostIds.length > 0 ? [{ id: { in: myPostIds } }] : []),
  ];
  const myPosts: SpacePostForTheme[] =
    ownershipFilters.length > 0
      ? await db.memoryPost.findMany({
          where: {
            spaceId: space.id,
            OR: ownershipFilters,
          },
          include: { appearances: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
  const myAlbumPosts = myPosts.filter(isAlbumPost);
  const initialAlbumPage: SpaceAlbumPage = {
    items: myAlbumPosts,
    nextCursor: null,
    hasMore: false,
  };

  return {
    space: {
      ...space,
      themeKey: space.themeKey || DEFAULT_SPACE_THEME_KEY,
    },
    myPosts,
    initialAlbumPage,
    initialView: getInitialView(new URL(request.url), myPosts),
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const postId = Number(formData.get("postId"));
  if (!Number.isInteger(postId)) return { error: "삭제할 글을 찾을 수 없습니다." };

  const { user } = await getSession(request);
  const myPostIds = await getMyPostIds(request);
  const post = await db.memoryPost.findUnique({
    where: { id: postId },
    select: { id: true, spaceId: true, writerId: true },
  });
  const canDelete = Boolean(post && post.spaceId === params.spaceId && (myPostIds.includes(postId) || (user && post.writerId === user.id)));

  if (!canDelete) {
    return { error: "삭제 권한이 없습니다." };
  }

  await db.memoryPost.delete({ where: { id: postId } });
  return { success: true };
}

export default function MyPostsPage() {
  const { space, myPosts, initialAlbumPage, initialView } = useLoaderData<typeof loader>();

  return (
    <>
      <SpaceExperience
        space={space}
        posts={myPosts}
        initialAlbumPage={initialAlbumPage}
        initialView={initialView}
        canChangeTheme={false}
        showSettingsMenu={false}
        allowPreviewDrag
      />
      <nav className="fixed bottom-4 left-1/2 z-[500] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg border border-white/15 bg-black/35 p-2 text-sm font-bold text-white shadow-2xl backdrop-blur-md md:bottom-6 md:right-6 md:left-auto md:w-80 md:translate-x-0">
        <div className="px-2 pb-2 pt-1 text-center">
          <p className="text-sm font-bold">내가 쓴 글만 보이는 중</p>
          <p className="mt-1 text-xs font-medium text-white/65">- 실제 공개 화면에서는 이렇게 다른 사람들 글과 함께 보여요</p>
        </div>
        <Link to={`/space/${space.id}/write`} className="block w-full rounded-md bg-white px-4 py-2 text-center text-slate-950 transition hover:bg-white/90">
          다시 쓰기
        </Link>
      </nav>
    </>
  );
}
