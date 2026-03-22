import { useMemo, useState } from "react";
import { Form } from "react-router";
import { ChevronDown, ImagePlus, Plus, Settings2, Trash2 } from "lucide-react";

import { ColorSwatchInput } from "~/components/color-swatch-input";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

type RoutineRecordStatusValue = "SUCCESS" | "FAIL" | "SKIPPED";

type RoutineRecordItem = {
  id: number;
  status: RoutineRecordStatusValue;
  performedAt: string | null;
  photoUrl1: string | null;
  photoUrl2: string | null;
  memo: string | null;
};

type RoutineTypeItem = {
  id: number;
  name: string;
  color: string | null;
  weeklyGoalCount: number | null;
  todayRecord: RoutineRecordItem | null;
};

type RoutinePanelProps = {
  routineTypes: RoutineTypeItem[];
  dayNoteMemo: string;
};

type RoutineRecordEditorProps = {
  typeId: number;
  record: RoutineRecordItem | null;
  title: string;
  description?: string;
  submitLabel: string;
};

const ROUTINE_STATUS_OPTIONS: Array<{
  value: RoutineRecordStatusValue;
  label: string;
  selectedClassName: string;
}> = [
  {
    value: "SUCCESS",
    label: "성공",
    selectedClassName: "peer-checked:border-emerald-300 peer-checked:bg-emerald-50 peer-checked:text-emerald-700",
  },
  {
    value: "FAIL",
    label: "실패",
    selectedClassName: "peer-checked:border-rose-300 peer-checked:bg-rose-50 peer-checked:text-rose-600",
  },
  {
    value: "SKIPPED",
    label: "건너뜀",
    selectedClassName: "peer-checked:border-slate-300 peer-checked:bg-slate-100 peer-checked:text-slate-700",
  },
];

