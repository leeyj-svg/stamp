import { useEffect, useState, type ReactNode } from "react";
import { Form, redirect, useActionData, useFetcher, useLoaderData, useLocation, useNavigation, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";
import { Link as LinkIcon, RefreshCw, Search, Trash2, Wand2 } from "lucide-react";

import { SpaceThemePicker } from "~/components/space/SpaceExperience";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { generateAiMessages, parseGeminiModelQuality } from "~/lib/gemini.server";
import { parseKoreanDateInput } from "~/lib/space-date";
import { isSpaceThemeKey } from "~/lib/space-theme";
import { applySpaceTheme, regeneratePostAppearances, upsertPostAppearancesForPost } from "~/lib/space-theme.server";

type SearchUser = {
  id: string;
  name: string;
  phoneNumber: string;
};

type GeneratedMessage = Awaited<ReturnType<typeof generateAiMessages>>[number];

const ADMIN_POSTS_PER_PAGE = 10;

function parsePositivePage(value: string | null) {
  const page = Number.parseInt(value || "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function parseDateInput(value: string | null) {
  return parseKoreanDateInput(value);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user } = await getSessionWithPermission(request, "ADMIN");
  if (!user) throw new Response("Unauthorized", { status: 401 });
  if (!params.spaceId) throw new Response("Not Found", { status: 404 });
  const url = new URL(request.url);
  const requestedPostPage = parsePositivePage(url.searchParams.get("postPage"));
  const postAuthor = (url.searchParams.get("postAuthor") || "").trim();
  const postDateFrom = url.searchParams.get("postDateFrom") || "";
  const postDateTo = url.searchParams.get("postDateTo") || "";
  const fromDate = parseDateInput(postDateFrom);
  const toDate = parseDateInput(postDateTo);

  const space = await db.memorySpace.findUnique({
    where: { id: params.spaceId },
    include: {
      user: { select: { id: true, name: true, phoneNumber: true } },
      appearances: true,
    },
  });

  if (!space) throw new Response("Not Found", { status: 404 });

  const postWhere: Prisma.MemoryPostWhereInput = {
    spaceId: params.spaceId,
    ...(postAuthor
      ? {
          OR: [
            { nickname: { contains: postAuthor } },
            { writer: { is: { name: { contains: postAuthor } } } },
            { writer: { is: { phoneNumber: { contains: postAuthor } } } },
          ],
        }
      : {}),
    ...(fromDate || toDate
      ? {
          createdAt: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lt: addDays(toDate, 1) } : {}),
          },
        }
      : {}),
  };

  const totalPosts = await db.memoryPost.count({ where: postWhere });
  const totalPostPages = Math.max(1, Math.ceil(totalPosts / ADMIN_POSTS_PER_PAGE));
  const postPage = Math.min(requestedPostPage, totalPostPages);

  const posts = await db.memoryPost.findMany({
    where: postWhere,
    include: {
      appearances: true,
      writer: { select: { id: true, name: true, phoneNumber: true } },
    },
    orderBy: { createdAt: "desc" },
    skip: (postPage - 1) * ADMIN_POSTS_PER_PAGE,
    take: ADMIN_POSTS_PER_PAGE,
  });

  return {
    space,
    posts,
    postPagination: {
      page: postPage,
      totalPages: totalPostPages,
      totalPosts,
      pageSize: ADMIN_POSTS_PER_PAGE,
      filters: {
        author: postAuthor,
        dateFrom: fromDate ? postDateFrom : "",
        dateTo: toDate ? postDateTo : "",
      },
    },
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { user } = await getSessionWithPermission(request, "ADMIN");
  if (!user) throw new Response("Unauthorized", { status: 401 });
  if (!params.spaceId) throw new Response("Not Found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "search_user") {
    const keyword = String(formData.get("keyword") || "").trim();
    if (!keyword) return { error: "검색어를 입력해 주세요." };

    const users = await db.user.findMany({
      where: {
        OR: [{ name: { contains: keyword } }, { phoneNumber: { contains: keyword } }],
      },
      take: 5,
      select: { id: true, name: true, phoneNumber: true },
    });
    return { foundUsers: users };
  }

  if (intent === "link_user") {
    const userId = String(formData.get("userId") || "");
    if (!userId) return { error: "연결할 사용자를 선택해 주세요." };

    const linkedUser = await db.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!linkedUser) return { error: "사용자를 찾을 수 없습니다." };

    await db.memorySpace.update({
      where: { id: params.spaceId },
      data: { userId },
    });
    return { success: true, mode: "LINK" };
  }

  if (intent === "unlink_user") {
    await db.memorySpace.update({
      where: { id: params.spaceId },
      data: { userId: null },
    });
    return { success: true, mode: "UNLINK" };
  }

  if (intent === "delete_space") {
    await db.$transaction([
      db.memoryPost.deleteMany({ where: { spaceId: params.spaceId } }),
      db.memorySpace.delete({ where: { id: params.spaceId } }),
    ]);

    return redirect("/admin/spaces");
  }

  if (intent === "delete_post") {
    const postId = Number(formData.get("postId"));
    if (Number.isNaN(postId)) return { error: "유효하지 않은 글 ID입니다." };

    const post = await db.memoryPost.findUnique({
      where: { id: postId },
      select: { id: true, spaceId: true },
    });
    if (!post || post.spaceId !== params.spaceId) {
      return { error: "이 공간의 글이 아닙니다." };
    }

    await db.memoryPost.delete({ where: { id: postId } });
    return { success: true, mode: "DELETE_POST" };
  }

  if (intent === "update_space") {
    const title = String(formData.get("title") || "").trim();
    const password = String(formData.get("password") || "").trim();
    if (!title) return { error: "제목을 입력해 주세요." };

    await db.memorySpace.update({
      where: { id: params.spaceId },
      data: {
        title,
        password: password || undefined,
      },
    });
    return { success: true, mode: "UPDATE" };
  }

  if (intent === "change_theme") {
    const themeValue = formData.get("themeKey");
    if (!isSpaceThemeKey(themeValue)) return { error: "선택할 수 없는 테마입니다." };
    await applySpaceTheme(params.spaceId, themeValue);
    return { success: true, mode: "THEME" };
  }

  if (intent === "GENERATE") {
    const topic = String(formData.get("topic") || "").trim();
    const count = Number(formData.get("count"));
    const name = String(formData.get("name") || "").trim();
    const age = String(formData.get("age") || "").trim();
    const gender = formData.get("gender") === "male" ? "male" : "female";
    const modelQuality = parseGeminiModelQuality(formData.get("modelQuality"));
    if (!topic || !name || !age || Number.isNaN(count)) return { error: "AI 메시지 생성 정보를 입력해 주세요." };

    const space = await db.memorySpace.findUnique({
      where: { id: params.spaceId },
      select: { themeKey: true },
    });
    if (!space) throw new Response("Not Found", { status: 404 });

    const messages = await generateAiMessages(topic, count, { name, age, gender }, modelQuality);

    await db.$transaction(async (tx) => {
      for (const msg of messages as GeneratedMessage[]) {
        const createdPost = await tx.memoryPost.create({
          data: {
            spaceId: params.spaceId!,
            type: "MESSAGE",
            content: msg.content,
            nickname: msg.nickname,
            aiStyle: msg.aiStyle,
            writerId: user.id,
          },
        });
        await upsertPostAppearancesForPost(tx, createdPost, space.themeKey);
      }
    });
    return { success: true, mode: "GENERATE" };
  }

  if (intent === "LAYOUT") {
    const space = await db.memorySpace.findUnique({
      where: { id: params.spaceId },
      select: { themeKey: true },
    });
    if (!space) throw new Response("Not Found", { status: 404 });

    await db.$transaction(async (tx) => {
      await regeneratePostAppearances(tx, params.spaceId!, space.themeKey);
    });
    return { success: true, mode: "LAYOUT" };
  }

  return null;
}

