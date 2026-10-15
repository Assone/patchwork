import type { DiffLine, FileDiff } from "../../diff";
import { diffWords, type WordSegment } from "./diffWords";

/**
 * Groups a parsed diff into the renderable rows the diff pane needs.
 *
 * The parser gives us hunks with their own line ranges, but a UI needs
 * two things it doesn't spell out:
 *
 *  1. **Gaps.** Between hunks (and before the first one) there are runs
 *     of unchanged lines that simply aren't in the diff. Without an
 *     explicit marker, line numbers appear to jump — 22 then 109 — and
 *     the reader can't tell whether something was lost.
 *  2. **Change pairs.** A `-` line followed by `+` lines is one edit.
 *     Pairing them lets us word-highlight the actual change instead of
 *     repainting whole lines.
 */

export interface GapRow {
  readonly kind: "gap";
  readonly count: number;
}

export interface HunkRow {
  readonly kind: "hunk";
  readonly header: string;
  /** Function/scope context git put after the `@@`, when present. */
  readonly section: string | undefined;
}

export interface LineRow {
  readonly kind: "line";
  readonly line: DiffLine;
  readonly oldNumber: number | null;
  readonly newNumber: number | null;
  /** Present only when this line is part of a word-diffable pair. */
  readonly segments: readonly WordSegment[] | undefined;
}

export type DiffRow = GapRow | HunkRow | LineRow;

/**
 * Smallest run of hidden lines worth a gap marker: any line at all is
 * enough for the numbering to jump, so a gap of 1 still gets explained.
 */
const MIN_GAP_LINES = 1;

/** Consecutive context lines are collapsed into a single filler row. */
const CONTEXT_FILLER_THRESHOLD = 8;

export function buildDiffRows(file: FileDiff): readonly DiffRow[] {
  const rows: DiffRow[] = [];

  file.hunks.forEach((hunk, hunkIndex) => {
    // Gap between the previous hunk's end and this hunk's start.
    // `oldStart` is the first line *of* the hunk, so the unchanged run
    // before it is `oldStart - previousEnd - 1` lines; for the first
    // hunk there is no previous end, giving `oldStart - 1`.
    const previous = file.hunks[hunkIndex - 1];
    const previousEnd = previous === undefined ? 0 : previous.oldStart + previous.oldLines - 1;
    const gap = hunk.oldStart - previousEnd - 1;
    if (gap >= MIN_GAP_LINES) {
      rows.push({ kind: "gap", count: gap });
    }

    rows.push({ kind: "hunk", header: hunk.header, section: hunk.section });

    // Walk the hunk, pairing delete runs with the add runs that follow.
    const lines = hunk.lines;
    let index = 0;

    while (index < lines.length) {
      const line = lines[index]!;

      if (line.type === "normal") {
        rows.push({
          kind: "line",
          line,
          oldNumber: line.oldLineNumber,
          newNumber: line.newLineNumber,
          segments: undefined,
        });
        index++;
        continue;
      }

      // A run of deletions followed by a run of additions is one edit
      // block; pair them positionally and word-diff each pair. Unequal
      // runs aren't a like-for-like edit, so emit them unpaired rather
      // than word-diffing against an arbitrary partner.
      if (line.type === "delete") {
        const deletes: DiffLine[] = [];
        while (index < lines.length && lines[index]!.type === "delete") {
          deletes.push(lines[index]!);
          index++;
        }
        const adds: DiffLine[] = [];
        while (index < lines.length && lines[index]!.type === "add") {
          adds.push(lines[index]!);
          index++;
        }

        if (deletes.length === adds.length) {
          for (let k = 0; k < deletes.length; k++) {
            const oldLine = deletes[k]!;
            const newLine = adds[k]!;
            const paired = diffWords(oldLine, newLine);
            rows.push({
              kind: "line",
              line: oldLine,
              oldNumber: oldLine.type === "delete" ? oldLine.oldLineNumber : null,
              newNumber: null,
              segments: paired.oldSegments,
            });
            rows.push({
              kind: "line",
              line: newLine,
              oldNumber: null,
              newNumber: newLine.type === "add" ? newLine.newLineNumber : null,
              segments: paired.newSegments,
            });
          }
        } else {
          for (const oldLine of deletes) {
            rows.push({
              kind: "line",
              line: oldLine,
              oldNumber: oldLine.type === "delete" ? oldLine.oldLineNumber : null,
              newNumber: null,
              segments: undefined,
            });
          }
          for (const newLine of adds) {
            rows.push({
              kind: "line",
              line: newLine,
              oldNumber: null,
              newNumber: newLine.type === "add" ? newLine.newLineNumber : null,
              segments: undefined,
            });
          }
        }
        continue;
      }

      // Addition with no preceding deletion in this hunk.
      rows.push({
        kind: "line",
        line,
        oldNumber: null,
        newNumber: line.type === "add" ? line.newLineNumber : null,
        segments: undefined,
      });
      index++;
    }
  });

  return collapseContextRuns(rows, CONTEXT_FILLER_THRESHOLD);
}

/**
 * Replaces overly long runs of context rows with a single "N unchanged
 * lines" filler, mirroring what the built-in diff editor collapses.
 */
function collapseContextRuns(rows: readonly DiffRow[], threshold: number): readonly DiffRow[] {
  const out: DiffRow[] = [];
  let run: LineRow[] = [];

  const flush = () => {
    if (run.length > threshold) {
      const first = run[0]!;
      const last = run[run.length - 1]!;
      out.push({ kind: "gap", count: run.length });
      // Keep the first and last so the hunk still reads as connected.
      out.push(first);
      out.push(last);
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const row of rows) {
    if (row.kind === "line" && row.line.type === "normal") {
      run.push(row);
      continue;
    }
    flush();
    out.push(row);
  }
  flush();
  return out;
}
