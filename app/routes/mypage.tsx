import { Link, redirect, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { CouponTicket } from "~/components/coupon-ticket";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { db } from "~/lib/db.server";
import { getSession, hashPassword, verifyPassword } from "~/lib/auth.server";
import { commitSession, getFlashSession } from "~/lib/session.server";

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await getSession(request);
  if (!user) {
    return redirect("/login?redirectTo=/mypage");
  }

  const [profile, stampCards, coupons, recentEntries, recentCommunityPosts, mySpaces] = await db.$transaction([
    db.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        role: true,
        status: true,
        createdAt: true,
        agreedToTerms: true,
        agreedToPrivacyPolicy: true,
        agreedToMarketing: true,
        _count: {
          select: {
            eventEntries: true,
            communityPosts: true,
            memorySpaces: true,
            memoryPosts: true,
            StampCard: true,
          },
        },
      },
    }),
    db.stampCard.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        entries: {
          orderBy: { createdAt: "desc" },
          include: {
            event: {
              select: { id: true, name: true },
            },
          },
        },
        coupon: true,
      },
    }),
    db.coupon.findMany({
      where: { stampCard: { userId: user.id } },
      orderBy: { createdAt: "desc" },
      include: {
        stampCard: {
          select: {
            id: true,
          },
        },
      },
    }),
    db.stampEntry.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        event: {
          select: { id: true, name: true },
        },
      },
    }),
    db.communityPost.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        _count: {
          select: { likes: true },
        },
      },
    }),
    db.memorySpace.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        _count: {
          select: { posts: true },
        },
      },
    }),
  ]);

  if (!profile) {
    throw new Response("User not found", { status: 404 });
  }

  const activeStampCards = stampCards.filter((card) => !card.isRedeemed);
  const redeemedStampCards = stampCards.filter((card) => card.isRedeemed);
  const availableCoupons = coupons.filter((coupon) => !coupon.isUsed);
  const usedCoupons = coupons.filter((coupon) => coupon.isUsed);

  return {
    profile,
    stats: {
      activeStampCards: activeStampCards.length,
      totalStampCards: profile._count.StampCard,
      totalStamps: stampCards.reduce((sum, card) => sum + card.entries.length, 0),
      availableCoupons: availableCoupons.length,
      usedCoupons: usedCoupons.length,
      eventEntries: profile._count.eventEntries,
      communityPosts: profile._count.communityPosts,
      memorySpaces: profile._count.memorySpaces,
      memoryPosts: profile._count.memoryPosts,
    },
    activeStampCards,
    redeemedStampCards,
    availableCoupons,
    usedCoupons,
    recentEntries,
    recentCommunityPosts,
    mySpaces,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { user } = await getSession(request);
  if (!user) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  const flashSession = await getFlashSession(request.headers.get("Cookie"));

  if (intent === "updateProfile") {
    const name = (formData.get("name") as string | null)?.trim() || "";
    if (name.length < 2) {
      flashSession.flash("toast", { type: "error", message: "이름은 2자 이상 입력해 주세요." });
      return redirect("/mypage", { headers: { "Set-Cookie": await commitSession(flashSession) } });
    }

    await db.user.update({
      where: { id: user.id },
      data: { name },
    });

    flashSession.flash("toast", { type: "success", message: "내 정보가 업데이트되었습니다." });
    return redirect("/mypage", { headers: { "Set-Cookie": await commitSession(flashSession) } });
  }

  if (intent === "updatePassword") {
    const currentPassword = (formData.get("currentPassword") as string | null) || "";
    const newPassword = (formData.get("newPassword") as string | null) || "";
    const confirmPassword = (formData.get("confirmPassword") as string | null) || "";

    if (!currentPassword || !newPassword || !confirmPassword) {
      flashSession.flash("toast", { type: "error", message: "비밀번호 항목을 모두 입력해 주세요." });
      return redirect("/mypage", { headers: { "Set-Cookie": await commitSession(flashSession) } });
    }

    if (!PASSWORD_RULE.test(newPassword)) {
      flashSession.flash("toast", {
        type: "error",
        message: "새 비밀번호는 8자 이상, 영문/숫자를 포함해야 합니다.",
      });
      return redirect("/mypage", { headers: { "Set-Cookie": await commitSession(flashSession) } });
    }

    if (newPassword !== confirmPassword) {
      flashSession.flash("toast", { type: "error", message: "새 비밀번호 확인이 일치하지 않습니다." });
      return redirect("/mypage", { headers: { "Set-Cookie": await commitSession(flashSession) } });
    }

    const key = await db.key.findUnique({
      where: { id: `password:${user.phoneNumber}` },
      select: { id: true, hashedPassword: true },
    });

    if (!key?.hashedPassword) {
      flashSession.flash("toast", { type: "error", message: "비밀번호 계정 정보를 찾을 수 없습니다." });
      return redirect("/mypage", { headers: { "Set-Cookie": await commitSession(flashSession) } });
    }

    const isValidPassword = verifyPassword(key.hashedPassword, currentPassword);
    if (!isValidPassword) {
      flashSession.flash("toast", { type: "error", message: "현재 비밀번호가 올바르지 않습니다." });
      return redirect("/mypage", { headers: { "Set-Cookie": await commitSession(flashSession) } });
    }

    await db.key.update({
      where: { id: key.id },
      data: { hashedPassword: hashPassword(newPassword) },
    });

    flashSession.flash("toast", { type: "success", message: "비밀번호가 변경되었습니다." });
    return redirect("/mypage", { headers: { "Set-Cookie": await commitSession(flashSession) } });
  }

  throw new Response("Invalid intent", { status: 400 });
};

