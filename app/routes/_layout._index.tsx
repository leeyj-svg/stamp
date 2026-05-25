// app/routes/index.tsx

import { type LoaderFunctionArgs, useLoaderData, Link, redirect, useFetcher } from "react-router";
// Remix v2+에서는 json 헬퍼가 @remix-run/node 에 있습니다.
// 하지만 loader에서 객체를 직접 반환하면 Remix가 자동으로 json 응답으로 처리합니다.
// 따라서 이 파일에서 json 헬퍼를 명시적으로 import할 필요는 없습니다.
// import { json } from "@remix-run/node"; // 👈 주석 처리 또는 제거

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Award, AwardIcon, Calendar, CreditCard, Sparkles, Star, Users } from "lucide-react";

import { getSession } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { useEffect, useState } from "react";
import { StampSlot } from "~/components/stampSlot";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { getSpaceShareMeta } from "~/lib/space-meta";

const STAMPS_PER_CARD = 10;
const HOME_META_TITLE = "아이들과 교사들의 행복한 공간 tcroom";

export function meta() {
  return getSpaceShareMeta({
    origin: "https://www.tcroom.kr",
    path: "/",
    title: HOME_META_TITLE,
  });
}

// HomePage에서 로드할 데이터의 타입 정의
type HomePageLoaderData = {
  user:{id:string, name:string} | null;
  currentStampCardsCount: number;
  availableCouponsCount: number;
  totalEventEntriesCount: number;
  activeStampCard: {
    id: number;
    collectedStamps: number;
    isRedeemed: boolean;
    coupon: { /* ... */ } | null;
    entries: Array<{
      id: number;
      eventId: string | null; 
      createdAt: Date;
      event: {
        name: string;
        images: Array<{ url: string }>;
      } | null; 
      isViewed: boolean;
      adminNote: string | null; 
    }>;
  } | null;
};

