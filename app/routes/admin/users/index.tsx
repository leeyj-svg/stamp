import { Form, Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import type { Prisma, Role, UserStatus } from "@prisma/client";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Award, Calendar, CreditCard, Phone, Search, UserCircle } from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "~/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

const USERS_PER_PAGE = 10;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await getSessionWithPermission(request, "ADMIN");

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const role = (url.searchParams.get("role") as Role | "all" | null) || "all";
  const status = (url.searchParams.get("status") as UserStatus | "all" | null) || "all";
  const page = Number.parseInt(url.searchParams.get("page") || "1", 10);

  const where: Prisma.UserWhereInput = {
    AND: [
      q
        ? {
            OR: [
              { name: { contains: q } },
              { phoneNumber: { contains: q.replace(/-/g, "") } },
            ],
          }
        : {},
      role !== "all" ? { role } : {},
      status !== "all" ? { status } : {},
    ],
  };

  const [rawUsers, totalUsers] = await db.$transaction([
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * USERS_PER_PAGE,
      take: USERS_PER_PAGE,
      include: {
        _count: {
          select: {
            eventEntries: true,
            StampCard: true,
          },
        },
        StampCard: {
          include: {
            coupon: {
              select: { id: true },
            },
          },
        },
      },
    }),
    db.user.count({ where }),
  ]);

  const users = rawUsers.map((user) => {
    const couponCount = user.StampCard.filter((card) => card.coupon !== null).length;
    const { StampCard, ...rest } = user;
    return {
      ...rest,
      couponCount,
      createdAtFormatted: format(new Date(user.createdAt), "yyyy.MM.dd", { locale: ko }),
    };
  });

  return {
    users,
    totalUsers,
    page,
    totalPages: Math.ceil(totalUsers / USERS_PER_PAGE),
    q,
    role,
    status,
  };
};

export default function AdminUsersPage() {
  const { users, totalUsers, page, totalPages, q, role, status } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const [isSearchVisible, setIsSearchVisible] = useState(!!q || role !== "all" || status !== "all");

  const getPageLink = (targetPage: number) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", String(targetPage));
    return `/admin/users?${newParams.toString()}`;
  };

  const getRoleBadgeVariant = (userRole: Role | null) => {
    switch (userRole) {
      case "ADMIN":
        return "destructive";
      case "MEMBER":
        return "default";
      case "USER":
        return "outline";
      default:
        return "secondary";
    }
  };

  const getStatusBadgeVariant = (userStatus: UserStatus) => {
    switch (userStatus) {
      case "ACTIVE":
        return "secondary";
      case "TEMPORARY":
        return "outline";
      default:
        return "secondary";
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>회원 관리</CardTitle>
              <CardDescription>총 {totalUsers}명의 회원이 있습니다.</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setIsSearchVisible((prev) => !prev)}>
              <Search className="h-5 w-5" />
              <span className="sr-only">검색창 열기/닫기</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isSearchVisible && (
            <Form method="get" className="mb-4 flex flex-col gap-2 rounded-lg border bg-muted/50 p-4 md:flex-row">
              <Input
                name="q"
                placeholder="이름, 전화번호 검색"
                defaultValue={q || ""}
                className="flex-grow"
              />
              <Select name="role" defaultValue={role || "all"}>
                <SelectTrigger className="w-full md:w-[160px]">
                  <SelectValue placeholder="모든 권한" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">모든 권한</SelectItem>
                  <SelectItem value="USER">일반 사용자</SelectItem>
                  <SelectItem value="MEMBER">멤버</SelectItem>
                  <SelectItem value="ADMIN">관리자</SelectItem>
                </SelectContent>
              </Select>
              <Select name="status" defaultValue={status || "all"}>
                <SelectTrigger className="w-full md:w-[160px]">
                  <SelectValue placeholder="모든 상태" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">모든 상태</SelectItem>
                  <SelectItem value="ACTIVE">활성</SelectItem>
                  <SelectItem value="TEMPORARY">임시</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" className="w-full md:w-auto">
                <Search className="mr-2 h-4 w-4" />
                검색
              </Button>
            </Form>
          )}

          {users.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed py-20 text-center">
              <h3 className="text-lg font-semibold">검색 결과가 없습니다.</h3>
              <p className="mt-2 text-sm text-muted-foreground">검색어나 필터를 변경해 보세요.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {users.map((user) => (
                <Link to={`/admin/users/${user.id}`} key={user.id} className="block">
                  <Card className="h-full transition-shadow duration-200 hover:shadow-lg">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <UserCircle className="h-6 w-6 text-primary" />
                        <CardTitle className="text-lg font-semibold">{user.name}</CardTitle>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant={getRoleBadgeVariant(user.role)}>{user.role}</Badge>
                        <Badge variant={getStatusBadgeVariant(user.status)}>{user.status}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Phone className="mr-2 h-4 w-4" />
                        <span>{user.phoneNumber.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3")}</span>
                      </div>
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Calendar className="mr-2 h-4 w-4" />
                        <span>가입일 {user.createdAtFormatted}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-sm text-muted-foreground">
                        <div className="flex items-center">
                          <CreditCard className="mr-1.5 h-4 w-4" />
                          <span className="font-medium text-foreground">{user._count.StampCard}</span> 스탬프 카드
                        </div>
                        <div className="flex items-center">
                          <Award className="mr-1.5 h-4 w-4" />
                          <span className="font-medium text-foreground">{user.couponCount}</span> 쿠폰
                        </div>
                        <div className="flex items-center">
                          <Search className="mr-1.5 h-4 w-4" />
                          <span className="font-medium text-foreground">{user._count.eventEntries}</span> 이벤트 참여
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <Pagination className="mt-8">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious href={page > 1 ? getPageLink(page - 1) : undefined} />
                </PaginationItem>
                <PaginationItem>
                  <span className="p-2 text-sm font-medium">
                    {page} / {totalPages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext href={page < totalPages ? getPageLink(page + 1) : undefined} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
