import { memo } from "react";
import type { FileDiff } from "../../domain/diff";
import { DiffBody } from "./DiffBody";

export interface DiffViewProps {
  readonly path: string | null;
  readonly file: FileDiff | undefined;
  readonly loading: boolean;
  readonly error: Error | null;
}

const DiffViewImpl: React.FC<DiffViewProps> = ({ path, file, loading, error }) => {
  return (
    <div className="border-border bg-background flex min-w-0 flex-1 flex-col overflow-hidden border-r">
      <header
        className="border-border font-editor text-foreground-muted flex items-center border-b px-3 text-[12px]"
        style={{ height: "var(--header-h)" }}
      >
        <span className="min-w-0 truncate">{path ?? "No file selected"}</span>
        {file !== undefined && <FileStats file={file} />}
      </header>
      {path === null ? (
        <div className="text-foreground-muted flex flex-1 items-center justify-center">
          Select a file to view its diff.
        </div>
      ) : error !== null ? (
        <div
          className="flex flex-1 items-center justify-center px-4 text-center break-words"
          style={{ color: "var(--color-badge-deleted)" }}
          role="alert"
        >
          Could not read the diff: {error.message}
        </div>
      ) : loading ? (
        <div
          className="text-foreground-muted flex flex-1 items-center justify-center"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          Loading diff…
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
        <div className="font-editor flex-1 overflow-auto overscroll-contain text-[12px] leading-4.5">
          <DiffBody file={file} />
        </div>
      )}
    </div>
  );
};

const FileStats: React.FC<{ file: FileDiff }> = ({ file }) => {
  const moved =
    file.oldPath !== "/dev/null" && file.newPath !== "/dev/null" && file.oldPath !== file.newPath
      ? ` ${file.oldPath} → ${file.newPath}`
      : "";

  return (
    <span className="ml-2 flex shrink-0 items-center gap-2 text-[11px]">
      {file.type !== "modified" && <span className="opacity-80">{file.type}</span>}
      {moved !== "" && <span className="opacity-80">{moved}</span>}
      <span className="text-badge-added">+{file.additions}</span>
      <span className="text-badge-deleted">−{file.deletions}</span>
    </span>
  );
};

export const DiffView = memo(DiffViewImpl);
