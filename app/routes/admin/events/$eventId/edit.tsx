// app/routes/admin/events/$eventId.edit.tsx

// 🚨 [수정됨] json 헬퍼를 사용하지 않으므로 import에서 제거합니다.
import { useLoaderData, useFetcher, type LoaderFunctionArgs, type ActionFunctionArgs, redirect } from "react-router";
import { db } from "~/lib/db.server";
import { EventForm } from "~/components/eventform";
import { getFlashSession, commitSession } from "~/lib/session.server";
import { getSessionWithPermission } from "~/lib/auth.server";
import { uploadImages } from "~/lib/upload.server";
import type { Participant } from "~/components/participantManager";
import * as z from 'zod';
import dayjs from 'dayjs';
import { UserStatus } from "@prisma/client"; // UserStatus import 추가
import { sendAlimtalk, AlimtalkType } from '~/lib/alimtalk.server'; // 알림톡 기능 추가

// 💡 성능/확장성을 위해 상수는 한 곳에 정의합니다.
const STAMPS_PER_CARD = 10;

// loader: URL의 eventId를 사용해 수정할 이벤트의 데이터를 불러옵니다.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    await getSessionWithPermission(request, "ADMIN");
    const eventId = params.eventId;
    if (!eventId) {
        throw new Response("Event not found", { status: 404 });
    }

    // 🚨 [최적화] Promise.all을 사용하여 병렬 처리 (조회)
    const [event, categories] = await Promise.all([
        db.event.findUnique({
            where: { id: eventId },
            include: {
                images: true,
                claimableStamps: true,
                // 👇 DB 최적화: 필요한 필드만 select하여 메모리 사용량 및 PII 노출 최소화
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                phoneNumber: true, // PII: Admin 페이지이므로 필요 시 가져옴
                                status: true
                            }
                        }
                    }
                },
            },
        }),
        db.eventCategory.findMany(),

    ]);

    if (!event) {
        throw new Response("Event not found", { status: 404 });
    }

    // ✨ 기존 참가자 데이터를 Participant 타입으로 변환하는 로직 (PII 최소화)
    const defaultParticipants: Participant[] = [];

    // 1. 기존 스탬프 엔트리 (확정된 회원/임시 전화번호)
    event.participants.forEach(p => {
        if (p.user) {
            // 💡 PII 보호: 전화번호는 상세 정보로만 전달
            defaultParticipants.push({
                type: p.user.status === 'TEMPORARY' ? 'temp-phone' : 'user',
                // 'temp-phone'의 ID는 전화번호, 'user'의 ID는 DB ID
                id: p.user.status === 'TEMPORARY' ? p.user.phoneNumber : p.user.id,
                name: p.user.name,
                detail: p.user.phoneNumber || p.user.id,
            });
        }
    });

    // 2. 기존 ClaimableStamp (임시 코드)
    event.claimableStamps.forEach(cs => {
        // 만료일 옵션을 역으로 추정하는 로직 (UI 표시용)
        let expiryOption: Participant['expiryOption'] = 'event_end';
        if (cs.expiresAt) {
            const eventEndDate = new Date(event.endDate);
            const expiresAtDate = new Date(cs.expiresAt);
            const diffTime = expiresAtDate.getTime() - eventEndDate.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 1) expiryOption = 'one_day';
            else if (diffDays === 3) expiryOption = 'three_days';
            else if (diffDays !== 0) expiryOption = 'custom';
        }

        defaultParticipants.push({
            type: 'temp-code',
            id: cs.claimCode,
            name: '임시 스탬프 코드',
            detail: `최대 ${cs.maxUses === null ? '무제한' : `${cs.maxUses}회`} 사용`,
            maxUses: cs.maxUses,
            expiryOption: expiryOption,
            customExpiryDate: expiryOption === 'custom' ? cs.expiresAt.toISOString() : null,
        });
    });

    // EventForm에 전달할 defaultValues 객체
    const defaultValues = {
        ...event,
        categoryId: event.categoryId.toString(),
        existingImages: event.images,
        participants: defaultParticipants, // ✨ 변환된 참가자 목록 추가
    };

    return { event: defaultValues, categories };
};

