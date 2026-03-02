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

const STAMPS_PER_CARD = 10;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const claimCode = url.searchParams.get('claimCode');
  return { claimCode };
};

const formSchema = z.object({
  name: z.string().min(2, { message: 'Please enter at least 2 characters for name.' }),
  phoneNumber: z
    .string()
    .regex(/^\d{3}-?\d{3,4}-?\d{4}$/, { message: 'Please enter a valid phone number.' })
    .transform((value) => value.replace(/\D/g, '')),
  password: z.string().min(4, { message: 'Password must be at least 4 characters.' }),
  agreedToTerms: z.boolean().refine((value) => value, {
    message: 'You must agree to the terms of service.',
  }),
  agreedToPrivacyPolicy: z.boolean().refine((value) => value, {
    message: 'You must agree to the privacy policy.',
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
    const firstError = validationResult.error.issues[0]?.message ?? 'Invalid input.';
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
          throw new Prisma.PrismaClientKnownRequestError('Phone number already in use.', {
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
          throw new Error('Invalid claim code.');
        }
        if (new Date() > claimableStamp.expiresAt) {
          throw new Error('This claim code is expired.');
        }
        if (claimableStamp.maxUses !== null && claimableStamp.currentUses >= claimableStamp.maxUses) {
          throw new Error('This claim code is fully used.');
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
          throw new Error('You already used this claim code.');
        }

        let activeStampCard = await prisma.stampCard.findFirst({
          where: { userId, isRedeemed: false },
          include: { _count: { select: { entries: true } } },
        });

        if (!activeStampCard) {
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
          currentCount: activeStampCard._count.entries + 1,
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
        sendAlimtalk(AlimtalkType.STAMP_ACQUIRED, phoneNumber, {
          고객명: name,
          활동명: transactionResult.stampNotification.eventName,
          현재개수: String(transactionResult.stampNotification.currentCount),
          남은스탬프개수: String(
            Math.max(0, STAMPS_PER_CARD - transactionResult.stampNotification.currentCount)
          ),
          link: `${appUrl}/card`,
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
      message: claimCode ? 'Sign-up and stamp save completed.' : 'Sign-up completed.',
    });

    const headers = new Headers();
    headers.append('Set-Cookie', sessionCookie.serialize());
    headers.append('Set-Cookie', await commitSession(flashSession));

    return redirect(claimCode ? '/card' : '/', { headers });
  } catch (error: unknown) {
    const message =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
        ? 'Phone number already in use.'
        : error instanceof Error
          ? error.message
          : 'Unexpected error occurred during sign-up.';

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
              Close
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
          <CardTitle className="text-2xl">Sign up</CardTitle>
          <CardDescription>Create your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {claimCode && (
            <div className="flex p-4 mb-4 text-sm text-green-800 rounded-lg bg-green-50" role="alert">
              <div>
                <span className="font-medium">Claim code detected.</span> Complete sign-up to receive your stamp.
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
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Your name" {...field} />
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
                    <FormLabel>Phone number</FormLabel>
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
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="******" {...field} />
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
                    Agree all (includes marketing)
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
                        <FormLabel className="text-sm font-normal">[Required] Terms of service</FormLabel>
                      </div>
                      <PolicyDialog triggerText="View" title="Terms of service">
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
                        <FormLabel className="text-sm font-normal">[Required] Privacy policy</FormLabel>
                      </div>
                      <PolicyDialog triggerText="View" title="Privacy policy">
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
                      <FormLabel className="text-sm font-normal">[Optional] Marketing agreement</FormLabel>
                    </FormItem>
                  )}
                />

                <FormMessage>
                  {form.formState.errors.agreedToTerms?.message ||
                    form.formState.errors.agreedToPrivacyPolicy?.message}
                </FormMessage>
              </div>

              <Button type="submit" className="w-full" disabled={fetcher.state !== 'idle'}>
                {fetcher.state !== 'idle' ? 'Submitting...' : 'Sign up'}
              </Button>
            </form>
          </Form>

          <div className="mt-4 text-center text-xs">
            Already have an account?{' '}
            <Link to="/login" className="underline">
              Log in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
