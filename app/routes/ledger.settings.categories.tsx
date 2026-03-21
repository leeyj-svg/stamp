import { Form, Link, redirect, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { ArrowLeft, Check, EyeOff, MoreVertical, Plus, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { getTypeLabel, type LedgerEntryTypeValue } from "~/lib/ledger-entry";
import { type CategoryFetcherData, handleCategoryIntent, loadLedgerCategories } from "~/lib/ledger-entry.server";
import { ensureLedgerSetup } from "~/lib/ledger";
import { commitSession, getFlashSession } from "~/lib/session.server";
import { cn } from "~/lib/utils";

const TYPE_ORDER: LedgerEntryTypeValue[] = ["EXPENSE", "INCOME", "SAVING"];

function parseSelectedType(value: string | null): LedgerEntryTypeValue {
  if (value === "INCOME" || value === "EXPENSE" || value === "SAVING") {
    return value;
  }

  return "EXPENSE";
}

function getTypeAccent(type: LedgerEntryTypeValue) {
  if (type === "INCOME") {
    return {
      text: "text-sky-500",
      border: "border-sky-200",
      bg: "bg-sky-50",
      button: "border-sky-200 text-sky-600 hover:bg-sky-50",
    };
  }

  if (type === "EXPENSE") {
    return {
      text: "text-rose-500",
      border: "border-rose-200",
      bg: "bg-rose-50",
      button: "border-rose-200 text-rose-600 hover:bg-rose-50",
    };
  }

  return {
    text: "text-emerald-600",
    border: "border-emerald-200",
    bg: "bg-emerald-50",
    button: "border-emerald-200 text-emerald-700 hover:bg-emerald-50",
  };
}

function getRedirectTarget(type: LedgerEntryTypeValue) {
  return `/ledger/settings/categories?type=${type}`;
}

async function redirectWithToast(request: Request, type: "success" | "error", message: string, selectedType: LedgerEntryTypeValue) {
  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  flashSession.flash("toast", { type, message });

  return redirect(getRedirectTarget(selectedType), {
    headers: {
      "Set-Cookie": await commitSession(flashSession),
    },
  });
}

function getSuccessMessage(payload: CategoryFetcherData, formData: FormData) {
  if (payload.intent === "create_category") {
    return "카테고리를 추가했습니다.";
  }

  if (payload.intent === "update_category") {
    return "카테고리를 수정했습니다.";
  }

  if (payload.intent === "toggle_category") {
    return formData.get("nextActive") === "true" ? "카테고리를 다시 보이게 했습니다." : "카테고리를 숨겼습니다.";
  }

  if (payload.intent === "delete_category") {
    return "카테고리를 삭제했습니다.";
  }

  return "카테고리 작업을 처리했습니다.";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  await ensureLedgerSetup(db, user.id);

  const selectedType = parseSelectedType(new URL(request.url).searchParams.get("type"));
  const categories = await loadLedgerCategories(db, user.id);
  const categoriesByType = TYPE_ORDER.map((type) => ({
    type,
    active: categories.filter((category) => category.type === type && category.isActive),
    hidden: categories.filter((category) => category.type === type && !category.isActive),
  }));

  return {
    selectedType,
    categoriesByType,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  await ensureLedgerSetup(db, user.id);

  const formData = await request.formData();
  const url = new URL(request.url);
  const typeField = formData.get("type");
  const selectedType = parseSelectedType(url.searchParams.get("type") ?? (typeof typeField === "string" ? typeField : null));

  const categoryResponse = await handleCategoryIntent(db, user.id, formData);

  if (!categoryResponse) {
    return redirectWithToast(request, "error", "처리할 카테고리 작업을 찾지 못했습니다.", selectedType);
  }

  const payload = (await categoryResponse.json()) as CategoryFetcherData;

  if (payload.error) {
    return redirectWithToast(request, "error", payload.error, selectedType);
  }

  return redirectWithToast(request, "success", getSuccessMessage(payload, formData), selectedType);
};

export default function LedgerCategorySettingsPage() {
  const { selectedType, categoriesByType } = useLoaderData<typeof loader>();
  const selectedGroup = categoriesByType.find((group) => group.type === selectedType) ?? categoriesByType[0];
  const accent = getTypeAccent(selectedGroup.type);
  const actionUrl = getRedirectTarget(selectedGroup.type);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b bg-white px-2 py-3">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
            <Link to="/ledger/settings">
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>

          <div className="text-center">
            <h1 className="text-[1.05rem] font-semibold text-slate-900">카테고리 관리</h1>
            <p className="text-xs text-slate-500">지출, 수입, 저축을 나눠서 정리해요.</p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/ledger/settings">설정</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/ledger/settings/budgets">예산 설정</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/ledger">달력으로</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/ledger/stats">통계</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4 pb-8">
        <section className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
          <div className="grid grid-cols-3 gap-2">
            {TYPE_ORDER.map((type) => {
              const typeAccent = getTypeAccent(type);
              const isActive = selectedType === type;

              return (
                <Button
                  key={type}
                  asChild
                  variant="outline"
                  className={cn(
                    "h-10 rounded-xl border-slate-200 text-sm font-medium text-slate-600",
                    isActive && cn(typeAccent.border, typeAccent.bg, typeAccent.text),
                  )}
                >
                  <Link to={getRedirectTarget(type)}>{getTypeLabel(type)}</Link>
                </Button>
              );
            })}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs text-slate-500">사용 중</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{selectedGroup.active.length}개</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs text-slate-500">숨김</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{selectedGroup.hidden.length}개</p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{getTypeLabel(selectedGroup.type)} 카테고리 추가</h2>
              <p className="mt-1 text-xs text-slate-500">많아져도 보기 편하게 타입별로 따로 관리해요.</p>
            </div>
            <div className={cn("inline-flex rounded-full border px-3 py-1 text-xs font-semibold", accent.border, accent.bg, accent.text)}>
              {getTypeLabel(selectedGroup.type)}
            </div>
          </div>

          <Form method="post" action={actionUrl} className="flex items-center gap-2">
            <input type="hidden" name="intent" value="create_category" />
            <input type="hidden" name="type" value={selectedGroup.type} />
            <Input name="name" placeholder={`${getTypeLabel(selectedGroup.type)} 카테고리 추가`} className="h-10 rounded-xl border-slate-200 text-sm" />
            <Button type="submit" variant="outline" size="icon" className={cn("h-10 w-10 rounded-xl", accent.button)}>
              <Plus className="h-4 w-4" />
              <span className="sr-only">카테고리 추가</span>
            </Button>
          </Form>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">사용 중인 카테고리</h2>
              <span className="text-xs text-slate-400">{selectedGroup.active.length}개</span>
            </div>
          </div>

          {selectedGroup.active.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">아직 등록한 카테고리가 없습니다.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {selectedGroup.active.map((category) => (
                <div key={category.id} className="flex items-center gap-2 px-4 py-3">
                  <Form method="post" action={actionUrl} className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="hidden" name="intent" value="update_category" />
                    <input type="hidden" name="categoryId" value={category.id} />
                    <Input
                      name="name"
                      defaultValue={category.name}
                      className="h-10 min-w-0 rounded-xl border-slate-200 bg-slate-50 text-sm"
                    />
                    <Button type="submit" variant="outline" size="icon" className="h-10 w-10 rounded-xl border-slate-200 text-slate-600">
                      <Check className="h-4 w-4" />
                      <span className="sr-only">카테고리 저장</span>
                    </Button>
                  </Form>

                  <span className="shrink-0 text-xs text-slate-400">
                    내역 {category.entryCount}건
                    {category.budgetAllocationCount > 0 ? ` · 예산 ${category.budgetAllocationCount}건` : ""}
                  </span>

                  <Form method="post" action={actionUrl}>
                    <input type="hidden" name="intent" value="toggle_category" />
                    <input type="hidden" name="categoryId" value={category.id} />
                    <input type="hidden" name="nextActive" value="false" />
                    <Button type="submit" variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-slate-500 hover:bg-slate-100">
                      <EyeOff className="h-4 w-4" />
                      <span className="sr-only">카테고리 숨김</span>
                    </Button>
                  </Form>

                  <Form method="post" action={actionUrl}>
                    <input type="hidden" name="intent" value="delete_category" />
                    <input type="hidden" name="categoryId" value={category.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      disabled={category.entryCount > 0 || category.budgetAllocationCount > 0}
                      className="h-10 w-10 rounded-xl text-rose-500 hover:bg-rose-50 hover:text-rose-600 disabled:text-slate-300 disabled:hover:bg-transparent"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">카테고리 삭제</span>
                    </Button>
                  </Form>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">숨긴 카테고리</h2>
              <span className="text-xs text-slate-400">{selectedGroup.hidden.length}개</span>
            </div>
          </div>

          {selectedGroup.hidden.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">숨긴 카테고리가 없습니다.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {selectedGroup.hidden.map((category) => (
                <div key={category.id} className="flex items-center gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{category.name}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      내역 {category.entryCount}건
                      {category.budgetAllocationCount > 0 ? ` · 예산 ${category.budgetAllocationCount}건` : ""}
                    </p>
                  </div>

                  <Form method="post" action={actionUrl}>
                    <input type="hidden" name="intent" value="toggle_category" />
                    <input type="hidden" name="categoryId" value={category.id} />
                    <input type="hidden" name="nextActive" value="true" />
                    <Button type="submit" variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-slate-500 hover:bg-slate-100">
                      <RotateCcw className="h-4 w-4" />
                      <span className="sr-only">카테고리 복원</span>
                    </Button>
                  </Form>

                  <Form method="post" action={actionUrl}>
                    <input type="hidden" name="intent" value="delete_category" />
                    <input type="hidden" name="categoryId" value={category.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      disabled={category.entryCount > 0 || category.budgetAllocationCount > 0}
                      className="h-10 w-10 rounded-xl text-rose-500 hover:bg-rose-50 hover:text-rose-600 disabled:text-slate-300 disabled:hover:bg-transparent"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">카테고리 삭제</span>
                    </Button>
                  </Form>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
