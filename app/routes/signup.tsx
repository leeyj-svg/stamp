import {
  Link,
  redirect,
  useFetcher,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  useLoaderData,
} from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Prisma } from '@prisma/client';

import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '~/components/ui/form';
import { Input } from '~/components/ui/input';
import { Checkbox } from '~/components/ui/checkbox';
import { Separator } from '~/components/ui/separator';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';

import { TermsOfServiceContent } from '~/components/terms';
import { PrivacyPolicyContent } from '~/components/privacy';
import { db } from '~/lib/db.server';
import { lucia, hashPassword } from '~/lib/auth.server';
import { getFlashSession, commitSession } from '~/lib/session.server';
import { sendAlimtalk, AlimtalkType } from '~/lib/alimtalk.server';
import { sendStampProgressAlimtalk } from '~/lib/stamp-notification.server';
import { STAMPS_PER_CARD, ensureCouponForCompletedStampCard } from '~/lib/stamp-coupon.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const claimCode = url.searchParams.get('claimCode');
  return { claimCode };
};

const formSchema = z.object({
  name: z.string().min(2, { message: '이름은 2자 이상 입력해 주세요.' }),
  phoneNumber: z
    .string()
    .regex(/^\d{3}-?\d{3,4}-?\d{4}$/, { message: '올바른 전화번호를 입력해 주세요.' })
    .transform((value) => value.replace(/\D/g, '')),
  password: z.string().min(4, { message: '비밀번호는 4자 이상 입력해 주세요.' }),
  agreedToTerms: z.boolean().refine((value) => value, {
    message: '이용약관에 동의해 주세요.',
  }),
  agreedToPrivacyPolicy: z.boolean().refine((value) => value, {
    message: '개인정보처리방침에 동의해 주세요.',
  }),
  agreedToMarketing: z.boolean().default(false).optional(),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const claimCodeRaw = formData.get('claimCode');
  const claimCode = typeof claimCodeRaw === 'string' && claimCodeRaw.trim().length > 0 ? claimCodeRaw : null;

  const submission = {
    name: formData.get('name'),
    phoneNumber: formData.get('phoneNumber'),
    password: formData.get('password'),
    agreedToTerms: formData.get('agreedToTerms') === 'true',
    agreedToPrivacyPolicy: formData.get('agreedToPrivacyPolicy') === 'true',
    agreedToMarketing: formData.get('agreedToMarketing') === 'true',
  };

  const flashSession = await getFlashSession(request.headers.get('Cookie'));
  const validationResult = formSchema.safeParse(submission);

  if (!validationResult.success) {
    const firstError = validationResult.error.issues[0]?.message ?? '입력한 내용을 다시 확인해 주세요.';
    flashSession.flash('toast', { message: firstError, type: 'error' });
    return redirect(`/signup${claimCode ? `?claimCode=${claimCode}` : ''}`, {
      headers: { 'Set-Cookie': await commitSession(flashSession) },
    });
  }

  const { name, phoneNumber, password, agreedToTerms, agreedToPrivacyPolicy, agreedToMarketing } = validationResult.data;
  const hashedPassword = hashPassword(password);

  try {
    const transactionResult = await db.$transaction(async (prisma) => {
      const existingUser = await prisma.user.findUnique({ where: { phoneNumber } });
      let userId: string;
      let stampNotification: { eventName: string; currentCount: number } | null = null;

        if (existingUser) {
          if (existingUser.status === 'ACTIVE') {
            throw new Prisma.PrismaClientKnownRequestError('이미 사용 중인 전화번호입니다.', {
              code: 'P2002',
              clientVersion: '',
            });
        }

        const updatedUser = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            name,
            status: 'ACTIVE',
            agreedToTerms,
            agreedToPrivacyPolicy,
            agreedToMarketing,
          },
          select: { id: true },
        });

        userId = updatedUser.id;

        await prisma.key.create({
          data: {
            id: `password:${phoneNumber}`,
            userId,
            hashedPassword,
          },
        });
      } else {
        const createdUser = await prisma.user.create({
          data: {
            name,
            phoneNumber,
            status: 'ACTIVE',
            agreedToTerms,
            agreedToPrivacyPolicy,
            agreedToMarketing,
            keys: {
              create: {
                id: `password:${phoneNumber}`,
                hashedPassword,
              },
            },
          },
          select: { id: true },
        });

        userId = createdUser.id;
      }

      if (claimCode) {
        const claimableStamp = await prisma.claimableStamp.findUnique({
          where: { claimCode },
          include: { event: true },
        });

        if (!claimableStamp) {
          throw new Error('유효하지 않은 적립 코드입니다.');
        }
        if (new Date() > claimableStamp.expiresAt) {
          throw new Error('만료된 적립 코드입니다.');
        }
        if (claimableStamp.maxUses !== null && claimableStamp.currentUses >= claimableStamp.maxUses) {
          throw new Error('이미 모두 사용된 적립 코드입니다.');
        }

        const existingRedemption = await prisma.claimableStampRedemption.findUnique({
          where: {
            claimableStampId_userId: {
              claimableStampId: claimableStamp.id,
              userId,
            },
          },
        });

        if (existingRedemption) {
          throw new Error('이미 사용한 적립 코드입니다.');
        }

        let activeStampCard = await prisma.stampCard.findFirst({
          where: { userId, isRedeemed: false },
          include: { _count: { select: { entries: true } } },
        });

        if (!activeStampCard || activeStampCard._count.entries >= STAMPS_PER_CARD) {
          activeStampCard = await prisma.stampCard.create({
            data: { userId },
            include: { _count: { select: { entries: true } } },
          });
        }

        await prisma.stampEntry.create({
          data: {
            userId,
            eventId: claimableStamp.eventId,
            stampCardId: activeStampCard.id,
          },
        });

        const nextStampCount = activeStampCard._count.entries + 1;

        if (nextStampCount >= STAMPS_PER_CARD) {
          await ensureCouponForCompletedStampCard(prisma, {
            stampCardId: activeStampCard.id,
            userId,
          });
        }

        await prisma.claimableStamp.update({
          where: { id: claimableStamp.id },
          data: {
            currentUses: { increment: 1 },
            redemptions: {
              create: { userId },
            },
          },
        });

        stampNotification = {
          eventName: claimableStamp.event.name,
          currentCount: nextStampCount,
        };
      }

      return {
        userId,
        stampNotification,
      };
    });

    const appUrl = process.env.APP_URL ?? new URL(request.url).origin;

    const notificationJobs: Promise<unknown>[] = [
      sendAlimtalk(AlimtalkType.WELCOME, phoneNumber, {
        link: appUrl,
      }),
    ];

    if (transactionResult.stampNotification) {
      notificationJobs.push(
        sendStampProgressAlimtalk({
          phoneNumber,
          customerName: name,
          eventName: transactionResult.stampNotification.eventName,
          currentCount: transactionResult.stampNotification.currentCount,
          appUrl,
        })
      );
    }

    const notificationResults = await Promise.allSettled(notificationJobs);
    for (const [index, result] of notificationResults.entries()) {
      if (result.status === 'rejected') {
        const type = index === 0 ? 'WELCOME' : 'STAMP_ACQUIRED';
        console.error(`[Alimtalk Error] Failed to send ${type} to ${phoneNumber.slice(-4)}`, result.reason);
      }
    }

    const session = await lucia.createSession(transactionResult.userId, {});
    const sessionCookie = lucia.createSessionCookie(session.id);

    flashSession.flash('toast', {
      type: 'success',
      message: claimCode ? '회원가입과 스탬프 적립이 완료되었습니다.' : '회원가입이 완료되었습니다.',
    });

    const headers = new Headers();
    headers.append('Set-Cookie', sessionCookie.serialize());
    headers.append('Set-Cookie', await commitSession(flashSession));

    return redirect(claimCode ? '/card' : '/', { headers });
  } catch (error: unknown) {
    const message =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
        ? '이미 사용 중인 전화번호입니다.'
        : error instanceof Error
          ? error.message
          : '회원가입 중 오류가 발생했습니다.';

    flashSession.flash('toast', { message, type: 'error' });
    return redirect(`/signup${claimCode ? `?claimCode=${claimCode}` : ''}`, {
      headers: { 'Set-Cookie': await commitSession(flashSession) },
    });
  }
};

