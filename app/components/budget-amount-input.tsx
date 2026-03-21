import { useState, type ComponentProps } from "react";

import { Input } from "~/components/ui/input";
import { parseBudgetInput } from "~/lib/ledger-budget";

type BudgetAmountInputProps = Omit<ComponentProps<typeof Input>, "value"> & {
  value: string;
};

export function BudgetAmountInput({
  value,
  onFocus,
  onBlur,
  ...props
}: BudgetAmountInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const parsedValue = parseBudgetInput(value);
  const displayValue = isFocused ? (parsedValue > 0 ? String(parsedValue) : "") : value;

  return (
    <Input
      {...props}
      value={displayValue}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        onBlur?.(event);
      }}
    />
  );
}
