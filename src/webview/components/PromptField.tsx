import { useId } from "react";
import { cn } from "../utils/cn";

export interface PromptFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly name?: string;
}

export const PromptField: React.FC<PromptFieldProps> = ({
  label,
  value,
  onChange,
  disabled = false,
  rows = 3,
  placeholder,
  name = "prompt",
}) => {
  const id = useId();

  return (
    <label
      htmlFor={id}
      className="text-foreground-muted flex flex-col gap-1 text-[11px] font-medium"
    >
      {label}
      <textarea
        id={id}
        name={name}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoComplete="off"
        className={cn(
          "w-full resize-y rounded-sm px-2 py-1 text-xs leading-snug",
          "bg-input-background text-input-foreground",
          "border-input-border border",
          "focus:border-focus-border outline-none",
          "placeholder:text-input-placeholder",
          "disabled:bg-row-hover disabled:cursor-not-allowed",
          "font-editor",
        )}
      />
    </label>
  );
};
