import { useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { Form, redirect, useActionData, useLoaderData, useNavigate, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { json, MaxPartSizeExceededError, unstable_createMemoryUploadHandler, unstable_parseMultipartFormData } from "@remix-run/node";
import { Calendar, Image as ImageIcon, Plus, Sparkles, X, type LucideIcon } from "lucide-react";

import { SpaceThemeBackground } from "~/components/space/SpaceExperience";
import { getSession } from "~/lib/auth.server";
import { myPostsCookie } from "~/lib/cookies.server";
import { db } from "~/lib/db.server";
import { getSpaceTheme } from "~/lib/space-theme";
import { upsertPostAppearancesForPost } from "~/lib/space-theme.server";
import { getPhotoLimitError, MAX_ALBUM_PHOTO_COUNT, MAX_PHOTO_UPLOAD_BYTES, MAX_PHOTO_UPLOAD_MB, type PhotoUploadResponse } from "~/lib/space-upload";
import { processAndUploadImage } from "~/lib/upload.server";

type WriteTab = "MESSAGE" | "ALBUM";
type PhotoUploadStatus = "idle" | "uploading" | "done" | "error";

type PhotoItem = {
  id: number;
  preview: string | null;
  file: File | null;
  content: string;
  status: PhotoUploadStatus;
};

type WriteActionData = {
  error: string;
};

function clampText(value: FormDataEntryValue | null, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

function isPhotoUploadResponse(value: unknown): value is PhotoUploadResponse {
  return typeof value === "object" && value !== null;
}

function getPostIdFromSuccessUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.pathname.endsWith("/success")) return null;
    const postId = Number(parsedUrl.searchParams.get("postId"));
    return Number.isFinite(postId) ? postId : null;
  } catch {
    return null;
  }
}

async function readPhotoUploadResponse(response: Response): Promise<PhotoUploadResponse> {
  const contentType = response.headers.get("content-type") || "";
  const redirectedPostId = getPostIdFromSuccessUrl(response.url);
  if (redirectedPostId) {
    return { success: true, postId: redirectedPostId };
  }

  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json();
      return isPhotoUploadResponse(payload) ? payload : { success: false, error: "업로드 응답을 확인할 수 없어요." };
    } catch {
      return { success: false, error: "업로드 응답을 읽지 못했어요." };
    }
  }

  await response.text().catch(() => "");
  if (response.redirected) {
    return { success: false, error: "업로드 요청이 다른 페이지로 이동했어요. 다시 시도해 주세요." };
  }

  return { success: false, error: `사진 업로드에 실패했습니다. (${response.status})` };
}

function createPhotoItem(file?: File): PhotoItem {
  return { id: Date.now() + Math.floor(Math.random() * 1000), preview: file ? URL.createObjectURL(file) : null, file: file ?? null, content: "", status: "idle" };
}

