import { cn } from "../utils/cn";
import { Button } from "./Button";

export interface ComposerFormProps {
  readonly disabled: boolean;
  readonly onSubmit: () => void;
  readonly errorReason: string | null;
  readonly prompt: string;
  readonly setPrompt: (value: string) => void;
}

export const ComposerForm: React.FC<ComposerFormProps> = ({
  disabled,
  onSubmit,
  errorReason,
  prompt,
  setPrompt,
}) => {
  return (
    <div className="border-border flex flex-col border-t">
      {errorReason !== null && (
        <div
          className="border-border flex items-start gap-2 border-b px-2 py-2 text-xs"
          style={{
            background: "var(--color-diff-delete-background)",
            color: "var(--color-badge-deleted)",
          }}
          role="alert"
        >
          <span aria-hidden className="shrink-0 leading-none">
            ⚠
          </span>
          <span className="flex-1 leading-snug">
            <span className="font-medium">Drafting failed:</span> {errorReason}
          </span>
        </div>
      )}
      <form
        className="flex flex-col gap-2 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="text-foreground-muted flex flex-col gap-1 text-[11px] font-medium">
          Prompt (optional)
          <textarea
            rows={3}
            placeholder="Describe what these changes accomplish…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={disabled}
            className={cn(
              "w-full resize-y rounded-sm px-2 py-1 text-xs leading-snug",
              "bg-input-background text-input-foreground",
              "border-input-border border",
              "focus:border-focus-border outline-none",
              "placeholder:text-foreground-muted",
              "disabled:bg-row-hover disabled:cursor-not-allowed",
              "font-editor",
            )}
          />
        </label>
        <Button type="submit" disabled={disabled}>
          Generate Commits
        </Button>
      </form>
    </div>
  );
};
