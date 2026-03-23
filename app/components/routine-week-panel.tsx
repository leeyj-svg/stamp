import { useMemo } from "react";

import { getMonthWeekRanges } from "~/lib/ledger-listing";
import { cn } from "~/lib/utils";

type RoutineWeekPanelProps = {
  weekStartDay: "SUNDAY" | "MONDAY";
  displayRangeStartAt: string;
  displayRangeEndAt: string;
  routineTypes: Array<{
    id: number;
    name: string;
    color: string | null;
    weeklyGoalCount: number | null;
  }>;
  routineRecords: Array<{
    id: number;
    typeId: number;
    status: "SUCCESS" | "FAIL" | "SKIPPED";
    recordDate: string;
  }>;
};

function formatWeekRangeLabel(start: Date, end: Date) {
  const displayEnd = new Date(end);
  displayEnd.setDate(displayEnd.getDate() - 1);
  return `${start.getMonth() + 1}/${start.getDate()} - ${displayEnd.getMonth() + 1}/${displayEnd.getDate()}`;
}

function getStatusText(successCount: number, goalCount: number | null, totalCount: number) {
  if (goalCount && goalCount > 0) {
    return `성공 ${successCount}/${goalCount}`;
  }

  if (successCount > 0) {
    return `성공 ${successCount}회`;
  }

  if (totalCount > 0) {
    return "미달성";
  }

  return "미기록";
}

function getPercent(successCount: number, goalCount: number | null) {
  if (!goalCount || goalCount <= 0) {
    return null;
  }

  return Math.max(0, Math.round((successCount / goalCount) * 100));
}

export function RoutineWeekPanel({
  weekStartDay,
  displayRangeStartAt,
  displayRangeEndAt,
  routineTypes,
  routineRecords,
}: RoutineWeekPanelProps) {
  const weekGroups = useMemo(() => {
    const displayRangeStart = new Date(displayRangeStartAt);
    const displayRangeEnd = new Date(displayRangeEndAt);
    const ranges = getMonthWeekRanges(displayRangeStart, displayRangeEnd, weekStartDay);

    return ranges.map((range, index) => {
      const summaries = routineTypes.map((type) => {
        const records = routineRecords.filter((record) => {
          if (record.typeId !== type.id) {
            return false;
          }

          const recordDate = new Date(record.recordDate);
          return recordDate >= range.start && recordDate < range.end;
        });

        const successCount = records.filter((record) => record.status === "SUCCESS").length;
        const percent = getPercent(successCount, type.weeklyGoalCount);

        return {
          id: type.id,
          name: type.name,
          color: type.color ?? "#94a3b8",
          goalCount: type.weeklyGoalCount,
          successCount,
          totalCount: records.length,
          percent,
        };
      });

      return {
        id: `${range.start.toISOString()}-${index}`,
        label: formatWeekRangeLabel(range.start, range.end),
        summaries,
      };
    });
  }, [displayRangeEndAt, displayRangeStartAt, routineRecords, routineTypes, weekStartDay]);

  const hasAnyRoutine = routineTypes.length > 0;

  return (
    <div className="space-y-3 bg-white px-3 py-4">
      {!hasAnyRoutine ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-slate-700">먼저 루틴 타입을 만들어보면 좋아요.</p>
          <p className="mt-1 text-xs text-slate-400">일별 화면에서 루틴 타입을 추가하면 주별 성공률도 같이 보입니다.</p>
        </div>
      ) : (
        weekGroups.map((group) => (
          <section key={group.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-2.5">
              <p className="text-[0.84rem] font-semibold text-slate-800">{group.label}</p>
            </div>
            <div className="space-y-2 px-4 py-3">
              {group.summaries.map((summary) => (
                <div key={summary.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: summary.color }}
                      />
                      <p className="truncate text-[0.76rem] font-medium text-slate-700">{summary.name}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[0.7rem] font-medium text-slate-600">
                        {getStatusText(summary.successCount, summary.goalCount, summary.totalCount)}
                      </p>
                      {summary.percent !== null ? (
                        <p className="text-[0.64rem] text-slate-400">{summary.percent}%</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width]",
                        summary.successCount > 0 ? "" : "bg-slate-200",
                      )}
                      style={{
                        width: `${summary.percent !== null ? Math.min(summary.percent, 100) : summary.totalCount > 0 ? 100 : 0}%`,
                        backgroundColor: summary.successCount > 0 ? summary.color : undefined,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
