import { memo, useEffect, useState } from "react";
import type { FileDiff } from "../../diff";
import { cn } from "../utils/cn";
import { buildDiffRows, type DiffRow, type LineRow } from "../utils/diffRows";
import {
  highlightLine,
  languageForPath,
  mergeSegments,
  type RenderPiece,
} from "../utils/highlight";

/**
 * Renders one file's diff.
 *
 * Rows come from `buildDiffRows`, which supplies three kinds:
 *
 *  - **hunk** — an `@@ -a,b +c,d @@` separator, including git's `section`
 *    context (the enclosing function) when it gave one;
 *  - **gap** — unchanged lines that aren't part of the diff at all, so a
 *    line-number jump like 22 → 109 is explicitly explained instead of
 *    looking like dropped output;
 *  - **line** — a real diff line, optionally carrying word-level segments
 *    so only the changed words are highlighted.
 */
export interface DiffBodyProps {
  readonly file: FileDiff;
}

export const DiffBody: React.FC<DiffBodyProps> = memo(function DiffBody({ file }) {
  const rows = buildDiffRows(file);
  const language = languageForPath(file.newPath);

  return (
    // `w-max` lets the block grow to its widest line so the add/delete
    // background stripes keep extending once the pane scrolls
    // horizontally; `min-w-full` guarantees the stripe still reaches the
    // right edge when the content is narrower than the pane.
    <pre className="m-0 w-max min-w-full">
      {rows.map((row, index) => (
        <DiffRowView key={index} row={row} language={language} />
      ))}
    </pre>
  );
});

const DiffRowView: React.FC<{ row: DiffRow; language: string | undefined }> = ({
  row,
  language,
}) => {
  if (row.kind === "gap") {
    return (
      <div className="text-foreground-muted bg-background-sidebar flex items-center text-[11px]">
        <span className="w-10 shrink-0" />
        <span className="w-10 shrink-0" />
        <span className="w-4 shrink-0 text-center">⋯</span>
        <span className="flex-1 pr-3 pl-1 italic">
          {row.count} unchanged {row.count === 1 ? "line" : "lines"}
        </span>
      </div>
    );
  }

  if (row.kind === "hunk") {
    return (
      <div className="bg-diff-gutter-foreground/10 text-foreground-muted flex items-center text-[11px]">
        <span className="w-10 shrink-0" />
        <span className="w-10 shrink-0" />
        <span className="w-4 shrink-0" />
        <span className="flex-1 pr-3 pl-1">
          {row.header}
          {row.section !== undefined && row.section !== "" ? `  ${row.section}` : ""}
        </span>
      </div>
    );
  }

  return <DiffLineRow row={row} language={language} />;
};

/**
 * Highlights asynchronously and falls back to plain text. Highlighting
 * is cosmetic, so a missing grammar must never block rendering.
 */
function useHighlightedPieces(row: LineRow, language: string | undefined) {
  const [pieces, setPieces] = useState<readonly RenderPiece[] | undefined>(undefined);
  const text = row.line.content;

  useEffect(() => {
    if (language === undefined) {
      setPieces(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      const tokens = await highlightLine(text, language);
      if (cancelled) {
        return;
      }
      setPieces(mergeSegments(tokens ?? [{ text, color: undefined }], row.segments));
    })();
    return () => {
      cancelled = true;
    };
  }, [text, language, row.segments]);

  // Until Shiki answers (or when it can't), render the plain text with
  // the word-diff segments applied.
  if (pieces === undefined) {
    return mergeSegments([{ text, color: undefined }], row.segments);
  }
  return pieces;
}

const DiffLineRow: React.FC<{ row: LineRow; language: string | undefined }> = ({
  row,
  language,
}) => {
  const pieces = useHighlightedPieces(row, language);
  const isAdd = row.line.type === "add";
  const isDelete = row.line.type === "delete";

  return (
    <div
      className={cn(
        "flex items-start whitespace-pre",
        isAdd && "bg-diff-insert-background",
        isDelete && "bg-diff-delete-background",
      )}
      style={{ color: "var(--color-diff-line-foreground)" }}
    >
      <span
        aria-hidden
        className="text-diff-line-number-foreground w-10 shrink-0 pr-2 text-right select-none"
      >
        {row.oldNumber ?? ""}
      </span>
      <span
        aria-hidden
        className="text-diff-line-number-foreground w-10 shrink-0 pr-2 text-right select-none"
      >
        {row.newNumber ?? ""}
      </span>
      <span
        aria-hidden
        className="text-diff-gutter-foreground w-4 shrink-0 text-center select-none"
      >
        {isAdd ? "+" : isDelete ? "-" : " "}
      </span>
      <span className="flex-1 pr-3 pl-1">
        {pieces.map((piece, index) => (
          <span
            key={index}
            style={piece.color === undefined ? undefined : { color: piece.color }}
            className={cn(
              piece.changed && isAdd && "bg-diff-insert-background",
              piece.changed && isDelete && "bg-diff-delete-background",
              piece.changed && (isAdd || isDelete) && "font-medium",
            )}
          >
            {piece.text}
          </span>
        ))}
      </span>
    </div>
  );
};
