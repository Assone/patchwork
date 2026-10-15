import type { DiffLine } from "../../diff";

/**
 * Word-level diff between a deleted and an added line.
 *
 * Longest-common-subsequence over whitespace-separated tokens, then
 * everything outside the LCS is marked as changed. This is what makes a
 * diff read like VS Code's: a one-word edit highlights that word rather
 * than repainting the whole line red and green.
 */
export interface WordSegment {
  readonly text: string;
  readonly changed: boolean;
}

/**
 * Splits a line into diffable tokens.
 *
 * Whitespace runs, identifier-like runs, and single punctuation
 * characters are separate tokens. Splitting punctuation out matters:
 * treating `1;` as one token would flag the semicolon as changed even
 * when only the digit is.
 */
const tokenize = (input: string): readonly string[] =>
  input.match(/\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) ?? [];

const isBlank = (token: string): boolean => token.trim() === "";

/**
 * Builds the LCS table. Inputs are expected to be short (a source line),
 * so the O(n*m) table is fine.
 */
const lcsTable = (a: readonly string[], b: readonly string[]): number[][] => {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      table[i]![j] =
        a[i - 1] === b[j - 1]
          ? (table[i - 1]![j - 1] ?? 0) + 1
          : Math.max(table[i - 1]![j] ?? 0, table[i]![j - 1] ?? 0);
    }
  }
  return table;
};

/** Walks the LCS table back into an aligned token list. */
const backtrack = (
  a: readonly string[],
  b: readonly string[],
): Array<{ readonly token: string; readonly side: "both" | "old" | "new" }> => {
  const table = lcsTable(a, b);
  const out: Array<{ readonly token: string; readonly side: "both" | "old" | "new" }> = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ token: a[i - 1]!, side: "both" });
      i--;
      j--;
    } else if ((table[i - 1]![j] ?? 0) >= (table[i]![j - 1] ?? 0)) {
      out.push({ token: a[i - 1]!, side: "old" });
      i--;
    } else {
      out.push({ token: b[j - 1]!, side: "new" });
      j--;
    }
  }
  while (i > 0) {
    out.push({ token: a[i - 1]!, side: "old" });
    i--;
  }
  while (j > 0) {
    out.push({ token: b[j - 1]!, side: "new" });
    j--;
  }
  return out.reverse();
};

/** Collapses runs of same-`changed` tokens into renderable segments. */
const toSegments = (
  aligned: Array<{ readonly token: string; readonly side: "both" | "old" | "new" }>,
  side: "old" | "new",
): readonly WordSegment[] => {
  const kept = aligned.filter((entry) => entry.side === "both" || entry.side === side);
  const segments: WordSegment[] = [];
  for (const entry of kept) {
    const changed = entry.side === side;
    // Never mark pure whitespace as a change: it renders as an
    // invisible highlight and looks like a rendering bug.
    const effectiveChanged = changed && !isBlank(entry.token);
    const last = segments.at(-1);
    if (last !== undefined && last.changed === effectiveChanged) {
      segments[segments.length - 1] = { text: last.text + entry.token, changed: effectiveChanged };
    } else {
      segments.push({ text: entry.token, changed: effectiveChanged });
    }
  }
  return segments;
};

export interface PairedLines {
  readonly oldLine: DiffLine;
  readonly newLine: DiffLine;
  /** Word segments for the old side, if the pair was diffable. */
  readonly oldSegments: readonly WordSegment[] | undefined;
  /** Word segments for the new side, if the pair was diffable. */
  readonly newSegments: readonly WordSegment[] | undefined;
}

/**
 * Computes word-level segments for a delete/add pair.
 *
 * Returns `undefined` segments when an inline diff would be noise —
 * for very different lines, highlighting is worse than plain
 * red/green, so callers fall back to whole-line colouring.
 */
export function diffWords(oldLine: DiffLine, newLine: DiffLine): PairedLines {
  const oldText = oldLine.type === "delete" ? oldLine.content : "";
  const newText = newLine.type === "add" ? newLine.content : "";
  if (oldLine.type !== "delete" || newLine.type !== "add") {
    return { oldLine, newLine, oldSegments: undefined, newSegments: undefined };
  }

  const a = tokenize(oldText);
  const b = tokenize(newText);
  const aligned = backtrack(a, b);
  const unchanged = aligned.filter((entry) => entry.side === "both").length;
  const total = Math.max(a.length, b.length);
  // Too little in common to be worth highlighting.
  if (total > 0 && unchanged / total < 0.3) {
    return { oldLine, newLine, oldSegments: undefined, newSegments: undefined };
  }

  return {
    oldLine,
    newLine,
    oldSegments: toSegments(aligned, "old"),
    newSegments: toSegments(aligned, "new"),
  };
}
