import { useEffect, useMemo, useState } from "react";
import { Form, Link, useFetcher, useNavigation } from "react-router";
import { ArrowLeft, Calculator, Check, Delete, EyeOff, Pencil, RotateCcw, Settings2, Trash2, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import {
  ENTRY_TYPES,
  type LedgerEntryTypeValue,
  type LedgerPaymentMethodValue,
  getTypeLabel,
} from "~/lib/ledger-entry";
import { cn } from "~/lib/utils";

type CategoryFetcherData = {
  ok?: boolean;
  intent?: "create_category" | "update_category" | "toggle_category" | "delete_category";
  error?: string;
};

const AMOUNT_SHORTCUTS = [
  ["7", "8", "9", "delete"],
  ["4", "5", "6", "clear"],
  ["1", "2", "3", "calculator"],
  ["0", "00", "empty", "confirm"],
] as const;

const CALCULATOR_SHORTCUTS = [
  ["7", "8", "9", "+"],
  ["4", "5", "6", "-"],
  ["1", "2", "3", "*"],
  ["00", "0", "delete", "/"],
] as const;

const NO_CATEGORY_VALUE = "__none__";
const NO_PAYMENT_METHOD_VALUE = "__none__";

function normalizeAmountValue(value: string) {
  const digitsOnly = value.replace(/\D/g, "");
  if (!digitsOnly) {
    return "";
  }

  return digitsOnly.replace(/^0+(?=\d)/, "");
}

function formatAmountDisplay(value: string) {
  if (!value) {
    return "";
  }

  const numericValue = Number(value || "0");
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(numericValue)}원`;
}

function formatCalculatorExpression(value: string) {
  if (!value) {
    return "";
  }

  return value.replace(/\*/g, "×").replace(/\//g, "÷");
}

function parseCalculatorResult(expression: string) {
  const compact = expression.replace(/\s+/g, "");
  if (!compact) {
    return 0;
  }

  const tokens = compact.match(/\d+|[+\-*/]/g);
  if (!tokens || tokens.join("") !== compact) {
    return null;
  }

  const values: number[] = [];
  const operators: string[] = [];
  const precedence = { "+": 1, "-": 1, "*": 2, "/": 2 } as const;

  const applyOperator = () => {
    const operator = operators.pop();
    const right = values.pop();
    const left = values.pop();

    if (!operator || right === undefined || left === undefined) {
      return false;
    }

    if (operator === "+") {
      values.push(left + right);
      return true;
    }

    if (operator === "-") {
      values.push(left - right);
      return true;
    }

    if (operator === "*") {
      values.push(left * right);
      return true;
    }

    if (right === 0) {
      return false;
    }

    values.push(left / right);
    return true;
  };

  let expectingNumber = true;

  for (const token of tokens) {
    if (expectingNumber) {
      if (!/^\d+$/.test(token)) {
        return null;
      }

      values.push(Number(token));
      expectingNumber = false;
      continue;
    }

    if (!/[+\-*/]/.test(token)) {
      return null;
    }

    while (operators.length > 0) {
      const previousOperator = operators[operators.length - 1] as keyof typeof precedence;
      const currentOperator = token as keyof typeof precedence;

      if (precedence[previousOperator] < precedence[currentOperator]) {
        break;
      }

      if (!applyOperator()) {
        return null;
      }
    }

    operators.push(token);
    expectingNumber = true;
  }

  if (expectingNumber) {
    return null;
  }

  while (operators.length > 0) {
    if (!applyOperator()) {
      return null;
    }
  }

  const result = values[0];
  if (!Number.isFinite(result)) {
    return null;
  }

  return Math.round(result);
}

function getEntryTypeTone(type: LedgerEntryTypeValue) {
  if (type === "INCOME") {
    return {
      active: "border-sky-500 bg-sky-50 text-sky-600",
      accent: "text-sky-600",
    };
  }

  if (type === "EXPENSE") {
    return {
      active: "border-rose-500 bg-rose-50 text-rose-600",
      accent: "text-rose-600",
    };
  }

  return {
    active: "border-emerald-600 bg-emerald-50 text-emerald-600",
    accent: "text-emerald-600",
  };
}

export type LedgerEntryFormCategory = {
  id: number;
  type: LedgerEntryTypeValue;
  name: string;
  isActive: boolean;
  entryCount: number;
  budgetAllocationCount: number;
};

type LedgerEntryFormProps = {
  mode: "create" | "edit";
  dateToken: string;
  dateLabel: string;
  categories: LedgerEntryFormCategory[];
  backTo: string;
  submitLabel: string;
  entryId?: number;
  defaultValues: {
    type: LedgerEntryTypeValue;
    categoryId: string;
    amount: string;
    paymentMethod: LedgerPaymentMethodValue | "";
    paymentSourceName: string;
    memo: string;
    tagNames: string;
  };
};

export function LedgerEntryForm({
  mode,
  dateToken,
  dateLabel,
  categories,
  backTo,
  submitLabel,
  entryId,
  defaultValues,
}: LedgerEntryFormProps) {
  const navigation = useNavigation();
  const categoryFetcher = useFetcher<CategoryFetcherData>();
  const isSubmitting = navigation.state === "submitting";
  const isDeleting = navigation.state === "submitting" && navigation.formData?.get("intent") === "delete_entry";
  const [entryType, setEntryType] = useState<LedgerEntryTypeValue>(defaultValues.type);
  const [selectedCategoryId, setSelectedCategoryId] = useState(defaultValues.categoryId);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [paymentMethodValue, setPaymentMethodValue] = useState<LedgerPaymentMethodValue | "">(defaultValues.paymentMethod);
  const [amountValue, setAmountValue] = useState(normalizeAmountValue(defaultValues.amount));
  const [isAmountPadOpen, setIsAmountPadOpen] = useState(defaultValues.amount.length === 0);
  const [amountError, setAmountError] = useState("");
  const [isCalculatorDialogOpen, setIsCalculatorDialogOpen] = useState(false);
  const [calculatorExpression, setCalculatorExpression] = useState("");
  const [calculatorError, setCalculatorError] = useState("");
  const currentTypeCategories = useMemo(
    () => categories.filter((category) => category.type === entryType),
    [categories, entryType],
  );

  const visibleCategories = useMemo(
    () =>
      currentTypeCategories.filter(
        (category) => category.isActive || String(category.id) === selectedCategoryId,
      ),
    [currentTypeCategories, selectedCategoryId],
  );

  const activeCategories = useMemo(
    () => currentTypeCategories.filter((category) => category.isActive),
    [currentTypeCategories],
  );

  const inactiveCategories = useMemo(
    () =>
      currentTypeCategories.filter(
        (category) => !category.isActive && String(category.id) !== selectedCategoryId,
      ),
    [currentTypeCategories, selectedCategoryId],
  );

  useEffect(() => {
    if (!categoryFetcher.data?.ok) {
      return;
    }

    if (categoryFetcher.data.intent === "create_category") {
      setNewCategoryName("");
    }

    if (categoryFetcher.data.intent === "update_category") {
      setEditingCategoryId(null);
      setEditingCategoryName("");
    }

    if (categoryFetcher.data.intent === "toggle_category" || categoryFetcher.data.intent === "delete_category") {
      setEditingCategoryId(null);
      setEditingCategoryName("");
    }
  }, [categoryFetcher.data]);

  useEffect(() => {
    if (selectedCategoryId === "") {
      return;
    }

    if (visibleCategories.some((category) => String(category.id) === selectedCategoryId)) {
      return;
    }

    setSelectedCategoryId("");
  }, [selectedCategoryId, visibleCategories]);

  const numericAmount = Number(amountValue || "0");
  const hasAmountValue = amountValue.length > 0;

  const appendAmount = (chunk: string) => {
    setAmountValue((prev) => normalizeAmountValue(`${prev}${chunk}`));
    setAmountError("");
  };

  const removeLastAmountDigit = () => {
    setAmountValue((prev) => prev.slice(0, -1));
    setAmountError("");
  };

  const clearAmount = () => {
    setAmountValue("");
    setAmountError("");
  };

  const openCalculatorDialog = () => {
    setCalculatorExpression(amountValue || "");
    setCalculatorError("");
    setIsCalculatorDialogOpen(true);
  };

  const openAmountPad = () => {
    setIsAmountPadOpen(true);
    setAmountError("");
  };

  const closeAmountPad = () => {
    setIsAmountPadOpen(false);
  };

  const appendCalculatorDigit = (chunk: string) => {
    setCalculatorExpression((prev) => `${prev}${chunk}`);
    setCalculatorError("");
  };

  const appendCalculatorOperator = (operator: "+" | "-" | "*" | "/") => {
    setCalculatorExpression((prev) => {
      const compact = prev.replace(/\s+/g, "");
      if (!compact) {
        return prev;
      }

      if (/[+\-*/]$/.test(compact)) {
        return `${compact.slice(0, -1)}${operator}`;
      }

      return `${compact}${operator}`;
    });
    setCalculatorError("");
  };

  const removeLastCalculatorToken = () => {
    setCalculatorExpression((prev) => prev.slice(0, -1));
    setCalculatorError("");
  };

  const clearCalculator = () => {
    setCalculatorExpression("");
    setCalculatorError("");
  };

  const confirmCalculatorResult = () => {
    const result = parseCalculatorResult(calculatorExpression);
    if (result === null) {
      setCalculatorError("계산식을 다시 확인해 주세요.");
      return;
    }

    setCalculatorExpression(String(result));
    setCalculatorError("");
  };

  const applyCalculatorResult = () => {
    const result = parseCalculatorResult(calculatorExpression);
    if (result === null) {
      setCalculatorError("계산식을 다시 확인해 주세요.");
      return;
    }

    if (result < 0) {
      setCalculatorError("0원 이상만 넣을 수 있어요.");
      return;
    }

    setAmountValue(normalizeAmountValue(String(result)));
    setAmountError("");
    setCalculatorError("");
    setIsCalculatorDialogOpen(false);
  };

  const tone = getEntryTypeTone(entryType);
  const calculatorResult = useMemo(() => parseCalculatorResult(calculatorExpression), [calculatorExpression]);

  return (
    <>
      <div className="min-h-screen bg-white">
        <div className="border-b bg-white px-3 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full text-slate-700">
              <Link to={backTo}>
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <p className="text-[0.62rem] text-slate-500">{mode === "edit" ? "가계부 수정" : "가계부 작성"}</p>
              <h1 className="text-[0.82rem] font-semibold text-slate-900">{dateLabel}</h1>
            </div>
          </div>
        </div>

        <Form
          method="post"
          className="space-y-0 pb-[22rem]"
          onSubmit={(event) => {
            if (!hasAmountValue) {
              event.preventDefault();
              setAmountError("금액을 입력해 주세요.");
              setIsAmountPadOpen(true);
              return;
            }

            if (numericAmount >= 0) {
              return;
            }

            event.preventDefault();
            setAmountError("금액을 다시 확인해 주세요.");
            setIsAmountPadOpen(true);
          }}
        >
          <input type="hidden" name="intent" value={mode === "edit" ? "update_entry" : "create_entry"} />
          <input type="hidden" name="usedAt" value={dateToken} />
          {entryId ? <input type="hidden" name="entryId" value={entryId} /> : null}

          <div className="grid grid-cols-3 gap-2 border-b px-4 py-3">
            {ENTRY_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setEntryType(type)}
                className={cn(
                  "rounded-2xl border bg-white px-3 py-2.5 text-[11px] font-semibold transition-colors",
                  entryType === type
                    ? getEntryTypeTone(type).active
                    : "border-slate-200 text-slate-700",
                )}
              >
                {getTypeLabel(type)}
              </button>
            ))}
          </div>

          <input type="hidden" name="type" value={entryType} />

          <div className="border-b px-6 py-2">
            <input type="hidden" id="amount" name="amount" value={amountValue} />
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-slate-400">금액</span>
              <div className="relative min-w-0 flex-1">
                <button
                  type="button"
                  onClick={openAmountPad}
                  className={cn(
                    "flex h-7 w-full items-center px-0 py-0 text-left text-[11px] font-normal tabular-nums md:text-[11px]",
                    isAmountPadOpen ? tone.accent : hasAmountValue ? "text-slate-900" : "text-slate-400",
                  )}
                  aria-label="금액 입력 열기"
                >
                  {amountValue ? (
                    formatAmountDisplay(amountValue)
                  ) : (
                    <span
                      className={cn(
                        "inline-block h-4 w-px rounded-full bg-current",
                        isAmountPadOpen ? "animate-pulse" : "opacity-60",
                      )}
                      aria-hidden="true"
                    />
                  )}
                </button>

              </div>
            </div>
            {amountError ? (
              <p className="mt-2 pl-20 text-xs text-rose-500">{amountError}</p>
            ) : null}
          </div>

          <div className="border-b px-6 py-2">
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-slate-400">카테고리</span>
              <div className="min-w-0 flex-1">
                <input type="hidden" id="categoryId" name="categoryId" value={selectedCategoryId} />
                <Select
                  value={selectedCategoryId || undefined}
                  onValueChange={(value) => setSelectedCategoryId(value === NO_CATEGORY_VALUE ? "" : value)}
                  onOpenChange={(open) => {
                    if (open) {
                      closeAmountPad();
                    }
                  }}
                >
                  <SelectTrigger className="h-8 rounded-none border-0 bg-transparent px-0 text-xs text-slate-900 shadow-none focus:ring-0 focus:ring-offset-0 md:text-xs [&>svg]:text-slate-400 [&>svg]:opacity-100">
                    <SelectValue placeholder="" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-slate-200 bg-white shadow-lg">

                    {visibleCategories.map((category) => (
                      <SelectItem key={category.id} value={String(category.id)}>
                        {category.name}
                        {!category.isActive ? " (숨김)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-slate-500"
                onClick={() => setIsCategoryDialogOpen(true)}
                aria-label="카테고리 관리"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="border-b px-6 py-2">
            <div className="flex items-center gap-3">
              <Label htmlFor="memo" className="w-20 shrink-0 text-xs text-slate-400">메모</Label>
              <div className="min-w-0 flex-1">
                <Input
                  id="memo"
                  name="memo"
                  defaultValue={defaultValues.memo}
                  className="h-8 border-0 px-0 py-0 text-xs text-slate-900 shadow-none focus-visible:ring-0"
                  onFocus={closeAmountPad}
                />
              </div>
            </div>
          </div>

          <div>
            {entryType === "EXPENSE" ? (
              <>
                <div className="border-b px-6 py-2">
                  <div className="flex items-center gap-3">
                    <Label htmlFor="paymentMethod" className="w-20 shrink-0 text-xs text-slate-400">결제</Label>
                    <div className="min-w-0 flex-1">
                      <input type="hidden" id="paymentMethod" name="paymentMethod" value={paymentMethodValue} />
                      <Select
                        value={paymentMethodValue || undefined}
                        onValueChange={(value) =>
                          setPaymentMethodValue(value === NO_PAYMENT_METHOD_VALUE ? "" : (value as LedgerPaymentMethodValue))
                        }
                        onOpenChange={(open) => {
                          if (open) {
                            closeAmountPad();
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 rounded-none border-0 bg-transparent px-0 text-xs text-slate-900 shadow-none focus:ring-0 focus:ring-offset-0 md:text-xs [&>svg]:text-slate-400 [&>svg]:opacity-100">
                          <SelectValue placeholder="" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-slate-200 bg-white shadow-lg">
                          <SelectItem value={NO_PAYMENT_METHOD_VALUE}>
                            <span aria-hidden="true" />
                            <span className="sr-only">비우기</span>
                          </SelectItem>
                          <SelectItem value="CARD">카드</SelectItem>
                          <SelectItem value="ACCOUNT_TRANSFER">계좌이체</SelectItem>
                          <SelectItem value="CASH">현금</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <div className="border-b px-6 py-2">
                  <div className="flex items-center gap-3">
                    <Label htmlFor="paymentSourceName" className="w-20 shrink-0 text-xs text-slate-400">수단명</Label>
                    <div className="min-w-0 flex-1">
                      <Input
                        id="paymentSourceName"
                        name="paymentSourceName"
                        defaultValue={defaultValues.paymentSourceName}
                        className="h-8 border-0 px-0 py-0 text-xs text-slate-900 shadow-none focus-visible:ring-0"
                        onFocus={closeAmountPad}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : null}
            <div className="border-b px-6 py-2">
              <div className="flex items-center gap-3">
                <Label htmlFor="tagNames" className="w-20 shrink-0 text-xs text-slate-400">태그</Label>
                <div className="min-w-0 flex-1">
                  <Input
                    id="tagNames"
                    name="tagNames"
                    defaultValue={defaultValues.tagNames}
                    className="h-8 border-0 px-0 py-0 text-xs text-slate-900 shadow-none focus-visible:ring-0"
                    onFocus={closeAmountPad}
                  />
                </div>
              </div>
            </div>

            <div className="px-4 py-6">
              <div className={cn("grid gap-3", mode === "edit" && entryId ? "grid-cols-2" : "grid-cols-1")}>
                {mode === "edit" && entryId ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-12 rounded-2xl border-rose-200 text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                        disabled={isSubmitting}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        삭제
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="rounded-3xl">
                      <AlertDialogHeader>
                        <AlertDialogTitle>이 내역을 삭제하시겠습니까?</AlertDialogTitle>
                        <AlertDialogDescription>
                          삭제한 내역은 복구할 수 없습니다.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete_entry" />
                        <input type="hidden" name="entryId" value={entryId} />
                        <input type="hidden" name="usedAt" value={dateToken} />
                        <AlertDialogFooter>
                          <AlertDialogCancel>취소</AlertDialogCancel>
                          <AlertDialogAction asChild>
                            <Button type="submit" variant="destructive" disabled={isDeleting}>
                              {isDeleting ? "삭제 중..." : "삭제"}
                            </Button>
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </Form>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
                <Button type="submit" className="h-12 w-full rounded-2xl bg-slate-600 hover:bg-slate-700" disabled={isSubmitting}>
                  {isSubmitting ? "저장 중..." : submitLabel}
                </Button>
              </div>
            </div>
          </div>
        </Form>
      </div>

      {isAmountPadOpen ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white">
          <div className="grid grid-cols-4">
            {AMOUNT_SHORTCUTS.flat().map((key) => {
              if (key === "empty") {
                return <div key={key} className="h-20 border-r border-t border-slate-200 bg-white" />;
              }

              if (key === "delete") {
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={removeLastAmountDigit}
                    className="flex h-20 items-center justify-center border-r border-t border-slate-200 bg-white text-slate-700"
                    aria-label="한 글자 지우기"
                  >
                    <Delete className="h-6 w-6" />
                  </button>
                );
              }

              if (key === "clear") {
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={clearAmount}
                    className="flex h-20 items-center justify-center border-r border-t border-slate-200 bg-white text-xl text-slate-500"
                    aria-label="전체 지우기"
                  >
                    <X className="h-6 w-6" />
                  </button>
                );
              }

              if (key === "calculator") {
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={openCalculatorDialog}
                    className="flex h-20 items-center justify-center border-r border-t border-slate-200 bg-white text-slate-500"
                    aria-label="계산기 열기"
                  >
                    <Calculator className="h-6 w-6" />
                  </button>
                );
              }

              if (key === "confirm") {
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={closeAmountPad}
                    className="flex h-20 items-center justify-center border-t bg-slate-600 text-white"
                    aria-label="금액 입력 확인"
                  >
                    <Check className="h-7 w-7" />
                  </button>
                );
              }

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => appendAmount(key)}
                  className="h-20 border-r border-t border-slate-200 bg-white text-2xl font-light text-slate-800"
                >
                  {key}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <Dialog open={isCalculatorDialogOpen} onOpenChange={setIsCalculatorDialogOpen}>
        <DialogContent className="rounded-3xl p-0 sm:max-w-sm">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>계산기</DialogTitle>
            <DialogDescription>계산 결과를 금액에 바로 넣을 수 있어요.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 p-5">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="min-h-6 text-right text-xs text-slate-500">
                {formatCalculatorExpression(calculatorExpression) || "0"}
              </div>
              <div className="mt-2 text-right text-xl font-semibold text-slate-900">
                {calculatorResult === null ? "-" : `${new Intl.NumberFormat("ko-KR").format(calculatorResult)}원`}
              </div>
            </div>

            {calculatorError ? (
              <p className="rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{calculatorError}</p>
            ) : null}

            <div className="grid grid-cols-4 overflow-hidden rounded-2xl border border-slate-200">
              {CALCULATOR_SHORTCUTS.flat().map((key) => {
                if (key === "delete") {
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={removeLastCalculatorToken}
                      className="flex h-16 items-center justify-center border-r border-t border-slate-200 bg-white text-slate-700 [&:nth-child(-n+4)]:border-t-0"
                      aria-label="한 글자 지우기"
                    >
                      <Delete className="h-5 w-5" />
                    </button>
                  );
                }

                if (key === "+" || key === "-" || key === "*" || key === "/") {
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => appendCalculatorOperator(key)}
                      className="h-16 border-r border-t border-slate-200 bg-slate-50 text-xl font-light text-slate-700 [&:nth-child(-n+4)]:border-t-0"
                    >
                      {key === "*" ? "×" : key === "/" ? "÷" : key}
                    </button>
                  );
                }

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => appendCalculatorDigit(key)}
                    className="h-16 border-r border-t border-slate-200 bg-white text-xl font-light text-slate-800 [&:nth-child(-n+4)]:border-t-0"
                  >
                    {key}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant="outline" className="rounded-2xl" onClick={clearCalculator}>
                초기화
              </Button>
              <Button type="button" variant="outline" className="rounded-2xl" onClick={confirmCalculatorResult}>
                =
              </Button>
              <Button type="button" className="rounded-2xl bg-slate-700 hover:bg-slate-800" onClick={applyCalculatorResult}>
                적용
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-3xl p-5 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{getTypeLabel(entryType)} 카테고리 관리</DialogTitle>
            <DialogDescription>작성한 카테고리만 저장되고, 바로 사용할 수 있어요.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {categoryFetcher.data?.error ? (
              <p className="rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{categoryFetcher.data.error}</p>
            ) : null}

            <categoryFetcher.Form method="post" className="space-y-2 rounded-2xl border bg-slate-50 p-4">
              <input type="hidden" name="intent" value="create_category" />
              <input type="hidden" name="type" value={entryType} />
              <Label htmlFor="newCategoryName" className="text-xs">새 카테고리</Label>
              <div className="flex gap-2">
                <Input
                  id="newCategoryName"
                  name="name"
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="예: 식비, 월급, 비상금"
                  className="rounded-2xl bg-white"
                />
                <Button type="submit" className="rounded-2xl">
                  추가
                </Button>
              </div>
            </categoryFetcher.Form>

            {editingCategoryId !== null ? (
              <categoryFetcher.Form method="post" className="space-y-2 rounded-2xl border bg-white p-3">
                <input type="hidden" name="intent" value="update_category" />
                <input type="hidden" name="categoryId" value={editingCategoryId} />
                <Label htmlFor="editingCategoryName" className="text-xs">카테고리 이름 수정</Label>
                <Input
                  id="editingCategoryName"
                  name="name"
                  value={editingCategoryName}
                  onChange={(event) => setEditingCategoryName(event.target.value)}
                  className="rounded-2xl"
                />
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1 rounded-2xl">저장</Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 rounded-2xl"
                    onClick={() => {
                      setEditingCategoryId(null);
                      setEditingCategoryName("");
                    }}
                  >
                    취소
                  </Button>
                </div>
              </categoryFetcher.Form>
            ) : null}

            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-900">사용 중인 카테고리</p>
              {activeCategories.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 px-4 py-4 text-xs text-slate-500">아직 저장한 카테고리가 없습니다.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {activeCategories.map((category) => (
                    <div key={category.id} className="inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1.5">
                      <span className="text-xs font-medium text-slate-900">{category.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-full text-slate-500"
                        aria-label={`${category.name} 수정`}
                        title="수정"
                        onClick={() => {
                          setEditingCategoryId(category.id);
                          setEditingCategoryName(category.name);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <categoryFetcher.Form method="post">
                        <input type="hidden" name="intent" value="toggle_category" />
                        <input type="hidden" name="categoryId" value={category.id} />
                        <input type="hidden" name="nextActive" value="false" />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded-full text-slate-500"
                          aria-label={`${category.name} 숨기기`}
                          title="숨기기"
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                        </Button>
                      </categoryFetcher.Form>
                      {category.entryCount === 0 && category.budgetAllocationCount === 0 ? (
                        <categoryFetcher.Form method="post">
                          <input type="hidden" name="intent" value="delete_category" />
                          <input type="hidden" name="categoryId" value={category.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-full text-rose-500"
                            aria-label={`${category.name} 삭제`}
                            title="완전 삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </categoryFetcher.Form>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {inactiveCategories.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-900">숨긴 카테고리</p>
                <div className="flex flex-wrap gap-2">
                  {inactiveCategories.map((category) => (
                    <div key={category.id} className="inline-flex items-center gap-1 rounded-full border border-dashed bg-slate-50 px-3 py-1.5">
                      <span className="text-xs text-slate-600">{category.name}</span>
                      <categoryFetcher.Form method="post">
                        <input type="hidden" name="intent" value="toggle_category" />
                        <input type="hidden" name="categoryId" value={category.id} />
                        <input type="hidden" name="nextActive" value="true" />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded-full text-slate-500"
                          aria-label={`${category.name} 복원`}
                          title="복원"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </categoryFetcher.Form>
                      {category.entryCount === 0 && category.budgetAllocationCount === 0 ? (
                        <categoryFetcher.Form method="post">
                          <input type="hidden" name="intent" value="delete_category" />
                          <input type="hidden" name="categoryId" value={category.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-full text-rose-500"
                            aria-label={`${category.name} 삭제`}
                            title="완전 삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </categoryFetcher.Form>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
