import * as assert from "assert";
import { parser } from "../diff";

/**
 * Parser diagnostics, running inside the real VS Code host.
 *
 * `parser()` is the shared unified-diff parser the webview uses to turn
 * the raw `git diff` text into renderable lines. This suite runs in the
 * real host (unlike the in-memory RPC suite) so it also proves the
 * module loads under Electron's CJS loader.
 */
suite("Unified diff parser", () => {
  test("parses a modified file into add/delete/context lines", () => {
    const raw = [
      "diff --git a/b.txt b/b.txt",
      "index f384549..7cdb995 100644",
      "--- a/b.txt",
      "+++ b/b.txt",
      "@@ -1,4 +1,4 @@",
      " one",
      " two",
      "-three",
      "+THREE",
      " four",
      "",
    ].join("\n");

    const files = parser(raw);

    assert.strictEqual(files.length, 1);
    const file = files[0];
    assert.strictEqual(file?.newPath, "b.txt");
    assert.strictEqual(file?.hunks.length, 1);
    const lines = file?.hunks[0]?.lines ?? [];
    assert.strictEqual(lines.length, 5);

    const add = lines.find((line) => line.type === "add");
    const del = lines.find((line) => line.type === "delete");
    assert.strictEqual(add?.content, "THREE");
    assert.strictEqual(add?.newLineNumber, 3);
    assert.strictEqual(del?.content, "three");
    assert.strictEqual(del?.oldLineNumber, 3);
  });

  test("parses a newly added file", () => {
    const raw = [
      "diff --git a/new.txt b/new.txt",
      "new file mode 100644",
      "index 0000000..f384549",
      "--- /dev/null",
      "+++ b/new.txt",
      "@@ -0,0 +1,2 @@",
      "+one",
      "+two",
      "",
    ].join("\n");

    const files = parser(raw);
    const file = files[0];

    assert.strictEqual(file?.oldPath, "/dev/null");
    assert.strictEqual(file?.newPath, "new.txt");
    assert.strictEqual(file?.type, "added");
    assert.strictEqual(file?.hunks[0]?.lines.length, 2);
  });

  test("an empty diff yields no files", () => {
    assert.deepStrictEqual(parser(""), []);
  });
});
