import { Link, useFetcher, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { format } from "date-fns";
import { Calendar, Copy, Edit, QrCode, Star, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

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
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "~/components/ui/carousel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { Separator } from "~/components/ui/separator";
import { assertCategoryAccess, requireAdminAccessScope } from "~/lib/admin-access.server";
import { db } from "~/lib/db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const scope = await requireAdminAccessScope(request);
  const eventId = params.eventId;

  if (!eventId) {
    throw new Response("Event not found", { status: 404 });
  }

  const event = await db.event.findUnique({
    where: { id: eventId },
    include: {
      images: true,
      category: true,
      participants: { include: { user: true } },
      claimableStamps: {
        include: {
          redemptions: {
            include: { user: { select: { name: true } } },
            orderBy: { redeemedAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      reviews: {
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!event) {
    throw new Response("Event not found", { status: 404 });
  }

  assertCategoryAccess(scope, event.categoryId);

  return {
    event,
    appUrl: process.env.APP_URL || "http://localhost:5173",
  };
};

type ClaimableStamp = Awaited<ReturnType<typeof loader>>["event"]["claimableStamps"][number];

export default function EventDetailsPage() {
  const { event, appUrl } = useLoaderData<typeof loader>();
  const totalParticipants = (event.participants?.length || 0) + (event.claimableStamps?.length || 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" asChild>
          <Link to="/admin/events">목록으로 돌아가기</Link>
        </Button>
        <Button asChild>
          <Link to={`/admin/events/${event.id}/edit`}>
            <Edit className="mr-2 h-4 w-4" />
            수정하기
          </Link>
        </Button>
      </div>

      <Card>
        {event.images.length > 0 && (
          <Carousel className="mx-auto w-full max-w-4xl p-4">
            <CarouselContent>
              {event.images.map((image) => (
                <CarouselItem key={image.id}>
                  <div className="p-1">
                    <Card>
                      <CardContent className="flex aspect-video items-center justify-center overflow-hidden rounded-lg p-0">
                        <img src={image.url} alt={event.name} className="h-full w-full object-contain" />
                      </CardContent>
                    </Card>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
          </Carousel>
        )}

        <CardHeader>
          <Badge variant="outline" className="mb-2 w-fit">
            {event.category.name}
          </Badge>
          <CardTitle className="text-3xl">{event.name}</CardTitle>
          <CardDescription>{event.description || "이벤트 설명이 없습니다."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Separator />
          <div className="grid gap-2 text-sm">
            <div className="flex items-center">
              <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
              <strong>기간:</strong>
              <span className="ml-2">
                {format(new Date(event.startDate), "yyyy.MM.dd")} ~ {format(new Date(event.endDate), "yyyy.MM.dd")}
              </span>
            </div>
            <div className="flex items-center">
              <Users className="mr-2 h-4 w-4 text-muted-foreground" />
              <strong>총 참여자:</strong>
              <span className="ml-2">{totalParticipants}명</span>
            </div>
          </div>
          <Separator />

          <div>
            <h3 className="mb-2 font-semibold">등록된 참여자 ({event.participants.length}명)</h3>
            <div className="flex flex-wrap gap-2">
              {event.participants.map((participant) => (
                <Badge key={participant.user.id} variant="secondary">
                  {participant.user.name} ({participant.user.phoneNumber})
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>이벤트 리뷰 관리</CardTitle>
          <CardDescription>총 {event.reviews.length}개의 리뷰가 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {event.reviews.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">작성된 리뷰가 없습니다.</p>
            ) : (
              event.reviews.map((review) => (
                <div key={review.id} className="flex items-start justify-between rounded-lg border p-3">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-4">
                      <span className="font-semibold">{review.user.name}</span>
                      <div className="flex items-center">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={`h-4 w-4 ${
                              review.rating >= star ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{review.comment}</p>
                    <p className="pt-1 text-xs text-muted-foreground">
                      {format(new Date(review.createdAt), "yyyy.MM.dd HH:mm")}
                    </p>
                  </div>
                  <DeleteReviewDialog reviewId={review.id} />
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>스탬프 코드 관리</CardTitle>
          <CardDescription>
            총 {event.claimableStamps.length}개의 스탬프 코드가 발급되었습니다.
            {event.claimableStamps.some((stamp) => stamp.maxUses === null || stamp.maxUses > 1) && (
              <span className="ml-2 text-primary">(일부 코드는 여러 번 사용할 수 있습니다.)</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {event.claimableStamps.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">발급된 스탬프 코드가 없습니다.</p>
            ) : (
              event.claimableStamps.map((stamp) => (
                <ClaimableStampItem key={stamp.id} stamp={stamp} appUrl={appUrl} />
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ClaimableStampItem({ stamp, appUrl }: { stamp: ClaimableStamp; appUrl: string }) {
  const claimUrl = `${appUrl}/claim?code=${stamp.claimCode}`;
  const [isQrDialogOpen, setIsQrDialogOpen] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(claimUrl);
    toast.success("클레임 URL이 클립보드에 복사되었습니다.", {
      action: {
        label: "QR 보기",
        onClick: () => setIsQrDialogOpen(true),
      },
    });
  };

  const isUnlimited = stamp.maxUses === null;
  const usageStatus = isUnlimited ? "무제한 사용" : `${stamp.currentUses} / ${stamp.maxUses ?? 0} 사용`;
  const isUsedUp = !isUnlimited && stamp.currentUses >= (stamp.maxUses ?? Number.MAX_SAFE_INTEGER);
  const isExpired = new Date(stamp.expiresAt) < new Date();

  return (
    <div
      className={`flex flex-col items-start justify-between rounded-lg border p-3 sm:flex-row sm:items-center ${
        isUsedUp || isExpired ? "border-gray-200 bg-gray-50 text-gray-500" : "border-blue-200 bg-white"
      }`}
    >
      <div className="mb-2 flex items-center gap-4 sm:mb-0">
        <Dialog open={isQrDialogOpen} onOpenChange={setIsQrDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" disabled={isExpired}>
              <QrCode className="h-5 w-5" />
            </Button>
          </DialogTrigger>
          <DialogContent className="flex flex-col items-center p-6 sm:max-w-[280px]">
            <DialogHeader className="w-full text-center">
              <DialogTitle className="pb-2 text-lg font-bold">스탬프 적립 QR 코드</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                QR 코드를 스캔하여 스탬프를 적립하세요.
              </DialogDescription>
            </DialogHeader>
            <div className="my-4">
              <QRCodeSVG value={claimUrl} size={200} level="H" includeMargin />
            </div>
            <p className="pt-2 text-center font-mono text-sm">Code: {stamp.claimCode}</p>
          </DialogContent>
        </Dialog>
        <div>
          <p className="font-mono text-base font-semibold">{stamp.claimCode}</p>
          <p className="text-xs text-muted-foreground">
            유효기간: {format(new Date(stamp.expiresAt), "yyyy.MM.dd HH:mm")}
            {isExpired && (
              <Badge className="ml-2" variant="destructive">
                만료됨
              </Badge>
            )}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
        <Badge variant={isUsedUp ? "destructive" : "secondary"}>{usageStatus}</Badge>
        <Button variant="outline" size="icon" onClick={copyToClipboard} disabled={isExpired}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function DeleteReviewDialog({ reviewId }: { reviewId: number }) {
  const fetcher = useFetcher();
  const isDeleting = fetcher.state !== "idle";

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="flex-shrink-0">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <fetcher.Form method="post" action="/api/events/reviews">
          <input type="hidden" name="intent" value="DELETE" />
          <input type="hidden" name="reviewId" value={reviewId} />
          <AlertDialogHeader>
            <AlertDialogTitle>정말 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              이 리뷰는 영구 삭제되며 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>취소</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={isDeleting}>
              {isDeleting ? "삭제 중..." : "삭제"}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
