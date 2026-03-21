import { useState } from "react";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { unstable_createMemoryUploadHandler, unstable_parseMultipartFormData } from "@remix-run/node";
import { Calendar, Image as ImageIcon, Plus, Sparkles, X, type LucideIcon } from "lucide-react";

import { db } from "~/lib/db.server";
import { getSession } from "~/lib/auth.server";
import { myPostsCookie } from "~/lib/cookies.server";
import { processAndUploadImage } from "~/lib/upload.server";

type WriteTab = "MESSAGE" | "ALBUM";

type PhotoItem = {
  id: number;
  preview: string | null;
};

function toNumberDate(value: Date | string) {
  return new Date(value).getTime();
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
  const { user } = await getSession(request);

  const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: 100_000_000 });
  const formData = await unstable_parseMultipartFormData(request, uploadHandler);

  const type = formData.get("type") as WriteTab;
  const nickname = formData.get("nickname") as string;
  const createdPostIds: string[] = [];

  if (type === "MESSAGE") {
    const content = formData.get("content") as string;
    const newPost = await db.memoryPost.create({
      data: {
        spaceId: params.spaceId!,
        type: "MESSAGE",
        content,
        nickname,
        writerId: user?.id || null,
      },
    });
    createdPostIds.push(String(newPost.id));
  } else if (type === "ALBUM") {
    const photos = formData.getAll("photo") as File[];
    const contents = formData.getAll("content") as string[];

    await Promise.all(
      photos.map(async (file, index) => {
        if (!file || file.size === 0) return;

        const uploadResult = await processAndUploadImage(file);
        if (!uploadResult) return;

        const { url, takenAt } = uploadResult;
        const content = contents[index] || "";
        const createdAt = takenAt ? new Date(takenAt) : new Date();

        const newPost = await db.memoryPost.create({
          data: {
            spaceId: params.spaceId!,
            type: "ALBUM",
            content,
            mediaUrl: url,
            nickname,
            writerId: user?.id || null,
            createdAt,
          },
        });
        createdPostIds.push(String(newPost.id));
      })
    );
  }

  if (createdPostIds.length > 0) {
    const cookieHeader = request.headers.get("Cookie");
    const myPostIds = (await myPostsCookie.parse(cookieHeader)) || [];
    const updatedIds = [...myPostIds, ...createdPostIds];

    return redirect(`/space/${params.spaceId}/success?postId=${createdPostIds[0]}`, {
      headers: { "Set-Cookie": await myPostsCookie.serialize(updatedIds) },
    });
  }

  return redirect(`/space/${params.spaceId}`);
}

