import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X } from "lucide-react";

type ClickableQrProps = {
  value: string;
  label: string;
  /** 기본(작은) QR 크기 px */
  size?: number;
};

// 게임 host 화면용 QR. 탭하면 전체화면 모달로 크게 확대된다.
export function ClickableQr({ value, label, size = 160 }: ClickableQrProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex flex-col items-center rounded-2xl bg-white p-3 shadow-lg transition hover:scale-105 active:scale-95"
      >
        <QRCodeSVG value={value} size={size} level="H" />
        <span className="mt-2 text-sm font-bold text-black">{label}</span>
        <span className="text-[11px] text-slate-500">탭하면 크게</span>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-black/85 p-6 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex flex-col items-center gap-4 rounded-3xl bg-white p-6 shadow-2xl"
          >
            <div className="w-[min(80vw,380px)] [&>svg]:h-auto [&>svg]:w-full">
              <QRCodeSVG value={value} size={360} level="H" />
            </div>
            <span className="text-xl font-extrabold text-black">{label}</span>
            <span className="max-w-[80vw] break-all text-center text-xs text-slate-500">{value}</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 text-lg font-bold text-white ring-1 ring-white/30 hover:bg-white/20"
          >
            <X className="h-5 w-5" /> 닫기
          </button>
        </div>
      )}
    </>
  );
}
