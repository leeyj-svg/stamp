import { Link, type LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { getScopedCategoryWhere, requireAdminAccessScope } from "~/lib/admin-access.server";
import { db } from "~/lib/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const scope = await requireAdminAccessScope(request);
  const scopedCategoryWhere = getScopedCategoryWhere(scope) as { categoryId?: { in: number[] } };

  const [totalEvents, recentEvents, totalUsers, totalCoupons] = await Promise.all([
    db.event.count({ where: scopedCategoryWhere }),
    db.event.findMany({
      where: scopedCategoryWhere,
      take: 8,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        category: { select: { name: true } },
      },
    }),
    scope.isAdmin ? db.user.count() : Promise.resolve(null),
    scope.isAdmin ? db.coupon.count() : Promise.resolve(null),
  ]);

  return {
    isAdmin: scope.isAdmin,
    totalEvents,
    totalUsers,
    totalCoupons,
    recentEvents,
  };
};

export default function AdminDashboard() {
  const { isAdmin, totalEvents, totalUsers, totalCoupons, recentEvents } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">대시보드</h1>
        <p className="text-muted-foreground">
          {isAdmin ? "전체 서비스" : "담당 카테고리"} 기준 운영 현황입니다.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">총 이벤트</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEvents}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">총 사용자</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalUsers ?? "-"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">총 쿠폰</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCoupons ?? "-"}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>최근 이벤트</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이벤트</TableHead>
                <TableHead>카테고리</TableHead>
                <TableHead className="text-right">생성일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentEvents.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Link to={`/admin/events/${event.id}`} className="hover:underline font-medium">
                      {event.name}
                    </Link>
                  </TableCell>
                  <TableCell>{event.category.name}</TableCell>
                  <TableCell className="text-right">{new Date(event.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
              {recentEvents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
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
