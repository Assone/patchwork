import { memo } from "react";
import type { Diff, DiffLine } from "../mocks/diffs";
import { cn } from "../utils/cn";

/**
 * Renders one file's diff: the two line-number gutters, the +/- gutter,
 * and the code lines with insert/delete background stripes.
 *
 * Shared by the composer's single-file diff pane and the review page's
 * accordion sections — both need identical line numbering and colouring,
 * so the logic lives here rather than being duplicated per view.
 */
export interface DiffBodyProps {
  readonly diff: Diff;
}

/**
 * Wrapped with `memo` so a parent rerender (e.g. typing in the message
 * editor) doesn't re-walk the diff lines. The named inner function
 * keeps the devtools label "DiffBody" instead of "Memo(Anonymous)".
 */
export const DiffBody: React.FC<DiffBodyProps> = memo(function DiffBody({ diff }) {
  const numbered = computeLineNumbers(diff);

  return (
    // `w-max` lets the block grow to its widest line so the add/delete
    // background stripes keep extending once the pane scrolls
    // horizontally; `min-w-full` guarantees the stripe still reaches the
    // right edge when the content is narrower than the pane.
    <pre className="m-0 w-max min-w-full">
      {numbered.map((row, index) => (
        <DiffLineRow key={index} line={diff[index]} oldNumber={row.old} newNumber={row.new} />
      ))}
    </pre>
  );
});

/**
 * For each diff line, returns the corresponding old/new line numbers:
 *   - `add` rows produce a new line number only (old stays null)
 *   - `del` rows produce an old line number only (new stays null)
 *   - `context` rows advance both columns together
 *
 * The two columns never desync because every line increments exactly one
 * side (or both, for context).
 */
function computeLineNumbers(diff: Diff) {
  let oldLine = 0;
  let newLine = 0;
  return diff.map((line) => {
    if (line.kind === "add") {
      newLine += 1;
      return { old: null, new: newLine } as const;
    }
    if (line.kind === "del") {
      oldLine += 1;
      return { old: oldLine, new: null } as const;
    }
    oldLine += 1;
    newLine += 1;
    return { old: oldLine, new: newLine } as const;
  });
}

interface DiffLineRowProps {
  readonly line: DiffLine;
  readonly oldNumber: number | null;
  readonly newNumber: number | null;
}

const DiffLineRow: React.FC<DiffLineRowProps> = memo(function DiffLineRow({
  line,
  oldNumber,
  newNumber,
}) {
  const rowClass =
    line.kind === "add"
      ? "bg-diff-insert-background"
      : line.kind === "del"
        ? "bg-diff-delete-background"
        : "";

  return (
    <div
      className={cn("flex items-start whitespace-pre", rowClass)}
      style={{ color: "var(--color-diff-line-foreground)" }}
    >
      <span
        aria-hidden
        className="text-diff-line-number-foreground w-10 shrink-0 pr-2 text-right select-none"
      >
        {oldNumber ?? ""}
      </span>
      <span
        aria-hidden
        className="text-diff-line-number-foreground w-10 shrink-0 pr-2 text-right select-none"
      >
        {newNumber ?? ""}
      </span>
      <span
        aria-hidden
        className="text-diff-gutter-foreground w-4 shrink-0 text-center select-none"
      >
        {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
      </span>
      <span className="flex-1 pr-3 pl-1">{line.text}</span>
    </div>
  );
});
