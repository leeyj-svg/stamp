import { json, MaxPartSizeExceededError, unstable_createMemoryUploadHandler, unstable_parseMultipartFormData } from "@remix-run/node";
import type { ActionFunctionArgs } from "react-router";

import { getSession } from "~/lib/auth.server";
import { myPostsCookie } from "~/lib/cookies.server";
import { db } from "~/lib/db.server";
import { upsertPostAppearancesForPost } from "~/lib/space-theme.server";
import { getPhotoLimitError, MAX_PHOTO_UPLOAD_BYTES, type PhotoUploadResponse } from "~/lib/space-upload";
import { processAndUploadImage } from "~/lib/upload.server";

function clampText(value: FormDataEntryValue | null, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

async function appendMyPostCookie(request: Request, postIds: string[]) {
  const cookieHeader = request.headers.get("Cookie");
  const myPostIds = (await myPostsCookie.parse(cookieHeader)) || [];
  return myPostsCookie.serialize([...myPostIds, ...postIds]);
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (!params.spaceId) {
    return json({ success: false, error: "SPACE를 찾을 수 없어요." } satisfies PhotoUploadResponse, { status: 404 });
  }

  const { user } = await getSession(request);
  const space = await db.memorySpace.findUnique({
    where: { id: params.spaceId },
    select: { id: true, themeKey: true },
  });

  if (!space) {
    return json({ success: false, error: "SPACE를 찾을 수 없어요." } satisfies PhotoUploadResponse, { status: 404 });
  }

  const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: MAX_PHOTO_UPLOAD_BYTES });
  let formData: FormData;

  try {
    formData = await unstable_parseMultipartFormData(request, uploadHandler);
  } catch (error) {
    if (error instanceof MaxPartSizeExceededError) {
      return json({ success: false, error: getPhotoLimitError() } satisfies PhotoUploadResponse, { status: 413 });
    }
    console.error("Failed to parse SPACE photo upload form", error);
    return json({ success: false, error: "업로드 요청을 처리하지 못했어요. 다시 시도해 주세요." } satisfies PhotoUploadResponse, { status: 400 });
  }

  const nickname = clampText(formData.get("nickname"), 80);
  if (!nickname) {
    return json({ success: false, error: "보내는 사람을 입력해 주세요." } satisfies PhotoUploadResponse, { status: 400 });
  }

  const photoFile = formData.get("photo");
  if (!(photoFile instanceof File) || photoFile.size === 0) {
    return json({ success: false, error: "사진 파일이 필요합니다." } satisfies PhotoUploadResponse, { status: 400 });
  }

  if (photoFile.size > MAX_PHOTO_UPLOAD_BYTES) {
    return json({ success: false, error: getPhotoLimitError() } satisfies PhotoUploadResponse, { status: 413 });
  }

  const uploadResult = await processAndUploadImage(photoFile).catch((error) => {
    console.error("Failed to upload SPACE album photo", error);
    return null;
  });
  if (!uploadResult) {
    return json({ success: false, error: "사진 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요." } satisfies PhotoUploadResponse, { status: 500 });
  }

  try {
    const newPost = await db.$transaction(async (tx) => {
      const createdPost = await tx.memoryPost.create({
        data: {
          spaceId: space.id,
          type: "ALBUM",
          content: clampText(formData.get("content"), 1000),
          mediaUrl: uploadResult.url,
          thumbnailUrl: uploadResult.thumbnailUrl,
          nickname,
          writerId: user?.id || null,
          createdAt: uploadResult.takenAt ? new Date(uploadResult.takenAt) : new Date(),
        },
      });

      await upsertPostAppearancesForPost(tx, createdPost, space.themeKey);
      return createdPost;
    });

    return json(
      { success: true, postId: newPost.id } satisfies PhotoUploadResponse,
      { headers: { "Set-Cookie": await appendMyPostCookie(request, [String(newPost.id)]) } }
    );
  } catch (error) {
    console.error("Failed to save SPACE album photo", error);
    return json({ success: false, error: "사진 설명 저장에 실패했어요. 내용을 조금 줄이거나 다시 시도해 주세요." } satisfies PhotoUploadResponse, { status: 500 });
  }
}
