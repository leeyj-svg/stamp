import { useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { json } from "@remix-run/node";

import { LockedSpaceScreen, SpaceExperience } from "~/components/space/SpaceExperience";
import { getSession } from "~/lib/auth.server";
import { spaceUnlockCookie } from "~/lib/cookies.server";
import { db } from "~/lib/db.server";
import { hasSpacePublicDatePassed } from "~/lib/space-date";
import { getPublicOrigin, getSpaceShareMeta } from "~/lib/space-meta";
import { DEFAULT_SPACE_THEME_KEY, isSpaceThemeKey, type SpaceAlbumPage, type SpacePostForTheme } from "~/lib/space-theme";
import { applySpaceTheme, canChangeSpaceTheme } from "~/lib/space-theme.server";

const ALBUM_PAGE_SIZE = 24;
const POSITION_BOUNDS = {
  DESKTOP: { minX: -560, maxX: 560, minY: -300, maxY: 300 },
  MOBILE: { minX: -330, maxX: 330, minY: -190, maxY: 170 },
} as const;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isPositionViewport(value: FormDataEntryValue | null): value is keyof typeof POSITION_BOUNDS {
  return value === "DESKTOP" || value === "MOBILE";
}

function asStyleRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseAlbumCursor(value: string | null) {
  if (!value) return null;
  const [sortOrderValue, postIdValue] = value.split(":");
  const sortOrder = Number(sortOrderValue);
  const postId = Number(postIdValue);
  if (!Number.isInteger(sortOrder) || !Number.isInteger(postId)) return null;
  return { sortOrder, postId };
}

function encodeAlbumCursor(value: { sortOrder: number; postId: number }) {
  return `${value.sortOrder}:${value.postId}`;
}

function isAlbumPageData(value: unknown): value is SpaceAlbumPage {
  return typeof value === "object" && value !== null && Array.isArray((value as SpaceAlbumPage).items);
}

async function getUnlockedSpaceIds(request: Request) {
  const parsed = await spaceUnlockCookie.parse(request.headers.get("Cookie"));
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
}

async function hasSpaceUnlock(request: Request, spaceId: string) {
  return (await getUnlockedSpaceIds(request)).includes(spaceId);
}

async function serializeSpaceUnlock(request: Request, spaceId: string) {
  const currentIds = await getUnlockedSpaceIds(request);
  const nextIds = [spaceId, ...currentIds.filter((id) => id !== spaceId)].slice(0, 30);
  return spaceUnlockCookie.serialize(nextIds);
}

function getMemoryPosts(spaceId: string) {
  return db.memoryPost.findMany({
    where: { spaceId, type: "MESSAGE" },
    include: { appearances: true },
    orderBy: { createdAt: "desc" },
  });
}

async function getAlbumPage(spaceId: string, cursorValue: string | null): Promise<SpaceAlbumPage> {
  const cursor = parseAlbumCursor(cursorValue);
  const rows = await db.memoryPostAppearance.findMany({
    where: {
      viewport: "DESKTOP",
      surface: "ALBUM",
      post: {
        spaceId,
        OR: [{ type: "ALBUM" }, { type: "PHOTO" }],
      },
      ...(cursor
        ? {
            OR: [
              { sortOrder: { gt: cursor.sortOrder } },
              { sortOrder: cursor.sortOrder, postId: { gt: cursor.postId } },
            ],
          }
        : {}),
    },
    include: { post: { include: { appearances: true } } },
    orderBy: [{ sortOrder: "asc" }, { postId: "asc" }],
    take: ALBUM_PAGE_SIZE + 1,
  });
  const pageRows = rows.slice(0, ALBUM_PAGE_SIZE);
  const lastRow = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map((row) => row.post),
    nextCursor: rows.length > ALBUM_PAGE_SIZE && lastRow ? encodeAlbumCursor(lastRow) : null,
    hasMore: rows.length > ALBUM_PAGE_SIZE,
  };
}

