import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import { useFocusedFileDiff } from "../hooks/useFocusedFileDiff";
import { useLLMConfigured } from "../hooks/useLLMConfigured";
import { useComposerState } from "../composer-context";
import { useSubmissionContext } from "../submission-context";
import { buttonClassName } from "../components/Button";
import { DiffView } from "../components/DiffView";
import { FileTree } from "../components/FileTree";
import { SelectionHeader } from "../components/SelectionHeader";
import { useFocus } from "../hooks/useFocus";
import { ConfiguredComposer, UnconfiguredComposer } from "../components/composer/Composer";
import { WaitingScreen } from "../components/WaitingScreen";

/**
 * `/` — the composer: message textarea + Generate Commit button.
 */
export const Route = createFileRoute("/")({
  component: IndexView,
});

function IndexView() {
  const { changedFiles, selection, prompt, setPrompt } = useComposerState();
  const focus = useFocus();
  const { status, generate, cancel } = useSubmissionContext();
  const navigate = useNavigate();
  const configured = useLLMConfigured();

  useEffect(() => {
    if (status.kind === "reviewing") {
      void navigate({ to: "/review" });
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
  const replaceSelection = selection.replace;
  const handleSelectAll = useCallback(() => {
    replaceSelection(selectAllPaths);
  }, [replaceSelection, selectAllPaths]);

  // Restrict the selection to files the host still reports. A selected
  // path can disappear when the user reverts or stages it elsewhere, and
  // `useSelection` has no file list of its own to prune against — using
  // the raw `selection.count` here would leave the Generate button
  // enabled for a request that ends up with zero files.
  const selectedFiles = useMemo(
    () => changedFiles.files.filter((file) => selection.selected.has(file.path)),
    [changedFiles.files, selection.selected],
  );

  const handleSubmit = useCallback(() => {
    if (selectedFiles.length === 0) {
      return;
    }
    generate({
      message: prompt.trim(),
      paths: selectedFiles.map((file) => file.path),
    });
  }, [prompt, selectedFiles, generate]);

  if (status.kind === "submitting") {
    return (
      <WaitingScreen startedAt={status.startedAt} progress={status.progress} onCancel={cancel} />
    );
  }

  return (
    <div className="bg-background-sidebar flex h-full">
      <DiffView
        path={focus.id}
        file={focusedDiff.file}
        loading={focusedDiff.loading}
        error={focusedDiff.error}
      />

      <aside className="border-border flex min-h-0 w-80 shrink-0 flex-col border-l">
        <SelectionHeader
          count={selectedFiles.length}
          total={changedFiles.files.length}
          onSelectAll={handleSelectAll}
          onClear={selection.clear}
        />
        <FileTree
          files={changedFiles.files}
          selected={selection.selected}
          focusedPath={focus.id}
          loading={changedFiles.loading}
          error={changedFiles.error}
          onRetry={changedFiles.refetch}
          onToggle={selection.toggle}
          onFocus={focus.focus}
        />
        {configured === false ? (
          <UnconfiguredComposer
            prompt={prompt}
            setPrompt={setPrompt}
            errorReason={status.kind === "error" ? status.reason : null}
            configureAction={
              <Link to="/settings" className={buttonClassName("primary")}>
                Configure Model
              </Link>
            }
          />
        ) : (
          <ConfiguredComposer
            prompt={prompt}
            setPrompt={setPrompt}
            disabled={selectedFiles.length === 0}
            errorReason={status.kind === "error" ? status.reason : null}
            onSubmit={handleSubmit}
          />
        )}
      </aside>
    </div>
  );
}
