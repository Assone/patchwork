import { memo } from "react";
import type { Diff } from "../mocks/diffs";
import { DiffBody } from "./DiffBody";

/**
 * Single-file diff pane for the composer route.
 *
 * Shows whichever source file is focused in the file tree. The header
 * strip shares `--header-h` with the sidebar's selection header so
 * the two panes' top edges line up.
 */
export interface DiffViewProps {
  readonly path: string | null;
  readonly diff: Diff | undefined;
}

const DiffViewImpl: React.FC<DiffViewProps> = ({ path, diff }) => {
  return (
    <div className="border-border bg-background flex flex-1 flex-col overflow-hidden border-r">
      <header
        className="border-border font-editor text-foreground-muted flex items-center border-b px-3 text-[12px]"
        style={{ height: "var(--header-h)" }}
      >
        {path ?? "No file selected"}
      </header>
      {!path ? (
        <div className="text-foreground-muted flex flex-1 items-center justify-center">
          Select a file to view its diff.
        </div>
      ) : diff === undefined || diff.length === 0 ? (
        <div className="text-foreground-muted flex flex-1 items-center justify-center">
          No diff available for {path}.
        </div>
      ) : (
        <div className="font-editor flex-1 overflow-auto text-[12px] leading-4.5">
          <DiffBody diff={diff} />
        </div>
      )}
    </div>
  );
};

/**
 * `memo` keeps the diff pane from re-rendering while the message
 * textarea updates on every keystroke — its props change only when the
 * focused path or its diff actually changes.
 */
export const DiffView = memo(DiffViewImpl);