async function getInitialUnlockedPosts(spaceId: string) {
  const [messages, albumPage] = await Promise.all([getMemoryPosts(spaceId), getAlbumPage(spaceId, null)]);
  return {
    posts: [...messages, ...albumPage.items],
    albumPage,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (!params.spaceId) {
    throw new Response("Not Found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "change_theme") {
    const { user } = await getSession(request);
    const space = await db.memorySpace.findUnique({
      where: { id: params.spaceId },
      select: { id: true, userId: true },
    });
    if (!space) throw new Response("Not Found", { status: 404 });
    if (!canChangeSpaceTheme(user, space)) {
      throw new Response("Forbidden", { status: 403 });
    }

    const themeValue = formData.get("themeKey");
    if (!isSpaceThemeKey(themeValue)) {
      return { error: "선택할 수 없는 테마입니다.", posts: null };
    }

    await applySpaceTheme(space.id, themeValue);
    return { success: true, mode: "THEME" };
  }

  if (intent === "update_post_position") {
    const { user } = await getSession(request);
    const space = await db.memorySpace.findUnique({
      where: { id: params.spaceId },
      select: { id: true, userId: true },
    });
    if (!space) throw new Response("Not Found", { status: 404 });
    if (!canChangeSpaceTheme(user, space)) {
      throw new Response("Forbidden", { status: 403 });
    }

    const postId = Number(formData.get("postId"));
    const viewport = formData.get("viewport");
    const rawX = Number(formData.get("x"));
    const rawY = Number(formData.get("y"));

    if (!Number.isFinite(postId) || !isPositionViewport(viewport) || !Number.isFinite(rawX) || !Number.isFinite(rawY)) {
      return { error: "유효하지 않은 위치입니다." };
    }

    const post = await db.memoryPost.findFirst({
      where: {
        id: postId,
        spaceId: params.spaceId,
        NOT: [{ type: "ALBUM" }, { type: "PHOTO" }],
      },
      select: { id: true },
    });
    if (!post) throw new Response("Not Found", { status: 404 });

    const bounds = POSITION_BOUNDS[viewport];
    const x = Math.round(clampNumber(rawX, bounds.minX, bounds.maxX));
    const y = Math.round(clampNumber(rawY, bounds.minY, bounds.maxY));
    const uniqueKey = { postId, viewport, surface: "MEMORY" as const };
    const existingAppearance = await db.memoryPostAppearance.findUnique({
      where: { postId_viewport_surface: uniqueKey },
      select: { style: true, sortOrder: true },
    });
    const style = { ...asStyleRecord(existingAppearance?.style), x, y };

    await db.memoryPostAppearance.upsert({
      where: { postId_viewport_surface: uniqueKey },
      update: { style },
      create: {
        ...uniqueKey,
        style,
        sortOrder: existingAppearance?.sortOrder ?? postId,
      },
    });

    return { success: true, mode: "POSITION" };
  }

  const inputPassword = String(formData.get("password") || "");
  const space = await db.memorySpace.findUnique({ where: { id: params.spaceId } });

  if (!space) return { error: "공간이 존재하지 않습니다.", posts: null };

  if (!hasSpacePublicDatePassed(space.targetDate)) {
    return { error: "아직 공개 날짜가 지나지 않았습니다.", posts: null };
  }

  if (space.password === inputPassword) {
    const { posts, albumPage } = await getInitialUnlockedPosts(space.id);
    return json(
      { success: true, posts, albumPage },
      {
        headers: {
          "Set-Cookie": await serializeSpaceUnlock(request, space.id),
        },
      }
    );
  }

  return { error: "비밀번호가 맞지 않습니다.", posts: null };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user } = await getSession(request);
  if (!params.spaceId) throw new Response("Not Found", { status: 404 });
  const url = new URL(request.url);
  const isAlbumPageRequest = url.searchParams.get("intent") === "album_page";

  const space = await db.memorySpace.findUnique({
    where: { id: params.spaceId },
    include: { appearances: true },
  });
  if (!space) throw new Response("Not Found", { status: 404 });

  const isDatePassed = hasSpacePublicDatePassed(space.targetDate);
  const isAdmin = user?.role === "ADMIN";
  const isOwner = Boolean(user && user.id === space.userId);
  const canChangeTheme = canChangeSpaceTheme(user, space);
  const isCookieUnlocked = isDatePassed && (await hasSpaceUnlock(request, space.id));
  const canReadUnlockedContent = isAdmin || (isDatePassed && (isOwner || isCookieUnlocked));

  if (isAlbumPageRequest) {
    if (!canReadUnlockedContent) {
      return json({ error: "Forbidden" }, { status: 403 });
    }
    return json({ albumPage: await getAlbumPage(space.id, url.searchParams.get("cursor")) });
  }

  let initialPosts: SpacePostForTheme[] = [];
  let initialAlbumPage: SpaceAlbumPage | null = null;
  if (canReadUnlockedContent) {
    const result = await getInitialUnlockedPosts(space.id);
    initialPosts = result.posts;
    initialAlbumPage = result.albumPage;
  }

  return {
    origin: getPublicOrigin(request),
    isAdmin,
    isOwner,
    isDatePassed,
    canChangeTheme,
    targetDate: space.targetDate,
    space: {
      ...space,
      themeKey: space.themeKey || DEFAULT_SPACE_THEME_KEY,
    },
    initialPosts,
    initialAlbumPage,
  };
}

export function meta({ data }: { data?: Awaited<ReturnType<typeof loader>> }) {
  const space = data && "space" in data ? data.space : null;
  const title = "소중한 마음들이 도착했어요";
  const description = "친구들이 남긴 쪽지와 사진을 테마 공간에서 천천히 확인해보세요.";

  return getSpaceShareMeta({
    origin: data && "origin" in data ? data.origin : "https://www.tcroom.kr",
    path: `/space/${space?.id || ""}`,
    title,
    description,
  });
}

export default function SpaceMain() {
  const loaderData = useLoaderData<typeof loader>();
  if ("albumPage" in loaderData && !("space" in loaderData)) {
    return null;
  }
  const { isAdmin, isOwner, isDatePassed, targetDate, space, initialPosts, initialAlbumPage, canChangeTheme } = loaderData;
  const actionData = useActionData<typeof action>();
  const loaderAlbumPage = isAlbumPageData(initialAlbumPage) ? initialAlbumPage : null;

  const unlockedPosts: SpacePostForTheme[] | null =
    isAdmin || (isDatePassed && isOwner)
      ? initialPosts
      : actionData && "posts" in actionData && Array.isArray(actionData.posts)
        ? actionData.posts
        : null;
  const unlockedAlbumPage: SpaceAlbumPage | null =
    isAdmin || (isDatePassed && isOwner)
      ? loaderAlbumPage
      : actionData && "albumPage" in actionData && isAlbumPageData(actionData.albumPage)
        ? actionData.albumPage
        : null;

  if (!unlockedPosts) {
    const error = actionData && "error" in actionData ? actionData.error : null;
    return <LockedSpaceScreen space={space} isDatePassed={isDatePassed} targetDate={targetDate} error={error} />;
  }

  return <SpaceExperience space={space} posts={unlockedPosts} initialAlbumPage={unlockedAlbumPage} canChangeTheme={canChangeTheme} showEntranceEffect />;
}