function PolicyDialog({
  triggerText,
  title,
  children,
}: {
  triggerText: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="link" type="button" className="p-0 h-auto text-xs text-muted-foreground hover:text-primary">
          {triggerText}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl">{title}</DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <div className="prose max-w-none text-sm overflow-y-auto max-h-[60vh] pr-4">{children}</div>
        <DialogFooter className="pt-4 border-t">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              닫기
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SignupPage() {
  const { claimCode } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      phoneNumber: '',
      password: '',
      agreedToTerms: false,
      agreedToPrivacyPolicy: false,
      agreedToMarketing: false,
    },
  });

  const handleAllAgreementChange = (checked: boolean | 'indeterminate') => {
    const isChecked = checked === true;
    form.setValue('agreedToTerms', isChecked);
    form.setValue('agreedToPrivacyPolicy', isChecked);
    form.setValue('agreedToMarketing', isChecked);
  };

  const isAllAgreed =
    form.watch('agreedToTerms') && form.watch('agreedToPrivacyPolicy') && form.watch('agreedToMarketing');

  function onSubmit(values: z.infer<typeof formSchema>) {
    const formData = new FormData();
    formData.append('name', values.name);
    formData.append('phoneNumber', values.phoneNumber);
    formData.append('password', values.password);
    formData.append('agreedToTerms', String(values.agreedToTerms));
    formData.append('agreedToPrivacyPolicy', String(values.agreedToPrivacyPolicy));
    formData.append('agreedToMarketing', String(values.agreedToMarketing || false));
    if (claimCode) {
      formData.append('claimCode', claimCode);
    }
    fetcher.submit(formData, { method: 'post' });
  }

  return (
    <div className="container mx-auto flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">회원가입</CardTitle>
          <CardDescription>계정을 만들고 서비스를 시작해 보세요.</CardDescription>
        </CardHeader>
        <CardContent>
          {claimCode && (
            <div className="flex p-4 mb-4 text-sm text-green-800 rounded-lg bg-green-50" role="alert">
              <div>
                <span className="font-medium">적립 코드를 확인했어요.</span> 회원가입을 완료하면 스탬프가 적립됩니다.
              </div>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} method="post" className="space-y-4">
              <FormField
                control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>이름</FormLabel>
                      <FormControl>
                        <Input placeholder="이름을 입력해 주세요" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                )}
              />

              <FormField
                control={form.control}
                  name="phoneNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>전화번호</FormLabel>
                      <FormControl>
                        <Input placeholder="01012345678" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>비밀번호</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="비밀번호를 입력해 주세요" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                )}
              />

              <div className="space-y-3 rounded-md border p-4">
                <div className="flex items-center space-x-2">
                  <Checkbox id="all-agree" checked={isAllAgreed} onCheckedChange={handleAllAgreementChange} />
                  <label
                    htmlFor="all-agree"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    전체 동의(마케팅 포함)
                  </label>
                </div>

                <Separator />

                <FormField
                  control={form.control}
                  name="agreedToTerms"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between space-y-0">
                      <div className="flex items-center space-x-2">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="text-sm font-normal">[필수] 이용약관</FormLabel>
                      </div>
                      <PolicyDialog triggerText="보기" title="이용약관">
                        <TermsOfServiceContent />
                      </PolicyDialog>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="agreedToPrivacyPolicy"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between space-y-0">
                      <div className="flex items-center space-x-2">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="text-sm font-normal">[필수] 개인정보처리방침</FormLabel>
                      </div>
                      <PolicyDialog triggerText="보기" title="개인정보처리방침">
                        <PrivacyPolicyContent />
                      </PolicyDialog>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="agreedToMarketing"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="text-sm font-normal">[선택] 마케팅 수신 동의</FormLabel>
                    </FormItem>
                  )}
                />

                <FormMessage>
                  {form.formState.errors.agreedToTerms?.message ||
                    form.formState.errors.agreedToPrivacyPolicy?.message}
                </FormMessage>
              </div>

              <Button type="submit" className="w-full" disabled={fetcher.state !== 'idle'}>
                {fetcher.state !== 'idle' ? '가입 중...' : '회원가입'}
              </Button>
            </form>
          </Form>

          <div className="mt-4 text-center text-xs">
            이미 계정이 있으신가요?{' '}
            <Link to="/login" className="underline">
              로그인
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
