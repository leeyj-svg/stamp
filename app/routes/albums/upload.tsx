import { unstable_createMemoryUploadHandler, unstable_parseMultipartFormData } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { getSession } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import {
  attachAssetToImmichAlbum,
  ensureImmichAlbum,
  isImmichSyncAvailable,
  uploadFileToImmich,
} from "~/lib/immich.server";
import { processAndUploadImage } from "~/lib/upload.server";

type ActionData = {
  error?: string;
  success?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await getSession(request);
  const albums = await db.photoAlbum.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return { albums, user, immichSyncEnabled: isImmichSyncAvailable() };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { user } = await getSession(request);

  const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: 100_000_000 });
  const formData = await unstable_parseMultipartFormData(request, uploadHandler);

  const albumId = Number(formData.get("albumId"));
  const caption = (formData.get("caption") as string | null)?.trim() || null;
  const uploaderNameInput = (formData.get("uploaderName") as string | null)?.trim() || null;

  if (!Number.isInteger(albumId) || albumId <= 0) {
    return { error: "앨범을 선택해 주세요." };
  }

  const album = await db.photoAlbum.findFirst({
    where: { id: albumId, isActive: true },
    select: { id: true, name: true, description: true, immichAlbumId: true },
  });

  if (!album) {
    return { error: "유효하지 않은 앨범입니다." };
  }

  const files = formData.getAll("photos").filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length === 0) {
    return { error: "업로드할 사진을 선택해 주세요." };
  }

  let immichAlbumId = album.immichAlbumId;
  let immichSyncFailed = false;

  if (isImmichSyncAvailable()) {
    try {
      const resolvedAlbumId = await ensureImmichAlbum({
        immichAlbumId: album.immichAlbumId,
        name: album.name,
        description: album.description,
      });

      if (resolvedAlbumId && resolvedAlbumId !== album.immichAlbumId) {
        await db.photoAlbum.update({
          where: { id: album.id },
          data: { immichAlbumId: resolvedAlbumId },
        });
      }

      immichAlbumId = resolvedAlbumId;
    } catch (error) {
      immichSyncFailed = true;
      console.warn("[immich] album ensure failed", error);
    }
  }

  const uploadRows: Array<{
    albumId: number;
    imageUrl: string;
    immichAssetId: string | null;
    caption: string | null;
    uploadedByUserId: string | null;
    uploaderName: string;
    takenAt: Date | null;
  }> = [];

  let immichSyncedCount = 0;

  for (const file of files) {
    const local = await processAndUploadImage(file);
    if (!local) continue;

    let immichAssetId: string | null = null;
    if (immichAlbumId) {
      try {
        const uploadedAssetId = await uploadFileToImmich(file, local.takenAt);
        if (uploadedAssetId) {
          await attachAssetToImmichAlbum(immichAlbumId, uploadedAssetId);
          immichAssetId = uploadedAssetId;
          immichSyncedCount += 1;
        }
      } catch (error) {
        immichSyncFailed = true;
        console.warn("[immich] asset sync failed", error);
      }
    }

    uploadRows.push({
      albumId,
      imageUrl: local.url,
      immichAssetId,
      caption,
      uploadedByUserId: user?.id || null,
      uploaderName: user?.name || uploaderNameInput || "익명",
      takenAt: local.takenAt,
    });
  }

  if (uploadRows.length === 0) {
    return { error: "이미지 업로드에 실패했습니다. 저장 서버 설정을 확인해 주세요." };
  }

  await db.albumPhoto.createMany({ data: uploadRows });

  const partial = uploadRows.length < files.length;
  const immichSuffix = isImmichSyncAvailable()
    ? ` · Immich ${immichSyncedCount}/${uploadRows.length}장 동기화${immichSyncFailed ? " (일부 실패)" : ""}`
    : "";

  if (partial) {
    return { success: `${uploadRows.length}/${files.length}장 업로드 완료 (일부 실패)${immichSuffix}` };
  }

  return { success: `${uploadRows.length}장 업로드 완료${immichSuffix}` };
};

export default function AlbumUploadPage() {
  const { albums, user, immichSyncEnabled } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="max-w-xl mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>앨범 사진 업로드</CardTitle>
          <CardDescription>사진 업로드는 누구나 가능, 앨범 조회는 회원 전용</CardDescription>
          <CardDescription>
            Immich 연동: {immichSyncEnabled ? "활성화됨" : "비활성화됨 (IMMICH_URL, IMMICH_API_KEY 필요)"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" encType="multipart/form-data" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="albumId">앨범 선택</Label>
              <select
                id="albumId"
                name="albumId"
                className="w-full border rounded-md px-3 py-2 bg-background"
                defaultValue=""
                required
              >
                <option value="" disabled>
                  앨범 선택
                </option>
                {albums.map((album) => (
                  <option key={album.id} value={album.id}>
                    {album.name}
                  </option>
                ))}
              </select>
            </div>

            {!user && (
              <div className="space-y-2">
                <Label htmlFor="uploaderName">업로더 이름(선택)</Label>
                <Input id="uploaderName" name="uploaderName" placeholder="익명으로 남기려면 비워두세요" />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="caption">설명(선택)</Label>
              <Input id="caption" name="caption" placeholder="예: 3월 2주 봉사 활동" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="photos">사진 파일</Label>
              <Input id="photos" type="file" name="photos" accept="image/*" multiple required />
            </div>

            {actionData?.error && <p className="text-sm text-red-600">{actionData.error}</p>}
            {actionData?.success && <p className="text-sm text-green-600">{actionData.success}</p>}

            <Button type="submit" className="w-full" disabled={isSubmitting || albums.length === 0}>
              {isSubmitting ? "업로드 중..." : "업로드"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
