import type { CommitDraft } from "../domain/submission";
import { Button } from "./Button";
import { PromptField } from "./PromptField";
import { Spinner } from "./Spinner";

export interface MessageEditorProps {
  readonly commit: CommitDraft;
  readonly paths: readonly string[];
  readonly editingMessage: string;
  readonly prompt: string;
  readonly confirming: boolean;
  readonly onEdit: (message: string) => void;
  readonly onPromptChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onRegenerate: () => void;
  readonly onCommit: () => void;
}

export const MessageEditor: React.FC<MessageEditorProps> = ({
  commit,
  paths,
  editingMessage,
  prompt,
  confirming,
  onEdit,
  onPromptChange,
  onCancel,
  onRegenerate,
  onCommit,
}) => {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="border-border text-foreground-muted flex items-center border-b px-2 text-[11px] tracking-wider uppercase"
        style={{ height: "var(--header-h)" }}
      >
        Commit message
      </div>
      <div className="flex-1 overflow-auto overscroll-contain p-2">
        <textarea
          aria-label="Commit message"
          name="commitMessage"
          autoComplete="off"
          value={editingMessage}
          onChange={(event) => onEdit(event.target.value)}
          disabled={confirming}
          className="border-input-border bg-input-background font-editor text-input-foreground focus:border-focus-border w-full resize-y rounded-sm border px-2 py-1 text-xs leading-snug outline-none disabled:cursor-not-allowed"
          rows={6}
        />
        <p className="text-foreground-muted mt-2 text-[10px] break-words">
          {commit.hunkIds.length} {commit.hunkIds.length === 1 ? "change" : "changes"}
          {paths.length > 0 ? ` · ${paths.join(", ")}` : ""}
        </p>
      </div>
      <div className="border-border flex flex-col gap-2 border-t p-2">
        <PromptField
          label="Prompt (optional)"
          value={prompt}
          onChange={onPromptChange}
          rows={2}
          placeholder="Describe what these changes accomplish…"
          disabled={confirming}
        />
        <div className="flex gap-2">
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
    </div>
  );
};
