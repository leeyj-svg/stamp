import {
  type LoaderFunctionArgs,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  redirect,
} from 'react-router';
import * as z from 'zod';
import dayjs from 'dayjs';
import { UserStatus } from '@prisma/client';

import { EventForm } from '~/components/eventform';
import { assertCategoryAccess, requireAdminAccessScope } from '~/lib/admin-access.server';
import { db } from '~/lib/db.server';
import { sendAlimtalk, AlimtalkType } from '~/lib/alimtalk.server';
import { commitSession, getFlashSession } from '~/lib/session.server';
import { uploadImages } from '~/lib/upload.server';

const STAMPS_PER_CARD = 10;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const scope = await requireAdminAccessScope(request);
  const categories = await db.eventCategory.findMany({
    where: scope.isAdmin ? {} : { id: { in: scope.managedCategoryIds } },
    orderBy: { name: 'asc' },
  });
  return { categories };
};

const participantSchema = z
  .object({
    type: z.enum(['user', 'temp-phone', 'temp-code']),
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    detail: z.string().trim().min(1),
    maxUses: z.number().int().min(1).nullable().optional(),
    expiryOption: z.enum(['event_end', 'one_day', 'three_days', 'custom']).optional(),
    customExpiryDate: z.string().nullable().optional(),
  })
  .superRefine((participant, ctx) => {
    if (participant.type === 'temp-phone' && !/^\d{10,11}$/.test(participant.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: '전화번호 형식이 올바르지 않습니다.',
      });
    }

    if (participant.type === 'temp-code') {
      if (!participant.id.startsWith('CODE-')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['id'],
          message: '임시 코드 형식이 올바르지 않습니다.',
        });
      }

      if (participant.expiryOption === 'custom') {
        if (!participant.customExpiryDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['customExpiryDate'],
            message: '직접 지정 만료일이 필요합니다.',
          });
        } else if (Number.isNaN(Date.parse(participant.customExpiryDate))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['customExpiryDate'],
            message: '만료일 형식이 올바르지 않습니다.',
          });
        }
      }
    }
  });

