import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { selectLockFiles } from "../domain/lock-files";
import { stagedPaths } from "./domain/selection";
import { useChangedFiles, type ChangedFilesState } from "./hooks/useChangedFiles";
import { useSelection, type Selection } from "./hooks/useSelection";

interface ComposerState {
  readonly changedFiles: ChangedFilesState;
  readonly lockFiles: readonly string[];
  readonly selection: Selection;
  readonly prompt: string;
  readonly setPrompt: (value: string) => void;
}

const ComposerContext = createContext<ComposerState | null>(null);

/** Owns selection + prompt so navigating to Settings does not discard them. */
export const ComposerProvider: React.FC<{ readonly children: ReactNode }> = ({ children }) => {
  const changedFiles = useChangedFiles();
  const lockFiles = useMemo(
    () => selectLockFiles(changedFiles.files.map((file) => file.path)),
    [changedFiles.files],
  );
  const selection = useSelection(lockFiles);
  const [prompt, setPrompt] = useState("");
  const replaceSelection = selection.replace;
  const seeded = useRef(false);

  // Preselect what the user already staged, once per panel. Waiting for a
  // successful first read avoids seeding from the empty placeholder while
  // the query is pending, and the ref keeps later refetches from
  // overwriting a selection the user has since edited.
  useEffect(() => {
    if (seeded.current || changedFiles.loading || changedFiles.error !== null) {
      return;
    }
    seeded.current = true;
    const staged = stagedPaths(changedFiles.files);
    if (staged.length > 0) {
      replaceSelection(staged);
    }
  }, [changedFiles.error, changedFiles.files, changedFiles.loading, replaceSelection]);

  // Depend on the stable fields, not on the wrapper objects, which are
  // recreated on every provider render.
  const value = useMemo(
    () => ({
      changedFiles,
      lockFiles,
      selection,
      prompt,
      setPrompt,
    }),
    [changedFiles, lockFiles, selection, prompt, setPrompt],
  );

  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
};

export function useComposerState(): ComposerState {
  const value = use(ComposerContext);
  if (value === null) {
    throw new Error("useComposerState must be used within ComposerProvider");
  }
  return value;
}
