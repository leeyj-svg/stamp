import { Form, Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { useState } from "react";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/ko";
import { Calendar, Heart, Search, Star } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "~/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

const EVENTS_PER_PAGE = 9;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "MEMBER");

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const categoryId = url.searchParams.get("categoryId") || "all";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10));
  const myEvents = url.searchParams.get("myEvents") === "on";
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";
  const sortBy = url.searchParams.get("sortBy") || "latest";

  const where: Prisma.EventWhereInput = {
    AND: [
      q
        ? {
            OR: [{ name: { contains: q } }, { description: { contains: q } }],
          }
        : {},
      categoryId !== "all" ? { categoryId: Number(categoryId) } : {},
      myEvents ? { participants: { some: { userId: user.id } } } : {},
      startDate ? { endDate: { gte: new Date(startDate) } } : {},
      endDate ? { startDate: { lte: new Date(endDate) } } : {},
    ],
  };

  const [rawEvents, totalEvents, categories] = await db.$transaction([
    db.event.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        category: { select: { name: true } },
        images: { select: { url: true }, take: 1 },
        reviews: { select: { rating: true } },
        _count: { select: { participants: true, likes: true } },
      },
    }),
    db.event.count({ where }),
    db.eventCategory.findMany({ orderBy: { name: "asc" } }),
  ]);

  const processed = rawEvents.map((event) => {
    const reviewCount = event.reviews.length;
    const averageRating = reviewCount
      ? event.reviews.reduce((sum, review) => sum + review.rating, 0) / reviewCount
      : 0;
    return {
      ...event,
      reviewCount,
      averageRating,
    };
  });

  processed.sort((a, b) => {
    if (sortBy === "popular") {
      return b._count.participants - a._count.participants;
    }
    if (sortBy === "rating") {
      return b.averageRating - a.averageRating;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const paginated = processed.slice((page - 1) * EVENTS_PER_PAGE, page * EVENTS_PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(totalEvents / EVENTS_PER_PAGE));

  return {
    events: paginated,
    categories,
    page,
    totalPages,
    q,
    categoryId,
    myEvents,
    startDate,
    endDate,
    sortBy,
  };
};

export default function EventsIndexPage() {
  const { events, categories, page, totalPages, q, categoryId, myEvents, startDate: initialStartDate, endDate: initialEndDate, sortBy } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const [showFilter, setShowFilter] = useState(
    Boolean(q) || categoryId !== "all" || myEvents || Boolean(initialStartDate) || Boolean(initialEndDate) || sortBy !== "latest"
  );

  const [startDate, setStartDate] = useState<Dayjs | null>(initialStartDate ? dayjs(initialStartDate) : null);
  const [endDate, setEndDate] = useState<Dayjs | null>(initialEndDate ? dayjs(initialEndDate) : null);

  const getPageLink = (nextPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(nextPage));
    return `/events?${params.toString()}`;
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="ko">
      <div className="container mx-auto max-w-7xl py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-extrabold">모든 이벤트</h1>
          <Button variant="ghost" size="icon" onClick={() => setShowFilter((prev) => !prev)}>
            <Search className="h-6 w-6" />
          </Button>
        </div>

        {showFilter && (
          <Form method="get" className="flex flex-col gap-4 mb-8 p-4 border rounded-lg bg-muted/50">
            <input type="hidden" name="startDate" value={startDate ? startDate.format("YYYY-MM-DD") : ""} />
            <input type="hidden" name="endDate" value={endDate ? endDate.format("YYYY-MM-DD") : ""} />

            <div className="flex flex-col sm:flex-row gap-2">
              <Input name="q" placeholder="이벤트 이름, 설명 검색" defaultValue={q} className="flex-grow" />

              <Select name="categoryId" defaultValue={categoryId}>
                <SelectTrigger className="w-full sm:w-[180px]">
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

              <Select name="sortBy" defaultValue={sortBy}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue placeholder="정렬" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">최신순</SelectItem>
                  <SelectItem value="popular">인기순</SelectItem>
                  <SelectItem value="rating">평점순</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2">
              <DatePicker
                label="시작일"
                value={startDate}
                onChange={(value) => setStartDate(value as Dayjs)}
                slotProps={{ textField: { size: "small", fullWidth: true } }}
              />
              <span className="hidden sm:inline">-</span>
              <DatePicker
                label="종료일"
                value={endDate}
                onChange={(value) => setEndDate(value as Dayjs)}
                slotProps={{ textField: { size: "small", fullWidth: true } }}
              />
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
              <div className="flex items-center space-x-2">
                <Checkbox id="my-events" name="myEvents" defaultChecked={myEvents} />
                <Label htmlFor="my-events" className="cursor-pointer">
                  내가 참여한 이벤트만 보기
                </Label>
              </div>
              <Button type="submit" className="w-full sm:w-auto">
                <Search className="h-4 w-4 mr-2" /> 검색
              </Button>
            </div>
          </Form>
        )}

        {events.length === 0 ? (
          <div className="text-center py-20 border-dashed border-2 rounded-lg">
            <h3 className="text-xl font-semibold">검색 결과가 없습니다.</h3>
            <p className="text-muted-foreground mt-2">다른 조건으로 다시 검색해 보세요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {events.map((event) => (
              <Link to={`/events/${event.id}`} key={event.id} className="block">
                <Card className="h-full flex flex-col hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                  {event.images[0]?.url && (
                    <img src={event.images[0].url} alt={event.name} className="w-full h-48 object-cover rounded-t-lg" />
                  )}

                  <CardHeader className="flex-grow pb-2">
                    <Badge className="w-fit mb-2">{event.category.name}</Badge>
                    <CardTitle className="text-lg font-bold line-clamp-2">{event.name}</CardTitle>
                  </CardHeader>

                  <CardContent>
                    <div className="flex justify-between items-center text-sm text-muted-foreground mb-4">
                      <div className="flex items-center">
                        <Calendar className="h-4 w-4 mr-1.5" />
                        <span>{new Date(event.startDate).toLocaleDateString()}</span>
                      </div>

                      <div className="flex items-center gap-3">
                        {event.reviewCount > 0 && (
                          <span className="inline-flex items-center">
                            <Star className="h-4 w-4 mr-1 text-yellow-400 fill-yellow-400" />
                            <span className="font-bold text-slate-700">{event.averageRating.toFixed(1)}</span>
                          </span>
                        )}
                        <span className="inline-flex items-center">
                          <Heart className="h-4 w-4 mr-1" />
                          {event._count.likes}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <Pagination className="mt-12">
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
      </div>
    </LocalizationProvider>
  );
}
