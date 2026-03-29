import {
  AlertCircle,
  Archive,
  Bold,
  Check,
  CheckCheck,
  ChevronsUpDown,
  CircleDot,
  Code2,
  File,
  FileArchive,
  FileImage,
  FileText,
  Github,
  Heading1,
  Heading2,
  List,
  ListChecks,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  RotateCcw,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";

import { DevlogRichText } from "~/components/devlog-rich-text";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "~/components/ui/command";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";
import { formatDevlogWorkItemReference, getDevlogStatusLabel } from "~/lib/devlog";
import {
  addDevWorkAttachment,
  attachDevWorkItemToDiaryPage,
  createDevWorkNote,
  createDevWorkItem,
  createDevWorkChecklistItem,
  createGitHubIssueForDevWorkItem,
  deleteDevWorkNote,
  deleteDevWorkAttachment,
  deleteDevWorkChecklistItem,
  loadDevWorkItemWindow,
  saveDevWorkItem,
  setDevWorkItemPinned,
  toggleDevWorkChecklistItem,
  toggleDevWorkChecklistToday,
  updateDevWorkNote,
} from "~/lib/devlog.server";
import { getSessionWithPermission } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { getDateKey, parseRequiredDateToken } from "~/lib/ledger-entry";
import { commitSession, getFlashSession } from "~/lib/session.server";

function buildWorkWindowLink(dateToken: string, workItemId: number, workSetId?: number | null) {
  const query = workSetId ? `?set=${workSetId}` : "";
  return `/devlog/${dateToken}/work/${workItemId}${query}`;
}

function buildDashboardLink(dateToken: string, workSetId?: number | null) {
  const query = workSetId ? `?set=${workSetId}` : "";
  return `/devlog/${dateToken}${query}`;
}

function parseWorkItemId(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatDisplayDate(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return "기록 없음";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "기록 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCalendarDate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function toDateInputValue(value: string | Date | null | undefined) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function formatByteSize(value: number | null | undefined) {
  if (!value || value < 1) {
    return null;
  }

  if (value < 1024) {
    return `${value}B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)}KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

type NoteTemplateId =
  | "bold"
  | "heading1"
  | "heading2"
  | "bullet"
  | "todo"
  | "ordered"
  | "quote"
  | "code"
  | "divider"
  | "callout";

const NOTE_TEMPLATE_ITEMS: Array<{ id: NoteTemplateId; label: string; icon: LucideIcon }> = [
  { id: "bold", label: "굵게", icon: Bold },
  { id: "heading1", label: "제목", icon: Heading1 },
  { id: "heading2", label: "소제목", icon: Heading2 },
  { id: "bullet", label: "불릿", icon: List },
  { id: "todo", label: "할 일", icon: ListChecks },
  { id: "ordered", label: "번호 목록", icon: ListOrdered },
  { id: "quote", label: "인용", icon: Quote },
  { id: "code", label: "코드", icon: Code2 },
  { id: "divider", label: "구분선", icon: Minus },
  { id: "callout", label: "강조", icon: AlertCircle },
];

type NoteTemplateResult = {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
};

function wrapSelectionWithSyntax(value: string, start: number, end: number, before: string, after = before): NoteTemplateResult {
  const selectedText = value.slice(start, end);
  const replacement = `${before}${selectedText}${after}`;
  const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  const selectionStart = start + before.length;
  const selectionEnd = selectionStart + selectedText.length;

  return {
    nextValue,
    selectionStart,
    selectionEnd,
  };
}

function getSelectedLineRange(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextLineBreak = value.indexOf("\n", end);
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;

  return { lineStart, lineEnd };
}

function replaceSelectedLines(
  value: string,
  start: number,
  end: number,
  transform: (line: string, index: number) => string,
): NoteTemplateResult {
  const { lineStart, lineEnd } = getSelectedLineRange(value, start, end);
  const selectedLines = value.slice(lineStart, lineEnd).split("\n");
  const replacement = selectedLines.map(transform).join("\n");
  const nextValue = `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`;

  return {
    nextValue,
    selectionStart: lineStart,
    selectionEnd: lineStart + replacement.length,
  };
}

function insertStandaloneBlock(value: string, start: number, end: number, blockText: string, cursorOffset: number): NoteTemplateResult {
  const needsLeadingBreak = start > 0 && value[start - 1] !== "\n";
  const needsTrailingBreak = end < value.length && value[end] !== "\n";
  const prefix = needsLeadingBreak ? "\n" : "";
  const suffix = needsTrailingBreak ? "\n" : "";
  const replacement = `${prefix}${blockText}${suffix}`;
  const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  const selectionStart = start + prefix.length + cursorOffset;

  return {
    nextValue,
    selectionStart,
    selectionEnd: selectionStart,
  };
}

function applyNoteTemplate(value: string, start: number, end: number, templateId: NoteTemplateId): NoteTemplateResult {
  switch (templateId) {
    case "bold": {
      if (start === end) {
        const nextValue = `${value.slice(0, start)}****${value.slice(end)}`;
        return {
          nextValue,
          selectionStart: start + 2,
          selectionEnd: start + 2,
        };
      }

      if (value.slice(start, end).includes("\n")) {
        return replaceSelectedLines(value, start, end, (line) => {
          if (!line.trim()) {
            return line;
          }

          const normalized = line.replace(/^\*\*(.*)\*\*$/, "$1");
          return `**${normalized}**`;
        });
      }

      return wrapSelectionWithSyntax(value, start, end, "**");
    }
    case "heading1":
      return replaceSelectedLines(value, start, end, (line) => `# ${line.replace(/^#{1,3}\s+/, "")}`);
    case "heading2":
      return replaceSelectedLines(value, start, end, (line) => `## ${line.replace(/^#{1,3}\s+/, "")}`);
    case "bullet":
      return replaceSelectedLines(value, start, end, (line) => `- ${line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "")}`);
    case "todo":
      return replaceSelectedLines(value, start, end, (line) => `- [ ] ${line.replace(/^-\s+\[( |x|X)\]\s+/, "").replace(/^[-*]\s+/, "")}`);
    case "ordered":
      return replaceSelectedLines(value, start, end, (line, index) => `${index + 1}. ${line.replace(/^\d+\.\s+/, "").replace(/^[-*]\s+/, "")}`);
    case "quote":
      return replaceSelectedLines(value, start, end, (line) => `> ${line.replace(/^>\s?/, "")}`);
    case "callout":
      return replaceSelectedLines(value, start, end, (line) => `! ${line.replace(/^!\s+/, "")}`);
    case "code": {
      const selectedText = value.slice(start, end);
      const replacement = `\`\`\`\n${selectedText}\n\`\`\``;
      const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
      const selectionStart = start + 4;
      const selectionEnd = selectionStart + selectedText.length;

      return {
        nextValue,
        selectionStart,
        selectionEnd,
      };
    }
    case "divider":
      return insertStandaloneBlock(value, start, end, "---", 3);
  }
}

function applyNoteTemplateToDraft({
  textarea,
  value,
  setValue,
  templateId,
}: {
  textarea: HTMLTextAreaElement | null;
  value: string;
  setValue: (nextValue: string) => void;
  templateId: NoteTemplateId;
}) {
  const selectionStart = textarea?.selectionStart ?? value.length;
  const selectionEnd = textarea?.selectionEnd ?? value.length;
  const next = applyNoteTemplate(value, selectionStart, selectionEnd, templateId);

  setValue(next.nextValue);

  if (!textarea || typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
    resizeNoteTextarea(textarea);
  });
}

function resizeNoteTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return;
  }

  const viewportMinHeight = typeof window === "undefined" ? 320 : Math.max(window.innerHeight - 360, 320);
  textarea.style.height = "0px";
  textarea.style.height = `${Math.max(textarea.scrollHeight, viewportMinHeight)}px`;
}

