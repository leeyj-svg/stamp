import { useState } from "react";
import { Form, redirect, useFetcher } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { User } from "@phosphor-icons/react";
import { Search, UserCheck, XCircle } from "lucide-react";

import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { parseKoreanDateInput } from "~/lib/space-date";
import { createDefaultSpaceAppearances } from "~/lib/space-theme.server";
import { DEFAULT_SPACE_THEME_KEY, SPACE_THEME_OPTIONS, isSpaceThemeKey } from "~/lib/space-theme";

type SearchActionData = Awaited<ReturnType<typeof action>>;
type SearchResultUser = NonNullable<Extract<SearchActionData, { foundUsers: unknown[] }>["foundUsers"]>[number];

export async function loader({ request }: LoaderFunctionArgs) {
  await getSessionWithPermission(request, "ADMIN");
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  await getSessionWithPermission(request, "ADMIN");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "search") {
    const keyword = String(formData.get("keyword") || "").trim();

    if (!keyword) {
      return { searchError: "검색어를 입력해 주세요." };
    }

    const users = await db.user.findMany({
      where: {
        OR: [{ name: { contains: keyword } }, { phoneNumber: { contains: keyword } }],
      },
      take: 5,
      select: { id: true, name: true, phoneNumber: true },
    });

    if (users.length === 0) {
      return { searchError: "검색 결과가 없습니다." };
    }

    return { foundUsers: users };
  }

  if (intent === "create") {
    const title = String(formData.get("title") || "").trim();
    const dateStr = String(formData.get("date") || "");
    const password = String(formData.get("password") || "").trim();
    const userId = String(formData.get("userId") || "");
    const themeValue = formData.get("themeKey");
    const themeKey = isSpaceThemeKey(themeValue) ? themeValue : DEFAULT_SPACE_THEME_KEY;

    if (!title || !dateStr || !password) {
      return { createError: "제목, 공개 일자, 비밀번호를 입력해 주세요." };
    }

    const targetDate = parseKoreanDateInput(dateStr);
    if (!targetDate) {
      return { createError: "공개 일자를 다시 확인해 주세요." };
    }

    const linkedUser = userId ? await db.user.findUnique({ where: { id: userId }, select: { id: true } }) : null;

    const space = await db.$transaction(async (tx) => {
      const createdSpace = await tx.memorySpace.create({
        data: {
          title,
          targetDate,
          password,
          themeKey,
          userId: linkedUser?.id || null,
        },
      });

      await createDefaultSpaceAppearances(tx, createdSpace.id, themeKey);
      return createdSpace;
    });

    return redirect(`/space/${space.id}/admin`);
  }

  return null;
}

export default function AdminCreateSpace() {
  const searchFetcher = useFetcher<typeof action>();
  const [linkedUser, setLinkedUser] = useState<SearchResultUser | null>(null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-2xl space-y-8 rounded-2xl bg-white p-8 shadow-xl">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-indigo-600">관리자: 추억 공간 생성</h1>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-700">사용자 연결 (선택)</h3>

          {!linkedUser ? (
            <>
              <searchFetcher.Form method="post" className="flex gap-2">
                <input type="hidden" name="intent" value="search" />
                <input
                  name="keyword"
                  placeholder="이름 또는 전화번호 검색"
                  className="w-full rounded border p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
                <button className="whitespace-nowrap rounded bg-slate-800 p-2 text-white hover:bg-slate-700" type="submit" aria-label="검색">
                  <Search size={18} />
                </button>
              </searchFetcher.Form>

              <div className="mt-3 space-y-2">
                {searchFetcher.data &&
                  "foundUsers" in searchFetcher.data &&
                  searchFetcher.data.foundUsers?.map((user: SearchResultUser) => (
                    <div key={user.id} className="flex items-center justify-between rounded border border-slate-200 bg-white p-3 transition hover:bg-slate-50">
                      <div className="flex items-center gap-3">
                        <div className="rounded-full bg-slate-100 p-2">
                          <User size={16} className="text-slate-500" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800">{user.name}</p>
                          <p className="text-xs text-slate-500">{user.phoneNumber}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setLinkedUser(user)}
                        className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-600 transition hover:bg-indigo-600 hover:text-white"
                        type="button"
                      >
                        선택
                      </button>
                    </div>
                  ))}
              </div>

              {searchFetcher.data && "searchError" in searchFetcher.data && (
                <p className="mt-2 px-1 text-xs font-bold text-red-500">{searchFetcher.data.searchError}</p>
              )}
            </>
          ) : (
            <div className="flex items-center justify-between rounded border border-indigo-200 bg-indigo-50 p-3">
              <div className="flex items-center gap-2">
                <UserCheck className="text-indigo-600" size={20} />
                <div>
                  <p className="text-sm font-bold text-indigo-800">{linkedUser.name}님 연결됨</p>
                  <p className="text-xs text-indigo-600">{linkedUser.phoneNumber}</p>
                </div>
              </div>
              <button onClick={() => setLinkedUser(null)} className="text-slate-400 transition hover:text-red-500" title="연결 해제" type="button">
                <XCircle size={20} />
              </button>
            </div>
          )}
        </div>

        <Form method="post" className="space-y-5">
          <input type="hidden" name="intent" value="create" />
          <input type="hidden" name="userId" value={linkedUser?.id || ""} />

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">공간 제목</label>
            <input name="title" placeholder="예: 지호의 생일 축하" className="w-full rounded-lg border p-3" required />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">공개 일자</label>
              <input name="date" type="date" className="w-full rounded-lg border p-3" required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">입장 비밀번호</label>
              <input name="password" type="text" placeholder="4자리" className="w-full rounded-lg border p-3" required />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold text-slate-500">테마 선택</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SPACE_THEME_OPTIONS.map((theme) => (
                <label
                  key={theme.key}
                  className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 p-3 transition has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50"
                >
                  <input type="radio" name="themeKey" value={theme.key} defaultChecked={theme.key === DEFAULT_SPACE_THEME_KEY} className="sr-only" />
                  <span className="block text-sm font-bold text-slate-800">{theme.label}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">{theme.description}</span>
                </label>
              ))}
            </div>
          </div>

          <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-4 font-bold text-white shadow-lg transition hover:bg-indigo-700">
            {linkedUser ? "연결된 사용자와 함께 생성" : "사용자 없이 생성"}
          </button>
        </Form>
      </div>
    </div>
  );
}
