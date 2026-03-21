import { cn } from "~/lib/utils";

type ColorSwatchInputProps = {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  className?: string;
};

export function ColorSwatchInput({
  name,
  value,
  defaultValue,
  onChange,
  className,
}: ColorSwatchInputProps) {
  const swatchColor = value ?? defaultValue ?? "#94a3b8";

  return (
    <label
      className={cn(
        "relative inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition-transform hover:scale-[1.03]",
        className,
      )}
    >
      <span
        className="h-full w-full rounded-full border border-white/20"
        style={{ backgroundColor: swatchColor }}
      />
      <input
        type="color"
        name={name}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}
