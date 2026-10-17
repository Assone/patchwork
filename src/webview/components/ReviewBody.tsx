import { useCallback, useEffect, useMemo, useState } from "react";
import type { GenerateCommitsResult } from "../../rpc/commit-types";
import type { CommitDraft } from "../domain/submission";
import { useFocus } from "../hooks/useFocus";
import { CommitList } from "./CommitList";
import { FileDiffAccordion } from "./FileDiffAccordion";
import { MessageEditor } from "./MessageEditor";

export interface ReviewBodyProps {
  readonly plan: GenerateCommitsResult;
  readonly commits: readonly CommitDraft[];
  readonly confirming: boolean;
  readonly prompt: string;
  readonly onConfirm: (commits: readonly CommitDraft[]) => void;
  readonly onCancel: () => void;
  readonly onRegenerate: (prompt: string) => void;
}

interface EditState {
  readonly plan: GenerateCommitsResult;
  readonly edits: Readonly<Record<string, string>>;
}

const NO_EDITS: Readonly<Record<string, string>> = {};

export const ReviewBody: React.FC<ReviewBodyProps> = ({
  plan,
  commits,
  confirming,
  prompt,
  onConfirm,
  onCancel,
  onRegenerate,
}) => {
  const focusedCommit = useFocus();
  const [editState, setEditState] = useState<EditState>({ plan, edits: {} });
  const [draftPrompt, setDraftPrompt] = useState(prompt);

  // Focus the first commit whenever the draft changes or the focused
  // commit disappears after a regeneration.
  useEffect(() => {
    if (commits.length === 0) {
      return;
    }
    if (focusedCommit.id === null || !commits.some((commit) => commit.id === focusedCommit.id)) {
      focusedCommit.focus(commits[0]!.id);
    }
  }, [commits, focusedCommit]);

  // Edits belong to one plan. Comparing identities during render avoids
  // an effect that clears state after the new plan has painted.
  const edits = editState.plan === plan ? editState.edits : NO_EDITS;

  const setEdit = useCallback(
    (id: string, message: string) => {
      setEditState((current) => ({
        plan,
        edits: { ...(current.plan === plan ? current.edits : {}), [id]: message },
      }));
    },
    [plan],
  );

  const effective = useMemo(
    () => commits.map((commit) => ({ ...commit, message: edits[commit.id] ?? commit.message })),
    [commits, edits],
  );

  const focused = effective.find((commit) => commit.id === focusedCommit.id) ?? effective[0];

  const touchedPaths = useMemo(() => {
    if (focused === undefined) {
      return [];
    }
    const unitById = new Map(plan.units.map((unit) => [unit.id, unit]));
    const paths = new Set<string>();
    for (const id of focused.hunkIds) {
      const unit = unitById.get(id);
      if (unit !== undefined) {
        paths.add(unit.path);
      }
    }
    return [...paths];
  }, [focused, plan.units]);

  const handleCommit = useCallback(() => {
    onConfirm(effective);
  }, [effective, onConfirm]);

  const handleRegenerate = useCallback(() => {
    onRegenerate(draftPrompt.trim());
  }, [draftPrompt, onRegenerate]);

  if (focused === undefined) {
    return (
      <div className="text-foreground-muted flex h-screen items-center justify-center text-xs">
        No commits were drafted.
      </div>
    );
  }

  return (
    <div className="bg-background flex h-full flex-col">
      <header
        className="border-border flex shrink-0 items-center justify-between border-b px-3"
        style={{ height: "var(--header-h)" }}
      >
        <h2 className="text-xs font-medium">Review commits</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-foreground-muted hover:text-foreground text-xs underline-offset-2 outline-none hover:underline focus-visible:underline"
        >
          Back to selection
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Commit diff"
          className="border-border min-h-0 min-w-0 flex-1 overflow-hidden border-r"
        >
          <FileDiffAccordion files={plan.files} units={plan.units} hunkIds={focused.hunkIds} />
        </section>

        <aside className="border-border flex min-h-0 w-80 shrink-0 flex-col border-l">
          <CommitList commits={effective} focusedId={focused.id} onFocus={focusedCommit.focus} />
          <MessageEditor
            commit={focused}
            paths={touchedPaths}
            editingMessage={edits[focused.id] ?? focused.message}
            prompt={draftPrompt}
            confirming={confirming}
            onEdit={(message) => setEdit(focused.id, message)}
            onPromptChange={setDraftPrompt}
            onCancel={onCancel}
            onRegenerate={handleRegenerate}
            onCommit={handleCommit}
          />
        </aside>
      </div>
    </div>
  );
};
