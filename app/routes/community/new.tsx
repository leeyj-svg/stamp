import { redirect, useActionData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

type ActionData = { error?: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await getSessionWithPermission(request, "MEMBER");
  return null;
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData | Response> => {
  const { user } = await getSessionWithPermission(request, "MEMBER");
  const formData = await request.formData();

  const title = (formData.get("title") as string | null)?.trim() || "";
  const content = (formData.get("content") as string | null)?.trim() || "";

  if (title.length < 2) {
    return { error: "제목은 2자 이상 입력해 주세요." };
  }
  if (content.length < 5) {
    return { error: "본문은 5자 이상 입력해 주세요." };
  }

  const post = await db.communityPost.create({
    data: { title, content, userId: user.id },
    select: { id: true },
  });

  return redirect(`/community/${post.id}`);
};

export default function NewCommunityPostPage() {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="max-w-2xl mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>커뮤니티 글쓰기</CardTitle>
          <CardDescription>회원만 작성할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">제목</Label>
              <Input id="title" name="title" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">내용</Label>
              <Textarea id="content" name="content" rows={10} required />
            </div>

            {actionData?.error && <p className="text-sm text-red-600">{actionData.error}</p>}

            <div className="flex justify-end">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "등록 중..." : "등록"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
