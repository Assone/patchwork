import { useState, useEffect, useMemo, useCallback } from "react";
import { useFocusedCommitContext } from "../focused-commit-context";
import type { Commit } from "../hooks/useSubmission";
import { CommitList } from "./CommitList";
import { FileDiffAccordion } from "./FileDiffAccordion";
import { MessageEditor } from "./MessageEditor";

export interface ReviewBodyProps {
  readonly commits: readonly Commit[];
  readonly confirming: boolean;
  readonly prompt: string;
  readonly onConfirm: (commits: readonly Commit[]) => void;
  readonly onCancel: () => void;
  readonly onRegenerate: (prompt: string) => void;
}

export const ReviewBody: React.FC<ReviewBodyProps> = ({
  commits,
  confirming,
  prompt,
  onConfirm,
  onCancel,
  onRegenerate,
}) => {
  const focusedCommit = useFocusedCommitContext();
  const focused = commits.find((c) => c.id === focusedCommit.id) ?? commits[0];

  // Local edits to each commit's message. Keyed by commit id so that
  // switching focus doesn't blow away unsaved edits elsewhere.
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});

  // The prompt shown in the editor footer. Seeded from the prompt that
  // produced the current draft; the user can refine it across
  // regenerations. We deliberately do NOT reset this on a fresh review
  // — whatever the user typed stays put, so they can iterate on the
  // prompt without losing what they wrote last time.
  const [draftPrompt, setDraftPrompt] = useState(prompt);

  // Whenever the commits themselves change (a fresh review), reset
  // the edit map so per-commit edits don't leak across regenerations.
  // `draftPrompt` is intentionally NOT reset — see above.
  useEffect(() => {
    setEdits({});
  }, [commits]);

  // Compose the effective list: edited message wins where present,
  // otherwise the server's draft. Used both for the editor and for
  // what gets sent on confirm.
  const effective = useMemo(
    () => commits.map((c) => ({ ...c, message: edits[c.id] ?? c.message })),
    [commits, edits],
  );

  const handleCommit = useCallback(() => {
    onConfirm(effective);
  }, [effective, onConfirm]);

  const handleRegenerate = useCallback(() => {
    onRegenerate(draftPrompt.trim());
  }, [draftPrompt, onRegenerate]);

  return (
    <div className="bg-background flex h-screen">
      {/* LEFT: diff viewer (accordion over the focused commit's files). */}
      <main className="border-border flex-1 overflow-hidden border-r">
        <FileDiffAccordion files={focused.files} />
      </main>

      {/* RIGHT: commit list + editor. */}
      <aside className="border-border flex w-72 flex-col border-l">
        <CommitList commits={effective} focusedId={focused.id} onFocus={focusedCommit.focus} />
        <MessageEditor
          commit={focused}
          editingMessage={edits[focused.id] ?? focused.message}
          prompt={draftPrompt}
          confirming={confirming}
          onEdit={(message) => setEdits((current) => ({ ...current, [focused.id]: message }))}
          onPromptChange={setDraftPrompt}
          onCancel={onCancel}
          onRegenerate={handleRegenerate}
          onCommit={handleCommit}
        />
      </aside>
    </div>
  );
};
