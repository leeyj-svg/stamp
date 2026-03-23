import { Form, useFetcher, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Calendar, MessageSquareMore, Search, Ticket, User } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "~/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

const COUPONS_PER_PAGE = 10;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await getSessionWithPermission(request, "ADMIN");

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const status = url.searchParams.get("status");
  const page = Number.parseInt(url.searchParams.get("page") || "1", 10);

  const where: Prisma.CouponWhereInput = {
    AND: [
      q
        ? {
            OR: [
              { code: { contains: q } },
              { stampCard: { user: { name: { contains: q } } } },
            ],
          }
        : {},
      status === "used" ? { isUsed: true } : {},
      status === "not_used" ? { isUsed: false } : {},
    ],
  };

  const [coupons, totalCoupons] = await db.$transaction([
    db.coupon.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * COUPONS_PER_PAGE,
      take: COUPONS_PER_PAGE,
      include: {
        stampCard: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    }),
    db.coupon.count({ where }),
  ]);

  return {
    coupons,
    totalCoupons,
    page,
    totalPages: Math.ceil(totalCoupons / COUPONS_PER_PAGE),
    q,
    status,
  };
};

type CouponItem = Awaited<ReturnType<typeof loader>>["coupons"][number];

export default function AdminCouponsPage() {
  const { coupons, totalCoupons, page, totalPages, q, status } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  const getPageLink = (targetPage: number) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", String(targetPage));
    return `/admin/coupons?${newParams.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>쿠폰 관리</CardTitle>
          <CardDescription>총 {totalCoupons}개의 쿠폰이 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="get" className="mb-4 flex flex-col gap-2 sm:flex-row">
            <Input
              name="q"
              placeholder="쿠폰 코드, 사용자 이름 검색"
              defaultValue={q || ""}
              className="flex-grow"
            />
            <Select name="status" defaultValue={status || "all"}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="모든 상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">모든 상태</SelectItem>
                <SelectItem value="not_used">미사용</SelectItem>
                <SelectItem value="used">사용 완료</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit">
              <Search className="mr-2 h-4 w-4" />
              검색
            </Button>
          </Form>

          {coupons.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed py-20 text-center">
              <h3 className="text-lg font-semibold">조건에 맞는 쿠폰이 없습니다.</h3>
              <p className="mt-2 text-sm text-muted-foreground">검색어나 필터를 변경해 보세요.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {coupons.map((coupon) => (
                <CouponCard key={coupon.id} coupon={coupon} />
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

function CouponCard({ coupon }: { coupon: CouponItem }) {
  const statusFetcher = useFetcher<{ success: boolean; error?: string }>();
  const resendFetcher = useFetcher<{ success: boolean; error?: string; message?: string }>();
  const isStatusSubmitting = statusFetcher.state !== "idle";
  const isResendSubmitting = resendFetcher.state !== "idle";

  const optimisticIsUsed = isStatusSubmitting ? !coupon.isUsed : coupon.isUsed;
  const isExpired = new Date(coupon.expiresAt).getTime() < Date.now();

  const statusLabel = optimisticIsUsed ? "사용 완료" : isExpired ? "만료" : "미사용";
  const statusVariant = optimisticIsUsed ? "secondary" : isExpired ? "destructive" : "default";

  useEffect(() => {
    if (resendFetcher.state !== "idle" || !resendFetcher.data) {
      return;
    }

    if (resendFetcher.data.success) {
      toast.success(resendFetcher.data.message ?? "알림톡을 다시 보냈습니다.");
      return;
    }

    if (resendFetcher.data.error) {
      toast.error(resendFetcher.data.error);
    }
  }, [resendFetcher.data, resendFetcher.state]);

  return (
    <Card className={`flex flex-col transition-all ${optimisticIsUsed ? "bg-muted/50" : "bg-background"}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Ticket className="h-5 w-5 text-primary" />
            {coupon.description}
          </CardTitle>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </div>
        <CardDescription className="pt-1 font-mono text-sm">{coupon.code}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow space-y-2 text-sm">
        <div className="flex items-center">
          <User className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>{coupon.stampCard.user.name}</span>
        </div>
        <div className="flex items-center">
          <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>~ {format(new Date(coupon.expiresAt), "yyyy.MM.dd", { locale: ko })} 까지</span>
        </div>
      </CardContent>
      <CardFooter className="border-t pt-4">
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <resendFetcher.Form method="post" action="/api/coupons/issue">
            <input type="hidden" name="intent" value="resendCouponNotification" />
            <input type="hidden" name="couponId" value={coupon.id} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              disabled={isResendSubmitting}
            >
              <MessageSquareMore className="mr-1 h-3.5 w-3.5" />
              쿠폰 발급 재발송
            </Button>
          </resendFetcher.Form>

          <statusFetcher.Form method="post" action="/api/coupons/issue" className="w-full sm:w-auto">
          <input type="hidden" name="intent" value="toggleCouponStatus" />
          <input type="hidden" name="couponId" value={coupon.id} />
          <div className="flex w-full items-center justify-between sm:min-w-[8rem]">
            <Label
              htmlFor={`coupon-switch-${coupon.id}`}
              className={optimisticIsUsed ? "text-muted-foreground" : ""}
            >
              사용 처리
            </Label>
            <Switch
              id={`coupon-switch-${coupon.id}`}
              checked={optimisticIsUsed}
              onCheckedChange={() => {
                statusFetcher.submit(
                  { couponId: coupon.id, intent: "toggleCouponStatus" },
                  { method: "post", action: "/api/coupons/issue" }
                );
              }}
              disabled={isStatusSubmitting}
              aria-label="쿠폰 사용 상태 변경"
            />
          </div>
          </statusFetcher.Form>
        </div>
      </CardFooter>
    </Card>
  );
}
