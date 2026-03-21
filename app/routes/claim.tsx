import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "react-router";
import { db } from "~/lib/db.server";
import { getSession as getAuthSession } from "~/lib/auth.server";
import { getFlashSession, commitSession } from "~/lib/session.server";
import { sendAlimtalk, AlimtalkType } from "~/lib/alimtalk.server";

const STAMPS_PER_CARD = 10;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "스탬프 적립 중 알 수 없는 오류가 발생했습니다.";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const claimCode = url.searchParams.get("code");
  const flashSession = await getFlashSession(request.headers.get("Cookie"));

  if (!claimCode) {
    flashSession.flash("toast", { message: "적립 코드가 올바르지 않습니다.", type: "error" });
    return redirect("/card", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  const { user } = await getAuthSession(request);

  if (user) {
    const formData = new FormData();
    formData.append("claimCode", claimCode);

    const response = await action({
      request: new Request(request.url, {
        method: "POST",
        body: formData,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
      params: {},
      context: {},
    });

    if (response instanceof Response) {
      return response;
    }

    flashSession.flash("toast", { message: "스탬프 적립 처리에 실패했습니다.", type: "error" });
    return redirect("/card", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  flashSession.flash("toast", { message: "회원가입 후 스탬프를 적립할 수 있습니다.", type: "info" });
  return redirect(`/signup?claimCode=${claimCode}`, {
    headers: { "Set-Cookie": await commitSession(flashSession) },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { user } = await getAuthSession(request);
  const flashSession = await getFlashSession(request.headers.get("Cookie"));

  const formData = await request.formData();
  const claimCode = formData.get("claimCode");

  if (!claimCode || typeof claimCode !== "string") {
    flashSession.flash("toast", { message: "적립 코드가 올바르지 않습니다.", type: "error" });
    return redirect("/card", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  if (!user) {
    flashSession.flash("toast", { message: "로그인 후 스탬프를 적립해 주세요.", type: "error" });
    return redirect("/login", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  try {
    const stampNotification = await db.$transaction(async (prisma) => {
      const claimableStamp = await prisma.claimableStamp.findUnique({
        where: { claimCode },
        include: { event: true, redemptions: { where: { userId: user.id } } },
      });

      if (!claimableStamp) {
        throw new Error("유효하지 않은 적립 코드입니다.");
      }
      if (new Date() > claimableStamp.expiresAt) {
        throw new Error("만료된 적립 코드입니다.");
      }
      if (claimableStamp.redemptions.length > 0) {
        throw new Error("이미 사용한 적립 코드입니다.");
      }
      if (claimableStamp.maxUses !== null && claimableStamp.currentUses >= claimableStamp.maxUses) {
        throw new Error("사용 가능 횟수를 초과한 적립 코드입니다.");
      }

      let activeStampCard = await prisma.stampCard.findFirst({
        where: { userId: user.id, isRedeemed: false },
        include: { _count: { select: { entries: true } } },
      });

      if (!activeStampCard) {
        activeStampCard = await prisma.stampCard.create({
          data: { userId: user.id },
          include: { _count: { select: { entries: true } } },
        });
      }

      const existingStampEntry = await prisma.stampEntry.findFirst({
        where: {
          stampCardId: activeStampCard.id,
          eventId: claimableStamp.eventId,
        },
      });

      if (existingStampEntry) {
        throw new Error("이미 해당 이벤트의 스탬프를 적립했습니다.");
      }

      await prisma.stampEntry.create({
        data: {
          userId: user.id,
          eventId: claimableStamp.eventId,
          stampCardId: activeStampCard.id,
        },
      });

      await prisma.claimableStamp.update({
        where: { id: claimableStamp.id },
        data: {
          currentUses: { increment: 1 },
          redemptions: {
            create: { userId: user.id },
          },
        },
      });

      return {
        eventName: claimableStamp.event.name,
        currentStampCount: activeStampCard._count.entries + 1,
      };
    });

    const appUrl = process.env.APP_URL ?? new URL(request.url).origin;
    await sendAlimtalk(AlimtalkType.STAMP_ACQUIRED, user.phoneNumber, {
      고객명: user.name,
      활동명: stampNotification.eventName,
      현재개수: String(stampNotification.currentStampCount),
      남은스탬프개수: String(Math.max(0, STAMPS_PER_CARD - stampNotification.currentStampCount)),
      link: `${appUrl}/card`,
    }).catch((error) => {
      console.error(`[Alimtalk Error] Failed to send STAMP_ACQUIRED to ${user.phoneNumber.slice(-4)}`, error);
    });

    flashSession.flash("toast", { message: "스탬프가 성공적으로 적립되었습니다.", type: "success" });
    return redirect("/card", {
      headers: {
        "Set-Cookie": await commitSession(flashSession),
      },
    });
  } catch (error) {
    console.error("스탬프 적립 처리 중 오류가 발생했습니다.", error);
    flashSession.flash("toast", { message: getErrorMessage(error), type: "error" });
    return redirect("/card", {
      headers: {
        "Set-Cookie": await commitSession(flashSession),
      },
    });
  }
};

export default function ClaimPage() {
  return null;
}
