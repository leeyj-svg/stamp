import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { getScopedCategoryWhere, requireAdminAccessScope } from "~/lib/admin-access.server";
import { db } from "~/lib/db.server";

type UserStat = {
  userId: string;
  userName: string;
  count: number;
};

type CategoryStat = {
  categoryId: number;
  categoryName: string;
  totalCount: number;
  users: UserStat[];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const scope = await requireAdminAccessScope(request);
  const scopedCategoryWhere = getScopedCategoryWhere(scope) as { categoryId?: { in: number[] } };

  const [entries, topEvents] = await db.$transaction([
    db.stampEntry.findMany({
      where: {
        eventId: { not: null },
        event: scopedCategoryWhere,
      },
      select: {
        userId: true,
        user: { select: { id: true, name: true } },
        event: {
          select: {
            categoryId: true,
            category: { select: { id: true, name: true } },
          },
        },
      },
    }),
    db.event.findMany({
      where: scopedCategoryWhere,
      select: {
        id: true,
        name: true,
        category: { select: { name: true } },
        _count: { select: { participants: true, claimableStamps: true, likes: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const userTotals = new Map<string, UserStat>();
  const categoryTotals = new Map<number, CategoryStat>();

  for (const entry of entries) {
    if (!entry.event || !entry.event.category) continue;

    const existingUser = userTotals.get(entry.userId);
    if (existingUser) {
      existingUser.count += 1;
    } else {
      userTotals.set(entry.userId, {
        userId: entry.user.id,
        userName: entry.user.name,
        count: 1,
      });
    }

    const categoryId = entry.event.categoryId;
    const existingCategory = categoryTotals.get(categoryId);
    if (!existingCategory) {
      categoryTotals.set(categoryId, {
        categoryId,
        categoryName: entry.event.category.name,
        totalCount: 1,
        users: [
          {
            userId: entry.user.id,
            userName: entry.user.name,
            count: 1,
          },
        ],
      });
      continue;
    }

    existingCategory.totalCount += 1;
    const existingCategoryUser = existingCategory.users.find((user) => user.userId === entry.user.id);
    if (existingCategoryUser) {
      existingCategoryUser.count += 1;
    } else {
      existingCategory.users.push({
        userId: entry.user.id,
        userName: entry.user.name,
        count: 1,
      });
    }
  }

  const users = [...userTotals.values()].sort((a, b) => b.count - a.count);
  const categories = [...categoryTotals.values()]
    .map((category) => ({
      ...category,
      users: category.users.sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.totalCount - a.totalCount);

  const events = topEvents
    .map((event) => ({
      ...event,
      participantCount: event._count.participants + event._count.claimableStamps,
    }))
    .sort((a, b) => b.participantCount - a.participantCount);

  return {
    isAdmin: scope.isAdmin,
    users,
    categories,
    events,
  };
};

export default function EventStatsPage() {
  const { isAdmin, users, categories, events } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">이벤트 통계</h1>
        <p className="text-muted-foreground">
          {isAdmin ? "전체 카테고리" : "담당 카테고리"} 기준 참여/좋아요 통계입니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>참여 상위 회원</CardTitle>
          <CardDescription>사람마다 얼마나 참여했는지 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>순위</TableHead>
                <TableHead>이름</TableHead>
                <TableHead className="text-right">참여 수</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.slice(0, 30).map((user, index) => (
                <TableRow key={user.userId}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>{user.userName}</TableCell>
                  <TableCell className="text-right font-semibold">{user.count}</TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    집계된 참여 데이터가 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>카테고리별 참여</CardTitle>
          <CardDescription>카테고리별 운영 현황을 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {categories.map((category) => (
            <div key={category.categoryId} className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{category.categoryName}</Badge>
                <span className="text-sm text-muted-foreground">총 참여 {category.totalCount}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                {category.users.slice(0, 9).map((user) => (
                  <div key={user.userId} className="flex justify-between rounded-md border p-2 text-sm">
                    <span>{user.userName}</span>
                    <span className="font-semibold">{user.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {categories.length === 0 && (
            <p className="py-6 text-center text-muted-foreground">카테고리 집계 데이터가 없습니다.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>이벤트별 참여/좋아요</CardTitle>
          <CardDescription>이벤트 운영 우선순위를 참고할 때 사용하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이벤트</TableHead>
                <TableHead>카테고리</TableHead>
                <TableHead className="text-right">참여</TableHead>
                <TableHead className="text-right">좋아요</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.slice(0, 30).map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="font-medium">{event.name}</TableCell>
                  <TableCell>{event.category.name}</TableCell>
                  <TableCell className="text-right">{event.participantCount}</TableCell>
                  <TableCell className="text-right">{event._count.likes}</TableCell>
                </TableRow>
              ))}
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    이벤트 데이터가 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
