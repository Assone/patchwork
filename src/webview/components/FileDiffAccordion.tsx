import { useState } from "react";
import { Chevron } from "./Chevron";
import { DiffBody } from "./DiffBody";
import { useFocusedFileDiff } from "../hooks/useFocusedFileDiff";

export interface FileDiffAccordionProps {
  readonly files: readonly { readonly path: string; readonly type: string }[];
}

/**
 * Renders the list of files in the focused commit as an accordion of
 * diffs. Each row fetches its own diff via `useFocusedFileDiff`; an
 * empty staged/unstaged diff renders the existing "No diff available"
 * empty state rather than an error.
 */
export const FileDiffAccordion: React.FC<FileDiffAccordionProps> = ({ files }) => {
  if (files.length === 0) {
    return (
      <div className="text-foreground-muted flex h-full items-center justify-center">
        No files in this commit.
      </div>
    );
  }

  return (
    <div className="font-editor h-full overflow-auto text-[12px]">
      {files.map((file) => (
        <FileSection key={file.path} path={file.path} />
      ))}
    </div>
  );
};

const FileSection: React.FC<{ path: string }> = ({ path }) => {
  const [collapsed, setCollapsed] = useState(false);
  // Passing `null` while collapsed disables the query (see the hook's
  // `enabled` guard), so a section only costs the host a `git diff`
  // once the user actually opens it.
  const { file, loading } = useFocusedFileDiff(collapsed ? null : path);

  return (
    <section className="border-border border-b">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
        className="hover:bg-row-hover flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs"
      >
        <Chevron expanded={!collapsed} />
        <span className="flex-1 truncate">{path}</span>
      </button>
      {!collapsed &&
        (file !== undefined && file.hunks.length > 0 ? (
          <DiffBody file={file} />
        ) : (
          <div className="text-foreground-muted px-3 py-2 text-xs">
            {loading ? "Loading diff…" : "No diff available."}
          </div>
        ))}
    </section>
  );
};
