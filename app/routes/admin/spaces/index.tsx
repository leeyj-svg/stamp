import { Form, Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import { CalendarDays, ExternalLink, PlusCircle, Search, Sparkles, UserRound } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "~/components/ui/pagination";
import { requireAdminAccessScope } from "~/lib/admin-access.server";
import { db } from "~/lib/db.server";
import { getSpaceTheme } from "~/lib/space-theme";

const SPACES_PER_PAGE = 12;

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const scope = await requireAdminAccessScope(request);
  if (!scope.isAdmin) {
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10));
  const where = q ? { title: { contains: q } } : {};

  const [spaces, totalSpaces, totalPosts] = await Promise.all([
    db.memorySpace.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * SPACES_PER_PAGE,
      take: SPACES_PER_PAGE,
      include: {
        user: { select: { id: true, name: true, phoneNumber: true } },
        _count: { select: { posts: true } },
      },
    }),
    db.memorySpace.count({ where }),
    db.memoryPost.count(),
  ]);

  const spaceIds = spaces.map((space) => space.id);
  const postTypeCounts =
    spaceIds.length > 0
      ? await db.memoryPost.groupBy({
          by: ["spaceId", "type"],
          where: { spaceId: { in: spaceIds } },
          _count: { id: true },
        })
      : [];

  const countsBySpace = new Map<string, { notes: number; photos: number }>();
  for (const row of postTypeCounts) {
    const current = countsBySpace.get(row.spaceId) ?? { notes: 0, photos: 0 };
    if (row.type === "MESSAGE") {
      current.notes += row._count.id;
    } else {
      current.photos += row._count.id;
    }
    countsBySpace.set(row.spaceId, current);
  }

  return {
    spaces: spaces.map((space) => {
      const theme = getSpaceTheme(space.themeKey);
      const counts = countsBySpace.get(space.id) ?? { notes: 0, photos: 0 };
      return {
        id: space.id,
        title: space.title,
        targetDate: space.targetDate,
        createdAt: space.createdAt,
        linkedUser: space.user,
        postCount: space._count.posts,
        noteCount: counts.notes,
        photoCount: counts.photos,
        theme: {
          label: theme.shortLabel,
          accentColor: theme.accentColor,
        },
      };
    }),
    totalSpaces,
    totalPosts,
    totalPages: Math.max(1, Math.ceil(totalSpaces / SPACES_PER_PAGE)),
    page,
    q,
  };
};

export default function AdminSpacesPage() {
  const { spaces, totalSpaces, totalPosts, totalPages, page, q } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  const getPageLink = (nextPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(nextPage));
    return `/admin/spaces?${params.toString()}`;
  };
  const getAdminSpaceLink = (spaceId: string) => {
    return searchParams.get("view") === "pc" ? `/admin/spaces/${spaceId}?view=pc` : `/admin/spaces/${spaceId}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold">SPACE 관리</h1>
          <p className="text-muted-foreground">비회원 작성 링크와 주인공 보기 링크를 관리하는 공간입니다.</p>
        </div>
        <Button asChild>
          <Link to="/memory/new">
            <PlusCircle className="h-4 w-4" /> SPACE 생성
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">총 SPACE</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSpaces}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">전체 작성물</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalPosts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">현재 페이지</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{page} / {totalPages}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>SPACE 목록</CardTitle>
              <CardDescription>제목으로 검색하고 각 SPACE의 관리자 화면으로 이동할 수 있습니다.</CardDescription>
            </div>
            <Form method="get" className="flex gap-2 md:w-80">
              <Input name="q" defaultValue={q} placeholder="SPACE 제목 검색" />
              <Button type="submit" size="icon" variant="outline" aria-label="검색">
                <Search className="h-4 w-4" />
              </Button>
            </Form>
          </div>
        </CardHeader>
        <CardContent>
          {spaces.length === 0 ? (
            <div className="rounded-lg border border-dashed py-14 text-center text-sm text-muted-foreground">
              표시할 SPACE가 없습니다.
            </div>
          ) : (
            <div className="space-y-3">
              {spaces.map((space) => (
                <Card key={space.id} className="overflow-hidden transition-shadow hover:shadow-sm">
                  <CardContent className="space-y-4 p-4">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-start gap-2">
                        <CardTitle className="min-w-0 break-words text-base leading-snug [overflow-wrap:anywhere]">{space.title}</CardTitle>
                        <Badge variant="secondary" className="shrink-0 whitespace-nowrap" style={{ color: space.theme.accentColor }}>
                          <Sparkles className="mr-1 h-3 w-3" />
                          {space.theme.label}
                        </Badge>
                      </div>
                      <CardDescription className="break-all text-xs leading-relaxed">ID: {space.id}</CardDescription>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-sm">
                      <div className="rounded-md bg-muted px-3 py-2">
                        <div className="font-bold">{space.postCount}</div>
                        <div className="text-xs text-muted-foreground">전체</div>
                      </div>
                      <div className="rounded-md bg-muted px-3 py-2">
                        <div className="font-bold">{space.noteCount}</div>
                        <div className="text-xs text-muted-foreground">쪽지</div>
                      </div>
                      <div className="rounded-md bg-muted px-3 py-2">
                        <div className="font-bold">{space.photoCount}</div>
                        <div className="text-xs text-muted-foreground">사진</div>
                      </div>
                    </div>

                    <div className="min-w-0 space-y-2 rounded-md bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                      <p className="flex min-w-0 items-start gap-2">
                        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="break-words leading-relaxed">공개일 {formatDate(space.targetDate)}</span>
                      </p>
                      <p className="flex min-w-0 items-start gap-2">
                        <UserRound className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="break-words leading-relaxed [overflow-wrap:anywhere]">{space.linkedUser ? `${space.linkedUser.name} (${space.linkedUser.phoneNumber})` : "연결된 주인공 없음"}</span>
                      </p>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <Button asChild className="w-full">
                        <Link to={getAdminSpaceLink(space.id)}>관리</Link>
                      </Button>
                      <Button asChild variant="outline" size="icon">
                        <Link to={`/space/${space.id}`} target="_blank" rel="noreferrer" aria-label="SPACE 보기">
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <Pagination className="mt-6">
              <PaginationContent>
                <PaginationItem>
                  {page <= 1 ? (
                    <span className="inline-flex h-10 items-center justify-center px-4 py-2 opacity-50">이전</span>
                  ) : (
                    <PaginationPrevious href={getPageLink(page - 1)} />
                  )}
                </PaginationItem>
                <PaginationItem>
                  <span className="px-2 text-sm font-medium">
                    {page} / {totalPages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  {page >= totalPages ? (
                    <span className="inline-flex h-10 items-center justify-center px-4 py-2 opacity-50">다음</span>
                  ) : (
                    <PaginationNext href={getPageLink(page + 1)} />
                  )}
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
