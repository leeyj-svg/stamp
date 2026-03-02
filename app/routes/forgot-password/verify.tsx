import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect, useFetcher } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { commitSession, getFlashSession } from "~/lib/session.server";

function clearPasswordResetSession(session: Awaited<ReturnType<typeof getFlashSession>>) {
  session.unset("verificationCode");
  session.unset("passwordResetUserId");
  session.unset("passwordResetCodeIssuedAt");
  session.unset("passwordResetCodeExpiresAt");
  session.unset("isVerifiedForPasswordReset");
  session.unset("passwordResetVerifiedAt");
}

function isExpired(expiresAtRaw: unknown) {
  const expiresAt = Number(expiresAtRaw ?? 0);
  return !Number.isFinite(expiresAt) || Date.now() > expiresAt;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  const hasRequiredSession =
    flashSession.has("verificationCode") &&
    flashSession.has("passwordResetUserId") &&
    flashSession.has("passwordResetCodeExpiresAt");

  if (!hasRequiredSession) {
    clearPasswordResetSession(flashSession);
    return redirect("/forgot-password", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  if (isExpired(flashSession.get("passwordResetCodeExpiresAt"))) {
    clearPasswordResetSession(flashSession);
    flashSession.flash("toast", {
      type: "error",
      message: "인증번호가 만료되었습니다. 다시 요청해주세요.",
    });
    return redirect("/forgot-password", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const codeRaw = formData.get("code");
  const code = typeof codeRaw === "string" ? codeRaw.trim() : "";
  const flashSession = await getFlashSession(request.headers.get("Cookie"));

  const verificationCode = String(flashSession.get("verificationCode") ?? "");
  const isCodeExpired = isExpired(flashSession.get("passwordResetCodeExpiresAt"));

  if (isCodeExpired || !verificationCode) {
    clearPasswordResetSession(flashSession);
    flashSession.flash("toast", {
      type: "error",
      message: "인증번호가 만료되었습니다. 다시 요청해주세요.",
    });
    return redirect("/forgot-password", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  if (!/^\d{6}$/.test(code)) {
    flashSession.flash("toast", { type: "error", message: "유효한 6자리 인증번호를 입력해주세요." });
    return redirect("/forgot-password/verify", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  if (code !== verificationCode) {
    flashSession.flash("toast", { type: "error", message: "인증번호가 올바르지 않습니다." });
    return redirect("/forgot-password/verify", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  flashSession.unset("verificationCode");
  flashSession.unset("passwordResetCodeIssuedAt");
  flashSession.unset("passwordResetCodeExpiresAt");
  flashSession.set("isVerifiedForPasswordReset", true);
  flashSession.set("passwordResetVerifiedAt", Date.now());

  return redirect("/forgot-password/reset", {
    headers: { "Set-Cookie": await commitSession(flashSession) },
  });
};

const formSchema = z.object({
  code: z.string().length(6, { message: "6자리 인증번호를 입력해주세요." }),
});

export default function VerifyCodePage() {
  const fetcher = useFetcher();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { code: "" },
  });

  return (
    <div className="container mx-auto flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">인증번호 입력</CardTitle>
          <CardDescription>휴대폰으로 전송된 6자리 인증번호를 입력해주세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) => fetcher.submit(values, { method: "post" }))}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>인증번호</FormLabel>
                    <FormControl>
                      <Input placeholder="123456" inputMode="numeric" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={fetcher.state !== "idle"}>
                {fetcher.state !== "idle" ? "확인 중..." : "인증번호 확인"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