export default function WritePage() {
  const { user, space } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [tab, setTab] = useState<WriteTab>("MESSAGE");
  const [photoItems, setPhotoItems] = useState<PhotoItem[]>([{ id: Date.now(), preview: null }]);

  const addPhotoItem = () => {
    if (photoItems.length >= 10) {
      alert("최대 10장까지 한 번에 올릴 수 있어요.");
      return;
    }
    setPhotoItems((prev) => [...prev, { id: Date.now() + Math.floor(Math.random() * 1000), preview: null }]);
  };

  const removePhotoItem = (targetId: number) => {
    if (photoItems.length === 1) {
      alert("최소 1장은 있어야 해요.");
      return;
    }
    setPhotoItems((prev) => prev.filter((item) => item.id !== targetId));
  };

  const handleFileChange = (id: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPhotoItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        return { ...item, preview: file ? URL.createObjectURL(file) : null };
      })
    );
  };

  const openDate = new Date(space.targetDate).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <div className="-mx-6 -mt-6 mb-6 rounded-t-xl border-b border-slate-200 bg-slate-100 p-5 text-center">
          <h1 className="text-xl font-bold text-slate-800">
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

        <div className="mb-6 flex items-start gap-3 rounded-lg border border-indigo-100 bg-indigo-50 p-3">
          <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" />
          <div className="text-sm text-indigo-800">
            <p className="mb-0.5 font-bold">이 메시지는 {openDate}에 공개돼요.</p>
            <p className="text-xs opacity-80">그 전까지는 비공개로 안전하게 보관됩니다.</p>
          </div>
        </div>

        <div className="mb-4 flex rounded-lg bg-slate-100 p-1">
          <TabButton
            active={tab === "MESSAGE"}
            onClick={() => setTab("MESSAGE")}
            icon={Sparkles}
            label="편지 쓰기"
            activeClass="text-indigo-600"
          />
          <TabButton
            active={tab === "ALBUM"}
            onClick={() => setTab("ALBUM")}
            icon={ImageIcon}
            label="사진 올리기"
            activeClass="text-pink-600"
          />
        </div>

        <Form method="post" encType="multipart/form-data" className="space-y-6">
          <input type="hidden" name="type" value={tab} />

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">보내는 사람</label>
            <input
              name="nickname"
              defaultValue={user?.name || ""}
              placeholder="닉네임"
              className="w-full rounded border bg-slate-50 p-3 focus:outline-indigo-500"
              required
            />
          </div>

          {tab === "MESSAGE" ? (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">메시지</label>
              <textarea
                name="content"
                rows={5}
                placeholder="축하 메시지를 적어주세요."
                className="w-full resize-none rounded border p-3 focus:outline-indigo-500"
                required
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-500">사진 목록 ({photoItems.length}/10)</label>
                <button
                  type="button"
                  onClick={addPhotoItem}
                  className="flex items-center gap-1 text-xs font-bold text-pink-600 transition hover:text-pink-700"
                >
                  <Plus size={14} /> 사진 추가하기
                </button>
              </div>

              <div className="max-h-[400px] space-y-3 overflow-y-auto pr-1 scrollbar-hide">
                {photoItems.map((item, index) => (
                  <div key={item.id} className="relative flex items-start gap-3 rounded-lg border bg-slate-50 p-3">
                    {photoItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removePhotoItem(item.id)}
                        className="absolute right-2 top-2 text-slate-400 transition hover:text-red-500"
                      >
                        <X size={16} />
                      </button>
                    )}

                    <div className="shrink-0">
                      <div
                        className={`relative flex h-20 w-20 items-center justify-center overflow-hidden rounded border-2 border-dashed bg-white ${
                          item.preview ? "border-pink-300" : "border-slate-300"
                        }`}
                      >
                        {item.preview ? (
                          <img src={item.preview} alt="preview" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-2xl text-slate-300">📷</span>
                        )}
                        <input
                          type="file"
                          name="photo"
                          accept="image/*"
                          className="absolute inset-0 cursor-pointer opacity-0"
                          onChange={(e) => handleFileChange(item.id, e)}
                          required
                        />
                      </div>
                    </div>

                    <div className="flex-1 pt-1">
                      <div className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
                        <span className="rounded bg-slate-200 px-1.5 text-[10px] text-slate-600">{index + 1}</span>
                        사진 설명
                      </div>
                      <input
                        name="content"
                        placeholder="사진에 대한 설명 (선택)"
                        className="w-full rounded border p-2 text-sm focus:outline-pink-500"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addPhotoItem}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-3 font-bold text-slate-500 transition hover:border-pink-300 hover:bg-pink-50 hover:text-pink-500"
              >
                <Plus size={18} /> 사진 더 추가하기
              </button>
            </div>
          )}

          <button
            disabled={isSubmitting}
            className={`w-full rounded-xl py-3.5 font-bold text-white shadow-lg transition disabled:opacity-50 ${
              tab === "MESSAGE" ? "bg-indigo-600 hover:bg-indigo-700" : "bg-pink-600 hover:bg-pink-700"
            }`}
          >
            {isSubmitting
              ? "업로드 중..."
              : tab === "MESSAGE"
                ? "🚀 별 띄우기"
                : `📸 사진 ${photoItems.length}장 저장하기`}
          </button>
        </Form>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  activeClass,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  activeClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1 rounded py-2 text-sm font-bold transition-all ${
        active ? `bg-white shadow ${activeClass}` : "text-slate-500"
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
