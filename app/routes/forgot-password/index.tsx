import { type ActionFunctionArgs, redirect, useFetcher } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { db } from "~/lib/db.server";
import { commitSession, getFlashSession } from "~/lib/session.server";
import { sendAlimtalk, AlimtalkType } from "~/lib/alimtalk.server";

const PASSWORD_RESET_CODE_TTL_MS = 10 * 60 * 1000;
// 서버 로직 (Action)
export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const phoneNumber = (formData.get("phoneNumber") as string).replace(/\D/g, '');
  const flashSession = await getFlashSession(request.headers.get("Cookie"));

  const user = await db.user.findUnique({ where: { phoneNumber } });

  if (!user) {
    flashSession.flash("toast", { type: "error", message: "가입되지 않은 핸드폰 번호입니다." });
    return redirect("/forgot-password", {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  // 실제로는 SMS를 보내야 하지만, 여기서는 6자리 코드를 생성하여 세션에 저장합니다.
  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
   await sendAlimtalk(AlimtalkType.PASSWORD_RESET, phoneNumber, {
    "인증번호": verificationCode
  }); // 개발용으로 콘솔에 출력

  flashSession.set("verificationCode", verificationCode);
  flashSession.set("passwordResetCodeIssuedAt", Date.now());
  flashSession.set("passwordResetCodeExpiresAt", Date.now() + PASSWORD_RESET_CODE_TTL_MS);
  flashSession.unset("isVerifiedForPasswordReset");
  flashSession.unset("passwordResetVerifiedAt");
  flashSession.set("passwordResetUserId", user.id); // 비밀번호를 변경할 사용자 ID 저장
  
  return redirect("/forgot-password/verify", {
    headers: { "Set-Cookie": await commitSession(flashSession) },
  });
};

// UI 컴포넌트
const formSchema = z.object({
  phoneNumber: z.string().min(1, { message: "핸드폰 번호를 입력해주세요." }),
});

export default function ForgotPasswordPage() {
  const fetcher = useFetcher();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { phoneNumber: "" },
  });

  return (
    <div className="container mx-auto flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">비밀번호 찾기</CardTitle>
          <CardDescription>가입 시 사용한 핸드폰 번호를 입력해주세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((values) => fetcher.submit(values, { method: "post" }))} className="space-y-4">
              <FormField
                control={form.control}
                name="phoneNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>핸드폰 번호</FormLabel>
                    <FormControl>
                      <Input placeholder="01012345678" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={fetcher.state !== 'idle'}>
                {fetcher.state !== 'idle' ? '인증번호 요청 중...' : '인증번호 받기'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
