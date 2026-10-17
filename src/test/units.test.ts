import * as assert from "assert";
import { describe, test } from "vitest";
import { parser } from "../domain/diff";
import { buildUnits } from "../features/compose/units";
import type { ChangeSet } from "../services/git";
import type { ChangedFile } from "../rpc/git-types";

const modifiedDiff = (path: string, body = "NEW") =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,3 +1,3 @@",
    " one",
    "-two",
    `+${body}`,
    " three",
    "@@ -10,3 +10,3 @@",
    " ten",
    "-eleven",
    "+ELEVEN",
    " twelve",
    "",
  ].join("\n");

const changeSet = (diff: string, changedFiles: readonly ChangedFile[]): ChangeSet => ({
  headSha: "0".repeat(40),
  changedFiles,
  files: parser(diff),
});

const modified = (path: string): ChangedFile => ({
  path,
  type: "modified",
  staged: true,
  unstaged: false,
});

describe("compose units", () => {
  test("a modified text file becomes one unit per hunk with stable ids", () => {
    const set = changeSet(modifiedDiff("a.txt"), [modified("a.txt")]);
    const first = buildUnits(set);
    const second = buildUnits(set);

    assert.strictEqual(first.units.length, 2);
    assert.deepStrictEqual(
      first.units.map((unit) => unit.id),
      second.units.map((unit) => unit.id),
    );
    assert.ok(first.units.every((unit) => unit.kind === "hunk"));
    assert.ok(first.units[0]?.patch.startsWith("diff --git a/a.txt b/a.txt\n"));
    assert.ok(first.units[0]?.patch.includes("@@ -1,3 +1,3 @@"));
    assert.ok(!first.units[0]?.patch.includes("@@ -10,3 +10,3 @@"));
  });

  test("changing a hunk body changes its id", () => {
    const a = buildUnits(changeSet(modifiedDiff("a.txt", "NEW"), [modified("a.txt")]));
    const b = buildUnits(changeSet(modifiedDiff("a.txt", "DIFFERENT"), [modified("a.txt")]));
    assert.notStrictEqual(a.units[0]?.id, b.units[0]?.id);
    assert.strictEqual(a.units[1]?.id, b.units[1]?.id);
  });

  test("added, deleted, renamed, binary, mode-only, and lock files are atomic", () => {
    const added = changeSet(
      [
        "diff --git a/new.txt b/new.txt",
        "new file mode 100644",
        "index 0000000..1111111",
        "--- /dev/null",
        "+++ b/new.txt",
        "@@ -0,0 +1 @@",
        "+new",
        "",
      ].join("\n"),
      [{ path: "new.txt", type: "added", staged: true, unstaged: false }],
    );
    const deleted = changeSet(
      [
        "diff --git a/gone.txt b/gone.txt",
        "deleted file mode 100644",
        "index 1111111..0000000",
        "--- a/gone.txt",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-gone",
        "",
      ].join("\n"),
      [{ path: "gone.txt", type: "deleted", staged: true, unstaged: false }],
    );
    const renamed = changeSet(
      [
        "diff --git a/old.txt b/new.txt",
        "similarity index 100%",
        "rename from old.txt",
        "rename to new.txt",
        "",
      ].join("\n"),
      [
        {
          path: "new.txt",
          originalPath: "old.txt",
          type: "renamed",
          staged: true,
          unstaged: false,
        },
      ],
    );
    const binary = changeSet(
      [
        "diff --git a/x.bin b/x.bin",
        "index 1111111..2222222 100644",
        "Binary files a/x.bin and b/x.bin differ",
        "",
      ].join("\n"),
      [{ path: "x.bin", type: "modified", staged: true, unstaged: false }],
    );
    const modeOnly = changeSet(
      ["diff --git a/x.sh b/x.sh", "old mode 100644", "new mode 100755", ""].join("\n"),
      [modified("x.sh")],
    );
    const lock = changeSet(modifiedDiff("pnpm-lock.yaml"), [modified("pnpm-lock.yaml")]);

    for (const set of [added, deleted, renamed, binary, modeOnly, lock]) {
      const result = buildUnits(set);
      assert.strictEqual(result.units.length, 1, JSON.stringify(set.files[0]?.type));
      assert.strictEqual(result.units[0]?.kind, "file");
    }
    assert.strictEqual(buildUnits(binary).units[0]?.isBinary, true);
    assert.strictEqual(buildUnits(lock).units[0]?.isLockFile, true);
    assert.strictEqual(buildUnits(added).units[0]?.patch.includes("new file mode"), true);
  });

  test("reports a selected path that has no parsed diff", () => {
    const set = changeSet("", [
      { path: "empty.txt", type: "untracked", staged: false, unstaged: false },
    ]);
    const result = buildUnits(set);
    assert.deepStrictEqual(result.missing, ["empty.txt"]);
  });
});
