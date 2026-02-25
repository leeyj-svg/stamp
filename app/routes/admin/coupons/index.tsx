// app/routes/admin/coupons/index.tsx (카드 레이아웃으로 변경)

import { type LoaderFunctionArgs, redirect } from "react-router";
import { useLoaderData, Form, useSearchParams, useFetcher } from "react-router";
import { db } from "~/lib/db.server";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationNext } from "~/components/ui/pagination";
import { Search, Ticket, User, Calendar } from "lucide-react";
import { Prisma } from "@prisma/client";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Switch } from "~/components/ui/switch";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";

const COUPONS_PER_PAGE = 10;

// --- Loader 함수 (변경 없음) ---
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const status = url.searchParams.get("status");
  const page = parseInt(url.searchParams.get("page") || "1");

  const where: Prisma.CouponWhereInput = {
    AND: [
      q ? {
        OR: [
          { code: { contains: q } },
          { stampCard: { user: { name: { contains: q } } } },
        ],
      } : {},
      status === 'used' ? { isUsed: true } : {},
      status === 'not_used' ? { isUsed: false } : {},
    ],
  };

  const [coupons, totalCoupons] = await db.$transaction([
    db.coupon.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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

  const totalPages = Math.ceil(totalCoupons / COUPONS_PER_PAGE);

  return { coupons, totalCoupons, page, totalPages, q, status };
};

type CouponItem = Awaited<ReturnType<typeof loader>>["coupons"][number];

// --- Default 컴포넌트: 쿠폰 목록 UI 렌더링 (카드 형식으로 변경) ---
export default function AdminCouponsPage() {
  const { coupons, totalCoupons, page, totalPages, q, status } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  const getPageLink = (p: number) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", String(p));
    return `/admin/coupons?${newParams.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>쿠폰 관리</CardTitle>
          <CardDescription>총 {totalCoupons}개의 쿠폰이 발급되었습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* --- 검색 및 필터 UI (변경 없음) --- */}
          <Form method="get" className="flex flex-col sm:flex-row gap-2 mb-4">
            <Input name="q" placeholder="쿠폰 코드, 사용자 이름 검색..." defaultValue={q || ""} className="flex-grow" />
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
            <Button type="submit"><Search className="h-4 w-4 mr-2" /> 검색</Button>
          </Form>

          {/* --- 쿠폰 목록 카드 그리드 --- */}
          {coupons.length === 0 ? (
            <div className="text-center py-20 border-dashed border-2 rounded-lg">
                <h3 className="text-lg font-semibold">해당하는 쿠폰이 없습니다.</h3>
                <p className="text-sm text-muted-foreground mt-2">다른 검색어나 필터를 사용해보세요.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1  gap-4">
              {coupons.map((coupon) => (
                <CouponCard key={coupon.id} coupon={coupon} />
              ))}
            </div>
          )}

          {/* --- 페이지네이션 (변경 없음) --- */}
          {totalPages > 1 && (
            <Pagination className="mt-8">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious href={page > 1 ? getPageLink(page - 1) : undefined} />
                </PaginationItem>
                <PaginationItem>
                  <span className="p-2 text-sm font-medium">{page} / {totalPages}</span>
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

// --- 쿠폰 카드 컴포넌트 (신규) ---
function CouponCard({ coupon }: { coupon: CouponItem }) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== 'idle';
  
  const optimisticIsUsed = isSubmitting ? !coupon.isUsed : coupon.isUsed;
  const isExpired = new Date(coupon.expiresAt).getTime() < Date.now();

  const statusLabel = optimisticIsUsed ? "사용 완료" : isExpired ? "만료" : "미사용";
  const statusVariant = optimisticIsUsed
    ? "secondary"
    : isExpired
      ? "destructive"
      : "default";

  return (
    <Card className={`flex flex-col transition-all ${optimisticIsUsed ? 'bg-muted/50' : 'bg-background'}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
              <Ticket className="h-5 w-5 text-primary" />
              {coupon.description}
          </CardTitle>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </div>
        <CardDescription className="font-mono text-sm pt-1">{coupon.code}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow space-y-2 text-sm">
        <div className="flex items-center">
            <User className="h-4 w-4 mr-2 text-muted-foreground" />
            <span>{coupon.stampCard.user.name}</span>
        </div>
        <div className="flex items-center">
            <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
            <span>~{format(new Date(coupon.expiresAt), "yyyy.MM.dd", { locale: ko })} 까지</span>
        </div>
      </CardContent>
      <CardFooter className="border-t pt-4">
        <fetcher.Form method="post" action="/api/coupons/issue" className="w-full">
            <input type="hidden" name="intent" value="toggleCouponStatus" />
            <input type="hidden" name="couponId" value={coupon.id} />
            <div className="flex items-center justify-between w-full">
                <Label htmlFor={`coupon-switch-${coupon.id}`} className={optimisticIsUsed ? "text-muted-foreground" : ""}>사용 여부</Label>
                <Switch
                    id={`coupon-switch-${coupon.id}`}
                    checked={optimisticIsUsed}
                    onCheckedChange={() => {
                        fetcher.submit(
                            { couponId: coupon.id, intent: "toggleCouponStatus" },
                            { method: 'post', action: '/api/coupons/issue' }
                        );
                    }}
                    disabled={isSubmitting}
                    aria-label="쿠폰 사용 여부 토글"
                />
            </div>
        </fetcher.Form>
      </CardFooter>
    </Card>
  );
}