const eventFormSchema = z
  .object({
    name: z.string().min(2, '이벤트 이름은 2글자 이상이어야 합니다.'),
    description: z.string().optional(),
    imageUrl: z.any().optional(),
    isAllDay: z.boolean(),
    categoryId: z.string().min(1, '카테고리를 선택해주세요.'),
    startDate: z.date().refine((date) => date, {
      message: '시작 날짜를 선택해주세요.',
    }),
    endDate: z.date().refine((date) => date, {
      message: '종료 날짜를 선택해주세요.',
    }),
    participants: z.array(participantSchema).min(1, '참가자를 1명 이상 등록해주세요.'),
  })
  .superRefine((data, ctx) => {
    if (data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: '종료일은 시작일보다 빠를 수 없습니다.',
      });
    }

    const seen = new Set<string>();
    for (let index = 0; index < data.participants.length; index += 1) {
      const key = `${data.participants[index].type}:${data.participants[index].id}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['participants', index, 'id'],
          message: '중복된 참가자가 포함되어 있습니다.',
        });
      }
      seen.add(key);
    }
  });

async function errorResponse(request: Request, message: string, status = 400) {
  const flashSession = await getFlashSession(request.headers.get('Cookie'));
  flashSession.flash('toast', { type: 'error', message });

  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': await commitSession(flashSession),
    },
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const scope = await requireAdminAccessScope(request);
  const formData = await request.formData();

  const participantsField = formData.get('participants');
  let participantsPayload: unknown = [];

  if (typeof participantsField === 'string' && participantsField.trim().length > 0) {
    try {
      participantsPayload = JSON.parse(participantsField);
    } catch {
      return errorResponse(request, '참가자 정보 형식이 올바르지 않습니다.');
    }
  }

  if (!Array.isArray(participantsPayload)) {
    return errorResponse(request, '참가자 정보 형식이 올바르지 않습니다.');
  }

  const result = eventFormSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description'),
    isAllDay: formData.get('isAllDay') === 'true',
    categoryId: formData.get('categoryId'),
    startDate: dayjs(formData.get('startDate') as string).toDate(),
    endDate: dayjs(formData.get('endDate') as string).toDate(),
    participants: participantsPayload,
  });

  if (!result.success) {
    const error = result.error.flatten();
    const firstErrorMessage =
      Object.values(error.fieldErrors).flat()[0] ||
      error.formErrors[0] ||
      '입력값이 올바르지 않습니다.';

    return errorResponse(request, firstErrorMessage);
  }

  const { name, description, categoryId, isAllDay, startDate, endDate, participants } = result.data;
  assertCategoryAccess(scope, Number(categoryId));
  const imageFiles = formData
    .getAll('images')
    .filter((value): value is File => value instanceof File && value.size > 0);

  try {
    const imageUrls = await uploadImages(imageFiles);
    const userParticipants = participants.filter((participant) => participant.type === 'user');
    const tempPhoneParticipants = participants.filter((participant) => participant.type === 'temp-phone');
    const tempCodeParticipants = participants.filter((participant) => participant.type === 'temp-code');

    const userIdSet = new Set(userParticipants.map((participant) => participant.id));

    if (tempPhoneParticipants.length > 0) {
      const uniquePhones = [...new Set(tempPhoneParticipants.map((participant) => participant.id))];
      const nameByPhone = new Map(tempPhoneParticipants.map((participant) => [participant.id, participant.name]));

      const existingTempUsers = await db.user.findMany({
        where: { phoneNumber: { in: uniquePhones } },
        select: { id: true, phoneNumber: true },
      });

      const existingPhoneSet = new Set(existingTempUsers.map((user) => user.phoneNumber));
      const missingPhones = uniquePhones.filter((phoneNumber) => !existingPhoneSet.has(phoneNumber));

      if (missingPhones.length > 0) {
        await db.user.createMany({
          data: missingPhones.map((phoneNumber) => ({
            name: nameByPhone.get(phoneNumber) ?? `임시회원-${phoneNumber.slice(-4)}`,
            phoneNumber,
            status: UserStatus.TEMPORARY,
          })),
          skipDuplicates: true,
        });
      }

      const resolvedTempUsers = await db.user.findMany({
        where: { phoneNumber: { in: uniquePhones } },
        select: { id: true },
      });

      for (const user of resolvedTempUsers) {
        userIdSet.add(user.id);
      }
    }

    if (tempCodeParticipants.length > 0) {
      const existingCodes = await db.claimableStamp.findMany({
        where: { claimCode: { in: tempCodeParticipants.map((participant) => participant.id) } },
        select: { claimCode: true },
      });

      if (existingCodes.length > 0) {
        return errorResponse(request, '이미 사용 중인 임시 코드가 포함되어 있습니다.');
      }
    }

    const userIdsToStamp = [...userIdSet];
    const alimtalkData: { name: string; phoneNumber: string; currentCount: number }[] = [];

    await db.$transaction(async (prisma) => {
      const newEvent = await prisma.event.create({
        data: {
          name,
          description,
          isAllDay,
          startDate,
          endDate,
          images: {
            create: imageUrls.map((imageObj) => ({ url: imageObj.url })),
          },
          categoryId: Number(categoryId),
        },
        select: { id: true },
      });

      const eventId = newEvent.id;

      if (tempCodeParticipants.length > 0) {
        const claimableStampsData = tempCodeParticipants.map((participant) => {
          let expiresAt = new Date(endDate);

          if (participant.expiryOption === 'one_day') {
            expiresAt.setDate(expiresAt.getDate() + 1);
          } else if (participant.expiryOption === 'three_days') {
            expiresAt.setDate(expiresAt.getDate() + 3);
          } else if (participant.expiryOption === 'custom' && participant.customExpiryDate) {
            expiresAt = new Date(participant.customExpiryDate);
          }

          return {
            claimCode: participant.id,
            eventId,
            expiresAt,
            maxUses: participant.maxUses === undefined ? undefined : participant.maxUses,
          };
        });

        await prisma.claimableStamp.createMany({ data: claimableStampsData });
      }

      if (userIdsToStamp.length > 0) {
        const userActiveCards = await prisma.stampCard.findMany({
          where: { userId: { in: userIdsToStamp }, isRedeemed: false },
          select: {
            id: true,
            userId: true,
            _count: {
              select: { entries: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        });

        const userRecords = await prisma.user.findMany({
          where: { id: { in: userIdsToStamp } },
          select: { id: true, name: true, phoneNumber: true },
        });
        const userMap = new Map(userRecords.map((user) => [user.id, user]));

        const userCardsMap = new Map<string, { id: number; entryCount: number }[]>();
        for (const card of userActiveCards) {
          if (!userCardsMap.has(card.userId)) {
            userCardsMap.set(card.userId, []);
          }
          userCardsMap.get(card.userId)!.push({ id: card.id, entryCount: card._count.entries });
        }

        const stampEntriesToCreate: { userId: string; eventId: string; stampCardId: number }[] = [];
        const newCardsToCreate: { userId: string }[] = [];

        for (const userId of userIdsToStamp) {
          const cards = userCardsMap.get(userId) || [];
          const incompleteCard = cards.find((card) => card.entryCount < STAMPS_PER_CARD);
          const currentStampCount = incompleteCard ? incompleteCard.entryCount : 0;

          if (incompleteCard) {
            stampEntriesToCreate.push({ userId, eventId, stampCardId: incompleteCard.id });
          } else {
            newCardsToCreate.push({ userId });
          }

          const userRecord = userMap.get(userId);
          if (userRecord?.phoneNumber) {
            alimtalkData.push({
              name: userRecord.name,
              phoneNumber: userRecord.phoneNumber,
              currentCount: currentStampCount + 1,
            });
          }
        }

        if (newCardsToCreate.length > 0) {
          const createdCards = await Promise.all(
            newCardsToCreate.map((cardData) => prisma.stampCard.create({ data: cardData }))
          );

          for (const newCard of createdCards) {
            stampEntriesToCreate.push({ userId: newCard.userId, eventId, stampCardId: newCard.id });
          }
        }

        if (stampEntriesToCreate.length > 0) {
          await prisma.stampEntry.createMany({ data: stampEntriesToCreate });
        }
      }
    });

    const appUrl = process.env.APP_URL ?? new URL(request.url).origin;
    await Promise.allSettled(
      alimtalkData.map((data) =>
        sendAlimtalk(AlimtalkType.STAMP_ACQUIRED, data.phoneNumber, {
          고객명: data.name,
          활동명: name,
          현재개수: String(data.currentCount),
          남은스탬프개수: String(Math.max(0, STAMPS_PER_CARD - data.currentCount)),
          link: `${appUrl}/card`,
        }).catch(() => {
          console.error(
            `[Alimtalk Error] Failed to send to ${data.name.slice(0, 1)}**(${data.phoneNumber.slice(-4)})`
          );
        })
      )
    );

    const flashSession = await getFlashSession(request.headers.get('Cookie'));
    flashSession.flash('toast', {
      type: 'success',
      message: '이벤트가 성공적으로 등록되었습니다.',
    });

    return redirect('/admin/events', {
      headers: [['Set-Cookie', await commitSession(flashSession)]],
    });
  } catch (error) {
    console.error('이벤트 등록 실패:', error);
    return errorResponse(request, '이벤트 등록 중 오류가 발생했습니다.', 500);
  }
};

export default function CreateEventPage() {
  const { categories } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return <EventForm fetcher={fetcher} categories={categories} />;
}