export default function SpaceAdminPage() {
  const { space, posts, postPagination } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const userFetcher = useFetcher<typeof action>();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [copiedLinkType, setCopiedLinkType] = useState<"write" | "viewer" | null>(null);
  const [origin, setOrigin] = useState("");
  const isAdminMobileView = location.pathname.startsWith("/admin/spaces") && searchParams.get("view") !== "pc";

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const foundUsers: SearchUser[] =
    userFetcher.data && "foundUsers" in userFetcher.data && Array.isArray(userFetcher.data.foundUsers) ? userFetcher.data.foundUsers : [];
  const adminListHref = searchParams.get("view") === "pc" ? "/admin/spaces?view=pc" : "/admin/spaces";
  const postResultStart = postPagination.totalPosts === 0 ? 0 : (postPagination.page - 1) * postPagination.pageSize + 1;
  const postResultEnd = Math.min(postPagination.totalPosts, postPagination.page * postPagination.pageSize);
  const buildPostPageHref = (page: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("postPage", String(page));
    const query = params.toString();
    return query ? `${location.pathname}?${query}` : location.pathname;
  };
  const resetPostFilterHref = (() => {
    const params = new URLSearchParams();
    if (searchParams.get("view") === "pc") params.set("view", "pc");
    const query = params.toString();
    return query ? `${location.pathname}?${query}` : location.pathname;
  })();

  const handleCopyLink = (type: "write" | "viewer") => {
    const baseOrigin = origin || window.location.origin;
    const link = type === "write" ? `${baseOrigin}/space/${space.id}/write` : `${baseOrigin}/space/${space.id}`;
    navigator.clipboard.writeText(link);
    setCopiedLinkType(type);
    setTimeout(() => setCopiedLinkType(null), 2000);
  };

  return (
    <div className={isAdminMobileView ? "min-h-screen bg-transparent pb-20" : "min-h-screen bg-slate-50 p-6 pb-32"}>
      <div className={isAdminMobileView ? "w-full space-y-4" : "mx-auto max-w-6xl space-y-8"}>
        <div className={isAdminMobileView ? "space-y-3" : "flex flex-col items-start justify-between gap-4 md:flex-row md:items-center"}>
          <div className="min-w-0">
            <h1 className={isAdminMobileView ? "space-y-1 text-xl font-bold leading-tight text-slate-800" : "space-y-1 text-2xl font-bold leading-tight text-slate-800"}>
              <span className="block break-words [overflow-wrap:anywhere]">{space.title}</span>
              <span className="block text-sm font-normal text-slate-400">관리자 화면</span>
            </h1>
            <p className="mt-2 break-all text-xs leading-relaxed text-slate-500">ID: {space.id}</p>
          </div>
          <div className={isAdminMobileView ? "grid grid-cols-2 gap-2" : "flex flex-wrap gap-2"}>
            <a href={`/space/${space.id}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              공간 보기
            </a>
            <a href={adminListHref} className="rounded-lg bg-slate-800 px-4 py-2 text-center text-sm font-bold text-white hover:bg-slate-700">
              목록으로
            </a>
          </div>
        </div>

        {actionData && "error" in actionData && actionData.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{actionData.error}</div>
        )}

        <div className={isAdminMobileView ? "space-y-4" : "grid grid-cols-1 gap-8 lg:grid-cols-3"}>
          <div className={isAdminMobileView ? "space-y-4" : "space-y-6 lg:col-span-1"}>
            <Panel title="연결 사용자">
              {space.user ? (
                <div className="flex flex-col gap-3 rounded-lg border border-indigo-100 bg-indigo-50 p-4">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-bold text-indigo-700">{space.user.name}</p>
                    <p className="break-all text-xs leading-relaxed text-indigo-500">{space.user.phoneNumber}</p>
                  </div>
                  <Form method="post">
                    <input type="hidden" name="intent" value="unlink_user" />
                    <button className="text-xs text-slate-500 underline hover:text-red-500" onClick={(event) => !confirm("사용자 연결을 해제할까요?") && event.preventDefault()}>
                      연결 해제
                    </button>
                  </Form>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="rounded bg-slate-50 p-2 text-xs text-slate-500">이름이나 전화번호로 검색해 주인공을 연결하세요.</p>
                  <userFetcher.Form method="post" className="flex gap-2">
                    <input type="hidden" name="intent" value="search_user" />
                    <input name="keyword" placeholder="이름 또는 전화번호" className="min-w-0 flex-1 rounded border p-2 text-xs" required />
                    <button className="shrink-0 rounded bg-slate-800 p-2 text-white hover:bg-slate-700" aria-label="검색">
                      <Search size={14} />
                    </button>
                  </userFetcher.Form>

                  {userFetcher.data && "foundUsers" in userFetcher.data && (
                    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                      {foundUsers.map((foundUser) => (
                        <div key={foundUser.id} className="flex items-center justify-between gap-3 rounded border border-transparent p-2 hover:border-slate-200 hover:bg-slate-50">
                          <div className="min-w-0">
                            <p className="text-xs font-bold">{foundUser.name}</p>
                            <p className="break-all text-[10px] text-slate-400">{foundUser.phoneNumber}</p>
                          </div>
                          <Form method="post">
                            <input type="hidden" name="intent" value="link_user" />
                            <input type="hidden" name="userId" value={foundUser.id} />
                            <button className="rounded bg-indigo-500 px-2 py-1 text-[10px] text-white hover:bg-indigo-600">연결</button>
                          </Form>
                        </div>
                      ))}
                      {foundUsers.length === 0 && <p className="text-center text-xs text-slate-400">검색 결과 없음</p>}
                    </div>
                  )}
                </div>
              )}
            </Panel>

            <Panel title="공유 링크">
              <div className="space-y-3">
                <button type="button" onClick={() => handleCopyLink("write")} className="w-full rounded-lg bg-slate-900 p-3 text-left text-xs text-white transition hover:bg-slate-800">
                  <span className="mb-1 flex items-center gap-2 font-bold">
                    <LinkIcon size={16} />
                    친구 작성 링크
                  </span>
                  <span className="block break-all leading-relaxed text-white/75">
                    {copiedLinkType === "write" ? "복사했어요!" : origin ? `${origin}/space/${space.id}/write` : "링크 준비 중..."}
                  </span>
                </button>
                <button type="button" onClick={() => handleCopyLink("viewer")} className="w-full rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-left text-xs text-indigo-700 transition hover:bg-indigo-100">
                  <span className="mb-1 flex items-center gap-2 font-bold">
                    <LinkIcon size={16} />
                    주인공 보기 링크
                  </span>
                  <span className="block break-all leading-relaxed text-indigo-500">
                    {copiedLinkType === "viewer" ? "복사했어요!" : origin ? `${origin}/space/${space.id}` : "링크 준비 중..."}
                  </span>
                </button>
                <p className="text-[11px] leading-relaxed text-slate-500">주인공에게는 보기 링크를 보내고, 필요한 경우 입장 비밀번호도 함께 알려주세요.</p>
              </div>
            </Panel>

            <Panel title="테마 설정">
              <SpaceThemePicker currentThemeKey={space.themeKey} compact />
            </Panel>

            <Panel title="공간 정보 수정">
              <Form method="post" className="space-y-4">
                <input type="hidden" name="intent" value="update_space" />
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-500">공간 제목</label>
                  <input name="title" defaultValue={space.title} className="w-full rounded border p-2 text-sm" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-500">입장 비밀번호</label>
                  <input name="password" defaultValue={space.password || ""} placeholder="미설정" className="w-full rounded border p-2 text-sm" />
                </div>
                <button className="w-full rounded-lg bg-slate-800 py-2 text-xs font-bold text-white hover:bg-slate-700">저장</button>
              </Form>
            </Panel>

            <div className="rounded-lg border border-red-100 bg-red-50 p-5">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-red-700">
                <Trash2 size={16} /> 공간 삭제
              </h3>
              <p className="mb-3 text-xs text-red-500">공간과 모든 글을 삭제합니다. 복구할 수 없습니다.</p>
              <Form method="post" onSubmit={(event) => !confirm("정말 이 공간을 삭제할까요? 복구할 수 없습니다.") && event.preventDefault()}>
                <input type="hidden" name="intent" value="delete_space" />
                <button className="w-full rounded-lg border border-red-200 bg-white py-2 text-xs font-bold text-red-600 transition hover:bg-red-600 hover:text-white">
                  이 공간 삭제
                </button>
              </Form>
            </div>
          </div>

          <div className={isAdminMobileView ? "space-y-4" : "space-y-6 lg:col-span-2"}>
            <div className={isAdminMobileView ? "space-y-4" : "grid grid-cols-1 gap-4 md:grid-cols-2"}>
              <Panel title="AI 메시지 생성" icon={<Wand2 size={16} className="text-purple-600" />}>
                <Form method="post" className="space-y-2">
                  <input type="hidden" name="intent" value="GENERATE" />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input name="name" placeholder="이름" className="min-w-0 rounded border p-2 text-xs" required />
                    <input name="age" placeholder="나이 (예: 25)" className="min-w-0 rounded border p-2 text-xs" required />
                  </div>
                  <select name="gender" className="w-full rounded border p-2 text-xs">
                    <option value="male">남성</option>
                    <option value="female">여성</option>
                  </select>
                  <select name="modelQuality" className="w-full rounded border p-2 text-xs" defaultValue="standard">
                    <option value="standard">기본</option>
                    <option value="quality">고품질</option>
                  </select>
                  <input name="topic" placeholder="주제 (예: 생일, 응원)" className="w-full min-w-0 rounded border p-2 text-xs" required />
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <select name="count" className="min-w-0 rounded border p-2 text-xs">
                      <option value="5">5개</option>
                      <option value="10">10개</option>
                    </select>
                    <button disabled={isSubmitting} className="rounded bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-700 disabled:opacity-50">
                      {isSubmitting ? "생성 중..." : "생성"}
                    </button>
                  </div>
                </Form>
              </Panel>

              <Panel title="테마 기준 재배치" icon={<RefreshCw size={16} className="text-blue-600" />}>
                <p className="mb-4 text-xs leading-relaxed text-slate-500">현재 테마에 맞춰 PC/모바일, 쪽지/앨범 배치를 다시 생성합니다.</p>
                <Form method="post">
                  <input type="hidden" name="intent" value="LAYOUT" />
                  <button disabled={isSubmitting} className="w-full rounded bg-blue-50 py-2 text-xs font-bold text-blue-600 hover:bg-blue-100 disabled:opacity-50">
                    배치 다시 하기
                  </button>
                </Form>
              </Panel>
            </div>

            <Panel title={`작성된 글 (${postPagination.totalPosts})`}>
              <Form method="get" className="mb-4 space-y-3 rounded-lg bg-slate-50 p-3">
                {searchParams.get("view") === "pc" && <input type="hidden" name="view" value="pc" />}
                <div className="space-y-1">
                  <label htmlFor="postAuthor" className="text-xs font-bold text-slate-500">
                    작성자
                  </label>
                  <input
                    id="postAuthor"
                    name="postAuthor"
                    defaultValue={postPagination.filters.author}
                    placeholder="닉네임, 이름, 전화번호"
                    className="w-full rounded border border-slate-200 bg-white p-2 text-xs outline-none focus:border-slate-500"
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="postDateFrom" className="text-xs font-bold text-slate-500">
                      시작일
                    </label>
                    <input
                      id="postDateFrom"
                      type="date"
                      name="postDateFrom"
                      defaultValue={postPagination.filters.dateFrom}
                      className="w-full rounded border border-slate-200 bg-white p-2 text-xs outline-none focus:border-slate-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="postDateTo" className="text-xs font-bold text-slate-500">
                      종료일
                    </label>
                    <input
                      id="postDateTo"
                      type="date"
                      name="postDateTo"
                      defaultValue={postPagination.filters.dateTo}
                      className="w-full rounded border border-slate-200 bg-white p-2 text-xs outline-none focus:border-slate-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <button type="submit" className="rounded bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
                    검색
                  </button>
                  <a href={resetPostFilterHref} className="rounded border border-slate-200 bg-white px-4 py-2 text-center text-xs font-bold text-slate-600 hover:bg-slate-100">
                    초기화
                  </a>
                </div>
              </Form>

              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  {postPagination.totalPosts === 0 ? "표시할 글이 없습니다." : `${postResultStart}-${postResultEnd} / ${postPagination.totalPosts}개`}
                </span>
                <span>
                  {postPagination.page} / {postPagination.totalPages} 페이지
                </span>
              </div>

              <div className="space-y-3">
                {posts.map((post) => (
                  <div key={post.id} className="group flex items-start gap-3 rounded-lg border border-slate-100 p-3 transition hover:bg-slate-50">
                    {(post.thumbnailUrl || post.mediaUrl) && <img src={post.thumbnailUrl || post.mediaUrl || ""} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${post.type === "ALBUM" ? "bg-pink-100 text-pink-600" : "bg-indigo-100 text-indigo-600"}`}>
                          {post.type === "ALBUM" ? "사진" : "쪽지"}
                        </span>
                        <span className="break-words text-xs font-bold text-slate-700 [overflow-wrap:anywhere]">{post.nickname}</span>
                        <span className="text-[10px] text-slate-400">{new Date(post.createdAt).toLocaleDateString()}</span>
                      </div>
                      <p className="line-clamp-3 break-words text-xs leading-relaxed text-slate-600 [overflow-wrap:anywhere]">{post.content}</p>
                    </div>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete_post" />
                      <input type="hidden" name="postId" value={post.id} />
                      <button
                        className="p-1 text-slate-400 transition hover:text-red-500"
                        title="삭제"
                        onClick={(event) => !confirm("이 글을 삭제할까요?") && event.preventDefault()}
                      >
                        <Trash2 size={14} />
                      </button>
                    </Form>
                  </div>
                ))}
                {posts.length === 0 && <p className="py-10 text-center text-xs text-slate-400">검색 조건에 맞는 글이 없습니다.</p>}
              </div>

              {postPagination.totalPages > 1 && (
                <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
                  {postPagination.page <= 1 ? (
                    <span className="rounded border border-slate-100 px-3 py-2 text-center text-slate-300">이전</span>
                  ) : (
                    <a href={buildPostPageHref(postPagination.page - 1)} className="rounded border border-slate-200 px-3 py-2 text-center font-bold text-slate-700 hover:bg-slate-50">
                      이전
                    </a>
                  )}
                  <span className="px-2 font-bold text-slate-500">
                    {postPagination.page} / {postPagination.totalPages}
                  </span>
                  {postPagination.page >= postPagination.totalPages ? (
                    <span className="rounded border border-slate-100 px-3 py-2 text-center text-slate-300">다음</span>
                  ) : (
                    <a href={buildPostPageHref(postPagination.page + 1)} className="rounded border border-slate-200 px-3 py-2 text-center font-bold text-slate-700 hover:bg-slate-50">
                      다음
                    </a>
                  )}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="mb-4 flex items-center gap-2 break-words text-base font-bold text-slate-800 sm:text-lg">
        {icon ? <span className="shrink-0">{icon}</span> : null}
        {title}
      </h3>
      {children}
    </section>
  );
}
