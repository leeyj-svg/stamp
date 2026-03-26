import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { getMonthToken } from "~/lib/ledger";
import { buildBudgetQuery, parseCategoryIds, parseCurrentWeekBudgetView, parseEntryFilter, parseMonthToken } from "~/lib/ledger-listing";
import { formatRoutineTimeValue } from "~/lib/routine";
import { cn } from "~/lib/utils";

type PhotoScope = "week" | "period" | "all";

function parseScope(value: string | null): PhotoScope {
  if (value === "period" || value === "all") {
    return value;
  }
  return "week";
}

function parsePositiveInt(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRangeLabel(startAt: string | null, endAt: string | null) {
  if (!startAt || !endAt) {
    return "";
  }

  const start = new Date(startAt);
  const endExclusive = new Date(endAt);
  const end = new Date(endExclusive);
  end.setDate(end.getDate() - 1);

  return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
}

function buildWeekListBackLink(
  monthToken: string,
  selectedFilter: ReturnType<typeof parseEntryFilter>,
  displayParam: string | null,
  showCurrentWeekBudget: boolean,
  selectedCategoryIds: number[],
) {
  const params = new URLSearchParams({ month: monthToken, panel: "routine" });

  if (selectedFilter !== "ALL") {
    params.set("type", selectedFilter);
  }

  const budgetQuery = buildBudgetQuery(displayParam, showCurrentWeekBudget, selectedCategoryIds);
  if (budgetQuery) {
    for (const [key, value] of new URLSearchParams(budgetQuery)) {
      params.set(key, value);
    }
  }

  return `/ledger/weeks?${params.toString()}`;
}

function buildPhotoScopeLink(
  monthToken: string,
  typeId: number,
  scope: PhotoScope,
  selectedFilter: ReturnType<typeof parseEntryFilter>,
  displayParam: string | null,
  showCurrentWeekBudget: boolean,
  selectedCategoryIds: number[],
  weekStartAt: string | null,
  weekEndAt: string | null,
  periodStartAt: string | null,
  periodEndAt: string | null,
) {
  const params = new URLSearchParams({
    month: monthToken,
    typeId: String(typeId),
    scope,
  });

  if (selectedFilter !== "ALL") {
    params.set("type", selectedFilter);
  }

  const budgetQuery = buildBudgetQuery(displayParam, showCurrentWeekBudget, selectedCategoryIds);
  if (budgetQuery) {
    for (const [key, value] of new URLSearchParams(budgetQuery)) {
      params.set(key, value);
    }
  }

  if (weekStartAt) params.set("weekStartAt", weekStartAt);
  if (weekEndAt) params.set("weekEndAt", weekEndAt);
  if (periodStartAt) params.set("periodStartAt", periodStartAt);
  if (periodEndAt) params.set("periodEndAt", periodEndAt);

  return `/ledger/routine/photos?${params.toString()}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "USER");
  const url = new URL(request.url);
  const monthToken = parseMonthToken(url.searchParams.get("month")) ?? getMonthToken(new Date());
  const selectedFilter = parseEntryFilter(url.searchParams.get("type"));
  const displayParam = url.searchParams.get("display");
  const showCurrentWeekBudget = parseCurrentWeekBudgetView(url.searchParams.get("currentWeek"));
  const selectedCategoryIds = parseCategoryIds(url.searchParams);
  const typeId = parsePositiveInt(url.searchParams.get("typeId"));
  const scope = parseScope(url.searchParams.get("scope"));
  const weekStartAt = url.searchParams.get("weekStartAt");
  const weekEndAt = url.searchParams.get("weekEndAt");
  const periodStartAt = url.searchParams.get("periodStartAt");
  const periodEndAt = url.searchParams.get("periodEndAt");

  if (typeId === null) {
    throw new Response("루틴 타입을 찾을 수 없어요.", { status: 404 });
  }

  const routineType = await db.routineType.findFirst({
    where: {
      id: typeId,
      userId: user.id,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      color: true,
    },
  });

  if (!routineType) {
    throw new Response("루틴 타입을 찾을 수 없어요.", { status: 404 });
  }

  const parsedWeekStart = parseDate(weekStartAt);
  const parsedWeekEnd = parseDate(weekEndAt);
  const parsedPeriodStart = parseDate(periodStartAt);
  const parsedPeriodEnd = parseDate(periodEndAt);

  let rangeStart: Date | undefined;
  let rangeEnd: Date | undefined;

  if (scope === "week" && parsedWeekStart && parsedWeekEnd) {
    rangeStart = parsedWeekStart;
    rangeEnd = parsedWeekEnd;
  } else if (scope === "period" && parsedPeriodStart && parsedPeriodEnd) {
    rangeStart = parsedPeriodStart;
    rangeEnd = parsedPeriodEnd;
  }

  const records = await db.routineRecord.findMany({
    where: {
      userId: user.id,
      typeId,
      OR: [{ photoUrl1: { not: null } }, { photoUrl2: { not: null } }],
      ...(rangeStart && rangeEnd
        ? {
            recordDate: {
              gte: rangeStart,
              lt: rangeEnd,
            },
          }
        : {}),
    },
    orderBy: [{ recordDate: "desc" }, { performedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      recordDate: true,
      performedAt: true,
      memo: true,
      photoUrl1: true,
      photoUrl2: true,
    },
  });

  const photos = records.flatMap((record) => {
    const photoEntries = [
      { key: `${record.id}-1`, url: record.photoUrl1 },
      { key: `${record.id}-2`, url: record.photoUrl2 },
    ].filter((item): item is { key: string; url: string } => Boolean(item.url));

    return photoEntries.map((item) => ({
      id: item.key,
      url: item.url,
      status: record.status,
      recordDate: record.recordDate.toISOString(),
      performedAt: record.performedAt?.toISOString() ?? null,
      memo: record.memo,
    }));
  });

  return {
    monthToken,
    selectedFilter,
    displayParam,
    showCurrentWeekBudget,
    selectedCategoryIds,
    routineType,
    scope,
    weekStartAt,
    weekEndAt,
    periodStartAt,
    periodEndAt,
    weekRangeLabel: formatRangeLabel(weekStartAt, weekEndAt),
    periodRangeLabel: formatRangeLabel(periodStartAt, periodEndAt),
    backLink: buildWeekListBackLink(monthToken, selectedFilter, displayParam, showCurrentWeekBudget, selectedCategoryIds),
    photos,
  };
};

export default function LedgerRoutinePhotosPage() {
  const {
    monthToken,
    selectedFilter,
    displayParam,
    showCurrentWeekBudget,
    selectedCategoryIds,
    routineType,
    scope,
    weekStartAt,
    weekEndAt,
    periodStartAt,
    periodEndAt,
    weekRangeLabel,
    periodRangeLabel,
    backLink,
    photos,
  } = useLoaderData<typeof loader>();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  const scopeLabel = useMemo(() => {
    if (scope === "all") return "전체";
    if (scope === "period") return periodRangeLabel || "이 기간";
    return weekRangeLabel || "선택한 주";
  }, [periodRangeLabel, scope, weekRangeLabel]);

  const previewPhoto = previewIndex !== null ? photos[previewIndex] ?? null : null;
  const canSwipePreview = photos.length > 1;

  const goToPreviousPhoto = () => {
    setPreviewIndex((current) => (current === null ? 0 : (current - 1 + photos.length) % photos.length));
  };

  const goToNextPhoto = () => {
    setPreviewIndex((current) => (current === null ? 0 : (current + 1) % photos.length));
  };

  const handlePreviewTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.changedTouches[0]?.clientX ?? null;
  };

  const handlePreviewTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!canSwipePreview || touchStartXRef.current === null) {
      touchStartXRef.current = null;
      return;
    }

    const touchEndX = event.changedTouches[0]?.clientX ?? null;
    if (touchEndX === null) {
      touchStartXRef.current = null;
      return;
    }

    const deltaX = touchEndX - touchStartXRef.current;
    touchStartXRef.current = null;

    if (Math.abs(deltaX) < 40) {
      return;
    }

    if (deltaX > 0) {
      goToPreviousPhoto();
      return;
    }

    goToNextPhoto();
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="border-b bg-white px-3 py-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
            <Link to={backLink}>
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-[1rem] font-semibold text-slate-900">{routineType.name} 사진</h1>
            <p className="mt-0.5 text-[11px] text-slate-400">{scopeLabel}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to={buildPhotoScopeLink(
              monthToken,
              routineType.id,
              "week",
              selectedFilter,
              displayParam,
              showCurrentWeekBudget,
              selectedCategoryIds,
              weekStartAt,
              weekEndAt,
              periodStartAt,
              periodEndAt,
            )}
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] transition-colors",
              scope === "week" ? "border-slate-300 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500",
            )}
          >
            선택한 주
          </Link>
          <Link
            to={buildPhotoScopeLink(
              monthToken,
              routineType.id,
              "period",
              selectedFilter,
              displayParam,
              showCurrentWeekBudget,
              selectedCategoryIds,
              weekStartAt,
              weekEndAt,
              periodStartAt,
              periodEndAt,
            )}
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] transition-colors",
              scope === "period" ? "border-slate-300 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500",
            )}
          >
            이 기간
          </Link>
          <Link
            to={buildPhotoScopeLink(
              monthToken,
              routineType.id,
              "all",
              selectedFilter,
              displayParam,
              showCurrentWeekBudget,
              selectedCategoryIds,
              weekStartAt,
              weekEndAt,
              periodStartAt,
              periodEndAt,
            )}
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] transition-colors",
              scope === "all" ? "border-slate-300 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500",
            )}
          >
            전체
          </Link>
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">아직 올린 사진이 없어요.</p>
          <p className="mt-1 text-xs text-slate-400">루틴 기록에서 사진을 올리면 여기서 모아서 볼 수 있어요.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 px-3 py-3">
          {photos.map((photo, index) => (
              <button
                key={photo.id}
                type="button"
                className="overflow-hidden rounded-2xl bg-slate-100 text-left"
                onClick={() => setPreviewIndex(index)}
              >
                <img src={photo.url} alt={routineType.name} className="aspect-square w-full object-cover" />
                <div className="space-y-0.5 px-2.5 py-2">
                  <p className="text-[11px] font-medium text-slate-700">
                    {new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(new Date(photo.recordDate))}
                  </p>
                  {photo.performedAt ? <p className="text-[10px] text-slate-400">{formatRoutineTimeValue(photo.performedAt)}</p> : null}
                  {photo.memo ? <p className="line-clamp-2 text-[10px] text-slate-500">{photo.memo}</p> : null}
                </div>
              </button>
          ))}
        </div>
      )}

      <Dialog open={previewIndex !== null} onOpenChange={(open) => !open && setPreviewIndex(null)}>
        <DialogContent className="overflow-hidden border-none bg-transparent p-0 shadow-none sm:max-w-xl">
          {previewPhoto ? (
            <div className="relative" onTouchStart={handlePreviewTouchStart} onTouchEnd={handlePreviewTouchEnd}>
              <img src={previewPhoto.url} alt={routineType.name} className="max-h-[80vh] w-full rounded-3xl object-contain bg-black" />
              {canSwipePreview ? (
                <>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-1 text-[11px] text-white">
                    {previewIndex! + 1} / {photos.length}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
