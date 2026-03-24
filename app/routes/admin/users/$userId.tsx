import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import { type Event as PrismaEvent, type Role, type UserStatus } from "@prisma/client";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import {
  Activity,
  ArrowLeft,
  AwardIcon,
  Calendar,
  Edit,
  Phone,
  PlusCircle,
  Save,
  Search as SearchIcon,
  Stamp,
  Ticket,
  Trash2,
  User,
} from "lucide-react";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "~/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { commitSession, getFlashSession } from "~/lib/session.server";
import { STAMPS_PER_CARD, ensureCouponForCompletedStampCard } from "~/lib/stamp-coupon.server";
import { sendCouponIssuedAlimtalk, sendStampProgressAlimtalk } from "~/lib/stamp-notification.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await getSessionWithPermission(request, "ADMIN");
  const userId = params.userId;
  if (!userId) throw new Response("User ID is required", { status: 400 });

  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      StampCard: {
        orderBy: { createdAt: "desc" },
        include: { coupon: true, _count: { select: { entries: true } } },
      },
      eventEntries: {
        orderBy: { createdAt: "desc" },
        include: { event: { select: { id: true, name: true } } },
      },
      reviews: {
        orderBy: { createdAt: "desc" },
        include: { event: { select: { id: true, name: true } } },
      },
    },
  });

  if (!user) throw new Response("User not found", { status: 404 });

  const formattedUser = {
    ...user,
    createdAtFormatted: format(new Date(user.createdAt), "yyyy.MM.dd", { locale: ko }),
    StampCard: user.StampCard.map((card) => ({
      ...card,
      createdAtFormatted: format(new Date(card.createdAt), "yyyy.MM.dd"),
      coupon: card.coupon
        ? {
            ...card.coupon,
            createdAtFormatted: format(new Date(card.coupon.createdAt), "yyyy.MM.dd"),
          }
        : null,
    })),
    eventEntries: user.eventEntries.map((entry) => ({
      ...entry,
      createdAtFormatted: format(new Date(entry.createdAt), "yyyy.MM.dd"),
    })),
  };

  const stampActivities = user.eventEntries.map((entry) => ({
    type: "스탬프 적립" as const,
    date: format(new Date(entry.createdAt), "yyyy.MM.dd HH:mm"),
    description: entry.event ? `'${entry.event.name}' 스탬프 적립` : `관리자 수기 적립: ${entry.adminNote || ""}`,
    link: entry.event ? `/admin/events/${entry.event.id}` : `/admin/users/${userId}`,
  }));

  const reviewActivities = user.reviews.map((review) => ({
    type: "리뷰 작성" as const,
    date: format(new Date(review.createdAt), "yyyy.MM.dd HH:mm"),
    description: `'${review.event.name}' 리뷰 작성 ${review.rating}점 평점 등록`,
    link: `/admin/events/${review.event.id}`,
  }));

  const couponActivities = user.StampCard.filter((card) => card.coupon).map((card) => ({
    type: "쿠폰 발급" as const,
    date: format(new Date(card.coupon!.createdAt), "yyyy.MM.dd HH:mm"),
    description: `스탬프 카드 쿠폰이 발급됨 (${card.coupon!.code})`,
    link: "/admin/coupons",
  }));

  const allActivities = [...stampActivities, ...reviewActivities, ...couponActivities].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return { user: formattedUser, activities: allActivities };
};

type LoaderData = Awaited<ReturnType<typeof loader>>;
type EventEntryItem = LoaderData["user"]["eventEntries"][number];
type ActivityItem = LoaderData["activities"][number];
type StampCardItem = LoaderData["user"]["StampCard"][number];

function getErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error && error.message ? error.message : fallbackMessage;
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await getSessionWithPermission(request, "ADMIN");
  const userId = params.userId;
  if (!userId) throw new Response("User not found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");
  const flashSession = await getFlashSession(request.headers.get("Cookie"));

  if (intent === "updateUser") {
    const name = formData.get("name") as string;
    const role = formData.get("role") as Role;
    const status = formData.get("status") as UserStatus;

    if (!name || name.length < 2) {
      flashSession.flash("toast", { type: "error", message: "이름은 2자 이상이어야 합니다." });
    } else {
      try {
        await db.user.update({ where: { id: userId }, data: { name, role, status } });
        flashSession.flash("toast", { type: "success", message: "사용자 정보가 성공적으로 수정되었습니다." });
      } catch {
        flashSession.flash("toast", { type: "error", message: "사용자 정보 수정에 실패했습니다." });
      }
    }

    return redirect(`/admin/users/${userId}`, {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  if (intent === "deleteStampCard") {
    const stampCardId = Number(formData.get("stampCardId"));
    if (!stampCardId) {
      throw new Response("Stamp Card ID is required", { status: 400 });
    }

    try {
      const cardToDelete = await db.stampCard.findUnique({
        where: { id: stampCardId },
        include: { coupon: true },
      });

      if (cardToDelete?.coupon) {
        throw new Error("쿠폰이 발급된 스탬프 카드는 삭제할 수 없습니다.");
      }

      await db.$transaction([
        db.stampEntry.deleteMany({ where: { stampCardId } }),
        db.stampCard.delete({ where: { id: stampCardId } }),
      ]);

      flashSession.flash("toast", { type: "success", message: "스탬프 카드가 성공적으로 삭제되었습니다." });
    } catch (error) {
      flashSession.flash("toast", {
        type: "error",
        message: getErrorMessage(error, "스탬프 카드 삭제 중 오류가 발생했습니다."),
      });
    }

    return redirect(`/admin/users/${userId}`, {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  if (intent === "issueStampCardCoupon") {
    const stampCardId = Number(formData.get("stampCardId"));

    if (!stampCardId) {
      flashSession.flash("toast", { type: "error", message: "스탬프 카드가 올바르지 않습니다." });
      return redirect(`/admin/users/${userId}`, {
        headers: { "Set-Cookie": await commitSession(flashSession) },
      });
    }

    try {
      const adminTargetUser = await db.user.findUnique({
        where: { id: userId },
        select: { name: true, phoneNumber: true },
      });

      const coupon = await db.$transaction(async (prisma) => {
        const stampCard = await prisma.stampCard.findUnique({
          where: { id: stampCardId },
          select: {
            id: true,
            userId: true,
            coupon: { select: { id: true } },
            _count: { select: { entries: true } },
          },
        });

        if (!stampCard || stampCard.userId !== userId) {
          throw new Error("스탬프 카드를 찾을 수 없습니다.");
        }

        if (stampCard.coupon) {
          throw new Error("이미 쿠폰이 발급된 카드입니다.");
        }

        if (stampCard._count.entries < STAMPS_PER_CARD) {
          throw new Error(`스탬프 ${STAMPS_PER_CARD}개를 모두 모아야 쿠폰을 발급할 수 있습니다.`);
        }

        const issuedCoupon = await ensureCouponForCompletedStampCard(prisma, {
          stampCardId,
          userId,
        });

        if (!issuedCoupon) {
          throw new Error("쿠폰을 발급할 수 없습니다.");
        }

        return issuedCoupon;
      });

      if (adminTargetUser?.name && adminTargetUser.phoneNumber) {
        await sendCouponIssuedAlimtalk({
          phoneNumber: adminTargetUser.phoneNumber,
          customerName: adminTargetUser.name,
          description: coupon.description,
          expiresAt: coupon.expiresAt,
          appUrl: process.env.APP_URL ?? new URL(request.url).origin,
        });
        flashSession.flash("toast", { type: "success", message: "쿠폰을 발급하고 알림톡도 보냈습니다." });
      } else {
        flashSession.flash("toast", { type: "success", message: "쿠폰을 발급했습니다." });
      }
    } catch (error) {
      flashSession.flash("toast", {
        type: "error",
        message: getErrorMessage(error, "쿠폰 발급 중 오류가 발생했습니다."),
      });
    }

    return redirect(`/admin/users/${userId}`, {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  if (intent === "addStamp") {
    const eventId = formData.get("eventId") as string;
    if (!eventId) {
      flashSession.flash("toast", { type: "error", message: "이벤트를 선택해 주세요." });
    } else {
      try {
        const stampNotification = await db.$transaction(async (prisma) => {
          const [userRecord, eventRecord] = await Promise.all([
            prisma.user.findUnique({
              where: { id: userId },
              select: { name: true, phoneNumber: true },
            }),
            prisma.event.findUnique({
              where: { id: eventId },
              select: { name: true },
            }),
          ]);

          let activeCard = await prisma.stampCard.findFirst({
            where: { userId, isRedeemed: false },
            include: { _count: { select: { entries: true } } },
            orderBy: { createdAt: "desc" },
          });

          if (!activeCard || activeCard._count.entries >= 10) {
            activeCard = await prisma.stampCard.create({
              data: { userId },
              include: { _count: { select: { entries: true } } },
            });
          }

          const existingEntry = await prisma.stampEntry.findFirst({
            where: { userId, eventId, stampCardId: activeCard.id },
          });

          if (existingEntry) {
            throw new Error("같은 카드에는 동일한 이벤트를 다시 적립할 수 없습니다.");
          }

          await prisma.stampEntry.create({
            data: { userId, eventId, stampCardId: activeCard.id },
          });

          const nextStampCount = activeCard._count.entries + 1;

          if (nextStampCount >= STAMPS_PER_CARD) {
            await ensureCouponForCompletedStampCard(prisma, {
              stampCardId: activeCard.id,
              userId,
            });
          }

          if (userRecord?.phoneNumber && eventRecord?.name) {
            return {
              phoneNumber: userRecord.phoneNumber,
              customerName: userRecord.name,
              eventName: eventRecord.name,
              currentCount: nextStampCount,
            };
          }

          return null;
        });

        if (stampNotification) {
          await sendStampProgressAlimtalk({
            phoneNumber: stampNotification.phoneNumber,
            customerName: stampNotification.customerName,
            eventName: stampNotification.eventName,
            currentCount: stampNotification.currentCount,
            appUrl: process.env.APP_URL ?? new URL(request.url).origin,
          });
        }

        flashSession.flash("toast", { type: "success", message: "스탬프가 성공적으로 적립되었습니다." });
      } catch (error) {
        flashSession.flash("toast", {
          type: "error",
          message: getErrorMessage(error, "스탬프 적립 중 오류가 발생했습니다."),
        });
      }
    }

    return redirect(`/admin/users/${userId}`, {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  if (intent === "deleteStamp") {
    const stampEntryId = Number(formData.get("stampEntryId"));

    try {
      const stampEntry = await db.stampEntry.findUnique({
        where: { id: stampEntryId, userId },
        include: { stampCard: { include: { coupon: true } } },
      });

      if (stampEntry?.stampCard.coupon) {
        throw new Error("쿠폰이 발급된 스탬프 카드는 수정할 수 없습니다.");
      }

      await db.stampEntry.delete({ where: { id: stampEntryId, userId } });
      flashSession.flash("toast", { type: "success", message: "스탬프가 삭제되었습니다." });
    } catch (error) {
      flashSession.flash("toast", {
        type: "error",
        message: getErrorMessage(error, "스탬프 삭제 중 오류가 발생했습니다."),
      });
    }

    return redirect(`/admin/users/${userId}`, {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  if (intent === "addAdminStamp") {
    const adminNote = formData.get("adminNote") as string;
    if (!adminNote || adminNote.trim().length === 0) {
      flashSession.flash("toast", { type: "error", message: "관리자 메모를 입력해 주세요." });
    } else {
      try {
        const stampNotification = await db.$transaction(async (prisma) => {
          const userRecord = await prisma.user.findUnique({
            where: { id: userId },
            select: { name: true, phoneNumber: true },
          });

          let activeCard = await prisma.stampCard.findFirst({
            where: { userId, isRedeemed: false },
            include: { _count: { select: { entries: true } } },
            orderBy: { createdAt: "desc" },
          });

          if (!activeCard || activeCard._count.entries >= 10) {
            const newCard = await prisma.stampCard.create({ data: { userId } });
            activeCard = {
              ...newCard,
              _count: { entries: 0 },
            };
          }

          await prisma.stampEntry.create({
            data: {
              userId,
              stampCardId: activeCard.id,
              adminNote,
            },
          });

          const nextStampCount = activeCard._count.entries + 1;

          if (nextStampCount >= STAMPS_PER_CARD) {
            await ensureCouponForCompletedStampCard(prisma, {
              stampCardId: activeCard.id,
              userId,
            });
          }

          if (userRecord?.phoneNumber) {
            return {
              phoneNumber: userRecord.phoneNumber,
              customerName: userRecord.name,
              eventName: adminNote.trim() || "관리자 수기 적립",
              currentCount: nextStampCount,
            };
          }

          return null;
        });

        if (stampNotification) {
          await sendStampProgressAlimtalk({
            phoneNumber: stampNotification.phoneNumber,
            customerName: stampNotification.customerName,
            eventName: stampNotification.eventName,
            currentCount: stampNotification.currentCount,
            appUrl: process.env.APP_URL ?? new URL(request.url).origin,
          });
        }

        flashSession.flash("toast", { type: "success", message: "관리자 수기 적립이 완료되었습니다." });
      } catch (error) {
        flashSession.flash("toast", {
          type: "error",
          message: getErrorMessage(error, "관리자 수기 적립 중 오류가 발생했습니다."),
        });
      }
    }

    return redirect(`/admin/users/${userId}`, {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  throw new Response("Invalid intent", { status: 400 });
};

export default function UserDetailPage() {
  const { user, activities } = useLoaderData<typeof loader>();
  const [isEditing, setIsEditing] = useState(false);
  const fetcher = useFetcher();

  const getRoleBadgeVariant = (userRole: Role | null) => {
    switch (userRole) {
      case "ADMIN":
        return "destructive" as const;
      case "MEMBER":
        return "default" as const;
      case "USER":
        return "outline" as const;
      default:
        return "secondary" as const;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link to="/admin/users">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold">사용자 상세 정보</h1>
      </div>

      <fetcher.Form method="post">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <User className="h-6 w-6" />
                {isEditing ? <Input name="name" defaultValue={user.name} className="h-10 text-2xl font-bold" /> : user.name}
              </CardTitle>
              <CardDescription className="mt-2 flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <Phone className="h-4 w-4" />
                  {user.phoneNumber}
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />가입일: {user.createdAtFormatted}
                </span>
              </CardDescription>
            </div>
            <Button type="button" onClick={() => setIsEditing(!isEditing)} variant="outline" size="sm">
              {isEditing ? "취소" : <><Edit className="mr-2 h-4 w-4" />정보 수정</>}
            </Button>
          </CardHeader>
          <CardContent>
            {isEditing ? (
              <>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <Label htmlFor="role">권한</Label>
                    <Select name="role" defaultValue={user.role || "USER"}>
                      <SelectTrigger id="role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USER">일반사용자</SelectItem>
                        <SelectItem value="MEMBER">회원</SelectItem>
                        <SelectItem value="ADMIN">관리자</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="status">상태</Label>
                    <Select name="status" defaultValue={user.status}>
                      <SelectTrigger id="status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">활성</SelectItem>
                        <SelectItem value="TEMPORARY">임시</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button type="submit" name="intent" value="updateUser" className="mt-4" disabled={fetcher.state !== "idle"}>
                  <Save className="mr-2 h-4 w-4" />
                  {fetcher.state !== "idle" ? "저장 중..." : "변경사항 저장"}
                </Button>
              </>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <Label>권한</Label>
                  <Badge variant={getRoleBadgeVariant(user.role)} className="mt-2 block w-fit">
                    {user.role}
                  </Badge>
                </div>
                <div>
                  <Label>상태</Label>
                  <Badge variant={user.status === "ACTIVE" ? "secondary" : "outline"} className="mt-2 block w-fit">
                    {user.status}
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </fetcher.Form>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Stamp className="h-5 w-5" /> 스탬프 관리
          </CardTitle>
          <div className="flex gap-2">
            <AddAdminStampDialog />
            <AddStampDialog />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {user.eventEntries.length > 0 ? (
              user.eventEntries.map((entry: EventEntryItem) => (
                <div key={entry.id} className="flex items-center justify-between rounded-md border p-2">
                  <div className="text-sm">
                    <p className="flex items-center gap-1.5 font-medium">
                      {entry.event ? (
                        <Link to={`/admin/events/${entry.event.id}`} className="hover:underline">
                          {entry.event.name}
                        </Link>
                      ) : (
                        <>
                          <AwardIcon className="h-4 w-4 text-primary" />
                          <span>{entry.adminNote || "관리자 메모"}</span>
                        </>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{entry.createdAtFormatted} 적립</p>
                  </div>
                  <DeleteStampDialog stampEntryId={entry.id} />
                </div>
              ))
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">적립된 스탬프가 없습니다.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" /> 활동 내역
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">일시</TableHead>
                <TableHead className="w-[100px]">구분</TableHead>
                <TableHead>내용</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.length > 0 ? (
                activities.map((activity: ActivityItem, index: number) => (
                  <TableRow key={index}>
                    <TableCell className="text-xs text-muted-foreground">{activity.date}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="flex w-fit items-center gap-1.5">
                        <ActivityIcon type={activity.type} /> {activity.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link to={activity.link} className="hover:underline">
                        {activity.description}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                    활동 내역이 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5" /> 스탬프 카드 ({user.StampCard.length}개)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {user.StampCard.length > 0 ? (
              user.StampCard.map((card: StampCardItem) => (
                <div key={card.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                  <div>
                      <div className="font-medium">
                        카드 {card._count.entries} / 10
                        {card.isRedeemed && <Badge className="ml-2">사용 완료</Badge>}
                        {!card.coupon && card._count.entries >= 10 && (
                          <Badge variant="outline" className="ml-2">
                            관리자 발급 대기
                          </Badge>
                        )}
                      </div>
                    <p className="text-xs text-muted-foreground">생성일 {card.createdAtFormatted}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {card.coupon && (
                      <Badge variant="outline" className="flex items-center gap-1">
                        <Ticket className="h-3 w-3" /> 쿠폰 발급됨
                      </Badge>
                    )}
                    {!card.coupon && card._count.entries >= 10 && <IssueStampCardCouponButton cardId={card.id} />}
                    <DeleteStampCardDialog cardId={card.id} hasCoupon={!!card.coupon} />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center text-muted-foreground">스탬프 카드가 없습니다.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AddStampDialog() {
  const fetcher = useFetcher();
  const eventSearchFetcher = useFetcher<{ events: Pick<PrismaEvent, "id" | "name">[] }>();
  const [open, setOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");

  const handleSearch = (query: string) => {
    if (query.length > 0) {
      eventSearchFetcher.load(`/api/events/search?q=${query}`);
    }
  };

  useEffect(() => {
    if (fetcher.state === "submitting") {
      setOpen(false);
    }
  }, [fetcher.state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusCircle className="mr-2 h-4 w-4" /> 스탬프 추가
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>이벤트 스탬프 추가</DialogTitle>
          <DialogDescription>이벤트를 검색해서 해당 사용자에게 스탬프를 추가합니다.</DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" onSubmit={() => setOpen(false)}>
          <input type="hidden" name="intent" value="addStamp" />
          <input type="hidden" name="eventId" value={selectedEventId} />

          <Command className="mt-2 rounded-lg border shadow-md">
            <CommandInput onValueChange={handleSearch} placeholder="이벤트 이름 검색..." />
            <CommandList>
              <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
              {eventSearchFetcher.data?.events && (
                <CommandGroup>
                  {eventSearchFetcher.data.events.map((event) => (
                    <CommandItem key={event.id} value={event.name} onSelect={() => setSelectedEventId(event.id)}>
                      <SearchIcon className="mr-2 h-4 w-4" />
                      {event.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>

          {selectedEventId && (
            <p className="mt-2 text-sm text-muted-foreground">
              선택된 이벤트: {eventSearchFetcher.data?.events?.find((event) => event.id === selectedEventId)?.name}
            </p>
          )}

          <DialogFooter className="mt-4">
            <Button type="submit" disabled={!selectedEventId || fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "추가 중..." : "스탬프 추가"}
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteStampDialog({ stampEntryId }: { stampEntryId: number }) {
  const fetcher = useFetcher();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="deleteStamp" />
          <input type="hidden" name="stampEntryId" value={stampEntryId} />
          <AlertDialogHeader>
            <AlertDialogTitle>이 스탬프를 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>삭제한 스탬프는 복구할 수 없습니다.</AlertDialogDescription>
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

function IssueStampCardCouponButton({ cardId }: { cardId: number }) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="issueStampCardCoupon" />
      <input type="hidden" name="stampCardId" value={cardId} />
      <Button type="submit" size="sm" variant="outline" disabled={isSubmitting}>
        {isSubmitting ? "발급 중..." : "쿠폰 발급"}
      </Button>
    </fetcher.Form>
  );
}

function DeleteStampCardDialog({ cardId, hasCoupon }: { cardId: number; hasCoupon: boolean }) {
  const fetcher = useFetcher();
  const isDeleting = fetcher.state !== "idle";

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={hasCoupon}
          title={hasCoupon ? "쿠폰이 발급된 카드는 삭제할 수 없습니다." : "스탬프 카드 삭제"}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="deleteStampCard" />
          <input type="hidden" name="stampCardId" value={cardId} />
          <AlertDialogHeader>
            <AlertDialogTitle>이 카드를 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              이 카드에 적립된 모든 스탬프가 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>취소</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button type="submit" variant="destructive" disabled={isDeleting}>
                {isDeleting ? "삭제 중..." : "삭제"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AddAdminStampDialog() {
  const fetcher = useFetcher();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.formMethod != null) {
      setOpen(false);
    }
  }, [fetcher]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <AwardIcon className="mr-2 h-4 w-4" /> 관리자 적립
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>관리자 수기 적립</DialogTitle>
          <DialogDescription>이벤트와 무관하게 관리자가 직접 스탬프를 적립합니다. 사유를 함께 남겨 주세요.</DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="addAdminStamp" />
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="adminNote" className="text-right">
                적립 사유
              </Label>
              <Input id="adminNote" name="adminNote" className="col-span-3" placeholder="예: 이벤트 보정 적립" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "적립 중..." : "스탬프 적립"}
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

function ActivityIcon({ type }: { type: "스탬프 적립" | "리뷰 작성" | "쿠폰 발급" }) {
  switch (type) {
    case "스탬프 적립":
      return <Stamp className="h-4 w-4" />;
    case "리뷰 작성":
      return <Edit className="h-4 w-4" />;
    case "쿠폰 발급":
      return <Ticket className="h-4 w-4" />;
    default:
      return <Activity className="h-4 w-4" />;
  }
}
