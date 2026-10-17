import * as assert from "assert";
import { describe, test } from "vitest";
import { parser } from "../domain/diff";
import { buildDiffRows } from "../webview/utils/diffRows";
import { diffWords } from "../webview/utils/diffWords";

/**
 * Row-building tests for the diff pane.
 *
 * These cover the two things the raw parser does not spell out but the
 * UI needs: explicit gaps between hunks (so a line-number jump reads as
 * "unchanged lines" rather than lost output), and pairing of deletes
 * with adds so a one-word edit highlights that word.
 */

const parseOne = (raw: string) => {
  const files = parser(raw);
  const file = files[0];
  assert.ok(file !== undefined, "expected one file");
  return file;
};

/**
 * A hunk whose hunk header counts match its body. The parser validates
 * these, so hand-written fixtures must be internally consistent — these
 * were taken from real `git diff` output rather than invented.
 */
const WITH_GAP_BEFORE = [
  "diff --git a/f.txt b/f.txt",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -20,6 +20,6 @@ l19",
  " l20",
  " l21",
  " l22",
  "-l23",
  "+CHANGED",
  " l24",
  " l25",
  "",
].join("\n");

describe("diff rows", () => {
  test("marks the unchanged lines before the first hunk", () => {
    const file = parseOne(WITH_GAP_BEFORE);

    const rows = buildDiffRows(file);
    const gap = rows.find((row) => row.kind === "gap");
    assert.ok(gap?.kind === "gap");
    // The hunk opens at line 20, so 19 lines precede it.
    assert.strictEqual(gap.count, 19);
  });

  test("marks the gap between two hunks", () => {
    // Verbatim real `git diff` output (two edits in a 28-line file).
    // Hunk 1 covers old 7..13, hunk 2 opens at old 23, so 9 unchanged
    // lines sit between them.
    const file = parseOne(
      [
        "diff --git a/f.txt b/f.txt",
        "--- a/f.txt",
        "+++ b/f.txt",
        "@@ -7,7 +7,7 @@ l6",
        " l7",
        " l8",
        " l9",
        "-l10",
        "+TEN",
        " l11",
        " l12",
        " l13",
        "@@ -23,6 +23,6 @@ l22",
        " l23",
        " l24",
        " l25",
        "-l26",
        "+CHANGED",
        " l27",
        " l28",
        "",
      ].join("\n"),
    );

    const rows = buildDiffRows(file);
    const gaps = rows.filter((row) => row.kind === "gap");
    // One gap before hunk 1 (lines 1..6), one between hunks (14..22).
    assert.strictEqual(gaps.length, 2, "expected a gap before and between hunks");
    assert.strictEqual(gaps[0]?.kind === "gap" ? gaps[0].count : -1, 6);
    assert.strictEqual(gaps[1]?.kind === "gap" ? gaps[1].count : -1, 9);
  });

  test("emits a hunk row carrying the header and section", () => {
    const file = parseOne(
      [
        "diff --git a/a.ts b/a.ts",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1 +1 @@ function greet()",
        "-old",
        "+new",
        "",
      ].join("\n"),
    );

    const hunk = buildDiffRows(file).find((row) => row.kind === "hunk");
    assert.ok(hunk?.kind === "hunk");
    assert.strictEqual(hunk.header, "@@ -1 +1 @@");
    assert.strictEqual(hunk.section, "function greet()");
  });

  test("keeps a deletion-only run as delete rows", () => {
    const file = parseOne(
      [
        "diff --git a/f.rs b/f.rs",
        "--- a/f.rs",
        "+++ b/f.rs",
        "@@ -310,7 +310,3 @@ fn dispose() {",
        "         clear();",
        "     })",
        " }",
        "-",
        "-pub fn add(a: i32, b: i32) -> i32 {",
        "-    a + b",
        "-}",
        "",
      ].join("\n"),
    );

    const rows = buildDiffRows(file);
    const lines = rows.filter((row) => row.kind === "line");
    assert.strictEqual(lines.filter((row) => row.line.type === "delete").length, 4);
    assert.strictEqual(lines.filter((row) => row.line.type === "normal").length, 3);
  });

  test("pairs a delete with its add and provides word segments", () => {
    const file = parseOne(
      [
        "diff --git a/a.ts b/a.ts",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1 +1 @@",
        "-const value = 1;",
        "+const value = 2;",
        "",
      ].join("\n"),
    );

    const lines = buildDiffRows(file).filter((row) => row.kind === "line");
    assert.strictEqual(lines.length, 2);
    const [old, added] = lines as [
      Extract<(typeof lines)[number], { kind: "line" }>,
      Extract<(typeof lines)[number], { kind: "line" }>,
    ];
    assert.ok(old.segments !== undefined, "old line should carry word segments");
    assert.ok(added.segments !== undefined, "new line should carry word segments");

    // Only the changed digit is marked, not the whole line.
    const changedInOld = old.segments.filter((segment) => segment.changed).map((s) => s.text);
    const changedInNew = added.segments.filter((segment) => segment.changed).map((s) => s.text);
    assert.deepStrictEqual(changedInOld, ["1"]);
    assert.deepStrictEqual(changedInNew, ["2"]);
  });

  test("skips word diff when the lines have little in common", () => {
    const file = parseOne(
      [
        "diff --git a/a.txt b/a.txt",
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1 +1 @@",
        "-aaa",
        "+zzz",
        "",
      ].join("\n"),
    );

    const lines = buildDiffRows(file).filter(
      (row): row is Extract<typeof row, { kind: "line" }> => row.kind === "line",
    );
    assert.ok(lines[0]?.segments === undefined, "too dissimilar to word-diff");
  });

  test("keeps line numbers on each side", () => {
    const file = parseOne(
      [
        "diff --git a/a.txt b/a.txt",
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -5,2 +7,2 @@",
        " ctx",
        "-old",
        "+new",
        "",
      ].join("\n"),
    );

    const lines = buildDiffRows(file).filter(
      (row): row is Extract<typeof row, { kind: "line" }> => row.kind === "line",
    );
    assert.strictEqual(lines.length, 3);
    const [context, del, add] = lines;
    // Context advances both sides from the hunk's starts.
    assert.strictEqual(context?.oldNumber, 5);
    assert.strictEqual(context?.newNumber, 7);
    assert.strictEqual(del?.oldNumber, 6);
    assert.strictEqual(del?.newNumber, null);
    assert.strictEqual(add?.oldNumber, null);
    assert.strictEqual(add?.newNumber, 8);
  });

  test("diffWords marks only the differing tokens", () => {
    const old = { type: "delete" as const, content: "const a = 1;", oldLineNumber: 1 };
    const added = { type: "add" as const, content: "const a = 2;", newLineNumber: 1 };
    const result = diffWords(old, added);

    const oldChanged = result.oldSegments?.filter((segment) => segment.changed) ?? [];
    const newChanged = result.newSegments?.filter((segment) => segment.changed) ?? [];
    assert.deepStrictEqual(
      oldChanged.map((segment) => segment.text),
      ["1"],
    );
    assert.deepStrictEqual(
      newChanged.map((segment) => segment.text),
      ["2"],
    );
  });

  test("diffWords never marks whitespace as changed", () => {
    const old = { type: "delete" as const, content: "a  b", oldLineNumber: 1 };
    const added = { type: "add" as const, content: "a  c", newLineNumber: 1 };
    const result = diffWords(old, added);

    for (const segment of result.oldSegments ?? []) {
      if (segment.changed) {
        assert.notStrictEqual(segment.text.trim(), "", "whitespace must not be flagged");
      }
    }
  });
});