async function appendMyPostCookie(request: Request, postIds: string[]) {
  const cookieHeader = request.headers.get("Cookie");
  const myPostIds = (await myPostsCookie.parse(cookieHeader)) || [];
  const updatedIds = [...myPostIds, ...postIds];
  return myPostsCookie.serialize(updatedIds);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user } = await getSession(request);
  const space = await db.memorySpace.findUnique({
    where: { id: params.spaceId },
    include: { user: { select: { name: true } } },
  });

  if (!space) throw new Response("Not Found", { status: 404 });
  return { user, space };
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (!params.spaceId) throw new Response("Not Found", { status: 404 });

  const { user } = await getSession(request);
  const space = await db.memorySpace.findUnique({
    where: { id: params.spaceId },
    select: { id: true, themeKey: true },
  });
  if (!space) throw new Response("Not Found", { status: 404 });

  const acceptsJsonResponse = (request.headers.get("Accept") || "").includes("application/json");
  const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: MAX_PHOTO_UPLOAD_BYTES });
  let formData: FormData;
  try {
    formData = await unstable_parseMultipartFormData(request, uploadHandler);
  } catch (error) {
    if (error instanceof MaxPartSizeExceededError) {
      const errorMessage = getPhotoLimitError();
      if (acceptsJsonResponse) {
        return json({ success: false, error: errorMessage } satisfies PhotoUploadResponse, { status: 413 });
      }
      return { error: errorMessage } satisfies WriteActionData;
    }
    console.error("Failed to parse SPACE write form", error);
    const errorMessage = "작성 내용을 처리하지 못했어요. 다시 시도해 주세요.";
    if (acceptsJsonResponse) {
      return json({ success: false, error: errorMessage } satisfies PhotoUploadResponse, { status: 400 });
    }
    return { error: errorMessage } satisfies WriteActionData;
  }

  const type = formData.get("type") === "ALBUM" ? "ALBUM" : "MESSAGE";
  const intent = formData.get("intent");
  const wantsJsonResponse = intent === "upload_album_photo" || acceptsJsonResponse;
  const fail = (error: string, status = 400) =>
    wantsJsonResponse ? json({ success: false, error } satisfies PhotoUploadResponse, { status }) : ({ error } satisfies WriteActionData);
  const nickname = clampText(formData.get("nickname"), 80);
  const createdPostIds: string[] = [];

  if (!nickname) {
    return fail("보내는 사람을 입력해 주세요.");
  }

  if (intent === "upload_album_photo") {
    const photoFile = formData.get("photo");
    if (!(photoFile instanceof File) || photoFile.size === 0) {
      return fail("사진 파일이 필요합니다.");
    }
    if (photoFile.size > MAX_PHOTO_UPLOAD_BYTES) {
      return fail(getPhotoLimitError(), 413);
    }

    const uploadResult = await processAndUploadImage(photoFile).catch((error) => {
      console.error("Failed to upload SPACE album photo", error);
      return null;
    });
    if (!uploadResult) {
      return fail("사진 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.", 500);
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
      return fail("사진 설명 저장에 실패했어요. 내용을 조금 줄이거나 다시 시도해 주세요.", 500);
    }
  }

  if (type === "MESSAGE") {
    const content = clampText(formData.get("content"), 3000);
    if (!content) return fail("메시지를 입력해 주세요.");

    try {
      const newPost = await db.$transaction(async (tx) => {
        const createdPost = await tx.memoryPost.create({
          data: {
            spaceId: space.id,
            type: "MESSAGE",
            content,
            nickname,
            writerId: user?.id || null,
          },
        });
        await upsertPostAppearancesForPost(tx, createdPost, space.themeKey);
        return createdPost;
      });
      createdPostIds.push(String(newPost.id));
    } catch (error) {
      console.error("Failed to save SPACE message", error);
      return fail("쪽지 저장에 실패했어요. 내용을 조금 줄이거나 다시 시도해 주세요.", 500);
    }
  } else {
    const photos = (formData.getAll("photo") as File[]).slice(0, MAX_ALBUM_PHOTO_COUNT);
    const contents = formData.getAll("content");
    const uploadedPhotos: Array<{ url: string; thumbnailUrl: string; takenAt: Date | string | null; content: string }> = [];

    for (let index = 0; index < photos.length; index += 1) {
      const file = photos[index];
      if (!file || file.size === 0) continue;
      if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
        return fail(getPhotoLimitError(), 413);
      }

      const uploadResult = await processAndUploadImage(file).catch((error) => {
        console.error("Failed to upload SPACE album photo", error);
        return null;
      });
      if (!uploadResult) continue;

      uploadedPhotos.push({
        url: uploadResult.url,
        thumbnailUrl: uploadResult.thumbnailUrl,
        takenAt: uploadResult.takenAt,
        content: clampText(contents[index] ?? "", 1000),
      });
    }

    for (const photo of uploadedPhotos) {
      try {
        const newPost = await db.$transaction(async (tx) => {
          const createdPost = await tx.memoryPost.create({
            data: {
              spaceId: space.id,
              type: "ALBUM",
              content: photo.content,
              mediaUrl: photo.url,
              thumbnailUrl: photo.thumbnailUrl,
              nickname,
              writerId: user?.id || null,
              createdAt: photo.takenAt ? new Date(photo.takenAt) : new Date(),
            },
          });
          await upsertPostAppearancesForPost(tx, createdPost, space.themeKey);
          return createdPost;
        });
        createdPostIds.push(String(newPost.id));
      } catch (error) {
        console.error("Failed to save SPACE album photo", error);
        return fail("사진 설명 저장에 실패했어요. 내용을 조금 줄이거나 다시 시도해 주세요.", 500);
      }
    }
  }

  if (createdPostIds.length > 0) {
    const headers = { "Set-Cookie": await appendMyPostCookie(request, createdPostIds) };
    if (wantsJsonResponse) {
      return json({ success: true, postId: Number(createdPostIds[0]) } satisfies PhotoUploadResponse, { headers });
    }
    return redirect(`/space/${params.spaceId}/success?postId=${createdPostIds[0]}`, { headers });
  }

  return fail("저장할 내용이 없어요.");
}

