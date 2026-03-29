import { Archive, ArrowLeft, RotateCcw, Search, SquareArrowOutUpRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Form, Link, redirect, useFetcher, useLoaderData, useRevalidator, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";

import { DevlogRichText } from "~/components/devlog-rich-text";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { getSessionWithPermission } from "~/lib/auth.server";
import { loadArchivedDevWorkSnapshot, saveDevWorkItem } from "~/lib/devlog.server";
import { db } from "~/lib/db.server";
import { getDateKey } from "~/lib/ledger-entry";
import { commitSession, getFlashSession } from "~/lib/session.server";

function parseWorkSetId(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSearchQuery(value: string | null) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildArchiveLink(workSetId?: number | null, searchQuery?: string | null) {
  const query = new URLSearchParams();
  if (workSetId) {
    query.set("set", String(workSetId));
  }
  if (searchQuery) {
    query.set("q", searchQuery);
  }

  const search = query.toString();
  return `/devlog/archive${search ? `?${search}` : ""}`;
}

function buildDashboardLink(dateToken: string, workSetId?: number | null) {
  const query = workSetId ? `?set=${workSetId}` : "";
  return `/devlog/${dateToken}${query}`;
}

function buildWorkWindowLink(dateToken: string, workItemId: number, workSetId?: number | null) {
  const query = workSetId ? `?set=${workSetId}` : "";
  return `/devlog/${dateToken}/work/${workItemId}${query}`;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function openWorkWindow(to: string) {
  if (typeof window === "undefined") {
    return;
  }

  const opened = window.open(
    to,
    `devlog-work-${to.replace(/[^a-zA-Z0-9]/g, "-")}`,
    "popup=yes,width=1180,height=900,resizable=yes,scrollbars=yes",
  );

  if (!opened) {
    window.location.href = to;
  }
}

async function redirectWithToast(request: Request, type: "success" | "error", message: string, to: string) {
  const flashSession = await getFlashSession(request.headers.get("Cookie"));
  flashSession.flash("toast", { type, message });

  return redirect(to, {
    headers: {
      "Set-Cookie": await commitSession(flashSession),
    },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "ADMIN");
  const searchParams = new URL(request.url).searchParams;
  const snapshot = await loadArchivedDevWorkSnapshot(db, user.id, {
    requestedWorkSetId: parseWorkSetId(searchParams.get("set")),
    searchQuery: parseSearchQuery(searchParams.get("q")),
  });

  return {
    todayDateToken: getDateKey(new Date()),
    ...snapshot,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "ADMIN");
  const formData = await request.formData();
  const intent = formData.get("intent");
  const responseMode = formData.get("responseMode");
  const searchParams = new URL(request.url).searchParams;
  const currentWorkSetId = parseWorkSetId(
    typeof formData.get("workSetId") === "string" ? String(formData.get("workSetId")) : searchParams.get("set"),
  );
  const currentSearchQuery = parseSearchQuery(
    typeof formData.get("searchQuery") === "string" ? String(formData.get("searchQuery")) : searchParams.get("q"),
  );

  try {
    if (intent === "restore_work_item") {
      formData.set("status", "TODO");
      await saveDevWorkItem(db, user.id, new Date(), formData);
      if (responseMode === "inline") {
        return {
          restored: true,
          workItemId: parseWorkSetId(typeof formData.get("workItemId") === "string" ? String(formData.get("workItemId")) : null),
        };
      }
      return redirectWithToast(
        request,
        "success",
        "보관한 작업을 다시 꺼냈어요.",
        buildArchiveLink(currentWorkSetId, currentSearchQuery),
      );
    }

    throw new Response("Invalid intent", { status: 400 });
  } catch {
    if (responseMode === "inline") {
      return {
        restored: false,
        error: "보관한 작업을 복구하지 못했어요.",
      };
    }
    return redirectWithToast(
      request,
      "error",
      "보관한 작업을 복구하지 못했어요.",
      buildArchiveLink(currentWorkSetId, currentSearchQuery),
    );
  }
};

export default function DevlogArchivePage() {
  const { todayDateToken, searchQuery, workSets, selectedWorkSet, archivedItems } = useLoaderData<typeof loader>();
  const restoreFetcher = useFetcher<{ restored?: boolean; error?: string; workItemId?: number | null }>();
  const revalidator = useRevalidator();
  const [hiddenWorkItemIds, setHiddenWorkItemIds] = useState<number[]>([]);

  const pendingRestoreItemId =
    restoreFetcher.state !== "idle" && typeof restoreFetcher.formData?.get("workItemId") === "string"
      ? Number(restoreFetcher.formData.get("workItemId"))
      : null;

  useEffect(() => {
    if (!restoreFetcher.data?.restored || !restoreFetcher.data.workItemId) {
      return;
    }

    setHiddenWorkItemIds((current) =>
      current.includes(restoreFetcher.data!.workItemId!) ? current : [...current, restoreFetcher.data!.workItemId!],
    );
    revalidator.revalidate();
  }, [restoreFetcher.data, revalidator]);

  useEffect(() => {
    setHiddenWorkItemIds((current) => current.filter((workItemId) => archivedItems.some((item) => item.id === workItemId)));
  }, [archivedItems]);

  const visibleArchivedItems = useMemo(
    () =>
      archivedItems.filter((item) => {
        if (hiddenWorkItemIds.includes(item.id)) {
          return false;
        }

        if (pendingRestoreItemId && pendingRestoreItemId === item.id) {
          return false;
        }

        return true;
      }),
    [archivedItems, hiddenWorkItemIds, pendingRestoreItemId],
  );

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#ece4d7_0%,#f6f0e7_46%,#fbf8f4_100%)] p-4">
      <div className="mx-auto w-full max-w-[1400px] space-y-5">
        <section className="rounded-[30px] border border-[#dbc8ad] bg-[radial-gradient(circle_at_top_left,#fff6e9_0%,#fcf9f4_48%,#f7f1e7_100%)] p-4 shadow-[0_28px_70px_rgba(72,54,28,0.12)]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="icon" className="h-10 w-10 rounded-full border-[#e3d3bc] bg-white/90">
                <Link to={buildDashboardLink(todayDateToken, selectedWorkSet.id)} aria-label="대시보드로 돌아가기" title="대시보드로 돌아가기">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>

              <div className="mx-1 hidden h-7 w-px bg-[#eadfce] sm:block" />

              {workSets.map((workSet) => (
                <Button
                  key={workSet.id}
                  asChild
                  variant={workSet.id === selectedWorkSet.id ? "default" : "outline"}
                  size="sm"
                  className={
                    workSet.id === selectedWorkSet.id
                      ? "rounded-full"
                      : "rounded-full border-[#e3d3bc] bg-white/90 text-slate-700 hover:bg-[#faf5ee]"
                  }
                >
                  <Link to={buildArchiveLink(workSet.id, searchQuery)} className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: workSet.color }} />
                    <span>{workSet.name}</span>
                    {workSet.isDefault ? <span className="text-[10px] opacity-80">기본</span> : null}
                  </Link>
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-white/70 bg-white/88 px-3 py-2.5 shadow-[0_18px_40px_rgba(72,54,28,0.08)] backdrop-blur">
              <Form method="get" className="flex min-w-[260px] flex-1 items-center gap-2 rounded-full border border-[#e3d3bc] bg-white/90 px-3">
                <input type="hidden" name="set" value={selectedWorkSet.id} />
                <Search className="h-4 w-4 shrink-0 text-[#8a5f36]" />
                <Input
                  name="q"
                  defaultValue={searchQuery ?? ""}
                  placeholder="제목, 메모, #링크 검색"
                  className="h-9 border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
                />
                <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                  <Search className="h-4 w-4" />
                </Button>
              </Form>
              {searchQuery ? (
                <Button asChild variant="outline" size="sm" className="rounded-full border-[#e3d3bc] bg-white/90">
                  <Link to={buildArchiveLink(selectedWorkSet.id)}>지우기</Link>
                </Button>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 px-1 py-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#94724b]">
                <Archive className="h-3.5 w-3.5" />
                <span>보관함</span>
              </div>
              <div className="min-w-[220px] flex-1">
                <p className="text-lg font-semibold text-slate-900">{selectedWorkSet.name} 보관 작업</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">보관 {visibleArchivedItems.length}개</Badge>
              </div>
            </div>
          </div>
        </section>

        <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
          <CardHeader>
            <CardTitle>보관된 작업</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {visibleArchivedItems.length === 0 ? (
              <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">보관된 작업이 아직 없어요.</p>
            ) : (
              visibleArchivedItems.map((item) => {
                const itemDateToken = item.plannedDate?.slice(0, 10) ?? item.lastDiaryPage?.pageDate.slice(0, 10) ?? todayDateToken;

                return (
                  <article key={item.id} className="rounded-2xl border border-[#e6d9c7] bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold tracking-[-0.01em] text-slate-900">{item.title}</p>
                          <Badge variant="outline">보관</Badge>
                        </div>
                        <DevlogRichText
                          text={item.nextAction}
                          className="mt-2 text-sm text-slate-600"
                          emptyText="메모가 아직 없어요."
                          onReferenceClick={(workItemId, event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openWorkWindow(buildWorkWindowLink(itemDateToken, workItemId, selectedWorkSet.id));
                          }}
                        />
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                          {item.lastDiaryPage ? <span>{formatShortDate(item.lastDiaryPage.pageDate)}</span> : null}
                          {item.plannedDate ? <span>마감 {formatShortDate(item.plannedDate)}</span> : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 rounded-full border-[#e3d3bc] bg-white/90"
                          onClick={() => openWorkWindow(buildWorkWindowLink(itemDateToken, item.id, selectedWorkSet.id))}
                          aria-label="작업창 열기"
                          title="작업창 열기"
                        >
                          <SquareArrowOutUpRight className="h-4 w-4" />
                        </Button>
                        <restoreFetcher.Form method="post">
                          <input type="hidden" name="intent" value="restore_work_item" />
                          <input type="hidden" name="responseMode" value="inline" />
                          <input type="hidden" name="workItemId" value={item.id} />
                          <input type="hidden" name="workSetId" value={selectedWorkSet.id} />
                          {searchQuery ? <input type="hidden" name="searchQuery" value={searchQuery} /> : null}
                          <Button
                            type="submit"
                            size="sm"
                            className="rounded-full"
                            disabled={pendingRestoreItemId === item.id}
                          >
                            <RotateCcw className="h-4 w-4" />
                            {pendingRestoreItemId === item.id ? "복구 중" : "복구"}
                          </Button>
                        </restoreFetcher.Form>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