function NoteTemplateToolbar({ onApply }: { onApply: (templateId: NoteTemplateId) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {NOTE_TEMPLATE_ITEMS.map((item) => {
        const Icon = item.icon;

        return (
          <Button
            key={item.id}
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-full border-[#e4d4be] bg-[#fffdfa] text-slate-500 hover:bg-[#f7efe4] hover:text-[#7b5c36]"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onApply(item.id)}
            aria-label={item.label}
            title={item.label}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        );
      })}
    </div>
  );
}

function getAttachmentTypeLabel(kind: string) {
  switch (kind) {
    case "IMAGE":
      return "이미지";
    case "DOCUMENT":
      return "문서";
    case "ARCHIVE":
      return "압축";
    default:
      return "파일";
  }
}

function getAttachmentExtension(fileName: string) {
  const extension = fileName.split(".").pop()?.trim();
  if (!extension) {
    return "FILE";
  }

  return extension.slice(0, 4).toUpperCase();
}

function getAttachmentIcon(kind: string) {
  switch (kind) {
    case "IMAGE":
      return FileImage;
    case "DOCUMENT":
      return FileText;
    case "ARCHIVE":
      return FileArchive;
    default:
      return File;
  }
}

type ParentWorkItemPickerProps = {
  workItemId: number;
  form?: string;
  currentParentWorkItem: {
    id: number;
    title: string;
    status: string;
    isMinimized: boolean;
  } | null;
  parentCandidates: Array<{
    id: number;
    title: string;
    status: string;
    isMinimized: boolean;
  }>;
  getStatusLabel: (status: string) => string;
};

function ParentWorkItemPicker({
  workItemId,
  form,
  currentParentWorkItem,
  parentCandidates,
  getStatusLabel,
}: ParentWorkItemPickerProps) {
  const [open, setOpen] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState(currentParentWorkItem ? String(currentParentWorkItem.id) : "");

  useEffect(() => {
    setSelectedParentId(currentParentWorkItem ? String(currentParentWorkItem.id) : "");
  }, [currentParentWorkItem?.id, workItemId]);

  const selectedParentWorkItem = useMemo(
    () =>
      parentCandidates.find((item) => String(item.id) === selectedParentId) ??
      (currentParentWorkItem && String(currentParentWorkItem.id) === selectedParentId ? currentParentWorkItem : null),
    [currentParentWorkItem, parentCandidates, selectedParentId],
  );

  return (
    <label className="space-y-2 text-sm font-medium text-slate-700">
      <span>상위 카드</span>
      <input type="hidden" name="parentWorkItemId" value={selectedParentId} form={form} />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full justify-between rounded-md border-input bg-background px-3 text-left font-normal shadow-sm"
          >
            {selectedParentWorkItem ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-xs font-semibold text-[#94724b]">
                  {formatDevlogWorkItemReference(selectedParentWorkItem.id)}
                </span>
                <span className="truncate text-slate-900">{selectedParentWorkItem.title}</span>
              </span>
            ) : (
              <span className="text-slate-500">상위 카드를 찾아 연결</span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[min(520px,calc(100vw-3rem))] p-0">
          <Command>
            <CommandInput placeholder="카드 제목 또는 #번호로 검색" />
            <CommandList>
              <CommandEmpty>연결할 카드를 찾지 못했어요.</CommandEmpty>

              <CommandGroup heading="선택">
                <CommandItem
                  value="연결 없음 해제"
                  onSelect={() => {
                    setSelectedParentId("");
                    setOpen(false);
                  }}
                >
                  <Check className={`h-4 w-4 ${selectedParentId ? "opacity-0" : "opacity-100"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">연결 안 함</p>
                    <p className="text-xs text-slate-500">현재 카드는 상위 카드 없이 둡니다.</p>
                  </div>
                </CommandItem>
              </CommandGroup>

              <CommandGroup heading="카드 검색">
                {parentCandidates.map((item) => {
                  const reference = formatDevlogWorkItemReference(item.id);
                  const isSelected = selectedParentId === String(item.id);

                  return (
                    <CommandItem
                      key={item.id}
                      value={`${reference} ${item.title} ${getStatusLabel(item.status)}`}
                      keywords={[String(item.id), reference, item.title, getStatusLabel(item.status)]}
                      onSelect={() => {
                        setSelectedParentId(String(item.id));
                        setOpen(false);
                      }}
                    >
                      <Check className={`h-4 w-4 ${isSelected ? "opacity-100" : "opacity-0"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 text-xs font-semibold text-[#94724b]">{reference}</span>
                          <p className="truncate font-medium text-slate-900">{item.title}</p>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{getStatusLabel(item.status)}</p>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <p className="text-xs text-slate-500">카드 제목이나 `#번호`로 바로 찾아 연결할 수 있어요.</p>
    </label>
  );
}

function WorkItemReferenceText({
  dateToken,
  workSetId,
  text,
  className,
  emptyText,
}: {
  dateToken: string;
  workSetId: number;
  text: string | null | undefined;
  className: string;
  emptyText?: string;
}) {
  return (
    <DevlogRichText
      text={text}
      className={className}
      emptyText={emptyText}
      referenceHrefBuilder={(workItemId) => buildWorkWindowLink(dateToken, workItemId, workSetId)}
    />
  );
}

function getSuccessMessage(intent: FormDataEntryValue | null) {
  switch (intent) {
    case "create_work_item":
      return "하위 이슈를 만들었어요.";
    case "create_work_note":
      return "작업 메모를 추가했어요.";
    case "update_work_note":
      return "작업 메모를 수정했어요.";
    case "delete_work_note":
      return "작업 메모를 삭제했어요.";
    case "save_work_item":
      return "작업 내용을 저장했어요.";
    case "create_github_issue":
      return "GitHub 이슈를 만들었어요.";
    case "add_checklist_item":
      return "체크리스트 항목을 추가했어요.";
    case "toggle_checklist_item":
      return "체크리스트 상태를 바꿨어요.";
    case "toggle_checklist_today":
      return "오늘 할 일 표시를 바꿨어요.";
    case "delete_checklist_item":
      return "체크리스트 항목을 삭제했어요.";
    case "add_attachment":
      return "파일을 올렸어요.";
    case "delete_attachment":
      return "파일을 삭제했어요.";
    default:
      return "변경 내용을 저장했어요.";
  }
}

function getErrorMessage(intent: FormDataEntryValue | null) {
  switch (intent) {
    case "create_work_item":
      return "하위 이슈를 만들지 못했어요.";
    case "create_work_note":
      return "작업 메모를 추가하지 못했어요.";
    case "update_work_note":
      return "작업 메모를 수정하지 못했어요.";
    case "delete_work_note":
      return "작업 메모를 삭제하지 못했어요.";
    case "save_work_item":
      return "작업 내용을 저장하지 못했어요.";
    case "create_github_issue":
      return "GitHub 이슈를 만들지 못했어요.";
    case "add_checklist_item":
      return "체크리스트 항목을 추가하지 못했어요.";
    case "toggle_checklist_item":
      return "체크리스트 상태를 바꾸지 못했어요.";
    case "toggle_checklist_today":
      return "오늘 할 일 표시를 바꾸지 못했어요.";
    case "delete_checklist_item":
      return "체크리스트 항목을 삭제하지 못했어요.";
    case "add_attachment":
      return "파일을 올리지 못했어요.";
    case "delete_attachment":
      return "파일을 삭제하지 못했어요.";
    default:
      return "요청을 처리하지 못했어요.";
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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "ADMIN");
  const selectedDate = parseRequiredDateToken(params.date);
  const workItemId = parseWorkItemId(params.workItemId);

  if (!workItemId) {
    throw new Response("작업창을 찾을 수 없어요.", { status: 404 });
  }

  const snapshot = await loadDevWorkItemWindow(db, user.id, selectedDate, workItemId);
  const dateToken = getDateKey(selectedDate);

  return {
    dateToken,
    workLink: buildWorkWindowLink(dateToken, workItemId, snapshot.selectedWorkSet.id),
    displayDateLabel: formatDisplayDate(selectedDate),
    ...snapshot,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { user } = await getSessionWithPermission(request, "ADMIN");
  const selectedDate = parseRequiredDateToken(params.date);
  const workItemId = parseWorkItemId(params.workItemId);

  if (!workItemId) {
    throw new Response("작업창을 찾을 수 없어요.", { status: 404 });
  }

  const dateToken = getDateKey(selectedDate);
  const existingWorkItem = await loadDevWorkItemWindow(db, user.id, selectedDate, workItemId);
  const workLink = buildWorkWindowLink(dateToken, workItemId, existingWorkItem.selectedWorkSet.id);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const responseMode = formData.get("responseMode");

  try {
    if (intent === "create_work_item") await createDevWorkItem(db, user.id, selectedDate, formData);
    else if (intent === "create_work_note") {
      await createDevWorkNote(db, user.id, selectedDate, formData);
      if (responseMode === "inline") {
        return {
          saved: true,
          savedAt: new Date().toISOString(),
        };
      }
    }
    else if (intent === "update_work_note") {
      await updateDevWorkNote(db, user.id, selectedDate, formData);
      if (responseMode === "inline") {
        return {
          saved: true,
          savedAt: new Date().toISOString(),
        };
      }
    }
    else if (intent === "delete_work_note") {
      await deleteDevWorkNote(db, user.id, selectedDate, formData);
      if (responseMode === "inline") {
        return {
          deleted: true,
          savedAt: new Date().toISOString(),
        };
      }
    }
    else if (intent === "save_work_item") {
      await saveDevWorkItem(db, user.id, selectedDate, formData);
      if (responseMode === "inline") {
        return {
          saved: true,
          savedAt: new Date().toISOString(),
          status: typeof formData.get("status") === "string" ? String(formData.get("status")) : null,
        };
      }
    }
    else if (intent === "create_github_issue") {
      const issue = await createGitHubIssueForDevWorkItem(db, user.id, formData);
      if (responseMode === "inline") {
        return {
          created: true,
          issue,
        };
      }
    }
    else if (intent === "add_checklist_item") await createDevWorkChecklistItem(db, user.id, selectedDate, formData);
    else if (intent === "toggle_checklist_item") await toggleDevWorkChecklistItem(db, user.id, selectedDate, formData);
    else if (intent === "toggle_checklist_today") await toggleDevWorkChecklistToday(db, user.id, selectedDate, formData);
    else if (intent === "delete_checklist_item") await deleteDevWorkChecklistItem(db, user.id, selectedDate, formData);
    else if (intent === "add_attachment") await addDevWorkAttachment(db, user.id, selectedDate, formData);
    else if (intent === "delete_attachment") await deleteDevWorkAttachment(db, user.id, selectedDate, formData);
    else if (intent === "attach_work_item_to_page") {
      await attachDevWorkItemToDiaryPage(db, user.id, selectedDate, formData);
      if (responseMode === "inline") {
        return { attached: true };
      }
      return redirectWithToast(request, "success", "현재 날짜 페이지에 작업을 연결했어요.", workLink);
    }
    else if (intent === "toggle_work_item_pin") {
      const isPinned = await setDevWorkItemPinned(db, user.id, selectedDate, formData);
      if (responseMode === "inline") {
        return { isPinned };
      }
      return redirectWithToast(
        request,
        "success",
        isPinned ? "작업을 상단에 고정했어요." : "작업 상단 고정을 해제했어요.",
        workLink,
      );
    }
    else {
      throw new Response("잘못된 요청이에요.", { status: 400 });
    }

    return redirectWithToast(request, "success", getSuccessMessage(intent), workLink);
  } catch {
    if (intent === "attach_work_item_to_page") {
      if (responseMode === "inline") {
        return { attached: false, error: "현재 날짜 페이지에 작업을 연결하지 못했어요." };
      }
      return redirectWithToast(request, "error", "현재 날짜 페이지에 작업을 연결하지 못했어요.", workLink);
    }
    if (intent === "toggle_work_item_pin") {
      if (responseMode === "inline") {
        return { error: "작업 상단 고정을 바꾸지 못했어요." };
      }
      return redirectWithToast(request, "error", "작업 상단 고정을 바꾸지 못했어요.", workLink);
    }
    if (
      (
        intent === "save_work_item" ||
        intent === "create_work_note" ||
        intent === "update_work_note" ||
        intent === "delete_work_note" ||
        intent === "create_github_issue"
      ) &&
      responseMode === "inline"
    ) {
      return { saved: false, deleted: false, created: false, error: getErrorMessage(intent) };
    }

    return redirectWithToast(request, "error", getErrorMessage(intent), workLink);
  }
};

export default function DevlogWorkWindowPage() {
  const { dateToken, displayDateLabel, githubIssueIntegration, statuses, workItem, selectedWorkSet } = useLoaderData<typeof loader>();
  const pinFetcher = useFetcher<{ isPinned?: boolean; error?: string }>();
  const saveFetcher = useFetcher<{ saved?: boolean; savedAt?: string; error?: string; status?: string | null }>();
  const githubIssueFetcher = useFetcher<{
    created?: boolean;
    error?: string;
    issue?: { repo: string; number: number; url: string; alreadyLinked?: boolean };
  }>();
  const noteComposerFetcher = useFetcher<{ saved?: boolean; savedAt?: string; error?: string }>();
  const noteEditFetcher = useFetcher<{ saved?: boolean; savedAt?: string; error?: string }>();
  const noteDeleteFetcher = useFetcher<{ deleted?: boolean; savedAt?: string; error?: string }>();
  const workItemFormId = "work-item-form";
  const statusLabelMap = useMemo(
    () => Object.fromEntries(statuses.map((status) => [status.key, status.label])),
    [statuses],
  );
  const [titleDraft, setTitleDraft] = useState(workItem.title);
  const [statusDraft, setStatusDraft] = useState(workItem.status);
  const [plannedDateDraft, setPlannedDateDraft] = useState(toDateInputValue(workItem.plannedDate));
  const [noteDraft, setNoteDraft] = useState("");
  const [isNoteComposerOpen, setIsNoteComposerOpen] = useState(workItem.notes.length === 0);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteDraft, setEditingNoteDraft] = useState("");
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [isPinnedDraft, setIsPinnedDraft] = useState(workItem.isPinned);
  const [githubIssueDraft, setGitHubIssueDraft] = useState(
    workItem.githubIssueUrl && workItem.githubIssueRepo && workItem.githubIssueNumber
      ? {
          repo: workItem.githubIssueRepo,
          number: workItem.githubIssueNumber,
          url: workItem.githubIssueUrl,
        }
      : null,
  );
  const [issueMenu, setIssueMenu] = useState<"child" | "link" | null>(null);
  const lastSubmittedSaveSignatureRef = useRef<string | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const latestNote = workItem.notes[workItem.notes.length - 1] ?? null;
  const currentEditingNote = useMemo(
    () => (editingNoteId === null ? null : workItem.notes.find((note) => note.id === editingNoteId) ?? null),
    [editingNoteId, workItem.notes],
  );
  const connectedWorkItems = useMemo(() => {
    const seen = new Set<number>();
    const items: Array<{ id: number; label: string; title: string }> = [];

    if (workItem.parentWorkItem && !seen.has(workItem.parentWorkItem.id)) {
      seen.add(workItem.parentWorkItem.id);
      items.push({
        id: workItem.parentWorkItem.id,
        label: "상위",
        title: workItem.parentWorkItem.title,
      });
    }

    for (const item of workItem.childWorkItems) {
      if (seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      items.push({
        id: item.id,
        label: "서브",
        title: item.title,
      });
    }

    for (const item of workItem.referencedWorkItems) {
      if (seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      items.push({
        id: item.id,
        label: "링크",
        title: item.title,
      });
    }

    return items;
  }, [workItem.childWorkItems, workItem.parentWorkItem, workItem.referencedWorkItems]);
  const createdDateLabel = formatCalendarDate(workItem.createdAt);

  const checklistSummary = useMemo(() => {
    const totalCount = workItem.checklist.length;
    const doneCount = workItem.checklist.filter((item) => item.isDone).length;
    const todayCount = workItem.checklist.filter((item) => item.isTodayTodo && !item.isDone).length;

    return {
      totalCount,
      doneCount,
      remainingCount: totalCount - doneCount,
      todayCount,
    };
  }, [workItem.checklist]);

  const initialSaveSignature = useMemo(
    () =>
      JSON.stringify({
        title: workItem.title,
        status: workItem.status,
        plannedDate: toDateInputValue(workItem.plannedDate),
      }),
    [workItem.plannedDate, workItem.status, workItem.title],
  );
  const currentSaveSignature = useMemo(
    () =>
      JSON.stringify({
        title: titleDraft,
        status: statusDraft,
        plannedDate: plannedDateDraft,
      }),
    [plannedDateDraft, statusDraft, titleDraft],
  );

  function buildSaveSignature(nextStatus = statusDraft) {
    return JSON.stringify({
      title: titleDraft,
      status: nextStatus,
      plannedDate: plannedDateDraft,
    });
  }

  function submitWorkItemSave(nextStatus = statusDraft) {
    const formData = new FormData();
    formData.set("intent", "save_work_item");
    formData.set("responseMode", "inline");
    formData.set("workItemId", String(workItem.id));
    formData.set("title", titleDraft);
    formData.set("status", nextStatus);
    formData.set("plannedDate", plannedDateDraft);

    lastSubmittedSaveSignatureRef.current = buildSaveSignature(nextStatus);
    saveFetcher.submit(formData, { method: "post" });
  }

  const [savedSignature, setSavedSignature] = useState(initialSaveSignature);
  const [failedSaveSignature, setFailedSaveSignature] = useState<string | null>(null);
  const hasUnsavedChanges = currentSaveSignature !== savedSignature;
  const shouldAutoSave = hasUnsavedChanges && currentSaveSignature !== failedSaveSignature;

  useEffect(() => {
    setTitleDraft(workItem.title);
    setStatusDraft(workItem.status);
    setPlannedDateDraft(toDateInputValue(workItem.plannedDate));
    setNoteDraft("");
    setIsNoteComposerOpen(workItem.notes.length === 0);
    setEditingNoteId(null);
    setEditingNoteDraft("");
    setIsTitleEditing(false);
    setIsPinnedDraft(workItem.isPinned);
    setGitHubIssueDraft(
      workItem.githubIssueUrl && workItem.githubIssueRepo && workItem.githubIssueNumber
        ? {
            repo: workItem.githubIssueRepo,
            number: workItem.githubIssueNumber,
            url: workItem.githubIssueUrl,
          }
        : null,
    );
    setIssueMenu(null);
    setSavedSignature(initialSaveSignature);
    setFailedSaveSignature(null);
    lastSubmittedSaveSignatureRef.current = null;
  }, [
    initialSaveSignature,
    workItem.githubIssueNumber,
    workItem.githubIssueRepo,
    workItem.githubIssueUrl,
    workItem.id,
    workItem.isPinned,
    workItem.notes.length,
    workItem.plannedDate,
    workItem.status,
    workItem.title,
  ]);

  useEffect(() => {
    if (typeof pinFetcher.data?.isPinned === "boolean") {
      setIsPinnedDraft(pinFetcher.data.isPinned);
    }
  }, [pinFetcher.data]);

  useEffect(() => {
    if (saveFetcher.data?.savedAt) {
      setSavedSignature(lastSubmittedSaveSignatureRef.current ?? currentSaveSignature);
      setFailedSaveSignature(null);

      if (saveFetcher.data.status === "ARCHIVED" && typeof window !== "undefined") {
        try {
          window.opener?.location?.reload();
        } catch {
          // ignore opener refresh failures
        }

        if (window.opener && !window.opener.closed) {
          window.close();
        } else {
          window.location.href = buildDashboardLink(dateToken, selectedWorkSet.id);
        }
      }
      return;
    }

    if (saveFetcher.data?.error) {
      setFailedSaveSignature(lastSubmittedSaveSignatureRef.current ?? currentSaveSignature);
    }
  }, [currentSaveSignature, dateToken, saveFetcher.data, selectedWorkSet.id]);

  useEffect(() => {
    if (!githubIssueFetcher.data?.created || !githubIssueFetcher.data.issue) {
      return;
    }

    setGitHubIssueDraft({
      repo: githubIssueFetcher.data.issue.repo,
      number: githubIssueFetcher.data.issue.number,
      url: githubIssueFetcher.data.issue.url,
    });
  }, [githubIssueFetcher.data]);

  useEffect(() => {
    if (workItem.notes.length === 0) {
      setIsNoteComposerOpen(true);
      setEditingNoteId(null);
      setEditingNoteDraft("");
      return;
    }

    if (isNoteComposerOpen) {
      return;
    }

    if (currentEditingNote) {
      setEditingNoteDraft((current) => (current === currentEditingNote.contentMd ? current : currentEditingNote.contentMd));
      return;
    }
  }, [currentEditingNote, isNoteComposerOpen, workItem.notes.length]);

  useEffect(() => {
    if (!noteComposerFetcher.data?.savedAt) {
      return;
    }

    setNoteDraft("");
    setIsNoteComposerOpen(false);
  }, [noteComposerFetcher.data]);

  useEffect(() => {
    if (!noteEditFetcher.data?.savedAt) {
      return;
    }

    setEditingNoteId(null);
    setEditingNoteDraft("");
  }, [noteEditFetcher.data]);

  useEffect(() => {
    if (!noteDeleteFetcher.data?.deleted) {
      return;
    }

    setEditingNoteId(null);
    setEditingNoteDraft("");
  }, [noteDeleteFetcher.data]);

  useEffect(() => {
    if (!isNoteComposerOpen) {
      return;
    }

    window.requestAnimationFrame(() => {
      resizeNoteTextarea(composerTextareaRef.current);
    });
  }, [isNoteComposerOpen, noteDraft]);

  useEffect(() => {
    if (editingNoteId === null) {
      return;
    }

    window.requestAnimationFrame(() => {
      resizeNoteTextarea(editingTextareaRef.current);
    });
  }, [editingNoteDraft, editingNoteId]);

  useEffect(() => {
    if (!shouldAutoSave || saveFetcher.state !== "idle") {
      return;
    }

    const timeout = window.setTimeout(() => {
      submitWorkItemSave();
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [saveFetcher.state, shouldAutoSave, submitWorkItemSave]);

  function getStatusLabel(status: string) {
    return getDevlogStatusLabel(status, statusLabelMap);
  }

  function openNoteComposer() {
    setEditingNoteId(null);
    setEditingNoteDraft("");
    setIsNoteComposerOpen(true);
  }

  function startNoteEdit(noteId: number, contentMd: string) {
    setIsNoteComposerOpen(false);
    setEditingNoteId(noteId);
    setEditingNoteDraft(contentMd);
  }

  function applyComposerTemplate(templateId: NoteTemplateId) {
    applyNoteTemplateToDraft({
      textarea: composerTextareaRef.current,
      value: noteDraft,
      setValue: setNoteDraft,
      templateId,
    });
  }

  function applyEditingTemplate(templateId: NoteTemplateId) {
    applyNoteTemplateToDraft({
      textarea: editingTextareaRef.current,
      value: editingNoteDraft,
      setValue: setEditingNoteDraft,
      templateId,
    });
  }

  function handleDeleteNote(noteId: number) {
    if (typeof window !== "undefined") {
      const shouldDelete = window.confirm("이 메모를 삭제할까요? 삭제하면 되돌릴 수 없어요.");
      if (!shouldDelete) {
        return;
      }
    }

    const formData = new FormData();
    formData.set("intent", "delete_work_note");
    formData.set("noteId", String(noteId));
    formData.set("responseMode", "inline");
    noteDeleteFetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f3eadb_0%,#fbf7f1_50%,#ffffff_100%)] px-4 pb-4 pt-10">
      <div className="mx-auto w-full space-y-5">
        <section className="rounded-[32px] border border-[#dbc8ad] bg-white/92 p-5 shadow-[0_24px_60px_rgba(72,54,28,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 rounded-full border border-[#eadfce] bg-[#fbf7f1] px-3 py-1.5 text-sm text-slate-700">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94724b]">상태</span>
                  <select
                    value={statusDraft}
                    onChange={(event) => setStatusDraft(event.currentTarget.value)}
                    className="bg-transparent text-sm font-medium text-slate-900 outline-none"
                  >
                    {statuses.map((status) => (
                      <option key={status.key} value={status.key}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 rounded-full border border-[#eadfce] bg-[#fbf7f1] px-3 py-1.5 text-sm text-slate-700">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94724b]">마감일</span>
                  <input
                    type="date"
                    value={plannedDateDraft}
                    onChange={(event) => setPlannedDateDraft(event.currentTarget.value)}
                    className="bg-transparent text-sm text-slate-900 outline-none"
                  />
                </label>
              </div>

              <div>
                {createdDateLabel ? <p className="text-[11px] font-medium text-slate-400">생성일 {createdDateLabel}</p> : null}
                <div className="mt-1 flex items-start gap-2">
                  {isTitleEditing ? (
                    <Input
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.currentTarget.value)}
                      onBlur={() => setIsTitleEditing(false)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === "Escape") {
                          event.preventDefault();
                          setIsTitleEditing(false);
                        }
                      }}
                      autoFocus
                      className="h-auto min-w-0 flex-1 border-none bg-transparent px-0 text-3xl font-semibold leading-tight text-slate-900 shadow-none focus-visible:ring-0"
                    />
                  ) : (
                    <button type="button" onClick={() => setIsTitleEditing(true)} className="min-w-0 flex-1 text-left">
                      <h1 className="break-words text-3xl font-semibold leading-tight text-slate-900">{titleDraft}</h1>
                    </button>
                  )}
                  <Badge variant="outline" className="shrink-0 text-[#94724b]">
                    {formatDevlogWorkItemReference(workItem.id)}
                  </Badge>
                </div>
                {connectedWorkItems.length > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {connectedWorkItems.map((item) => (
                      <Button
                        key={item.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        asChild
                        className="max-w-[280px] border-[#eadfce] bg-[#fbf7f1] text-slate-700 hover:bg-[#f7efe4]"
                      >
                        <Link to={buildWorkWindowLink(dateToken, item.id, selectedWorkSet.id)} className="min-w-0">
                          <span className="shrink-0 text-[10px] font-semibold text-[#94724b]">{item.label}</span>
                          <span className="shrink-0 text-[11px] text-slate-500">{formatDevlogWorkItemReference(item.id)}</span>
                          <span className="truncate">{item.title}</span>
                        </Link>
                      </Button>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {githubIssueDraft ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        asChild
                        className="border-[#eadfce] bg-[#fbf7f1] text-slate-700 hover:bg-[#f7efe4]"
                      >
                        <a href={githubIssueDraft.url} target="_blank" rel="noreferrer">
                          <Github className="h-4 w-4" />
                          GitHub 이슈 #{githubIssueDraft.number}
                        </a>
                      </Button>
                      <span className="text-xs text-slate-500">{githubIssueDraft.repo}</span>
                    </>
                  ) : (
                    <>
                      {githubIssueIntegration.isAvailable ? (
                        <githubIssueFetcher.Form method="post">
                          <input type="hidden" name="intent" value="create_github_issue" />
                          <input type="hidden" name="responseMode" value="inline" />
                          <input type="hidden" name="workItemId" value={workItem.id} />
                          <Button type="submit" variant="outline" size="sm" disabled={githubIssueFetcher.state !== "idle"}>
                            <Github className="h-4 w-4" />
                            {githubIssueFetcher.state !== "idle" ? "이슈 만드는 중" : "깃허브 이슈 만들기"}
                          </Button>
                        </githubIssueFetcher.Form>
                      ) : (
                        <Button type="button" variant="outline" size="sm" disabled>
                          <Github className="h-4 w-4" />
                          GitHub 설정 필요
                        </Button>
                      )}
                      {githubIssueIntegration.repo ? <span className="text-xs text-slate-500">{githubIssueIntegration.repo}</span> : null}
                    </>
                  )}
                </div>
                {!githubIssueDraft && githubIssueFetcher.data?.error ? (
                  <p className="mt-2 text-xs text-rose-600">{githubIssueFetcher.data.error}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <pinFetcher.Form method="post" className="flex items-center gap-1.5 text-xs text-slate-500">
                    <input type="hidden" name="intent" value="toggle_work_item_pin" />
                    <input type="hidden" name="workItemId" value={workItem.id} />
                    <input type="hidden" name="responseMode" value="inline" />
                    <input
                      type="checkbox"
                      name="isPinned"
                      value="1"
                      checked={isPinnedDraft}
                      onChange={(event) => {
                        setIsPinnedDraft(event.currentTarget.checked);
                        event.currentTarget.form?.requestSubmit();
                      }}
                      className="h-3.5 w-3.5 rounded border border-[#c9b393]"
                    />
                    <span>상단 고정</span>
                  </pinFetcher.Form>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {statusDraft === "ARCHIVED" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={saveFetcher.state !== "idle"}
                  onClick={() => {
                    setStatusDraft("TODO");
                    submitWorkItemSave("TODO");
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                  복구
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={saveFetcher.state !== "idle"}
                  onClick={() => {
                    setStatusDraft("ARCHIVED");
                    submitWorkItemSave("ARCHIVED");
                  }}
                >
                  <Archive className="h-4 w-4" />
                  보관
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.close();
                  }
                }}
              >
                <X className="h-4 w-4" />
                닫기
              </Button>
            </div>
          </div>
        </section>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 space-y-5">
            <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
              <CardHeader className="pb-2">
                <CardTitle>작업메모</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <saveFetcher.Form method="post" id={workItemFormId} className="hidden">
                  <input type="hidden" name="intent" value="save_work_item" />
                  <input type="hidden" name="responseMode" value="inline" />
                  <input type="hidden" name="workItemId" value={workItem.id} />
                  <input type="hidden" name="title" value={titleDraft} />
                  <input type="hidden" name="status" value={statusDraft} />
                  <input type="hidden" name="plannedDate" value={plannedDateDraft} />
                </saveFetcher.Form>

                <div className="space-y-4">
                  <div className="flex justify-end">
                    {!isNoteComposerOpen ? (
                      <Button type="button" variant="outline" size="sm" onClick={openNoteComposer}>
                        메모 추가
                      </Button>
                    ) : null}
                  </div>

                  {workItem.notes.length > 0 ? (
                    <div className="divide-y divide-[#efe5d7] rounded-[24px] bg-[#fcfaf6] px-4">
                      {workItem.notes.map((note) => (
                        <div key={note.id} className="space-y-2 py-3 first:pt-4 last:pb-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] font-medium text-slate-400">{formatTimestamp(note.createdAt)}</p>
                            {editingNoteId === note.id ? null : (
                              <div className="flex items-center gap-1">
                                <Button type="button" variant="ghost" size="sm" onClick={() => startNoteEdit(note.id, note.contentMd)}>
                                  수정
                                </Button>
                                {latestNote?.id === note.id ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-slate-400 hover:text-rose-500"
                                    onClick={() => handleDeleteNote(note.id)}
                                    disabled={noteDeleteFetcher.state !== "idle"}
                                    aria-label="메모 삭제"
                                    title="메모 삭제"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                ) : null}
                              </div>
                            )}
                          </div>

                          {editingNoteId === note.id ? (
                            <noteEditFetcher.Form method="post" className="space-y-2">
                              <input type="hidden" name="intent" value="update_work_note" />
                              <input type="hidden" name="noteId" value={note.id} />
                              <input type="hidden" name="responseMode" value="inline" />
                              <NoteTemplateToolbar onApply={applyEditingTemplate} />
                              <Textarea
                                ref={editingTextareaRef}
                                name="noteMd"
                                value={editingNoteDraft}
                                onChange={(event) => setEditingNoteDraft(event.currentTarget.value)}
                                onInput={(event) => resizeNoteTextarea(event.currentTarget)}
                                rows={1}
                                style={{ minHeight: "max(320px, calc(100vh - 360px))" }}
                                className="resize-none overflow-hidden rounded-[18px] border-[#e6dac9] bg-white px-4 py-3 text-[15px] leading-7"
                              />
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditingNoteId(null);
                                    setEditingNoteDraft('');
                                  }}
                                >
                                  취소
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-400 hover:text-rose-500"
                                  onClick={() => handleDeleteNote(note.id)}
                                  disabled={noteDeleteFetcher.state !== "idle"}
                                  aria-label="메모 삭제"
                                  title="메모 삭제"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={editingNoteDraft.trim().length === 0 || noteEditFetcher.state !== "idle"}
                                >
                                  저장</Button>
                              </div>
                            </noteEditFetcher.Form>
                          ) : (
                            <WorkItemReferenceText
                              dateToken={dateToken}
                              workSetId={selectedWorkSet.id}
                              text={note.contentMd}
                              className="whitespace-pre-wrap break-words text-[15px] leading-6 text-slate-800"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {isNoteComposerOpen ? (
                    <noteComposerFetcher.Form method="post" className="space-y-2 rounded-[24px] bg-[#fbf7f1] px-4 py-4">
                      <input type="hidden" name="intent" value="create_work_note" />
                      <input type="hidden" name="workItemId" value={workItem.id} />
                      <input type="hidden" name="responseMode" value="inline" />
                      <NoteTemplateToolbar onApply={applyComposerTemplate} />
                      <Textarea
                        ref={composerTextareaRef}
                        name="noteMd"
                        value={noteDraft}
                        onChange={(event) => setNoteDraft(event.currentTarget.value)}
                        onInput={(event) => resizeNoteTextarea(event.currentTarget)}
                        rows={1}
                        style={{ minHeight: "max(320px, calc(100vh - 360px))" }}
                        className="resize-none overflow-hidden rounded-[18px] border-[#e6dac9] bg-white px-4 py-3 text-[15px] leading-7"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setIsNoteComposerOpen(false);
                            setNoteDraft('');
                          }}
                        >
                          취소
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={noteDraft.trim().length === 0 || noteComposerFetcher.state !== "idle"}
                        >
                          저장</Button>
                      </div>
                    </noteComposerFetcher.Form>
                  ) : null}
                </div>
                <div className="mt-4 space-y-3 rounded-[24px] border border-[#eadfce] bg-[#fbf7f1] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant={issueMenu === "child" ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => setIssueMenu((current) => (current === "child" ? null : "child"))}
                    >
                      하위 이슈 만들기
                    </Button>
                    <Button
                      type="button"
                      variant={issueMenu === "link" ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => setIssueMenu((current) => (current === "link" ? null : "link"))}
                    >
                      이슈 연결하기
                    </Button>
                  </div>

                  {issueMenu === "child" ? (
                    <Form method="post" className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                      <input type="hidden" name="intent" value="create_work_item" />
                      <input type="hidden" name="workSetId" value={selectedWorkSet.id} />
                      <input type="hidden" name="parentWorkItemId" value={workItem.id} />
                      <Input name="title" placeholder="하위 이슈 제목" />
                      <Input name="nextAction" placeholder="짧은 메모 또는 #123" />
                      <Button type="submit" size="sm">
                        만들기
                      </Button>
                    </Form>
                  ) : null}

                  {issueMenu === "link" ? (
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                      <Input
                        name="nextAction"
                        form={workItemFormId}
                        defaultValue={workItem.nextAction ?? ""}
                        placeholder="#123 또는 연결 메모"
                      />
                      <Button type="submit" form={workItemFormId} size="sm">
                        연결 저장
                      </Button>
                    </div>
                  ) : null}
                </div>
                </CardContent>
              </Card>
          </div>

          <div className="space-y-5 xl:self-start">
            <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-3">
                  <CardTitle>체크리스트</CardTitle>
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      {checklistSummary.remainingCount === 0 ? (
                        <CheckCheck className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <ListTodo className="h-3.5 w-3.5 text-slate-400" />
                      )}
                      {checklistSummary.remainingCount === 0
                        ? `${checklistSummary.doneCount}/${checklistSummary.totalCount}`
                        : `${checklistSummary.remainingCount}/${checklistSummary.totalCount}`}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[#b8742f]">
                      <CircleDot className="h-3.5 w-3.5" />
                      {checklistSummary.todayCount}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {workItem.checklist.length === 0 ? <p className="text-sm text-slate-500">아직 체크리스트가 없어요.</p> : null}

                <div className="space-y-1">
                  {workItem.checklist.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-2 py-1">
                      <div className="flex min-w-0 flex-1 items-start gap-2.5">
                        <Form method="post">
                          <input type="hidden" name="intent" value="toggle_checklist_item" />
                          <input type="hidden" name="checklistItemId" value={item.id} />
                          <input
                            type="checkbox"
                            checked={item.isDone}
                            onChange={(event) => event.currentTarget.form?.requestSubmit()}
                            className="mt-1 h-4 w-4 rounded border border-[#c9b393]"
                          />
                        </Form>

                        <div className="flex min-w-0 flex-1 items-start gap-1.5 pt-0.5">
                          <p className={`min-w-0 text-sm ${item.isDone ? "text-slate-400 line-through" : "text-slate-800"}`}>
                            {item.content}
                          </p>
                          {item.isTodayTodo && !item.isDone ? (
                            <span className="mt-0.5 inline-flex shrink-0 items-center text-[#b8742f]">
                              <CircleDot className="h-3.5 w-3.5" />
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-0.5">
                        <Form method="post">
                          <input type="hidden" name="intent" value="toggle_checklist_today" />
                          <input type="hidden" name="checklistItemId" value={item.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            className={`h-7 w-7 ${
                              item.isTodayTodo && !item.isDone
                                ? "bg-[#efe2ca] text-[#94724b] hover:bg-[#e7d5b4]"
                                : "text-slate-400 hover:text-[#94724b]"
                            }`}
                            aria-label={item.isTodayTodo ? "오늘 할 일 해제" : "오늘 할 일 표시"}
                            title={item.isTodayTodo ? "오늘 할 일 해제" : "오늘 할 일 표시"}
                          >
                            <CircleDot className="h-3.5 w-3.5" />
                          </Button>
                        </Form>

                        <Form method="post">
                          <input type="hidden" name="intent" value="delete_checklist_item" />
                          <input type="hidden" name="checklistItemId" value={item.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-slate-900"
                            aria-label="체크리스트 삭제"
                            title="체크리스트 삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </Form>
                      </div>
                    </div>
                  ))}

                  <Form method="post" className="pt-1">
                    <input type="hidden" name="intent" value="add_checklist_item" />
                    <input type="hidden" name="workItemId" value={workItem.id} />
                    <div className="flex items-start gap-2 py-1">
                      <input type="checkbox" disabled className="mt-1 h-4 w-4 rounded border border-[#c9b393]" />
                      <Textarea
                        name="content"
                        rows={1}
                        placeholder="체크리스트 내용 입력"
                        className="min-h-0 flex-1 resize-none overflow-hidden border-none bg-transparent px-0 py-0 leading-6 shadow-none focus-visible:ring-0"
                        onInput={(event) => {
                          const element = event.currentTarget;
                          element.style.height = "0px";
                          element.style.height = `${element.scrollHeight}px`;
                        }}
                      />
                      <label className="shrink-0">
                        <input type="checkbox" name="isTodayTodo" value="1" className="sr-only peer" />
                        <span
                          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:text-[#94724b] peer-checked:bg-[#efe2ca] peer-checked:text-[#94724b]"
                          aria-label="오늘 할 일로 표시"
                          title="오늘 할 일로 표시"
                        >
                          <CircleDot className="h-3.5 w-3.5" />
                        </span>
                      </label>
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-[#94724b] hover:bg-[#efe2ca] hover:text-[#7b5c36]"
                        aria-label="체크리스트 추가"
                        title="체크리스트 추가"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </Form>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-[28px] border-[#dbc8ad] bg-white/90">
              <CardHeader className="pb-2">
                <CardTitle>파일첨부</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <Form method="post" encType="multipart/form-data" className="flex items-center gap-2">
                  <input type="hidden" name="intent" value="add_attachment" />
                  <input type="hidden" name="workItemId" value={workItem.id} />
                  <Input type="file" name="attachment" className="min-w-0 flex-1" />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-[#94724b] hover:bg-[#efe2ca] hover:text-[#7b5c36]"
                    aria-label="파일 올리기"
                    title="파일 올리기"
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                </Form>

                {workItem.attachments.length > 0 ? (
                  <div className="divide-y divide-[#efe5d7]">
                    {workItem.attachments.map((attachment) => {
                      const AttachmentIcon = getAttachmentIcon(attachment.kind);
                      const attachmentSize = formatByteSize(attachment.byteSize);

                      return (
                        <div key={attachment.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                          <a
                            href={attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="group flex min-w-0 flex-1 items-center gap-3"
                          >
                            <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-[16px] border border-[#ddd0ba] bg-white shadow-sm">
                              <span className="absolute right-0 top-0 z-10 h-4 w-4 rounded-bl-[10px] border-b border-l border-[#ddd0ba] bg-[#f7efe4]" />
                              {attachment.kind === "IMAGE" ? (
                                <img
                                  src={attachment.url}
                                  alt={attachment.fileName}
                                  className="absolute bottom-5 left-1 right-1 top-1 rounded-[9px] object-cover"
                                />
                              ) : (
                                <div className="flex h-full flex-col items-center justify-center gap-2 px-2 pb-5 pt-4">
                                  <AttachmentIcon className="h-5 w-5 text-[#94724b]" />
                                </div>
                              )}
                              <span className="absolute inset-x-1 bottom-1 truncate text-center text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                {getAttachmentExtension(attachment.fileName)}
                              </span>
                            </div>

                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-800 underline underline-offset-2 group-hover:text-[#7b5c36]">
                                {attachment.fileName}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {getAttachmentTypeLabel(attachment.kind)}
                                {attachmentSize ? ` / ${attachmentSize}` : ""}
                              </p>
                            </div>
                          </a>

                          <Form method="post">
                            <input type="hidden" name="intent" value="delete_attachment" />
                            <input type="hidden" name="attachmentId" value={attachment.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-slate-400 hover:text-slate-900"
                              aria-label="파일 삭제"
                              title="파일 삭제"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </Form>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </div>
  );
}

