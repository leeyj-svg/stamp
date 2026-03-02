import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useSearchParams } from "react-router";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { requireAdminAccessScope } from "~/lib/admin-access.server";
import { db } from "~/lib/db.server";
import { commitSession, getFlashSession } from "~/lib/session.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const scope = await requireAdminAccessScope(request);
  if (!scope.isAdmin) {
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  const [categories, users] = await db.$transaction([
    db.eventCategory.findMany({
      orderBy: { name: "asc" },
      include: {
        managers: {
          include: {
            user: { select: { id: true, name: true, phoneNumber: true, role: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    db.user.findMany({
      where: {
        AND: [
          { role: { in: ["MEMBER", "ADMIN"] } },
          q
            ? {
                OR: [{ name: { contains: q } }, { phoneNumber: { contains: q } }],
              }
            : {},
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, name: true, phoneNumber: true, role: true },
    }),
  ]);

  return { q, categories, users };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const scope = await requireAdminAccessScope(request);
  if (!scope.isAdmin) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  const categoryId = Number(formData.get("categoryId"));
  const userId = (formData.get("userId") as string) || "";
  const q = (formData.get("q") as string) || "";

  const flashSession = await getFlashSession(request.headers.get("Cookie"));

  if (!Number.isInteger(categoryId) || !userId) {
    flashSession.flash("toast", { type: "error", message: "카테고리와 사용자를 선택해 주세요." });
    return redirect(`/admin/categories/managers?q=${encodeURIComponent(q)}`, {
      headers: { "Set-Cookie": await commitSession(flashSession) },
    });
  }

  if (intent === "add_manager") {
    await db.eventCategoryManager.upsert({
      where: { userId_categoryId: { userId, categoryId } },
      create: { userId, categoryId },
      update: {},
    });
    flashSession.flash("toast", { type: "success", message: "카테고리 운영진을 추가했습니다." });
  } else if (intent === "remove_manager") {
    await db.eventCategoryManager.deleteMany({
      where: { userId, categoryId },
    });
    flashSession.flash("toast", { type: "success", message: "카테고리 운영진을 해제했습니다." });
  } else {
    flashSession.flash("toast", { type: "error", message: "지원하지 않는 요청입니다." });
  }

  return redirect(`/admin/categories/managers?q=${encodeURIComponent(q)}`, {
    headers: { "Set-Cookie": await commitSession(flashSession) },
  });
};

export default function CategoryManagersPage() {
  const { q, categories, users } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const selectedQuery = searchParams.get("q") || q;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">카테고리 운영진 관리</h1>
        <p className="text-muted-foreground">카테고리별 운영진을 지정하고 관리합니다.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>운영진 지정</CardTitle>
          <CardDescription>회원(MEMBER/ADMIN)만 카테고리 운영진으로 지정할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="get" className="mb-4">
            <Input name="q" defaultValue={selectedQuery} placeholder="이름/전화번호 검색" />
          </Form>

          <Form method="post" className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input type="hidden" name="intent" value="add_manager" />
            <input type="hidden" name="q" value={selectedQuery} />

            <Select name="categoryId">
              <SelectTrigger>
                <SelectValue placeholder="카테고리 선택" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={String(category.id)}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select name="userId">
              <SelectTrigger>
                <SelectValue placeholder="운영진 선택" />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name} ({user.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button type="submit">운영진 추가</Button>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>카테고리별 운영진 목록</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {categories.map((category) => (
            <div key={category.id} className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{category.name}</h2>
                <Badge variant="outline">{category.managers.length}명</Badge>
              </div>

              {category.managers.length === 0 ? (
                <p className="text-sm text-muted-foreground">지정된 운영진이 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {category.managers.map((manager) => (
                    <div key={manager.id} className="flex items-center justify-between border rounded-md p-2">
                      <div className="text-sm">
                        <p className="font-medium">{manager.user.name}</p>
                        <p className="text-muted-foreground">{manager.user.phoneNumber}</p>
                      </div>
                      <Form method="post">
                        <input type="hidden" name="intent" value="remove_manager" />
                        <input type="hidden" name="categoryId" value={category.id} />
                        <input type="hidden" name="userId" value={manager.user.id} />
                        <input type="hidden" name="q" value={selectedQuery} />
                        <Button type="submit" variant="outline">
                          해제
                        </Button>
                      </Form>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
