import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect, useFetcher } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { db } from "~/lib/db.server";
import { commitSession, getFlashSession } from "~/lib/session.server";
import { hashPassword } from "~/lib/auth.server";

const PASSWORD_RESET_VERIFIED_TTL_MS = 20 * 60 * 1000;

const formSchema = z.object({
  password: z.string().min(4, { message: "비밀번호는 4자리 이상이어야 합니다." }),
});

function clearPasswordResetSession(session: Awaited<ReturnType<typeof getFlashSession>>) {
  session.unset("verificationCode");
  session.unset("passwordResetUserId");
  session.unset("passwordResetCodeIssuedAt");
  session.unset("passwordResetCodeExpiresAt");
  session.unset("isVerifiedForPasswordReset");
  session.unset("passwordResetVerifiedAt");
}

function isVerificationExpired(verifiedAtRaw: unknown) {
  const verifiedAt = Number(verifiedAtRaw ?? 0);
  return !Number.isFinite(verifiedAt) || Date.now() - verifiedAt > PASSWORD_RESET_VERIFIED_TTL_MS;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  const isVerified = Boolean(flashSession.get("isVerifiedForPasswordReset"));
  const hasUser = flashSession.has("passwordResetUserId");
  const isExpired = isVerificationExpired(flashSession.get("passwordResetVerifiedAt"));

  if (!isVerified || !hasUser || isExpired) {
    clearPasswordResetSession(flashSession);
    if (isExpired) {
      flashSession.flash("toast", {
        type: "error",
        message: "재설정 세션이 만료되었습니다. 인증을 다시 진행해주세요.",
      });
    }
    return redirect("/forgot-password", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const flashSession = await getFlashSession(request.headers.get("Cookie"));

  const validationResult = formSchema.safeParse({
    password: formData.get("password"),
  });

  if (!validationResult.success) {
    flashSession.flash("toast", {
      type: "error",
      message: validationResult.error.issues[0]?.message ?? "유효하지 않은 비밀번호입니다.",
    });
    return redirect("/forgot-password/reset", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  const isVerified = Boolean(flashSession.get("isVerifiedForPasswordReset"));
  const userIdRaw = flashSession.get("passwordResetUserId");
  const userId = typeof userIdRaw === "string" ? userIdRaw : "";
  const isExpired = isVerificationExpired(flashSession.get("passwordResetVerifiedAt"));

  if (!isVerified || !userId || isExpired) {
    clearPasswordResetSession(flashSession);
    flashSession.flash("toast", {
      type: "error",
      message: "재설정 세션이 만료되었습니다. 처음부터 다시 진행해주세요.",
    });
    return redirect("/forgot-password", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, phoneNumber: true },
  });

  if (!user) {
    clearPasswordResetSession(flashSession);
    flashSession.flash("toast", {
      type: "error",
      message: "사용자 정보를 찾을 수 없습니다. 처음부터 다시 진행해주세요.",
    });
    return redirect("/forgot-password", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  const hashedPassword = hashPassword(validationResult.data.password);
  const keyId = `password:${user.phoneNumber}`;

  await db.$transaction(async (prisma) => {
    await prisma.key.upsert({
      where: { id: keyId },
      create: {
        id: keyId,
        userId: user.id,
        hashedPassword,
      },
      update: {
        userId: user.id,
        hashedPassword,
      },
    });

    // Invalidate existing sessions after password reset.
    await prisma.session.deleteMany({
      where: { userId: user.id },
    });
  });

  clearPasswordResetSession(flashSession);
  flashSession.flash("toast", {
    type: "success",
    message: "비밀번호가 변경되었습니다. 다시 로그인해주세요.",
  });

  return redirect("/login", {
    headers: { "Set-Cookie": await commitSession(flashSession) },
  });
};

export default function ResetPasswordPage() {
  const fetcher = useFetcher();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "" },
  });

  return (
    <div className="container mx-auto flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">비밀번호 재설정</CardTitle>
          <CardDescription>새 비밀번호를 입력해주세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) => fetcher.submit(values, { method: "post" }))}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>새 비밀번호</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="******" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={fetcher.state !== "idle"}>
                {fetcher.state !== "idle" ? "변경 중..." : "비밀번호 변경하기"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
