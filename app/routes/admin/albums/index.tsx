import { Form, useActionData, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { requireAdminAccessScope } from "~/lib/admin-access.server";
import { db } from "~/lib/db.server";

type ActionData = {
  error?: string;
  success?: string;
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdminAccessScope(request);

  const albums = await db.photoAlbum.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { photos: true } },
    },
  });

  return { albums };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  await requireAdminAccessScope(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const name = (formData.get("name") as string | null)?.trim() || "";
    const description = (formData.get("description") as string | null)?.trim() || null;

    if (name.length < 2) {
      return { error: "앨범 이름은 2자 이상 입력해 주세요." };
    }

    const baseSlug = slugify(name) || `album-${Date.now()}`;
    let slug = baseSlug;
    let i = 1;
    while (await db.photoAlbum.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${baseSlug}-${i++}`;
    }

    await db.photoAlbum.create({
      data: { name, slug, description, isActive: true },
    });

    return { success: "앨범이 생성되었습니다." };
  }

  if (intent === "toggle_active") {
    const albumId = Number(formData.get("albumId"));
    if (!Number.isInteger(albumId) || albumId <= 0) {
      return { error: "유효하지 않은 앨범입니다." };
    }

    const album = await db.photoAlbum.findUnique({
      where: { id: albumId },
      select: { id: true, isActive: true },
    });
    if (!album) {
      return { error: "앨범을 찾을 수 없습니다." };
    }

    await db.photoAlbum.update({
      where: { id: album.id },
      data: { isActive: !album.isActive },
    });

    return { success: "앨범 상태가 변경되었습니다." };
  }

  if (intent === "delete") {
    const albumId = Number(formData.get("albumId"));
    if (!Number.isInteger(albumId) || albumId <= 0) {
      return { error: "유효하지 않은 앨범입니다." };
    }

    const album = await db.photoAlbum.findUnique({
      where: { id: albumId },
      select: { id: true, name: true },
    });

    if (!album) {
      return { error: "앨범을 찾을 수 없습니다." };
    }

    await db.photoAlbum.delete({ where: { id: albumId } });
    return { success: `앨범 '${album.name}'을(를) 삭제했습니다.` };
  }

  return { error: "지원하지 않는 요청입니다." };
};

export default function AdminAlbumPage() {
  const { albums } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>앨범 관리</CardTitle>
          <CardDescription>운영진이 앨범을 만들고, 이용자는 활성 앨범에 사진을 업로드합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Form method="post" className="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end">
            <input type="hidden" name="intent" value="create" />
            <div className="space-y-1">
              <Label htmlFor="name">앨범 이름</Label>
              <Input id="name" name="name" placeholder="예: 봉사방 2026 봄" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description">설명(선택)</Label>
              <Input id="description" name="description" placeholder="앨범 설명" />
            </div>
            <Button type="submit">생성</Button>
          </Form>

          {actionData?.error && <p className="text-sm text-red-600">{actionData.error}</p>}
          {actionData?.success && <p className="text-sm text-green-600">{actionData.success}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>앨범 목록</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {albums.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 앨범이 없습니다.</p>
          ) : (
            albums.map((album) => (
              <div key={album.id} className="border rounded-md p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{album.name}</p>
                  <p className="text-xs text-muted-foreground">
                    slug: {album.slug} · 사진 {album._count.photos}장
                  </p>
                  {album.immichAlbumId && (
                    <p className="text-xs text-muted-foreground">Immich Album ID: {album.immichAlbumId}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={album.isActive ? "default" : "secondary"}>
                    {album.isActive ? "활성" : "비활성"}
                  </Badge>
                  <Form method="post">
                    <input type="hidden" name="intent" value="toggle_active" />
                    <input type="hidden" name="albumId" value={album.id} />
                    <Button type="submit" variant="outline" size="sm">
                      {album.isActive ? "비활성화" : "활성화"}
                    </Button>
                  </Form>
                  <Form
                    method="post"
                    onSubmit={(event) => {
                      if (!confirm(`앨범 '${album.name}'을(를) 삭제하시겠습니까?`)) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="albumId" value={album.id} />
                    <Button type="submit" variant="destructive" size="sm">
                      삭제
                    </Button>
                  </Form>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
