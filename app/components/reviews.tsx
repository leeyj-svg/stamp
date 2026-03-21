import { useFetcher } from "react-router";
import { useState } from "react";
import { Star, MessageSquare } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { format } from "date-fns";

type ReviewItem = {
  id: number;
  rating: number;
  comment: string | null;
  createdAt: string | Date;
  user: {
    name: string;
  };
};

// 별점 표시 컴포넌트
function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`h-5 w-5 ${rating >= star ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`}
        />
      ))}
    </div>
  );
}

// 리뷰 목록을 보여주는 컴포넌트
export function ReviewList({ reviews }: { reviews: ReviewItem[] }) {
  if (reviews.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <MessageSquare className="mx-auto h-8 w-8 mb-2"/>
        <p>아직 작성된 리뷰가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reviews.map(review => (
        <Card key={review.id}>
          <CardHeader className="flex-row justify-between items-center pb-2">
            <div className="flex items-center gap-4">
              <span className="font-semibold">{review.user.name}</span>
              <StarRating rating={review.rating} />
            </div>
            <span className="text-xs text-muted-foreground">
              {format(new Date(review.createdAt), 'yyyy.MM.dd')}
            </span>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{review.comment}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// 리뷰 작성 폼 컴포넌트
export function ReviewForm({ eventId }: { eventId: string }) {
  const fetcher = useFetcher<{ error?: string }>();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const isSubmitting = fetcher.state !== 'idle';

  return (
    <fetcher.Form method="post" action="/api/events/reviews" className="p-4 border rounded-lg mt-6">
      <input type="hidden" name="intent" value="CREATE" />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="rating" value={rating} />
      
      <h3 className="text-lg font-semibold mb-2">리뷰 작성하기</h3>
      <div className="mb-4">
        <p className="text-sm font-medium mb-2">별점을 매겨주세요</p>
        <div className="flex items-center">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              type="button"
              key={star}
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
            >
              <Star className={`h-8 w-8 cursor-pointer ${
                (hoverRating || rating) >= star 
                ? 'text-yellow-400 fill-yellow-400' 
                : 'text-gray-300'
              }`} />
            </button>
          ))}
        </div>
      </div>
      <Textarea name="comment" placeholder="이벤트는 어떠셨나요? 경험을 공유해주세요." rows={4} />
      <Button type="submit" disabled={isSubmitting || rating === 0} className="mt-4">
        {isSubmitting ? "등록 중..." : "리뷰 등록하기"}
      </Button>
      {fetcher.data?.error && <p className="text-red-500 text-sm mt-2">{fetcher.data.error}</p>}
    </fetcher.Form>
  );
}
