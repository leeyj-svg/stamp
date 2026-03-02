import {
  Form,
  Link,
  useFetcher,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "~/components/ui/carousel";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Textarea } from "~/components/ui/textarea";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { format, intervalToDuration } from "date-fns";
import { ko } from "date-fns/locale";
import { Calendar, ChevronDown, Edit, Heart, Send, Star, Trash2, Users } from "lucide-react";
import { DialogDescription, DialogTitle } from "@radix-ui/react-dialog";
import { useState } from "react";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "MEMBER");
  const eventId = params.id;
  if (!eventId) {
    throw new Response("Event not found", { status: 404 });
  }

  const event = await db.event.findUnique({
    where: { id: eventId },
    include: {
      images: true,
      category: true,
      reviews: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
      participants: {
        select: {
          user: {
            select: { id: true, name: true, status: true },
          },
        },
        orderBy: { user: { name: "asc" } },
      },
      _count: { select: { participants: true, claimableStamps: true, likes: true } },
    },
  });

  if (!event) {
    throw new Response("Event not found", { status: 404 });
  }

  const participation = await db.stampEntry.findFirst({
    where: { eventId, userId: user.id },
  });
  const isParticipant = Boolean(participation);
  const isAdmin = user.role === "ADMIN";
  if (!isParticipant && !isAdmin) {
    throw new Response("참여자만 접근할 수 있는 이벤트입니다.", { status: 403 });
  }
  const hasReviewed = event.reviews.some((review) => review.user.id === user.id);
  const isLiked = Boolean(
    await db.eventLike.findUnique({
      where: { eventId_userId: { eventId, userId: user.id } },
      select: { eventId: true },
    })
  );

  return { event, isParticipant, hasReviewed, currentUserId: user.id, isLiked };
};

