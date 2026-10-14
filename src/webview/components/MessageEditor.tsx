import type { Commit } from "../hooks/useSubmission";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

export function MessageEditor({
  commit,
  editingMessage,
  confirming,
  onEdit,
  onCancel,
  onRegenerate,
  onCommit,
}: {
  readonly commit: Commit;
  readonly editingMessage: string;
  readonly confirming: boolean;
  readonly onEdit: (message: string) => void;
  readonly onCancel: () => void;
  readonly onRegenerate: () => void;
  readonly onCommit: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div
        className="border-border text-foreground-muted flex items-center border-b px-2 text-[11px] tracking-wider uppercase"
        style={{ height: "var(--header-h)" }}
      >
        Commit message
      </div>
      <div className="flex-1 overflow-auto p-2">
        <textarea
          value={editingMessage}
          onChange={(event) => onEdit(event.target.value)}
          disabled={confirming}
          className="border-input-border bg-input-background font-editor text-input-foreground focus:border-focus-border w-full resize-y rounded-sm border px-2 py-1 text-xs leading-snug outline-none disabled:cursor-not-allowed"
          rows={6}
        />
        <p className="text-foreground-muted mt-2 text-[10px]">
          Files: {commit.files.map((f) => f.path.split("/").pop()).join(", ")}
        </p>
      </div>
      <div className="border-border flex gap-2 border-t p-2">
        <Button
          variant="secondary"
          onClick={onCancel}
          disabled={confirming}
          className="flex-1 disabled:opacity-50"
        >
          Cancel
        </Button>
        <Button
          variant="ghost"
          onClick={onRegenerate}
          disabled={confirming}
          className="flex-1 disabled:opacity-50"
        >
          Regenerate
        </Button>
        <Button
          onClick={onCommit}
          disabled={confirming}
          className="flex flex-1 items-center justify-center gap-1.5"
        >
          {confirming ? (
            <>
              <Spinner size={12} />
              Committing…
            </>
          ) : (
            "Commit"
          )}
        </Button>
      </div>
    </div>
  );
}