export default function MyPage() {
  const {
    profile,
    stats,
    activeStampCards,
    redeemedStampCards,
    availableCoupons,
    usedCoupons,
    recentEntries,
    recentCommunityPosts,
    mySpaces,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-24">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">내정보 보기</CardTitle>
          <CardDescription>내 정보, 스탬프/쿠폰, 활동 내역을 한 번에 확인할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{profile.role || "USER"}</Badge>
            <Badge variant={profile.status === "ACTIVE" ? "default" : "secondary"}>{profile.status}</Badge>
            <Badge variant="outline">가입일 {new Date(profile.createdAt).toLocaleDateString()}</Badge>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/card">스탬프카드 상세 보기</Link>
            </Button>
          </div>
          <div className="rounded-md border p-3 text-sm">
            <p>
              <span className="font-semibold">이름:</span> {profile.name}
            </p>
            <p>
              <span className="font-semibold">전화번호:</span> {profile.phoneNumber}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatItem label="진행중 스탬프카드" value={stats.activeStampCards} />
            <StatItem label="보유 쿠폰" value={stats.availableCoupons} />
            <StatItem label="이벤트 참여" value={stats.eventEntries} />
            <StatItem label="커뮤니티 글" value={stats.communityPosts} />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">내정보</TabsTrigger>
          <TabsTrigger value="stampCoupon">스탬프/쿠폰</TabsTrigger>
          <TabsTrigger value="settings">정보수정</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">최근 이벤트 적립 내역</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {recentEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">적립 내역이 없습니다.</p>
              ) : (
                recentEntries.map((entry) => (
                  <div key={entry.id} className="rounded-md border p-2 text-sm">
                    <p className="font-medium">{entry.event ? entry.event.name : "관리자 수동 적립"}</p>
                    <p className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">최근 커뮤니티 작성 글</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {recentCommunityPosts.length === 0 ? (
                <p className="text-sm text-muted-foreground">작성한 커뮤니티 글이 없습니다.</p>
              ) : (
                recentCommunityPosts.map((post) => (
                  <Link
                    key={post.id}
                    to={`/community/${post.id}`}
                    className="block rounded-md border p-2 transition hover:bg-muted/40"
                  >
                    <p className="font-medium line-clamp-1">{post.title}</p>
                    <p className="text-xs text-muted-foreground">
                      좋아요 {post._count.likes} · {new Date(post.createdAt).toLocaleDateString()}
                    </p>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">내가 만든 공간</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {mySpaces.length === 0 ? (
                <p className="text-sm text-muted-foreground">생성한 공간이 없습니다.</p>
              ) : (
                mySpaces.map((space) => (
                  <Link
                    key={space.id}
                    to={`/space/${space.id}`}
                    className="flex items-center justify-between rounded-md border p-2 text-sm transition hover:bg-muted/40"
                  >
                    <span className="font-medium line-clamp-1">{space.title}</span>
                    <span className="text-xs text-muted-foreground">게시글 {space._count.posts}</span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stampCoupon" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">스탬프 카드</CardTitle>
              <CardDescription>
                전체 {stats.totalStampCards}장 · 누적 스탬프 {stats.totalStamps}개
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm font-semibold">진행중 ({activeStampCards.length})</p>
                {activeStampCards.length === 0 ? (
                  <p className="rounded-md border p-2 text-sm text-muted-foreground">진행중 카드가 없습니다.</p>
                ) : (
                  activeStampCards.map((card) => (
                    <div key={card.id} className="rounded-md border p-2 text-sm">
                      <p className="font-medium">카드 #{card.id}</p>
                      <p className="text-xs text-muted-foreground">스탬프 {card.entries.length} / 10</p>
                    </div>
                  ))
                )}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold">완료 ({redeemedStampCards.length})</p>
                {redeemedStampCards.length === 0 ? (
                  <p className="rounded-md border p-2 text-sm text-muted-foreground">완료된 카드가 없습니다.</p>
                ) : (
                  redeemedStampCards.map((card) => (
                    <div key={card.id} className="rounded-md border p-2 text-sm">
                      <p className="font-medium">카드 #{card.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {card.coupon ? card.coupon.description : "쿠폰 없음"}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">쿠폰</CardTitle>
              <CardDescription>
                보유 {stats.availableCoupons}개 · 사용 {stats.usedCoupons}개
              </CardDescription>
            </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-sm font-semibold">보유 쿠폰</p>
                  {availableCoupons.length === 0 ? (
                    <p className="rounded-md border p-2 text-sm text-muted-foreground">보유 쿠폰이 없습니다.</p>
                  ) : (
                    availableCoupons.map((coupon) => (
                      <CouponTicket
                        key={coupon.id}
                        description={coupon.description}
                        expiresAt={coupon.expiresAt}
                        compact
                      />
                    ))
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-semibold">사용 쿠폰</p>
                  {usedCoupons.length === 0 ? (
                    <p className="rounded-md border p-2 text-sm text-muted-foreground">사용 쿠폰이 없습니다.</p>
                  ) : (
                    usedCoupons.map((coupon) => (
                      <CouponTicket
                        key={coupon.id}
                        description={coupon.description}
                        expiresAt={coupon.expiresAt}
                        status="used"
                        compact
                      />
                    ))
                  )}
                </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">기본 정보 수정</CardTitle>
              <CardDescription>이름을 변경할 수 있습니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <form method="post" className="space-y-3">
                <input type="hidden" name="intent" value="updateProfile" />
                <div className="space-y-1">
                  <Label htmlFor="name">이름</Label>
                  <Input id="name" name="name" defaultValue={profile.name} minLength={2} required />
                </div>
                <Button type="submit" disabled={isSubmitting}>
                  저장
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">비밀번호 변경</CardTitle>
              <CardDescription>영문/숫자를 포함해 8자 이상으로 설정하세요.</CardDescription>
            </CardHeader>
            <CardContent>
              <form method="post" className="space-y-3">
                <input type="hidden" name="intent" value="updatePassword" />
                <div className="space-y-1">
                  <Label htmlFor="currentPassword">현재 비밀번호</Label>
                  <Input id="currentPassword" name="currentPassword" type="password" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="newPassword">새 비밀번호</Label>
                  <Input id="newPassword" name="newPassword" type="password" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="confirmPassword">새 비밀번호 확인</Label>
                  <Input id="confirmPassword" name="confirmPassword" type="password" required />
                </div>
                <Button type="submit" disabled={isSubmitting}>
                  변경
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">추천 설정</CardTitle>
              <CardDescription>운영 편의와 보안을 위해 함께 관리하면 좋은 항목입니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>1. 비밀번호는 3개월 단위로 주기적으로 변경하기</p>
              <p>2. 계정 공유 금지 및 공동기기 사용 후 로그아웃하기</p>
              <p>3. 약관/개인정보/마케팅 동의 상태 주기적으로 점검하기</p>
              <div className="rounded-md border p-2">
                <p>약관 동의: {profile.agreedToTerms ? "동의" : "미동의"}</p>
                <p>개인정보 동의: {profile.agreedToPrivacyPolicy ? "동의" : "미동의"}</p>
                <p>마케팅 동의: {profile.agreedToMarketing ? "동의" : "미동의"}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