// HomePage의 loader 함수
export const loader = async ({ request }: LoaderFunctionArgs): Promise<HomePageLoaderData | Response> => {
  const session = await getSession(request);
  const user = session.user; // 세션에서 userId 가져오기
if (!user) {
    return {
      user: null,
      currentStampCardsCount: 0,
      availableCouponsCount: 0,
      totalEventEntriesCount: 0,
      activeStampCard: null,
    };
  }
  // 2. 사용자가 로그인한 경우 (기존 로직과 동일)
  const currentStampCardsCount = await db.stampCard.count({
    where: { userId: user.id },
  });

  const availableCouponsCount = await db.coupon.count({
    where: { stampCard: { userId: user.id }, isUsed: false },
  });

  const distinctEventEntries = await db.stampEntry.findMany({
    where: { userId: user.id },
    select: { eventId: true },
    distinct: ['eventId'],
  });
  const totalEventEntriesCount = distinctEventEntries.length;

const latestCardData = await db.stampCard.findFirst({
    where: { userId: user.id, isRedeemed: false },
    include: {
      entries: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          eventId: true,
          createdAt: true,
          isViewed: true,
          adminNote: true, 
          event: { select: { name: true, images: { select: { url: true }, take: 1 } } }
        }
      },
      coupon: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  let activeStampCard: HomePageLoaderData["activeStampCard"] = null;
  if (latestCardData) {
    const collectedStamps = latestCardData.entries.length;
    activeStampCard = {
      id: latestCardData.id,
      collectedStamps: collectedStamps,
      isRedeemed: latestCardData.isRedeemed,
      coupon: latestCardData.coupon,
      entries: latestCardData.entries.map(entry => ({
        id: entry.id,
        eventId: entry.eventId,
        createdAt: entry.createdAt,
        event: entry.event ? { name: entry.event.name, images: entry.event.images } : null,
        isViewed: entry.isViewed,
        adminNote: entry.adminNote,
      })),
    };
  }

  // 객체를 직접 반환하여 React Router가 JSON 응답으로 처리하도록 합니다.
  return {
    currentStampCardsCount,
    availableCouponsCount,
    totalEventEntriesCount,
    activeStampCard,
    user,
  };
};


export default function HomePage() {


  // HomePage loader에서 가져온 데이터
  const {
    user,
    currentStampCardsCount,
    availableCouponsCount,
    totalEventEntriesCount,
    activeStampCard
  } = useLoaderData<HomePageLoaderData>();
  const fetcher = useFetcher(); // 이벤트 상세 정보를 로드하기 위함
  const [viewingEventId, setViewingEventId] = useState<string | null>(null);
  const [viewingAdminNote, setViewingAdminNote] = useState<string | null>(null);


useEffect(() => {
    if (viewingEventId) {
      fetcher.load(`/api/events/${viewingEventId}`); // API 라우트로 이벤트 상세 정보 요청
    }
  }, [viewingEventId]);

   const handleStampClick = (data: string | { adminNote: string | null }) => {
    if (typeof data === 'string') {
        setViewingEventId(data);
    } else {
        setViewingAdminNote(data.adminNote || '별도의 사유가 기재되지 않았습니다.');
    }
  };

   const collectedStamps = activeStampCard?.collectedStamps || 0;
  const isCardFull = collectedStamps >= STAMPS_PER_CARD;
  const cardStatusText = activeStampCard?.isRedeemed
    ? (activeStampCard.coupon ? "쿠폰 발급 완료!" : "사용 완료된 카드")
    : isCardFull
      ? "쿠폰 발급 대기 중"
      : `${STAMPS_PER_CARD - collectedStamps}개 더 모으면 쿠폰이 발급됩니다!`;
  return (
    <>
    <div className="space-y-6 p-4">
      {/* 1. 환영 메시지 및 사용자 정보 요약 */}
      {user ? (
        <Card className="bg-gradient-to-r from-[#F0FDF4] to-[#EEF7EF] border-[#D1E7DD] shadow-sm"> {/* 로고의 연한 초록 계열 */}
          <CardHeader className="pb-3">
            <CardTitle className="text-2xl font-bold text-gray-800">
              어서오세요, {user.name}님!
            </CardTitle>
            <CardDescription className="text-sm text-gray-600">
              오늘의 스탬프 활동을 확인해보세요.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2 text-center"> {/* 간격 조정: gap-2 -> gap-4 */}
            <div className="flex flex-col items-center p-2">
              <CreditCard size={28} className="text-[#81C784] mb-1" /> {/* 로고 메인 초록 */}
              <span className="text-lg font-semibold text-gray-900">{currentStampCardsCount}</span>
              <span className="text-xs text-muted-foreground">진행 중인 카드</span>
            </div>
            <div className="flex flex-col items-center p-2">
              <Award size={28} className="text-[#FFB74D] mb-1" /> {/* 로고 주황 */}
              <span className="text-lg font-semibold text-gray-900">{availableCouponsCount}</span>
              <span className="text-xs text-muted-foreground">사용 가능 쿠폰</span>
            </div>
            <div className="flex flex-col items-center p-2">
              <Sparkles size={28} className="text-[#4FC3F7] mb-1" /> {/* 로고 파랑 */}
              <span className="text-lg font-semibold text-gray-900">{totalEventEntriesCount}</span>
              <span className="text-xs text-muted-foreground">참여 이벤트</span>
            </div>
          </CardContent>
          <div className="px-6 pb-4 pt-2">
            <Link to="/events">
              <Button className="w-full bg-[#81C784] hover:bg-[#66BB6A] text-white">참여한 이벤트 확인하기</Button> {/* 로고 메인 초록 버튼 */}
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="text-center p-8 bg-gradient-to-r from-[#F0FDF4] to-[#EEF7EF] border-[#D1E7DD] shadow-md"> {/* 로고 연한 초록 계열 */}
          <CardTitle className="text-2xl font-bold mb-2 text-gray-800">
            스탬프 앱에 오신 것을 환영합니다!
          </CardTitle>
          <CardDescription className="text-gray-600 mb-6">
            다양한 이벤트에 참여하고 스탬프를 모아 특별한 혜택을 받으세요.
          </CardDescription>
          <Link to="/login">
            <Button size="lg" className="bg-[#FFB74D] hover:bg-[#FFA726] text-white">로그인하고 시작하기</Button> {/* 로고 주황 버튼 */}
          </Link>
        </Card>
      )}

      {/* 2. 진행 중인 스탬프 카드 */}
       <section className="mt-8">
         
          {activeStampCard ? (
            <Card className={`p-6 ${activeStampCard.isRedeemed ? 'bg-gray-50 border-gray-200' : 'bg-white border-[#81C784] shadow-lg'}`}> {/* 진행 중 카드 테두리 로고 초록 */}
              <CardHeader className="text-center pb-2">
                
                {/* CardDescription은 아래로 이동 */}
              </CardHeader>
              <CardContent>
                {/* --- 스탬프 카드 UI --- */}
                <div className="grid grid-cols-5 gap-3 p-3 border-dashed border-2 rounded-lg bg-[#F9FAFB] border-[#D1E7DD]"> {/* 스탬프 슬롯 배경/테두리 로고 연한 초록 */}
                  {activeStampCard.entries.map((stamp) => (
                    <StampSlot key={stamp.id} stamp={stamp} onStampClick={handleStampClick} />
                  ))}
                  {Array.from({ length: STAMPS_PER_CARD - collectedStamps }).map((_, index) => (
                    <div key={`empty-${activeStampCard.id}-${index}`} className="aspect-square w-full rounded-full border-2 border-dashed bg-muted/20 border-gray-300" />
                  ))}
                </div>
           
                {/* --- 보상 정보 (쿠폰 발급 버튼은 /card 페이지에만) --- */}
                <div className="mt-8 text-center">
                  <CardDescription className={`text-sm ${activeStampCard.isRedeemed ? 'text-gray-500' : 'text-[#81C784]'}`}> {/* 스탬프 카드 상태 텍스트 로고 메인 초록 */}
                    {cardStatusText}
                  </CardDescription>
                 
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="p-6 text-center text-muted-foreground border-dashed border-2 border-[#D1E7DD]"> {/* 로고 연한 초록 테두리 */}
              <p className="text-base">아직 진행 중인 스탬프 카드가 없습니다.</p>
              <Link to="/events" className="mt-4 inline-block">
                <Button variant="secondary" className="bg-[#FFB74D] hover:bg-[#FFA726] text-white">새로운 이벤트 찾아보기</Button> {/* 로고 주황 버튼 */}
              </Link>
            </Card>
          )}
        </section>
      </div>

       {/* --- 이벤트 상세 정보 다이얼로그 --- */}
      <Dialog open={!!viewingEventId} onOpenChange={(isOpen) => { if (!isOpen) setViewingEventId(null); }}>
        <DialogContent className="sm:max-w-[425px]">
          {fetcher.state === 'loading' || !fetcher.data ? (
            <DialogHeader>
              <DialogTitle>이벤트 정보를 불러오는 중...</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground pt-2"></DialogDescription>
            </DialogHeader>
          ) : (
            <>
             
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold text-gray-800">{fetcher.data.event.name}</DialogTitle>
   {fetcher.data.event.images && fetcher.data.event.images.length > 0 && (
                <img src={fetcher.data.event.images[0].url} alt={fetcher.data.event.name} className="w-full h-48 object-cover rounded-md mb-4" />
              )}
                <DialogDescription className="text-sm text-gray-600 pt-2 whitespace-pre-wrap text-left">
                  {fetcher.data.event.description || "이벤트 설명이 없습니다."}
                </DialogDescription>
              </DialogHeader>
               {/* 이미지를 DialogHeader 바깥으로 이동 */}
           
              {/* Badge와 Rating 정보를 DialogHeader와 DialogDescription 사이에 위치 */}
              <div className="flex justify-between items-center mt-4"> {/* 여백 추가 */}
                <Badge variant="outline" className="w-fit border-[#81C784] text-[#81C784]">
                  {fetcher.data.event.category.name}
                </Badge>
                {fetcher.data.event.averageRating !== null && fetcher.data.event.reviewCount > 0 && (
                  <div className="flex items-center text-sm">
                    <Star className="h-4 w-4 mr-1 text-[#FFD700] fill-[#FFD700]"/>
                    <span className="font-bold text-slate-700">{fetcher.data.event.averageRating.toFixed(1)}</span>
                    <span className="ml-1 text-muted-foreground">({fetcher.data.event.reviewCount})</span>
                  </div>
                )}
              </div>

              <div className="space-y-2 mt-4 text-sm text-gray-700">
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-2 text-[#81C784]" />
                  {new Date(fetcher.data.event.startDate).toLocaleDateString()} ~ {new Date(fetcher.data.event.endDate).toLocaleDateString()}
                </div>
                <div className="flex items-center">
                  <Users className="h-4 w-4 mr-2 text-[#4FC3F7]" />
                  총 {fetcher.data.event._count.participants}명 참여
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button asChild className="bg-[#FFB74D] hover:bg-[#FFA726] text-white">
                  <Link to={`/events/${fetcher.data.event.id}`}>상세 페이지로 이동</Link>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
 <Dialog open={!!viewingAdminNote} onOpenChange={(isOpen) => { if (!isOpen) setViewingAdminNote(null); }}>
        <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <AwardIcon className="h-6 w-6 text-primary" />
                    관리자 발급 스탬프
                </DialogTitle>
                <DialogDescription className="pt-4 text-base text-foreground">
                    {viewingAdminNote}
                </DialogDescription>
            </DialogHeader>
            <DialogFooter>
                <Button onClick={() => setViewingAdminNote(null)}>확인</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    </>
  );
}
