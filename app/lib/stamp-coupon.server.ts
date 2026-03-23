import { Prisma } from "@prisma/client";

export const STAMPS_PER_CARD = 10;

export function getStampCouponDescription(referenceDate = new Date()) {
  return `${referenceDate.getFullYear()}년 스탬프 이벤트 보상`;
}

export function getStampCouponExpiresAt(referenceDate = new Date()) {
  const expiresAt = new Date(referenceDate);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  return expiresAt;
}

export async function ensureCouponForCompletedStampCard(
  prisma: Prisma.TransactionClient,
  params: { stampCardId: number; userId?: string; referenceDate?: Date }
) {
  const { stampCardId, userId, referenceDate = new Date() } = params;

  const stampCard = await prisma.stampCard.findUnique({
    where: { id: stampCardId },
    select: {
      id: true,
      userId: true,
      isRedeemed: true,
      coupon: {
        select: {
          id: true,
          code: true,
          description: true,
          isUsed: true,
          expiresAt: true,
          createdAt: true,
          stampCardId: true,
        },
      },
      _count: {
        select: {
          entries: true,
        },
      },
    },
  });

  if (!stampCard) {
    return null;
  }

  if (userId && stampCard.userId !== userId) {
    return null;
  }

  if (stampCard._count.entries < STAMPS_PER_CARD) {
    return null;
  }

  if (stampCard.coupon) {
    if (!stampCard.isRedeemed) {
      await prisma.stampCard.updateMany({
        where: { id: stampCard.id, isRedeemed: false },
        data: { isRedeemed: true },
      });
    }
    return stampCard.coupon;
  }

  await prisma.stampCard.updateMany({
    where: { id: stampCard.id, isRedeemed: false },
    data: { isRedeemed: true },
  });

  try {
    return await prisma.coupon.create({
      data: {
        code: generateCouponCode(),
        description: getStampCouponDescription(referenceDate),
        expiresAt: getStampCouponExpiresAt(referenceDate),
        stampCardId: stampCard.id,
      },
      select: {
        id: true,
        code: true,
        description: true,
        isUsed: true,
        expiresAt: true,
        createdAt: true,
        stampCardId: true,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.coupon.findUnique({
        where: { stampCardId: stampCard.id },
        select: {
          id: true,
          code: true,
          description: true,
          isUsed: true,
          expiresAt: true,
          createdAt: true,
          stampCardId: true,
        },
      });
    }

    throw error;
  }
}

export async function reconcileCompletedStampCardsForUser(prisma: Prisma.TransactionClient, userId: string) {
  const candidates = await prisma.stampCard.findMany({
    where: {
      userId,
      coupon: null,
    },
    select: {
      id: true,
      _count: {
        select: {
          entries: true,
        },
      },
    },
  });

  for (const card of candidates) {
    if (card._count.entries >= STAMPS_PER_CARD) {
      await ensureCouponForCompletedStampCard(prisma, { stampCardId: card.id, userId });
    }
  }
}

function generateCouponCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let raw = "";

  for (let index = 0; index < 12; index += 1) {
    raw += chars[Math.floor(Math.random() * chars.length)];
  }

  return `STAMP-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}
