import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Form } from "react-router";
import { ChevronDown, ImagePlus, Pencil, Plus, Settings2, Trash2 } from "lucide-react";

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
import { formatRoutineTimeValue } from "~/lib/routine";
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

type RoutinePhotoFieldProps = {
  label: string;
  inputName: "photo1" | "photo2";
  removeName: "removePhoto1" | "removePhoto2";
  currentUrl: string | null;
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

function RoutinePhotoField({ label, inputName, removeName, currentUrl }: RoutinePhotoFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [blobPreviewUrl, setBlobPreviewUrl] = useState<string | null>(null);
  const [markedForRemoval, setMarkedForRemoval] = useState(false);

  useEffect(() => {
    setMarkedForRemoval(false);
    setBlobPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, [currentUrl]);

  useEffect(() => {
    return () => {
      if (blobPreviewUrl) {
        URL.revokeObjectURL(blobPreviewUrl);
      }
    };
  }, [blobPreviewUrl]);

  const displayUrl = blobPreviewUrl ?? (!markedForRemoval ? currentUrl : null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }

    setBlobPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return URL.createObjectURL(file);
    });
    setMarkedForRemoval(false);
  }

  function handleRemove() {
    setBlobPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setMarkedForRemoval(Boolean(currentUrl));
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-slate-500">{label}</p>
        {displayUrl ? (
          <button
            type="button"
            className="text-[10px] text-slate-400 transition-colors hover:text-rose-400"
            onClick={handleRemove}
          >
            지우기
          </button>
        ) : null}
      </div>
      <input type="hidden" name={removeName} value={markedForRemoval ? "1" : "0"} />
      <label className="group relative flex h-28 cursor-pointer overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-white">
        {displayUrl ? (
          <img src={displayUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-[11px] text-slate-400">
            <ImagePlus className="mb-1.5 h-4 w-4" />
            사진 선택
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-full bg-black/35 px-2 py-1 text-center text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
          {displayUrl ? "사진 바꾸기" : "사진 찍기 또는 선택"}
        </div>
        <input ref={inputRef} type="file" name={inputName} accept="image/*" className="hidden" onChange={handleFileChange} />
      </label>
    </div>
  );
}

function RoutineRecordEditor({ typeId, record, title, description, submitLabel }: RoutineRecordEditorProps) {
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
            <RoutinePhotoField label="사진 1" inputName="photo1" removeName="removePhoto1" currentUrl={record?.photoUrl1 ?? null} />
            <RoutinePhotoField label="사진 2" inputName="photo2" removeName="removePhoto2" currentUrl={record?.photoUrl2 ?? null} />
          </div>
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
  const hasDayNote = dayNoteMemo.trim().length > 0;
  const [isDayNoteEditing, setIsDayNoteEditing] = useState(() => !hasDayNote);

  const completedCount = useMemo(() => routineTypes.filter((type) => type.todayRecord?.status === "SUCCESS").length, [routineTypes]);
  const totalRecordCount = useMemo(() => routineTypes.filter((type) => type.todayRecord !== null).length, [routineTypes]);
  const totalGoalCount = useMemo(
    () => routineTypes.reduce((sum, type) => sum + (type.weeklyGoalCount ?? 0), 0),
    [routineTypes],
  );

  useEffect(() => {
    setIsDayNoteEditing(!hasDayNote);
  }, [hasDayNote]);

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
                        : [recordTimeLabel, recordPhotos.length > 0 ? `사진 ${recordPhotos.length}장` : null]
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

      <div className="relative overflow-hidden rounded-[26px] border border-[#eadfcd] bg-[linear-gradient(140deg,#fffaf4_0%,#fffdf9_52%,#f4ebdf_100%)] px-3 py-3 shadow-[0_10px_28px_rgba(148,120,80,0.08)] before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(transparent_0px,transparent_31px,rgba(183,160,132,0.10)_32px)] before:bg-[length:100%_32px]">
        {hasDayNote && !isDayNoteEditing ? (
          <>
            <div className="relative rounded-[22px] border border-white/70 bg-[rgba(255,255,255,0.58)] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-[2px]">
            <div className="mb-1 text-[1.6rem] leading-none text-[#d7c1a4]">"</div>
            <p className="whitespace-pre-wrap px-1 text-[0.92rem] leading-8 text-[#5b4a39]">{dayNoteMemo}</p>
            <div className="mt-1 flex justify-end pr-1 text-[1.6rem] leading-none text-[#d7c1a4]">"</div>
            </div>
            <div className="mt-2 flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                className="h-6 w-6 rounded-full p-0 text-[#cfbead] hover:bg-white/40 hover:text-[#a88e76]"
                onClick={() => setIsDayNoteEditing(true)}
                aria-label="메모 수정"
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Form method="post">
                <input type="hidden" name="intent" value="save_routine_day_note" />
                <input type="hidden" name="memo" value="" />
                <Button
                  type="submit"
                  variant="ghost"
                  className="h-6 w-6 rounded-full p-0 text-[#dbc8c6] hover:bg-white/40 hover:text-rose-300"
                  aria-label="메모 삭제"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </Form>
            </div>
          </>
        ) : (
          <Form method="post" className="space-y-2">
            <input type="hidden" name="intent" value="save_routine_day_note" />
            <Textarea
              name="memo"
              defaultValue={dayNoteMemo}
              rows={4}
              className="min-h-[110px] rounded-[22px] border-[#eadfcd] bg-white/70 text-sm text-[#5b4a39] placeholder:text-[#c2ad96]"
              placeholder="오늘 하루를 짧게 남겨보세요"
            />
            <div className="flex justify-end gap-2">
              {hasDayNote ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 rounded-full px-3 text-xs text-[#8c7258] hover:bg-white/60 hover:text-[#5c4935]"
                  onClick={() => setIsDayNoteEditing(false)}
                >
                  취소
                </Button>
              ) : null}
              <Button type="submit" className="h-9 rounded-full bg-[#6b5643] px-4 text-xs text-white hover:bg-[#5c4935]">
                메모 저장
              </Button>
            </div>
          </Form>
        )}
      </div>
    </div>
  );
}
