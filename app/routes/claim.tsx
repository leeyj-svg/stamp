// app/routes/claim.tsx

import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "react-router"; // ?몚 react-router?먯꽌 LoaderFunctionArgs??import
import { db } from "~/lib/db.server";
import { getSession as getAuthSession } from "~/lib/auth.server"; // 湲곗〈 ?몄쬆 ?몄뀡
import { getFlashSession, commitSession } from "~/lib/session.server"; // ?몚 ?뚮옒???몄뀡 ?꾪룷??
import { sendAlimtalk, AlimtalkType } from "~/lib/alimtalk.server";

const STAMPS_PER_CARD = 10;
// --- Loader ?⑥닔 ---
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const claimCode = url.searchParams.get("code");
  const flashSession = await getFlashSession(request.headers.get("Cookie"));

  if (!claimCode) {
    flashSession.flash("toast", { message: "?좏슚???ㅽ꺃??肄붾뱶媛 ?꾩슂?⑸땲??", type: "error" });
    return redirect("/card", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  const { user, session: authSession } = await getAuthSession(request); // ?몄쬆 ?몄뀡 媛?몄삤湲?

  // 1. 濡쒓렇???곹깭??寃쎌슦: 諛붾줈 ?ㅽ꺃???곷┰???쒕룄?⑸땲??
  if (user) {
    const formData = new FormData();
    formData.append("claimCode", claimCode);

    // loader?먯꽌 action???몄텧?섎뒗 諛⑸쾿
    // React Router??action ?⑥닔瑜?吏곸젒 ?몄텧?섎릺,
    // request 媛앹껜瑜??앹꽦?섏뿬 action???꾩슂???곗씠?곕? ?꾨떖?⑸땲??
    const response = await action({
      request: new Request(request.url, {
        method: 'POST',
        body: formData,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
      params: {},
      context: {}, // ?몚 ??遺遺꾩쓣 異붽??섏뿬 context ?꾨뱶瑜??쒓났?⑸땲??
    });

    // action??redirect瑜?諛섑솚?섎㈃ 洹멸구 洹몃?濡?諛섑솚
    if (response instanceof Response) {
      return response;
    }
    // action???쒖닔 媛앹껜瑜?諛섑솚??寃쎌슦 (?ㅻ쪟 ?곹솴)
    flashSession.flash("toast", { message: "?ㅽ꺃???곷┰ 泥섎━ 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.", type: "error" });
    return redirect("/card", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });

  } else {
    // 2. 濡쒓렇???곹깭媛 ?꾨땶 寃쎌슦: ?뚯썝媛???섏씠吏濡?由щ떎?대젆??
    // claimCode瑜??④퍡 ?섍꺼二쇱뼱 ?뚯썝媛?????먮룞 ?곷┰?섎룄濡??⑸땲??
    flashSession.flash("toast", { message: "?ㅽ꺃?꾨? 諛쏆쑝?ㅻ㈃ ?뚯썝媛???먮뒗 濡쒓렇?몄씠 ?꾩슂?⑸땲??", type: "info" });
    return redirect(`/signup?claimCode=${claimCode}`, {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }
};


// --- Action ?⑥닔 (?ㅽ꺃???곷┰ 泥섎━) ---
export const action = async ({ request }: ActionFunctionArgs) => {
  const { user, session: authSession } = await getAuthSession(request); // ?몄쬆 ?몄뀡
  const flashSession = await getFlashSession(request.headers.get("Cookie")); // ?뚮옒???몄뀡

  const formData = await request.formData();
  const claimCode = formData.get("claimCode");

  if (!claimCode || typeof claimCode !== "string") {
    flashSession.flash("toast", { message: "?좏슚???ㅽ꺃??肄붾뱶媛 ?꾩슂?⑸땲??", type: "error" });
    return redirect("/card", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  // ??action? 濡쒓렇?몃맂 ?ъ슜?먮쭔 ?묎렐 媛?ν빀?덈떎. (濡쒓렇?꾩썐 ?ъ슜?먮뒗 loader?먯꽌 ?대? signup?쇰줈 redirect)
  if (!user) {
    flashSession.flash("toast", { message: "?ㅽ꺃???곷┰???꾪빐 濡쒓렇?몄씠 ?꾩슂?⑸땲??", type: "error" });
    return redirect("/login", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  try {
    const stampNotification = await db.$transaction(async (prisma) => {
      const claimableStamp = await prisma.claimableStamp.findUnique({
        where: { claimCode },
        include: { event: true, redemptions: { where: { userId: user.id } } }, // ?ъ슜?먭? ??肄붾뱶瑜??ъ슜?덈뒗吏 ?뺤씤
      });

      if (!claimableStamp) {
        throw new Error("議댁옱?섏? ?딅뒗 ?ㅽ꺃??肄붾뱶?낅땲??");
      }
      if (new Date() > claimableStamp.expiresAt) {
        throw new Error("留뚮즺???ㅽ꺃??肄붾뱶?낅땲??");
      }

      if (claimableStamp.redemptions.length > 0) {
        throw new Error("?대? ?ъ슜???ㅽ꺃??肄붾뱶?낅땲??");
      }
      if (claimableStamp.maxUses !== null && claimableStamp.currentUses >= claimableStamp.maxUses) {
        throw new Error("???ㅽ꺃??肄붾뱶??紐⑤몢 ?ъ슜?섏뿀?듬땲??");
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
        throw new Error("???대깽?몄쓽 ?ㅽ꺃?꾨뒗 ?대? ?곷┰?섏뿀?듬땲??");
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
            create: { userId: user.id }
          }
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

    flashSession.flash("toast", { message: "?ㅽ꺃?꾧? ?깃났?곸쑝濡??곷┰?섏뿀?듬땲??", type: "success" });
    return redirect("/card", {
      headers: {
        "Set-Cookie": await commitSession(flashSession),
      },
    });

  } catch (error: any) { // error ??낆쓣 any濡?蹂寃쏀븯??error.message ?묎렐
    console.error("?ㅽ꺃???곷┰ 以??ㅻ쪟 諛쒖깮:", error);
    flashSession.flash("toast", { message: error.message || "?ㅽ꺃???곷┰ 以??????녿뒗 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.", type: "error" });
    return redirect("/card", {
      headers: {
        "Set-Cookie": await commitSession(flashSession),
      },
    });
  }
};

// UI???뚮뜑留곷릺吏 ?딆쑝誘濡?null 諛섑솚
export default function ClaimPage() {
  return null;
}
