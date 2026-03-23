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
import { sendStampProgressAlimtalk } from '~/lib/stamp-notification.server';
import { commitSession, getFlashSession } from '~/lib/session.server';
import { deleteImages, uploadImages } from '~/lib/upload.server';

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
          message: '초대 코드 형식이 올바르지 않습니다.',
        });
      }

      if (participant.expiryOption === 'custom') {
        if (!participant.customExpiryDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['customExpiryDate'],
            message: '사용자 지정 만료일을 입력해 주세요.',
          });
        } else if (Number.isNaN(Date.parse(participant.customExpiryDate))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['customExpiryDate'],
            message: '올바른 날짜 형식이 아닙니다.',
          });
        }
      }
    }
  });

const eventFormSchema = z
  .object({
    name: z.string().min(2, '이벤트명은 2자 이상이어야 합니다.'),
    description: z.string().optional(),
    imageUrl: z.unknown().optional(),
    isAllDay: z.boolean(),
    categoryId: z.string().min(1, '카테고리를 선택해 주세요.'),
    startDate: z.date().refine((date) => date, {
      message: '시작 날짜를 선택해 주세요.',
    }),
    endDate: z.date().refine((date) => date, {
      message: '종료 날짜를 선택해 주세요.',
    }),
    participants: z.array(participantSchema).min(1, '참여자는 1명 이상 추가해 주세요.'),
  })
  .superRefine((data, ctx) => {
    if (data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: '종료일은 시작일보다 늦어야 합니다.',
      });
    }

    const seen = new Set<string>();
    for (let index = 0; index < data.participants.length; index += 1) {
      const key = `${data.participants[index].type}:${data.participants[index].id}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['participants', index, 'id'],
          message: '중복된 참여자가 포함되어 있습니다.',
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
      return errorResponse(request, '참여자 정보 형식이 올바르지 않습니다.');
    }
  }

  if (!Array.isArray(participantsPayload)) {
    return errorResponse(request, '참여자 정보 형식이 올바르지 않습니다.');
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
  const userParticipants = participants.filter((participant) => participant.type === 'user');
  const tempPhoneParticipants = participants.filter((participant) => participant.type === 'temp-phone');
  const tempCodeParticipants = participants.filter((participant) => participant.type === 'temp-code');
  const requestedUserIds = [...new Set(userParticipants.map((participant) => participant.id))];
  const requestedPhones = [...new Set(tempPhoneParticipants.map((participant) => participant.id))];

  if (requestedUserIds.length > 0) {
    const existingUsers = await db.user.findMany({
      where: { id: { in: requestedUserIds } },
      select: { id: true },
    });

    if (existingUsers.length !== requestedUserIds.length) {
      return errorResponse(request, '선택한 사용자가 존재하지 않습니다.');
    }
  }

  if (requestedPhones.length > 0) {
    const usersByPhone = await db.user.findMany({
      where: { phoneNumber: { in: requestedPhones } },
      select: { phoneNumber: true, status: true },
    });

    const registeredPhone = usersByPhone.find((user) => user.status !== UserStatus.TEMPORARY);
    if (registeredPhone) {
      return errorResponse(request, '기존 회원은 사용자 검색에서 추가해 주세요.');
    }
  }

  if (tempCodeParticipants.length > 0) {
    const existingCodes = await db.claimableStamp.findMany({
      where: { claimCode: { in: tempCodeParticipants.map((participant) => participant.id) } },
      select: { claimCode: true },
    });

    if (existingCodes.length > 0) {
      return errorResponse(request, '이미 사용 중인 초대 코드가 있습니다.');
    }
  }

  const imageFiles = formData
    .getAll('images')
    .filter((value): value is File => value instanceof File && value.size > 0);
  let uploadedImageUrls: { url: string; takenAt: Date | null }[] = [];

  try {
    uploadedImageUrls = await uploadImages(imageFiles);
    if (uploadedImageUrls.length !== imageFiles.length) {
      if (uploadedImageUrls.length > 0) {
        await deleteImages(uploadedImageUrls.map((image) => image.url));
      }

      return errorResponse(request, '일부 이미지 업로드에 실패했습니다. 다시 시도해 주세요.', 500);
    }

    const alimtalkData: { name: string; phoneNumber: string; currentCount: number }[] = [];

    await db.$transaction(async (prisma) => {
      const userIdSet = new Set(requestedUserIds);

      if (requestedPhones.length > 0) {
        const nameByPhone = new Map(tempPhoneParticipants.map((participant) => [participant.id, participant.name]));
        const existingTempUsers = await prisma.user.findMany({
          where: { phoneNumber: { in: requestedPhones } },
          select: { id: true, phoneNumber: true },
        });
        const existingPhoneSet = new Set(existingTempUsers.map((user) => user.phoneNumber));
        const missingPhones = requestedPhones.filter((phoneNumber) => !existingPhoneSet.has(phoneNumber));

        if (missingPhones.length > 0) {
          await prisma.user.createMany({
            data: missingPhones.map((phoneNumber) => ({
              name: nameByPhone.get(phoneNumber) ?? `temp-user-${phoneNumber.slice(-4)}`,
              phoneNumber,
              status: UserStatus.TEMPORARY,
            })),
            skipDuplicates: true,
          });
        }

        const resolvedTempUsers = await prisma.user.findMany({
          where: { phoneNumber: { in: requestedPhones } },
          select: { id: true },
        });

        for (const user of resolvedTempUsers) {
          userIdSet.add(user.id);
        }
      }

      const userIdsToStamp = [...userIdSet];
      const newEvent = await prisma.event.create({
        data: {
          name,
          description,
          isAllDay,
          startDate,
          endDate,
          images: {
            create: uploadedImageUrls.map((imageObj) => ({ url: imageObj.url })),
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
        sendStampProgressAlimtalk({
          phoneNumber: data.phoneNumber,
          customerName: data.name,
          eventName: name,
          currentCount: data.currentCount,
          appUrl,
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
      message: '이벤트가 성공적으로 생성되었습니다.',
    });

    return redirect('/admin/events', {
      headers: [['Set-Cookie', await commitSession(flashSession)]],
    });
  } catch (error) {
    if (uploadedImageUrls.length > 0) {
      await deleteImages(uploadedImageUrls.map((image) => image.url));
    }

    console.error('이벤트 생성 오류:', error);
    return errorResponse(request, '이벤트 생성 중 오류가 발생했습니다.', 500);
  }
};

export default function CreateEventPage() {
  const { categories } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return <EventForm fetcher={fetcher} categories={categories} />;
}



