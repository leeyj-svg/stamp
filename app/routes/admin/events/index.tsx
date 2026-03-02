import { Form, Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { format } from "date-fns";
import { MoreHorizontal, PlusCircle, Search, Users } from "lucide-react";
import { Prisma } from "@prisma/client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "~/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { db } from "~/lib/db.server";
import { getScopedCategoryWhere, requireAdminAccessScope } from "~/lib/admin-access.server";

const EVENTS_PER_PAGE = 8;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const scope = await requireAdminAccessScope(request);
  const url = new URL(request.url);

  const q = url.searchParams.get("q") || "";
  const categoryIdParam = url.searchParams.get("categoryId") || "all";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10));

  const scopedWhere = getScopedCategoryWhere(scope);
  const where: Prisma.EventWhereInput = {
    AND: [
      scopedWhere,
      q
        ? {
            OR: [{ name: { contains: q } }, { description: { contains: q } }],
          }
        : {},
      categoryIdParam !== "all" ? { categoryId: Number(categoryIdParam) } : {},
    ],
  };

  const [events, totalEvents, categories] = await db.$transaction([
    db.event.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * EVENTS_PER_PAGE,
      take: EVENTS_PER_PAGE,
      include: {
        category: true,
        images: { take: 1 },
        _count: { select: { participants: true, claimableStamps: true, likes: true } },
      },
    }),
    db.event.count({ where }),
    db.eventCategory.findMany({
      where: scope.isAdmin ? {} : { id: { in: scope.managedCategoryIds } },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    isAdmin: scope.isAdmin,
    events,
    categories,
    totalEvents,
    totalPages: Math.max(1, Math.ceil(totalEvents / EVENTS_PER_PAGE)),
    page,
    q,
    categoryId: categoryIdParam,
  };
};

export default function EventListPage() {
  const { events, categories, totalEvents, totalPages, page, q, categoryId } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const [showFilter, setShowFilter] = useState(Boolean(q) || categoryId !== "all");

  const getPageLink = (nextPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(nextPage));
    return `/admin/events?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>이벤트 관리</CardTitle>
              <CardDescription>총 {totalEvents}개의 이벤트가 있습니다.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setShowFilter((prev) => !prev)}>
                <Search className="h-5 w-5" />
              </Button>
              <Button asChild>
                <Link to="/admin/events/create">
                  <PlusCircle className="h-4 w-4 mr-2" /> 이벤트 생성
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {showFilter && (
            <Form method="get" className="flex flex-col sm:flex-row gap-2 mb-4 p-4 border rounded-lg bg-muted/50">
              <Input name="q" placeholder="이벤트 검색" defaultValue={q} className="flex-grow" />
              <Select name="categoryId" defaultValue={categoryId}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="카테고리" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 카테고리</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={String(category.id)}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit">검색</Button>
            </Form>
          )}

          {events.length === 0 ? (
            <div className="text-center py-16 border-2 border-dashed rounded-lg text-muted-foreground">
              표시할 이벤트가 없습니다.
            </div>
          ) : (
            <div className="space-y-4">
              {events.map((event) => {
                const totalParticipants = event._count.participants + event._count.claimableStamps;
                return (
                  <Card key={event.id} className="relative group hover:shadow-sm transition-shadow">
                    <Link to={`/admin/events/${event.id}`} className="absolute inset-0 z-0">
                      <span className="sr-only">{event.name} 상세</span>
                    </Link>

                    <div className="relative z-10 flex items-start gap-4 p-4">
                      <div className="w-24 h-24 rounded-md overflow-hidden bg-muted flex-shrink-0">
                        {event.images[0]?.url ? (
                          <img src={event.images[0].url} alt={event.name} className="w-full h-full object-cover" />
                        ) : null}
                      </div>

                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline">{event.category.name}</Badge>
                          <p className="font-semibold truncate">{event.name}</p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(event.startDate), "yyyy.MM.dd")} ~ {format(new Date(event.endDate), "yyyy.MM.dd")}
                        </p>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-4 w-4" /> 참가 {totalParticipants}명
                          </span>
                          <span>좋아요 {event._count.likes}</span>
                        </div>
                      </div>

                      <div className="relative z-20">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>작업</DropdownMenuLabel>
                            <DropdownMenuItem asChild>
                              <Link to={`/admin/events/${event.id}/edit`}>수정</Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DeleteEventDialog eventId={event.id} eventName={event.name} />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <Pagination className="mt-8">
              <PaginationContent>
                <PaginationItem>
                  {page <= 1 ? (
                    <span className="inline-flex items-center justify-center h-10 px-4 py-2 opacity-50">이전</span>
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
                    <span className="inline-flex items-center justify-center h-10 px-4 py-2 opacity-50">다음</span>
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

function DeleteEventDialog({ eventId, eventName }: { eventId: string; eventName: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <DropdownMenuItem onSelect={(event) => event.preventDefault()} className="text-red-600">
          삭제
        </DropdownMenuItem>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <Form method="post" action="/api/events/delete">
          <input type="hidden" name="eventId" value={eventId} />
          <AlertDialogHeader>
            <AlertDialogTitle>이벤트를 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              '{eventName}' 이벤트를 삭제합니다. 관련 데이터가 함께 정리됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button type="submit" variant="destructive">
              삭제
            </Button>
          </AlertDialogFooter>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