const eventFormSchema = z.object({
    name: z.string().min(2, '이벤트 이름은 2글자 이상이어야 합니다.'),
    description: z.string().optional(),
    isAllDay: z.boolean(),
    categoryId: z.string().min(1, '카테고리를 선택해주세요.'),
    startDate: z.date().refine(date => date, {
        message: '시작 날짜를 선택해주세요.',
    }),
    endDate: z.date().refine(date => date, {
        message: '종료 날짜를 선택해주세요.',
    }),
});

// action: 폼 제출 시, 데이터를 받아 이벤트를 '수정'합니다.
export const action = async ({ request, params }: ActionFunctionArgs) => {
    await getSessionWithPermission(request, "ADMIN");
    const eventId = params.eventId!;
    if (!eventId) {
        // 🚨 new Response 사용
        return new Response(JSON.stringify({ error: "이벤트 ID가 없습니다." }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
        });
    }

    const formData = await request.formData();
    const flashSession = await getFlashSession(request.headers.get("Cookie"));

    // 💡 action에서 참가자 데이터도 파싱
    const participants: Participant[] = JSON.parse(formData.get("participants") as string || '[]');

    const result = eventFormSchema.safeParse({
        ...Object.fromEntries(formData),
        isAllDay: formData.get('isAllDay') === 'true',
        startDate: dayjs(formData.get('startDate') as string).toDate(),
        endDate: dayjs(formData.get('endDate') as string).toDate(),
        // 폼 스키마에 participants가 없으므로 생략하고, 별도로 처리합니다.
    });

    // 1. 유효성 검사 실패 시, 에러 메시지를 반환합니다.
    if (!result.success) {
        const error = result.error.flatten();
        const firstErrorMessage = Object.values(error.fieldErrors).flat()[0] || error.formErrors[0] || '입력값이 올바르지 않습니다.';
        flashSession.flash("toast", { type: "error", message: firstErrorMessage });
        // 🚨 new Response 사용
        return new Response(JSON.stringify({ error: firstErrorMessage }), {
            status: 400,
            headers: {
                "Content-Type": "application/json",
                "Set-Cookie": await commitSession(flashSession)
            },
        });
    }

    const { name, description, categoryId, isAllDay, startDate, endDate } = result.data;
    const eventEndDate = endDate;

    // 2. 이미지 및 참가자 데이터는 별도로 처리합니다.
    const newImageFiles = formData.getAll("newImages") as File[];
    const newImageUrls = await uploadImages(newImageFiles);
    const existingImageIds: number[] = JSON.parse(formData.get("existingImageIds") as string || '[]');

    // 알림톡 발송을 위한 데이터 수집용 임시 배열 (트랜잭션 바깥에서 사용)
    const alimtalkData: { name: string, phoneNumber: string, currentCount: number }[] = [];
    let currentEventName = name;

    try {

        // --- 3. 참가자 분류 및 사용자 ID 확보 (Bulk 처리를 위한 사전 작업) ---
        const userParticipants = participants.filter(p => p.type === 'user');
        const tempPhoneParticipants = participants.filter(p => p.type === 'temp-phone');

        // 1차: 기존 회원 ID 목록
        let userIdsToStamp = userParticipants.map(p => p.id);

        // 2차: 임시 전화번호 사용자 처리 (N+1 방지 대신, DB 쿼리를 트랜잭션 전으로 분리)
        for (const p of tempPhoneParticipants) {
            let user = await db.user.findUnique({ where: { phoneNumber: p.id } });
            if (!user) {
                user = await db.user.create({
                    data: { name: p.name, phoneNumber: p.id, status: UserStatus.TEMPORARY },
                });
            }
            userIdsToStamp.push(user.id);
        }

        // --- 4. 데이터베이스에 모든 정보를 한 번에 저장 (트랜잭션 시작) ---
        await db.$transaction(async (prisma) => {

            // --- 4-1. 이벤트 기본 정보 업데이트 ---
            await prisma.event.update({
                where: { id: eventId },
                data: { name, description, isAllDay, startDate, endDate, categoryId: Number(categoryId) },
            });

            // --- 4-2. 이미지 정보 업데이트 ---
            // 삭제된 기존 이미지들 제거
            await prisma.eventImage.deleteMany({
                where: { eventId: eventId, id: { notIn: existingImageIds } },
            });
            // 새로 추가된 이미지들 생성
            if (newImageUrls.length > 0) {
                await prisma.eventImage.createMany({
                    data: newImageUrls.map((image) => ({ url: image.url, eventId })),
                });
            }

            // --- 4-3. 기존 참가자 정보 조회 ---
            const [existingStampEntries, existingClaimableStamps] = await Promise.all([
                prisma.stampEntry.findMany({
                    where: { eventId },
                    select: { userId: true } // userId만 있으면 충분
                }),
                prisma.claimableStamp.findMany({
                    where: { eventId },
                    select: { claimCode: true } // claimCode만 있으면 충분
                })
            ]);
            const existingUserIdsInEvent = new Set(existingStampEntries.map(e => e.userId));
            const existingClaimCodesInEvent = new Set(existingClaimableStamps.map(c => c.claimCode));

            const currentParticipantUserIds = new Set(userIdsToStamp); // 현재 폼에 있는 (임시 코드 제외) 유저 ID들
            const currentParticipantClaimCodes = new Set<string>();

            // --- 4-4. ClaimableStamp CRUD (Create/Update) ---
            for (const p of participants.filter(p => p.type === 'temp-code')) {
                currentParticipantClaimCodes.add(p.id);

                let expiresAt = new Date(eventEndDate);
                if (p.expiryOption === 'one_day') { expiresAt.setDate(expiresAt.getDate() + 1); }
                else if (p.expiryOption === 'three_days') { expiresAt.setDate(expiresAt.getDate() + 3); }
                else if (p.expiryOption === 'custom' && p.customExpiryDate) { expiresAt = new Date(p.customExpiryDate); }

                if (!existingClaimCodesInEvent.has(p.id)) {
                    await prisma.claimableStamp.create({
                        data: { claimCode: p.id, eventId: eventId, expiresAt: expiresAt, maxUses: p.maxUses }
                    });
                } else {
                    await prisma.claimableStamp.update({
                        where: { claimCode: p.id, eventId: eventId },
                        data: { expiresAt: expiresAt, maxUses: p.maxUses }
                    });
                }
            }

            // --- 4-5. StampEntry CRUD (Delete/Create) ---

            // [DELETE] 폼에서 제거된 임시 코드 삭제
            const codesToRemove = existingClaimableStamps
                .map(c => c.claimCode)
                .filter(code => !currentParticipantClaimCodes.has(code));

            if (codesToRemove.length > 0) {
                await prisma.claimableStamp.deleteMany({
                    where: { eventId: eventId, claimCode: { in: codesToRemove } },
                });
            }

            // [DELETE] 폼에서 제거된 참가자(StampEntry) 삭제
            const userIdsToRemoveEntry = existingStampEntries
                .map(e => e.userId)
                .filter(userId => !currentParticipantUserIds.has(userId));

            if (userIdsToRemoveEntry.length > 0) {
                await prisma.stampEntry.deleteMany({
                    where: { eventId: eventId, userId: { in: userIdsToRemoveEntry } },
                });
            }

            // [CREATE] 새로 추가된 참가자(StampEntry) 생성 (Bulk 처리)
            const userIdsToAddNewEntry = userIdsToStamp.filter(userId => !existingUserIdsInEvent.has(userId));

            if (userIdsToAddNewEntry.length > 0) {

                // 1. 해당 유저들의 현재 활성 카드 목록과 엔트리 수를 한번에 조회 (DB 쿼리 1회)
                const userActiveCards = await prisma.stampCard.findMany({
                    where: { userId: { in: userIdsToAddNewEntry }, isRedeemed: false },
                    select: {
                        id: true,
                        userId: true,
                        entries: {
                            where: { eventId: { not: eventId } },
                            select: { id: true }
                        }
                    },
                    orderBy: { createdAt: 'asc' },
                });

                // 2. 알림톡 데이터에 필요한 사용자 정보도 한 번에 조회 (DB 쿼리 1회)
                const userRecords = await prisma.user.findMany({
                    where: { id: { in: userIdsToAddNewEntry } },
                    select: { id: true, name: true, phoneNumber: true }
                });
                const userMap = new Map(userRecords.map(u => [u.id, u]));


                const userCardsMap = new Map<string, { id: number, entryCount: number }[]>();
                for (const card of userActiveCards) {
                    if (!userCardsMap.has(card.userId)) {
                        userCardsMap.set(card.userId, []);
                    }
                    userCardsMap.get(card.userId)!.push({ id: card.id, entryCount: card.entries.length });
                }

                const stampEntriesToCreate: { userId: string; eventId: string; stampCardId: number; }[] = [];
                const newCardsToCreate: { userId: string }[] = [];

                // 3. 메모리 내에서 카드 할당 및 알림톡 데이터 수집
                for (const userId of userIdsToAddNewEntry) {
                    const cards = userCardsMap.get(userId) || [];
                    let targetCardId: number | undefined;
                    let currentStampCount = 0;

                    const incompleteCard = cards.find(card => card.entryCount < STAMPS_PER_CARD);

                    if (incompleteCard) {
                        targetCardId = incompleteCard.id;
                        currentStampCount = incompleteCard.entryCount;
                    } else {
                        newCardsToCreate.push({ userId });
                        currentStampCount = 0;
                    }

                    if (targetCardId || newCardsToCreate.some(c => c.userId === userId)) {
                        if (targetCardId) {
                            stampEntriesToCreate.push({ userId, eventId, stampCardId: targetCardId });
                        }

                        const userRecord = userMap.get(userId);
                        if (userRecord && userRecord.phoneNumber) {
                            // 알림톡 데이터 수집
                            alimtalkData.push({
                                name: userRecord.name,
                                phoneNumber: userRecord.phoneNumber,
                                currentCount: currentStampCount + 1, // 스탬프 적립 후 개수
                            });
                        }
                    }
                }

                // 4. 필요한 경우 새 카드 생성
                if (newCardsToCreate.length > 0) {
                    const createdCards = await Promise.all(
                        newCardsToCreate.map(cardData => prisma.stampCard.create({ data: cardData }))
                    );

                    for (const newCard of createdCards) {
                        stampEntriesToCreate.push({ userId: newCard.userId, eventId, stampCardId: newCard.id });
                    }
                }

                // 5. 스탬프 엔트리 Bulk 삽입 (DB 쿼리 1회)
                if (stampEntriesToCreate.length > 0) {
                    await prisma.stampEntry.createMany({ data: stampEntriesToCreate });
                }
            }
        }); // --- 트랜잭션 종료 (DB Commit) ---


        // 🚨 알림톡 비동기 발송 (성능/안정성 확보)
        for (const data of alimtalkData) {
            sendAlimtalk(
                AlimtalkType.STAMP_ACQUIRED,
                data.phoneNumber,
                {
                    '고객명': data.name,
                    '활동명': currentEventName,
                    '현재개수': String(data.currentCount),
                    '남은스탬프개수': String(STAMPS_PER_CARD - data.currentCount),
                    'link': `${process.env.APP_URL}/card`
                }
            ).catch(err => {
                console.error(`[Alimtalk Error] Failed to send to ${data.name.slice(0, 1)}**(${data.phoneNumber.slice(-4)})`);
            });
        }


        // 5. 리다이렉션 처리
        flashSession.flash("toast", { type: "success", message: "이벤트가 성공적으로 수정되었습니다.", });

        return redirect(`/admin/events`, {
            headers: [["Set-Cookie", await commitSession(flashSession)]],
        });
    } catch (error) {
        console.error("이벤트 수정 실패:", error);
        flashSession.flash("toast", { type: "error", message: '이벤트 수정 중 오류가 발생했습니다.' });

        // 🚨 new Response 사용
        return new Response(JSON.stringify({ error: '이벤트 수정 중 오류가 발생했습니다.' }), {
            status: 500,
            headers: {
                "Content-Type": "application/json",
                "Set-Cookie": await commitSession(flashSession)
            },
        });
    }
};

export default function EditEventPage() {
    const { event, categories } = useLoaderData<typeof loader>();
    const fetcher = useFetcher();

    return (
        <EventForm
            fetcher={fetcher}
            categories={categories}
            defaultValues={event} // 👈 loader가 불러온 기존 데이터를 폼에 채워줍니다.
        />
    );
}
