import { Form, Link, useLoaderData, type LoaderFunctionArgs } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

const POSTS_PER_PAGE = 12;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await getSessionWithPermission(request, "MEMBER");

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10));

  const where = q
    ? {
        OR: [{ title: { contains: q } }, { content: { contains: q } }],
      }
    : {};

  const [posts, totalCount] = await db.$transaction([
    db.communityPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * POSTS_PER_PAGE,
      take: POSTS_PER_PAGE,
      include: {
        user: { select: { id: true, name: true } },
        _count: {
          select: { likes: true },
        },
      },
    }),
    db.communityPost.count({ where }),
  ]);

  return {
    posts,
    q,
    page,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / POSTS_PER_PAGE)),
  };
};

export default function CommunityListPage() {
  const { posts, q, page, totalCount, totalPages } = useLoaderData<typeof loader>();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-2xl">커뮤니티 게시판</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">회원 글을 게시판 형태로 확인할 수 있습니다.</p>
            </div>
            <Button asChild>
              <Link to="/community/new">글쓰기</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Form method="get" className="flex items-center gap-2">
            <Input name="q" defaultValue={q} placeholder="제목/내용 검색" />
            <Button type="submit" variant="outline">
              검색
            </Button>
          </Form>

          {posts.length === 0 ? (
            <div className="rounded-md border py-12 text-center text-muted-foreground">게시글이 없습니다.</div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px] text-center">번호</TableHead>
                    <TableHead>제목</TableHead>
                    <TableHead className="w-[110px] text-center">작성자</TableHead>
                    <TableHead className="w-[90px] text-center">좋아요</TableHead>
                    <TableHead className="w-[140px] text-center">작성일</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.map((post, index) => {
                    const rowNumber = totalCount - ((page - 1) * POSTS_PER_PAGE + index);
                    return (
                      <TableRow key={post.id}>
                        <TableCell className="text-center text-muted-foreground">{rowNumber}</TableCell>
                        <TableCell>
                          <Link to={`/community/${post.id}`} className="block hover:underline">
                            <p className="line-clamp-1 font-medium">{post.title}</p>
                            <p className="line-clamp-1 text-xs text-muted-foreground">{post.content}</p>
                          </Link>
                        </TableCell>
                        <TableCell className="text-center">{post.user.name}</TableCell>
                        <TableCell className="text-center">{post._count.likes}</TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {new Date(post.createdAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <Button asChild variant="outline" disabled={page <= 1}>
                <Link to={`/community?q=${encodeURIComponent(q)}&page=${page - 1}`}>이전</Link>
              </Button>
              <span className="text-sm">
                {page} / {totalPages}
              </span>
              <Button asChild variant="outline" disabled={page >= totalPages}>
                <Link to={`/community?q=${encodeURIComponent(q)}&page=${page + 1}`}>다음</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
