import { Prisma } from '@prisma/client';
import { type ActionFunctionArgs } from 'react-router';
import { customAlphabet } from 'nanoid';
import { format } from 'date-fns';

import { db } from '~/lib/db.server';
import { getSession, getSessionWithPermission } from '~/lib/auth.server';
import { sendAlimtalk, AlimtalkType } from '~/lib/alimtalk.server';

const STAMPS_PER_CARD = 10;
const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 12);

const generateCouponCode = () => {
  const code = nanoid();
  return `STAMP-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
};

class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

type ActionResult = {
  success: boolean;
  error?: string;
  message?: string;
  coupon?: {
    id: string;
    code: string;
    description: string;
    isUsed: boolean;
    expiresAt: Date;
    createdAt: Date;
    stampCardId: number;
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'issueCoupon') {
    const { user } = await getSession(request);
    if (!user) {
      return { success: false, error: '로그인이 필요합니다.' };
    }

    const stampCardIdRaw = formData.get('stampCardId');
    const stampCardId = Number(stampCardIdRaw);
    if (!Number.isInteger(stampCardId) || stampCardId <= 0) {
      return { success: false, error: '유효하지 않은 스탬프 카드입니다.' };
    }

    try {
      const { coupon, expiresAt } = await db.$transaction(async (prisma) => {
        const stampCard = await prisma.stampCard.findFirst({
          where: { id: stampCardId, userId: user.id },
          select: {
            id: true,
            isRedeemed: true,
            coupon: { select: { id: true } },
            _count: { select: { entries: true } },
          },
        });

        if (!stampCard) {
          throw new ActionError('스탬프 카드를 찾을 수 없습니다.');
        }

        if (stampCard.coupon || stampCard.isRedeemed) {
          throw new ActionError('이미 쿠폰이 발급된 카드입니다.');
        }

        if (stampCard._count.entries < STAMPS_PER_CARD) {
          throw new ActionError(`스탬프 ${STAMPS_PER_CARD}개를 모두 모아야 쿠폰을 발급할 수 있습니다.`);
        }

        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);

        const cardUpdate = await prisma.stampCard.updateMany({
          where: { id: stampCard.id, userId: user.id, isRedeemed: false },
          data: { isRedeemed: true },
        });

        if (cardUpdate.count === 0) {
          throw new ActionError('이미 처리된 카드입니다. 새로고침 후 다시 확인해주세요.');
        }

        const coupon = await prisma.coupon.create({
          data: {
            code: generateCouponCode(),
            description: `${new Date().getFullYear()}년 스탬프 이벤트 보상`,
            expiresAt,
            stampCardId: stampCard.id,
          },
        });

        return { coupon, expiresAt };
      });

      const appUrl = process.env.APP_URL ?? new URL(request.url).origin;
      sendAlimtalk(AlimtalkType.COUPON_ISSUED, user.phoneNumber, {
        고객명: user.name,
        쿠폰설명: coupon.description,
        만료일자: format(expiresAt, 'yyyy-MM-dd'),
        link: `${appUrl}/card`,
      }).catch((error) => {
        console.error('쿠폰 알림톡 발송 실패:', error);
      });

      return {
        success: true,
        message: '쿠폰이 성공적으로 발급되었습니다.',
        coupon,
      };
    } catch (error) {
      if (error instanceof ActionError) {
        return { success: false, error: error.message };
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String((error.meta as { target?: unknown })?.target ?? '');
        if (target.includes('stampCardId')) {
          return { success: false, error: '이미 쿠폰이 발급된 카드입니다.' };
        }
        if (target.includes('code')) {
          return { success: false, error: '쿠폰 코드 생성 중 충돌이 발생했습니다. 다시 시도해주세요.' };
        }
      }

      console.error('쿠폰 발급 오류:', error);
      return { success: false, error: '쿠폰 발급 중 오류가 발생했습니다.' };
    }
  }

  if (intent === 'toggleCouponStatus') {
    await getSessionWithPermission(request, 'ADMIN');

    const couponId = formData.get('couponId');
    if (typeof couponId !== 'string' || !couponId) {
      return { success: false, error: '유효하지 않은 쿠폰 ID입니다.' };
    }

    try {
      const updatedCoupon = await db.$transaction(async (prisma) => {
        const coupon = await prisma.coupon.findUnique({
          where: { id: couponId },
          select: { id: true, isUsed: true, stampCardId: true },
        });

        if (!coupon) {
          throw new ActionError('쿠폰을 찾을 수 없습니다.');
        }

        const nextIsUsed = !coupon.isUsed;
        const updated = await prisma.coupon.update({
          where: { id: coupon.id },
          data: { isUsed: nextIsUsed },
        });

        // 쿠폰 발급된 카드는 항상 redeemed 상태를 유지합니다.
        await prisma.stampCard.update({
          where: { id: coupon.stampCardId },
          data: { isRedeemed: true },
        });

        return updated;
      });

      return { success: true, coupon: updatedCoupon };
    } catch (error) {
      if (error instanceof ActionError) {
        return { success: false, error: error.message };
      }

      console.error('쿠폰 상태 변경 오류:', error);
      return { success: false, error: '쿠폰 상태를 업데이트할 수 없습니다.' };
    }
  }

  return { success: false, error: '지원하지 않는 요청입니다.' };
};
