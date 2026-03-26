import { CheckCircle2, Gift } from "lucide-react";
import { format } from "date-fns";

import { cn } from "~/lib/utils";

type CouponTicketProps = {
  description: string;
  expiresAt: Date | string;
  status?: "available" | "used";
  usedAt?: Date | string | null;
  compact?: boolean;
  className?: string;
};

export function CouponTicket({
  description,
  expiresAt,
  status = "available",
  usedAt,
  compact = false,
  className,
}: CouponTicketProps) {
  const isUsed = status === "used";
  const expiresLabel = format(new Date(expiresAt), "yyyy년 M월 d일");
  const usedLabel = usedAt ? format(new Date(usedAt), "yyyy년 M월 d일 사용") : "사용 완료";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[30px] border shadow-sm",
        isUsed
          ? "border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100"
          : "border-emerald-200 bg-gradient-to-br from-white via-emerald-50 to-lime-50",
        compact ? "p-4" : "p-5",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border bg-white",
          isUsed ? "border-slate-200" : "border-emerald-100",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border bg-white",
          isUsed ? "border-slate-200" : "border-emerald-100",
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-1",
          isUsed ? "bg-slate-200/70" : "bg-emerald-300/70",
        )}
      />

      <div className="relative flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em]",
                isUsed ? "bg-slate-200/80 text-slate-500" : "bg-emerald-500/10 text-emerald-700",
              )}
            >
              {isUsed ? "사용 완료" : "사용 가능"}
            </span>
          </div>

          <p
            className={cn(
              "mt-3 break-keep font-semibold leading-snug text-slate-900",
              compact ? "text-[15px]" : "text-lg",
              isUsed && "text-slate-700",
            )}
          >
            {description}
          </p>

          <div
            className={cn(
              "mt-4 grid gap-2 border-t border-dashed pt-3",
              compact ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_auto]",
              isUsed ? "border-slate-200/90" : "border-emerald-200/90",
            )}
          >
            <div>
              <p className="text-[10px] font-medium tracking-[0.18em] text-slate-400">사용기한</p>
              <p className={cn("mt-1 font-semibold text-slate-700", compact ? "text-xs" : "text-sm")}>
                {expiresLabel}까지
              </p>
            </div>
            {isUsed ? (
              <p className="self-end text-[11px] text-slate-400">{usedLabel}</p>
            ) : (
              <p className="self-end text-[11px] text-emerald-700/70">사용 전</p>
            )}
          </div>
        </div>

        <div className="shrink-0 pt-1">
          <div
            className={cn(
              "flex items-center justify-center rounded-full",
              compact ? "h-12 w-12" : "h-14 w-14",
              isUsed ? "bg-slate-200/70 text-slate-500" : "bg-emerald-100 text-emerald-600",
            )}
          >
            {isUsed ? (
              <CheckCircle2 className={compact ? "h-6 w-6" : "h-7 w-7"} />
            ) : (
              <Gift className={compact ? "h-6 w-6" : "h-7 w-7"} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
