import { memo } from "react";
import type { FileDiff } from "../../diff";
import { DiffBody } from "./DiffBody";

/**
 * Single-file diff pane for the composer route.
 *
 * Shows whichever source file is focused in the file tree. The header
 * strip shares `--header-h` with the sidebar's selection header so the
 * two panes' top edges line up.
 *
 * `FileDiff | undefined` because the focused file may have no diff
 * (unchanged, untracked-but-not-staged, binary). The view renders a
 * dedicated empty state in that case so the user isn't left wondering.
 */
export interface DiffViewProps {
  readonly path: string | null;
  readonly file: FileDiff | undefined;
}

const DiffViewImpl: React.FC<DiffViewProps> = ({ path, file }) => {
  return (
    <div className="border-border bg-background flex flex-1 flex-col overflow-hidden border-r">
      <header
        className="border-border font-editor text-foreground-muted flex items-center border-b px-3 text-[12px]"
        style={{ height: "var(--header-h)" }}
      >
        {path ?? "No file selected"}
        {file !== undefined && <FileStats file={file} />}
      </header>
      {path === null ? (
        <div className="text-foreground-muted flex flex-1 items-center justify-center">
          Select a file to view its diff.
        </div>
      ) : file === undefined ? (
        <div className="text-foreground-muted flex flex-1 items-center justify-center">
          No diff available for {path}.
        </div>
      ) : file.isBinary === true ? (
        <div className="text-foreground-muted flex flex-1 items-center justify-center">
          Binary file — no text diff to show.
        </div>
      ) : file.hunks.length === 0 ? (
        // Parsed, but nothing to show: a mode change, or an empty diff.
        <div className="text-foreground-muted flex flex-1 items-center justify-center">
          No diff available for {path}.
        </div>
      ) : (
        <div className="font-editor flex-1 overflow-auto text-[12px] leading-4.5">
          <DiffBody file={file} />
        </div>
      )}
    </div>
  );
};

/**
 * `+N −M` counts, plus the rename/added/deleted marker git gave us.
 * These are already computed by the parser; showing them keeps the pane
 * from losing information the diff clearly carries.
 */
const FileStats: React.FC<{ file: FileDiff }> = ({ file }) => {
  const moved = file.oldPath !== file.newPath ? ` ${file.oldPath} → ${file.newPath}` : "";

  return (
    <span className="ml-2 flex items-center gap-2 text-[11px]">
      {file.type !== "modified" && <span className="opacity-80">{file.type}</span>}
      {moved !== "" && <span className="opacity-80">{moved}</span>}
      <span className="text-badge-added">+{file.additions}</span>
      <span className="text-badge-deleted">−{file.deletions}</span>
    </span>
  );
};

/**
 * `memo` keeps the diff pane from re-rendering while the message
 * textarea updates on every keystroke — its props change only when the
 * focused path or its diff actually changes.
 */
export const DiffView = memo(DiffViewImpl);
