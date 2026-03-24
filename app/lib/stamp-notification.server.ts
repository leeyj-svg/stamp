import { format } from "date-fns";

import { AlimtalkType, sendAlimtalk } from "~/lib/alimtalk.server";
import {
  getAlimtalkCouponDescription,
  STAMPS_PER_CARD,
  getStampCouponDescription,
  getStampCouponExpiresAt,
} from "~/lib/stamp-coupon.server";

export async function sendCouponIssuedAlimtalk(params: {
  phoneNumber: string;
  customerName: string;
  description?: string;
  expiresAt?: Date;
  appUrl: string;
}) {
  const { phoneNumber, customerName, description, expiresAt, appUrl } = params;

  await sendAlimtalk(AlimtalkType.COUPON_ISSUED, phoneNumber, {
    고객명: customerName,
    쿠폰설명: getAlimtalkCouponDescription(description),
    만료일자: format(expiresAt ?? getStampCouponExpiresAt(), "yyyy-MM-dd"),
    link: `${appUrl}/card`,
  });
}

export async function sendStampProgressAlimtalk(params: {
  phoneNumber: string;
  customerName: string;
  eventName: string;
  currentCount: number;
  appUrl: string;
}) {
  const { phoneNumber, customerName, eventName, currentCount, appUrl } = params;

  if (currentCount >= STAMPS_PER_CARD) {
    await sendCouponIssuedAlimtalk({
      phoneNumber,
      customerName,
      description: getStampCouponDescription(),
      expiresAt: getStampCouponExpiresAt(),
      appUrl,
    });
    return;
  }

  await sendAlimtalk(AlimtalkType.STAMP_ACQUIRED, phoneNumber, {
    고객명: customerName,
    활동명: eventName,
    현재개수: String(currentCount),
    남은스탬프개수: String(Math.max(0, STAMPS_PER_CARD - currentCount)),
    link: `${appUrl}/card`,
  });
}