function formatRoutineTimeValue(value: string | null) {
  if (!value) {
    return "";
  }

  const performedAt = new Date(value);
  const hours = String(performedAt.getHours()).padStart(2, "0");
  const minutes = String(performedAt.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getStatusLabel(status: RoutineRecordStatusValue) {
  if (status === "SUCCESS") return "성공";
  if (status === "FAIL") return "실패";
  return "건너뜀";
}

function getTypeSummaryClass(record: RoutineRecordItem | null) {
  if (!record) return "text-slate-400";
  if (record.status === "SUCCESS") return "text-emerald-600";
  if (record.status === "FAIL") return "text-rose-500";
  return "text-slate-500";
}

function getTypeSummaryLabel(record: RoutineRecordItem | null) {
  if (!record) {
    return "미기록";
  }
  return getStatusLabel(record.status);
}

function RoutineRecordEditor({ typeId, record, title, description, submitLabel }: RoutineRecordEditorProps) {
  const recordPhotos = [record?.photoUrl1 ?? null, record?.photoUrl2 ?? null].filter((url): url is string => Boolean(url));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-700">{title}</p>
          {description ? <p className="mt-1 text-[11px] text-slate-400">{description}</p> : null}
        </div>

        {record ? (
          <Form method="post">
            <input type="hidden" name="intent" value="delete_routine_record" />
            <input type="hidden" name="recordId" value={record.id} />
            <Button type="submit" variant="ghost" className="h-7 rounded-full px-2 text-[11px] text-rose-500 hover:text-rose-600">
              <Trash2 className="mr-1 h-3 w-3" />
              삭제
            </Button>
          </Form>
        ) : null}
      </div>

      <Form method="post" encType="multipart/form-data" className="space-y-3">
        <input type="hidden" name="intent" value="save_routine_record" />
        <input type="hidden" name="typeId" value={typeId} />
        <input type="hidden" name="recordId" value={record?.id ?? ""} />

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-slate-500">상태</p>
          <div className="flex gap-1.5">
            {ROUTINE_STATUS_OPTIONS.map((option) => (
              <label key={option.value} className="min-w-0 flex-1">
                <input
                  type="radio"
                  name="status"
                  value={option.value}
                  defaultChecked={(record?.status ?? "SUCCESS") === option.value}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    "flex h-9 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-medium text-slate-500 transition-colors",
                    option.selectedClassName,
                  )}
                >
                  {option.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
          <p className="text-[11px] font-medium text-slate-500">기록 시간</p>
          <Input
            type="time"
            name="performedTime"
            defaultValue={record?.performedAt ? formatRoutineTimeValue(record.performedAt) : ""}
            className="h-9 border-slate-200 bg-white text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-slate-500">인증 사진</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex h-20 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-[11px] text-slate-400">
              <ImagePlus className="mb-1 h-4 w-4" />
              사진 1
              <input type="file" name="photo1" accept="image/*" capture="environment" className="hidden" />
            </label>
            <label className="flex h-20 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-[11px] text-slate-400">
              <ImagePlus className="mb-1 h-4 w-4" />
              사진 2
              <input type="file" name="photo2" accept="image/*" capture="environment" className="hidden" />
            </label>
          </div>
          {recordPhotos.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {recordPhotos.map((photoUrl, index) => (
                <img
                  key={`${photoUrl}-${index}`}
                  src={photoUrl}
                  alt="루틴 인증 사진"
                  className="h-24 w-full rounded-2xl object-cover"
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-slate-500">메모</p>
          <Textarea
            name="memo"
            defaultValue={record?.memo ?? ""}
            rows={3}
            className="min-h-[84px] border-slate-200 bg-white text-sm"
            placeholder="오늘 기록을 짧게 남겨도 좋아요"
          />
        </div>

        <div className="flex justify-end pt-1">
          <Button type="submit" className="h-9 rounded-full px-4 text-xs">
            {submitLabel}
          </Button>
        </div>
      </Form>
    </div>
  );
}

export function RoutinePanel({ routineTypes, dayNoteMemo }: RoutinePanelProps) {
  const [expandedTypeId, setExpandedTypeId] = useState<number | null>(null);
  const [isTypeManagerOpen, setIsTypeManagerOpen] = useState(false);

  const completedCount = useMemo(() => routineTypes.filter((type) => type.todayRecord?.status === "SUCCESS").length, [routineTypes]);
  const totalRecordCount = useMemo(() => routineTypes.filter((type) => type.todayRecord !== null).length, [routineTypes]);

  const totalGoalCount = useMemo(
    () => routineTypes.reduce((sum, type) => sum + (type.weeklyGoalCount ?? 0), 0),
    [routineTypes],
  );

  return (
    <div className="space-y-4 bg-white px-3 py-4">
      <div className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">오늘 루틴</p>
          <p className="mt-1 text-xs text-slate-500">
            {completedCount > 0 ? `성공 ${completedCount}개` : "성공 0개"}
            {totalRecordCount > 0 ? ` / 기록 ${totalRecordCount}개` : ""}
            {routineTypes.length > 0 ? ` / 루틴 ${routineTypes.length}개` : ""}
            {totalGoalCount > 0 ? ` / 주 목표 ${totalGoalCount}회` : ""}
          </p>
        </div>

        <Dialog open={isTypeManagerOpen} onOpenChange={setIsTypeManagerOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="h-8 rounded-full px-3 text-xs text-slate-600">
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              타입 관리
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto rounded-3xl p-5 sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-base">루틴 타입 관리</DialogTitle>
              <DialogDescription className="text-xs">
                자주 기록할 루틴을 만들고 이름, 색, 주간 목표를 정해둘 수 있어요.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {routineTypes.map((type) => (
                <Form key={type.id} method="post" className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                  <input type="hidden" name="intent" value="update_routine_type" />
                  <input type="hidden" name="typeId" value={type.id} />
                  <div className="flex items-center gap-2">
                    <ColorSwatchInput name="color" defaultValue={type.color ?? "#94a3b8"} />
                    <Input name="name" defaultValue={type.name} className="h-9 border-slate-200 text-sm" placeholder="루틴 이름" />
                    <Input
                      name="weeklyGoalCount"
                      type="number"
                      min={1}
                      max={14}
                      defaultValue={type.weeklyGoalCount ?? ""}
                      className="h-9 w-20 border-slate-200 text-sm"
                      placeholder="주 n회"
                    />
                    <Button type="submit" className="h-9 rounded-full px-3 text-xs">
                      저장
                    </Button>
                  </div>
                </Form>
              ))}

              <Form method="post" className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3">
                <input type="hidden" name="intent" value="create_routine_type" />
                <div className="flex items-center gap-2">
                  <ColorSwatchInput name="color" defaultValue="#94a3b8" />
                  <Input name="name" className="h-9 border-slate-200 text-sm" placeholder="새 루틴 이름" />
                  <Input
                    name="weeklyGoalCount"
                    type="number"
                    min={1}
                    max={14}
                    className="h-9 w-20 border-slate-200 text-sm"
                    placeholder="주 n회"
                  />
                  <Button type="submit" className="h-9 rounded-full px-3 text-xs">
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    추가
                  </Button>
                </div>
              </Form>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {routineTypes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-slate-700">먼저 루틴 타입을 하나 만들어볼까요?</p>
          <p className="mt-1 text-xs text-slate-500">운동, 약 복용, 공부 같은 항목을 추가하면 바로 기록할 수 있어요.</p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 h-9 rounded-full px-4 text-xs"
            onClick={() => setIsTypeManagerOpen(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            루틴 타입 추가
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {routineTypes.map((type) => {
            const isExpanded = expandedTypeId === type.id;
            const record = type.todayRecord;
            const summaryLabel = getTypeSummaryLabel(record);
            const recordTimeLabel = record?.performedAt ? formatRoutineTimeValue(record.performedAt) : "";
            const recordPhotos = [record?.photoUrl1 ?? null, record?.photoUrl2 ?? null].filter((url): url is string => Boolean(url));

            return (
              <div key={type.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-3 text-left"
                  onClick={() => {
                    setExpandedTypeId((current) => (current === type.id ? null : type.id));
                  }}
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/30 shadow-sm"
                    style={{ backgroundColor: type.color ?? "#94a3b8" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{type.name}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {type.weeklyGoalCount ? `주 ${type.weeklyGoalCount}회 목표` : "주간 목표 미설정"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn("text-xs font-medium", getTypeSummaryClass(record))}>{summaryLabel}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {record === null
                        ? "기록하기"
                        : [
                            recordTimeLabel,
                            recordPhotos.length > 0 ? `사진 ${recordPhotos.length}장` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </p>
                  </div>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", isExpanded && "rotate-180")} />
                </button>

                {isExpanded ? (
                  <div className="space-y-2 border-t border-slate-100 bg-slate-50/80 px-3 py-3">
                    <RoutineRecordEditor
                      typeId={type.id}
                      record={record}
                      title={record ? "오늘 기록" : "기록하기"}
                      description={record ? [recordTimeLabel, getStatusLabel(record.status)].filter(Boolean).join(" · ") : "하루 한 번만 기록합니다."}
                      submitLabel={record ? "저장" : "기록"}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
        <div className="mb-2">
          <p className="text-sm font-medium text-slate-800">하루 메모</p>
          <p className="mt-1 text-[11px] text-slate-400">그날 느낌이나 체크한 걸 가볍게 남겨둘 수 있어요.</p>
        </div>
        <Form method="post" className="space-y-2">
          <input type="hidden" name="intent" value="save_routine_day_note" />
          <Textarea
            name="memo"
            defaultValue={dayNoteMemo}
            rows={4}
            className="min-h-[104px] border-slate-200 bg-slate-50 text-sm"
            placeholder="오늘 루틴 메모"
          />
          <div className="flex justify-end">
            <Button type="submit" className="h-9 rounded-full px-4 text-xs">
              메모 저장
            </Button>
          </div>
        </Form>
      </div>
    </div>
  );
}