export default function EventDetailPage() {
  const { event, isParticipant, hasReviewed, currentUserId, isLiked } = useLoaderData<typeof loader>();
  const likeFetcher = useFetcher();
  const [showParticipants, setShowParticipants] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  const totalParticipants = event._count.participants;
  const startDate = new Date(event.startDate);
  const endDate = new Date(event.endDate);
  const duration = intervalToDuration({ start: startDate, end: endDate });
  const durationString = Object.entries(duration)
    .filter(([unit, value]) => value && ["years", "months", "days", "hours", "minutes"].includes(unit))
    .map(([unit, value]) => `${value}${{ years: "년", months: "개월", days: "일", hours: "시간", minutes: "분" }[unit]}`)
    .join(" ");

  const liked = likeFetcher.state !== "idle" ? !isLiked : isLiked;
  const likeCount =
    (event._count.likes ?? 0) + (likeFetcher.state !== "idle" ? (isLiked ? -1 : 1) : 0);

  const confirmedParticipants = event.participants.map((participant) => participant.user);

  return (
    <>
      <div className="container mx-auto max-w-4xl py-3 space-y-6">
        <Card>
          {event.images.length > 0 && (
            <Carousel className="w-full max-w-4xl mx-auto rounded-t-lg overflow-hidden">
              <CarouselContent>
                {event.images.map((image) => (
                  <CarouselItem key={image.id}>
                    <button
                      type="button"
                      className="w-full aspect-video bg-muted block cursor-zoom-in"
                      onClick={() => setViewingImage(image.url)}
                    >
                      <img src={image.url} alt={event.name} className="w-full h-full object-cover" />
                    </button>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious className="left-4" />
              <CarouselNext className="right-4" />
            </Carousel>
          )}

          <CardHeader>
            <Badge variant="outline" className="w-fit mb-2 border-[#81C784] text-[#81C784] bg-[#F0FDF4]">
              {event.category.name}
            </Badge>
            <CardTitle className="text-4xl font-extrabold">{event.name}</CardTitle>
            <CardDescription className="text-lg text-gray-600 pt-2">
              {event.description || "이벤트 설명이 없습니다."}
            </CardDescription>

            <likeFetcher.Form method="post" action={`/api/events/${event.id}/like`} className="pt-4">
              <Button type="submit" variant={liked ? "default" : "outline"} className="gap-2">
                <Heart className={`h-4 w-4 ${liked ? "fill-current" : ""}`} />
                좋아요 {likeCount}
              </Button>
            </likeFetcher.Form>
          </CardHeader>

          <CardContent className="space-y-4">
            <Separator />
            <div className="grid gap-2 text-sm">
              <div className="flex items-center">
                <Calendar className="h-4 w-4 mr-2 text-[#81C784]" />
                <strong>기간:</strong>
                <span className="ml-2">
                  {format(startDate, "yyyy.MM.dd", { locale: ko })} ~ {format(endDate, "yyyy.MM.dd", { locale: ko })}
                </span>
              </div>

              {durationString && (
                <div className="flex items-center">
                  <span className="ml-6 text-muted-foreground text-xs">총 {durationString} 진행</span>
                </div>
              )}

              <div>
                <button
                  className="flex items-center w-full text-left hover:bg-muted/50 p-1 rounded-md transition-colors"
                  onClick={() => setShowParticipants((prev) => !prev)}
                >
                  <Users className="h-4 w-4 mr-2 text-[#4FC3F7]" />
                  <strong>총 참가자</strong>
                  <span className="ml-2">{totalParticipants}명</span>
                  <ChevronDown
                    className={`h-4 w-4 ml-auto text-muted-foreground transition-transform duration-200 ${
                      showParticipants ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {showParticipants && (
                  <div className="mt-2 pl-4 border-l-2 ml-3">
                    <ul className="space-y-3 pt-2">
                      {confirmedParticipants.map((participant) => (
                        <li key={participant.id} className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage
                              src={`https://api.dicebear.com/7.x/initials/svg?seed=${participant.name}`}
                            />
                            <AvatarFallback>{participant.name.slice(0, 1)}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-sm">{participant.name}</span>
                          {participant.status === "TEMPORARY" && <Badge variant="outline">임시</Badge>}
                        </li>
                      ))}

                      {totalParticipants === 0 && (
                        <li className="text-sm text-muted-foreground">아직 등록된 참가자가 없습니다.</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>리뷰 ({event.reviews.length}개)</CardTitle>
          </CardHeader>
          <CardContent>
            {isParticipant && !hasReviewed && <ReviewForm eventId={event.id} />}

            {event.reviews.length === 0 ? (
              <p className="text-gray-500 text-center py-4">아직 이 이벤트에 대한 리뷰가 없습니다.</p>
            ) : (
              <div className="space-y-6 pt-4">
                {event.reviews.map((review) => (
                  <ReviewItem
                    key={review.id}
                    review={review}
                    currentUserId={currentUserId}
                    eventId={event.id}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-center w-full">
          <Button
            asChild
            variant="outline"
            className="w-full max-w-sm border-2 border-[#81C784] text-[#81C784] hover:bg-[#E8F5E9] hover:text-[#4CAF50] font-semibold"
          >
            <Link to="/events">전체 목록으로</Link>
          </Button>
        </div>
      </div>

      <Dialog open={Boolean(viewingImage)} onOpenChange={(isOpen) => !isOpen && setViewingImage(null)}>
        <DialogTitle />
        <DialogDescription />
        <DialogContent className="max-w-4xl p-2">
          {viewingImage && (
            <img src={viewingImage} alt="Event" className="w-full h-auto max-h-[85vh] object-contain rounded-md" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReviewItem({ review, currentUserId, eventId }: { review: any; currentUserId: string; eventId: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const isMyReview = review.user.id === currentUserId;

  return (
    <div className="p-4 border rounded-lg bg-gray-50">
      {isEditing ? (
        <ReviewForm
          eventId={eventId}
          intent="UPDATE"
          existingReview={review}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <>
          <div className="flex items-center mb-2">
            <Avatar className="h-8 w-8 mr-3">
              <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${review.user.name}`} />
              <AvatarFallback>{review.user.name.slice(0, 2)}</AvatarFallback>
            </Avatar>
            <span className="font-semibold">{review.user.name}</span>
            <span className="ml-auto text-sm text-gray-500">
              {format(new Date(review.createdAt), "yyyy.MM.dd", { locale: ko })}
            </span>
            {isMyReview && (
              <div className="ml-2 flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsEditing(true)}
                  className="text-[#66BB6A] hover:bg-[#E8F5E9]"
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <DeleteMyReviewDialog reviewId={review.id} eventId={eventId} />
              </div>
            )}
          </div>

          <div className="flex items-center mb-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Star
                key={index}
                className={`h-4 w-4 ${index < review.rating ? "text-yellow-400 fill-yellow-400" : "text-gray-300"}`}
              />
            ))}
          </div>

          <p className="text-gray-800">{review.comment}</p>
        </>
      )}
    </div>
  );
}

function ReviewForm({
  eventId,
  intent = "CREATE",
  existingReview,
  onCancel,
}: {
  eventId: string;
  intent?: "CREATE" | "UPDATE";
  existingReview?: any;
  onCancel?: () => void;
}) {
  const [rating, setRating] = useState(existingReview?.rating || 0);
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state === "submitting";

  return (
    <fetcher.Form method="post" action="/api/events/reviews" className="p-4 border rounded-lg mb-6 space-y-4 bg-background">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="eventId" value={eventId} />
      {intent === "UPDATE" && <input type="hidden" name="reviewId" value={existingReview.id} />}

      <div>
        <Label className="font-semibold">별점</Label>
        <div className="flex items-center mt-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button key={star} type="button" onClick={() => setRating(star)}>
              <Star
                className={`h-6 w-6 cursor-pointer ${star <= rating ? "text-yellow-400 fill-yellow-400" : "text-gray-300"}`}
              />
            </button>
          ))}
          <input type="hidden" name="rating" value={rating} />
        </div>
      </div>

      <div>
        <Label htmlFor="comment" className="font-semibold">
          코멘트
        </Label>
        <Textarea id="comment" name="comment" defaultValue={existingReview?.comment || ""} required className="mt-2" />
      </div>

      <div className="flex justify-end gap-2">
        {intent === "UPDATE" && (
          <Button type="button" variant="ghost" onClick={onCancel} className="text-gray-600 hover:bg-gray-100">
            취소
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting || rating === 0} className="bg-[#81C784] hover:bg-[#66BB6A] text-white">
          <Send className="h-4 w-4 mr-2" />
          {isSubmitting ? "저장 중..." : intent === "CREATE" ? "리뷰 등록" : "리뷰 수정"}
        </Button>
      </div>
    </fetcher.Form>
  );
}

function DeleteMyReviewDialog({ reviewId, eventId }: { reviewId: number; eventId: string }) {
  const fetcher = useFetcher();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <fetcher.Form method="post" action="/api/events/reviews">
          <input type="hidden" name="intent" value="DELETE" />
          <input type="hidden" name="reviewId" value={reviewId} />
          <input type="hidden" name="eventId" value={eventId} />
          <AlertDialogHeader>
            <AlertDialogTitle>정말 리뷰를 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>이 작업은 되돌릴 수 없습니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button type="submit" variant="destructive">
                삭제
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}