export default function WritePage() {
  const { user, space } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const theme = getSpaceTheme(space.themeKey);

  const [tab, setTab] = useState<WriteTab>("MESSAGE");
  const [photoItems, setPhotoItems] = useState<PhotoItem[]>([createPhotoItem()]);
  const [albumUploadIndex, setAlbumUploadIndex] = useState<number | null>(null);
  const [albumUploadError, setAlbumUploadError] = useState<string | null>(null);
  const [isPhotoDragActive, setIsPhotoDragActive] = useState(false);
  const isAlbumUploading = albumUploadIndex !== null;
  const isSubmitting = navigation.state === "submitting" || isAlbumUploading;
  const selectedPhotoCount = photoItems.filter((item) => item.file).length;
  const formError =
    actionData && typeof actionData === "object" && "error" in actionData && typeof actionData.error === "string" ? actionData.error : null;

  const addPhotoItem = () => {
    if (isAlbumUploading) return;
    if (photoItems.length >= MAX_ALBUM_PHOTO_COUNT) {
      alert(`최대 ${MAX_ALBUM_PHOTO_COUNT}장까지 올릴 수 있어요.`);
      return;
    }
    setPhotoItems((prev) => [...prev, createPhotoItem()]);
  };

  const removePhotoItem = (targetId: number) => {
    if (isAlbumUploading) return;
    if (photoItems.length === 1) {
      alert("최소 1장은 있어야 해요.");
      return;
    }
    setPhotoItems((prev) => prev.filter((item) => item.id !== targetId));
  };

  const addPhotoFiles = (files: File[], replaceItemId?: number) => {
    if (isAlbumUploading) return;

    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      setAlbumUploadError("이미지 파일만 올릴 수 있어요.");
      return;
    }

    const validFiles = imageFiles.filter((file) => file.size <= MAX_PHOTO_UPLOAD_BYTES);
    const hasOversizedFiles = validFiles.length !== imageFiles.length;
    const remainingSlots = MAX_ALBUM_PHOTO_COUNT - photoItems.length + (replaceItemId ? 1 : 0);

    if (remainingSlots <= 0) {
      setAlbumUploadError(`사진은 최대 ${MAX_ALBUM_PHOTO_COUNT}장까지 올릴 수 있어요.`);
      return;
    }

    const filesToAdd = validFiles.slice(0, remainingSlots);
    if (filesToAdd.length === 0) {
      setAlbumUploadError(getPhotoLimitError());
      return;
    }

    setPhotoItems((prev) => {
      const next = [...prev];
      let queuedFiles = [...filesToAdd];

      if (replaceItemId) {
        const replaceIndex = next.findIndex((item) => item.id === replaceItemId);
        if (replaceIndex >= 0 && queuedFiles[0]) {
          next[replaceIndex] = createPhotoItem(queuedFiles[0]);
          queuedFiles = queuedFiles.slice(1);
        }
      } else {
        const emptyIndex = next.findIndex((item) => !item.file && !item.preview && item.status !== "done");
        if (emptyIndex >= 0 && queuedFiles[0]) {
          next[emptyIndex] = createPhotoItem(queuedFiles[0]);
          queuedFiles = queuedFiles.slice(1);
        }
      }

      return [...next, ...queuedFiles.map((file) => createPhotoItem(file))].slice(0, MAX_ALBUM_PHOTO_COUNT);
    });

    if (hasOversizedFiles) {
      setAlbumUploadError(`20MB를 넘는 사진은 제외했어요. ${MAX_PHOTO_UPLOAD_MB}MB 이하 사진만 올릴 수 있어요.`);
    } else if (validFiles.length > filesToAdd.length) {
      setAlbumUploadError(`최대 ${MAX_ALBUM_PHOTO_COUNT}장까지만 추가했어요.`);
    } else {
      setAlbumUploadError(null);
    }
  };

  const handleFileChange = (id: number, event: ChangeEvent<HTMLInputElement>) => {
    addPhotoFiles(Array.from(event.target.files ?? []), id);
    event.target.value = "";
  };

  const handleBulkFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addPhotoFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handlePhotoDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!isAlbumUploading) setIsPhotoDragActive(true);
  };

  const handlePhotoDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsPhotoDragActive(false);
  };

  const handlePhotoDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsPhotoDragActive(false);
    addPhotoFiles(Array.from(event.dataTransfer.files));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    if (tab !== "ALBUM") return;
    event.preventDefault();
    if (isAlbumUploading) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const nickname = String(formData.get("nickname") || "").trim();
    if (!nickname) {
      form.reportValidity();
      return;
    }

    const contents = formData.getAll("content");
    const uploadItems = photoItems
      .map((item, index) => ({ ...item, content: String(contents[index] || "") }))
      .filter((item) => item.file && item.status !== "done");
    if (uploadItems.length === 0) {
      alert("사진을 선택해 주세요.");
      return;
    }
    if (uploadItems.length > MAX_ALBUM_PHOTO_COUNT) {
      setAlbumUploadError(`사진은 최대 ${MAX_ALBUM_PHOTO_COUNT}장까지 올릴 수 있어요.`);
      return;
    }
    if (uploadItems.some((item) => item.file && item.file.size > MAX_PHOTO_UPLOAD_BYTES)) {
      setAlbumUploadError(getPhotoLimitError());
      return;
    }

    setAlbumUploadError(null);
    const createdPostIds: number[] = [];
    const failedMessages: string[] = [];

    for (let index = 0; index < uploadItems.length; index += 1) {
      const item = uploadItems[index];
      if (!item.file) continue;

      try {
        setAlbumUploadIndex(index);
        setPhotoItems((prev) => prev.map((photo) => (photo.id === item.id ? { ...photo, status: "uploading" } : photo)));

        const uploadData = new FormData();
        uploadData.append("intent", "upload_album_photo");
        uploadData.append("type", "ALBUM");
        uploadData.append("nickname", nickname);
        uploadData.append("content", item.content);
        uploadData.append("photo", item.file);

        const response = await fetch(`/space/${space.id}/write/photo`, {
          method: "POST",
          body: uploadData,
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const payload = await readPhotoUploadResponse(response);

        if (!response.ok || !payload.success || !payload.postId) {
          throw new Error(payload.error || `${index + 1}번째 사진 업로드에 실패했습니다.`);
        }

        createdPostIds.push(payload.postId);
        setPhotoItems((prev) => prev.map((photo) => (photo.id === item.id ? { ...photo, status: "done" } : photo)));
      } catch (error) {
        const message = error instanceof Error ? error.message : `${index + 1}번째 사진 업로드에 실패했습니다.`;
        failedMessages.push(`${index + 1}번째: ${message}`);
        setPhotoItems((prev) => prev.map((photo) => (photo.id === item.id ? { ...photo, status: "error" } : photo)));
      }
    }

    setAlbumUploadIndex(null);

    if (failedMessages.length === 0 && createdPostIds[0]) {
      navigate(`/space/${space.id}/success?postId=${createdPostIds[0]}`);
      return;
    }

    if (createdPostIds.length > 0) {
      setAlbumUploadError(`${createdPostIds.length}장은 저장됐고 ${failedMessages.length}장은 실패했어요. 실패한 사진만 다시 저장할 수 있어요.`);
      return;
    }

    setAlbumUploadError(failedMessages[0] || "사진 업로드에 실패했습니다.");
  };

  const openDate = new Date(space.targetDate).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  });

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4" style={{ color: theme.textColor }}>
      <SpaceThemeBackground themeKey={space.themeKey} />
      <section className="relative z-10 w-full max-w-md rounded-lg border border-white/15 p-6 shadow-2xl backdrop-blur-md" style={{ backgroundColor: theme.panelColor }}>
        <div className="-mx-6 -mt-6 mb-6 rounded-t-lg border-b border-white/10 bg-white/10 p-5 text-center">
          <h1 className="text-xl font-bold">
            {space.user ? (
              <>
                {space.user.name}
                <span className="ml-1 text-sm font-normal">님께</span>
              </>
            ) : (
              space.title
            )}
          </h1>
        </div>

        <div className="mb-6 flex items-start gap-3 rounded-lg border border-white/10 bg-white/10 p-3">
          <Calendar className="mt-0.5 h-5 w-5 shrink-0" style={{ color: theme.accentColor }} />
          <div className="text-sm">
            <p className="mb-0.5 font-bold">작성한 마음은 {openDate}에 공개돼요.</p>
            <p className="text-xs opacity-80">그 전까지는 비공개로 안전하게 보관됩니다.</p>
          </div>
        </div>

        <div className="mb-4 flex rounded-lg bg-white/10 p-1">
          <TabButton active={tab === "MESSAGE"} onClick={() => setTab("MESSAGE")} icon={Sparkles} label="쪽지 쓰기" />
          <TabButton active={tab === "ALBUM"} onClick={() => setTab("ALBUM")} icon={ImageIcon} label="사진 올리기" />
        </div>

        <Form method="post" encType="multipart/form-data" className="space-y-6" onSubmit={handleSubmit}>
          <input type="hidden" name="type" value={tab} />

          <div>
            <label className="mb-1 block text-xs font-bold opacity-70">보내는 사람</label>
            <input
              name="nickname"
              defaultValue={user?.name || ""}
              placeholder="이름 또는 별명"
              maxLength={80}
              className="w-full rounded-lg border border-white/15 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:ring-2"
              style={{ outlineColor: theme.accentColor }}
              required
            />
          </div>

          {tab === "MESSAGE" ? (
            <div>
              <label className="mb-1 block text-xs font-bold opacity-70">메시지</label>
              <textarea
                name="content"
                rows={5}
                maxLength={3000}
                placeholder="전하고 싶은 마음을 적어 주세요."
                className="w-full resize-none rounded-lg border border-white/15 bg-white p-3 text-sm text-slate-900 outline-none focus:ring-2"
                required
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold opacity-70">사진 목록 ({selectedPhotoCount}/{MAX_ALBUM_PHOTO_COUNT})</label>
                <button type="button" onClick={addPhotoItem} disabled={isAlbumUploading} className="flex items-center gap-1 text-xs font-bold transition hover:opacity-80 disabled:opacity-40">
                  <Plus size={14} /> 사진 추가
                </button>
              </div>

              <label
                onDragOver={handlePhotoDragOver}
                onDragEnter={handlePhotoDragOver}
                onDragLeave={handlePhotoDragLeave}
                onDrop={handlePhotoDrop}
                className={`relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-5 text-center transition ${
                  isPhotoDragActive ? "border-white bg-white/20" : "border-white/25 bg-white/10 hover:bg-white/15"
                } ${isAlbumUploading ? "pointer-events-none opacity-50" : ""}`}
              >
                <ImageIcon className="mb-2 h-7 w-7 opacity-80" />
                <span className="text-sm font-bold">사진을 드래그하거나 눌러서 한 번에 선택</span>
                <span className="mt-1 text-xs opacity-75">최대 {MAX_ALBUM_PHOTO_COUNT}장, 장당 {MAX_PHOTO_UPLOAD_MB}MB 이하</span>
                <input type="file" accept="image/*" multiple className="sr-only" onChange={handleBulkFileChange} disabled={isAlbumUploading} />
              </label>

              <div className="max-h-[400px] space-y-3 overflow-y-auto pr-1">
                {photoItems.map((item, index) => (
                  <div key={item.id} className="relative flex items-start gap-3 rounded-lg border border-white/10 bg-white/10 p-3">
                    {photoItems.length > 1 && (
                      <button type="button" onClick={() => removePhotoItem(item.id)} disabled={isAlbumUploading} className="absolute right-2 top-2 text-white/60 transition hover:text-white disabled:opacity-30" aria-label="사진 삭제">
                        <X size={16} />
                      </button>
                    )}

                    <div className="shrink-0">
                      <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded border-2 border-dashed border-white/25 bg-white/10">
                        {item.preview ? <img src={item.preview} alt="미리보기" className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6 opacity-50" />}
                        <input
                          type="file"
                          name="photo"
                          accept="image/*"
                          multiple
                          className="absolute inset-0 cursor-pointer opacity-0"
                          onChange={(event) => handleFileChange(item.id, event)}
                          disabled={isAlbumUploading}
                        />
                      </div>
                    </div>

                    <div className="flex-1 pt-1">
                      <div className="mb-1 flex items-center gap-1 text-xs font-bold opacity-70">
                        <span className="rounded bg-white/15 px-1.5 text-[10px]">{index + 1}</span>
                        사진 설명
                      </div>
                      <input name="content" maxLength={1000} placeholder="사진에 대한 설명 (선택)" className="w-full rounded border border-white/15 bg-white p-2 text-sm text-slate-900 outline-none" />
                    </div>
                  </div>
                ))}
              </div>

              <button type="button" onClick={addPhotoItem} disabled={isAlbumUploading} className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/25 py-3 font-bold transition hover:bg-white/10 disabled:opacity-40">
                <Plus size={18} /> 사진 더 추가하기
              </button>

              {isAlbumUploading && albumUploadIndex !== null ? (
                <div className="rounded-lg border border-white/10 bg-white/10 p-3 text-sm font-bold">
                  사진 {albumUploadIndex + 1} / {selectedPhotoCount} 업로드 중...
                </div>
              ) : null}

              {albumUploadError ? <p className="rounded-lg bg-red-500/20 p-3 text-sm font-bold text-red-100">{albumUploadError}</p> : null}
            </div>
          )}

          {formError ? (
            <p role="alert" className="rounded-lg bg-red-500/20 p-3 text-sm font-bold text-red-100">
              {formError}
            </p>
          ) : null}

          <button
            disabled={isSubmitting}
            className="w-full rounded-lg py-3.5 font-bold text-slate-950 shadow-lg transition hover:brightness-105 disabled:opacity-50"
            style={{ backgroundColor: theme.accentColor }}
          >
            {isSubmitting ? "저장 중..." : tab === "MESSAGE" ? "마음 보내기" : `사진 ${selectedPhotoCount}장 저장하기`}
          </button>
        </Form>
      </section>
    </main>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1 rounded-md py-2 text-sm font-bold transition-all ${
        active ? "bg-white text-slate-950 shadow" : "text-white/70 hover:text-white"
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
