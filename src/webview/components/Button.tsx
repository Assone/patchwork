import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "../utils/cn";

/**
 * VS Code-styled button.
 *
 * Three variants mirror the theme's button tokens:
 *   - primary    solid `--vscode-button-background`, the default CTA
 *   - secondary  muted `--vscode-button-secondaryBackground`
 *   - ghost      transparent with a border, for tertiary actions
 *
 * The size is fixed at the VS Code compact size (text-xs, ~24px tall) —
 * introducing a size axis before a second size exists would be
 * speculative.
 *
 * In React 19, `ref` is a regular prop, so this component can stay an
 * arrow function and still forward refs to the underlying `<button>`.
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "primary" | "secondary" | "ghost";
  readonly ref?: Ref<HTMLButtonElement>;
}

const VARIANT: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: [
    "bg-button-background text-button-foreground",
    "hover:bg-button-hover",
    "disabled:bg-button-secondary-background",
    "disabled:text-button-secondary-foreground",
  ].join(" "),
  secondary: [
    "bg-button-secondary-background text-button-secondary-foreground",
    "hover:bg-button-hover",
  ].join(" "),
  ghost: ["border border-input-border bg-transparent text-foreground", "hover:bg-row-hover"].join(
    " ",
  ),
};

export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  className,
  type = "button",
  ref,
  ...rest
}) => {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "rounded-sm px-3 py-1.5 text-xs font-medium",
        "disabled:cursor-not-allowed",
        "focus-visible:outline-focus-border outline-none focus-visible:outline",
        VARIANT[variant],
        className,
      )}
      {...rest}
    />
  );
};
