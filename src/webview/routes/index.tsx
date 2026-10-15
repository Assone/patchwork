import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useChangedFiles } from "../hooks/useChangedFiles";
import { useFocusedFileDiff } from "../hooks/useFocusedFileDiff";
import { useSelection } from "../hooks/useSelection";
import { useSubmissionContext } from "../submission-context";
import { DiffView } from "../components/DiffView";
import { FileTree } from "../components/FileTree";
import { SelectionHeader } from "../components/SelectionHeader";
import { useFocus } from "../hooks/useFocus";
import { ComposerForm } from "../components/ComposerForm";
import { WaitingScreen } from "../components/WaitingScreen";

/**
 * `/` — the composer: message textarea + Generate Commit button.
 */
export const Route = createFileRoute("/")({
  component: IndexView,
});

function IndexView() {
  const changedFiles = useChangedFiles();
  const selection = useSelection();
  const focus = useFocus();
  const { status, generate } = useSubmissionContext();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");

  // Auto-navigate to the review page once generation succeeds.
  useEffect(() => {
    if (status.kind === "reviewing") {
      navigate({ to: "/review" });
    }
  }, [status, navigate]);

  const focusedDiff = useFocusedFileDiff(focus.id);

  // Stable so `SelectionHeader` can stay memoised: the file list only
  // changes when `useChangedFiles` produces a new one, not on every
  // keystroke in the prompt textarea.
  const selectAllPaths = useMemo(
    () => changedFiles.files.map((file) => file.path),
    [changedFiles.files],
  );
  const handleSelectAll = useCallback(() => {
    selection.replace(selectAllPaths);
  }, [selection.replace, selectAllPaths]);

  const handleSubmit = useCallback(() => {
    if (selection.count === 0) {
      return;
    }
    const selected = changedFiles.files.filter((file) => selection.selected.has(file.path));
    generate({
      message: prompt.trim(),
      files: selected.map((file) => ({ path: file.path, type: file.type })),
    });
  }, [prompt, selection, changedFiles, generate]);

  if (status.kind === "submitting") {
    return <WaitingScreen />;
  }

  return (
    <div className="bg-background-sidebar flex h-screen">
      <DiffView path={focus.id} file={focusedDiff.file} />

      <aside className="border-border flex w-72 flex-col border-l">
        <SelectionHeader
          count={selection.count}
          total={changedFiles.files.length}
          onSelectAll={handleSelectAll}
          onClear={selection.clear}
        />
        <FileTree
          files={changedFiles.files}
          selected={selection.selected}
          focusedPath={focus.id}
          onToggle={selection.toggle}
          onFocus={focus.focus}
        />
        <ComposerForm
          disabled={selection.count === 0}
          onSubmit={handleSubmit}
          errorReason={status.kind === "error" ? status.reason : null}
          prompt={prompt}
          setPrompt={setPrompt}
        />
      </aside>
    </div>
  );
}
