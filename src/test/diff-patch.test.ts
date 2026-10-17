import * as assert from "assert";
import { describe, test } from "vitest";
import { buildPatch, parser, stripIndexLine } from "../domain/diff";

const TWO_HUNKS = [
  "diff --git a/a.txt b/a.txt",
  "index 1111111..2222222 100644",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1,3 +1,3 @@",
  " one",
  "-two",
  "+TWO",
  " three",
  "@@ -10,3 +10,3 @@",
  " ten",
  "-eleven",
  "+ELEVEN",
  " twelve",
  "",
].join("\n");

describe("diff patch assembly", () => {
  test("captures the file header, full raw section, and each hunk", () => {
    const [file] = parser(TWO_HUNKS);
    assert.ok(file !== undefined);
    assert.strictEqual(file.hunks.length, 2);
    assert.strictEqual(
      file.header,
      [
        "diff --git a/a.txt b/a.txt",
        "index 1111111..2222222 100644",
        "--- a/a.txt",
        "+++ b/a.txt",
        "",
      ].join("\n"),
    );
    assert.strictEqual(file.raw, TWO_HUNKS);
    assert.ok(file.hunks[1]?.raw.startsWith("@@ -10,3 +10,3 @@\n"));
  });

  test("builds a patch from only the selected hunks, without the index line", () => {
    const [file] = parser(TWO_HUNKS);
    assert.ok(file !== undefined);

    const patch = buildPatch(file, [file.hunks[1]!]);
    assert.ok(!patch.includes("index "));
    assert.ok(patch.includes("@@ -10,3 +10,3 @@"));
    assert.ok(!patch.includes("@@ -1,3 +1,3 @@"));
    assert.ok(patch.startsWith("diff --git a/a.txt b/a.txt\n"));
  });

  test("keeps the blank line that terminates a GIT binary patch", () => {
    const raw = [
      "diff --git a/icon.png b/icon.png",
      "new file mode 100644",
      "index 0000000..1111111",
      "GIT binary patch",
      "literal 1",
      "Lc000000",
      "literal 0",
      "HcmV?d00001",
      "",
    ].join("\n");

    const [file] = parser(`${raw}\n`);
    assert.ok(file !== undefined);
    assert.strictEqual(file.isBinary, true);
    assert.ok(file.raw.endsWith("\n\n"), "binary patch needs its blank terminator");
    assert.strictEqual(buildPatch(file, file.hunks), file.raw);
  });

  test("keeps the binary terminator when another file follows", () => {
    const raw = [
      "diff --git a/icon.png b/icon.png",
      "new file mode 100644",
      "index 0000000..1111111",
      "GIT binary patch",
      "literal 1",
      "Lc000000",
      "literal 0",
      "HcmV?d00001",
      "",
      "diff --git a/a.txt b/a.txt",
      "index 1111111..2222222 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");

    const files = parser(raw);
    assert.strictEqual(files.length, 2);
    assert.ok(files[0]?.raw.endsWith("\n\n"));
    assert.ok(!files[0]?.raw.includes("diff --git a/a.txt"));
  });

  test("preserves CRLF and no-newline markers in raw patches", () => {
    const crlf = [
      "diff --git a/a.txt b/a.txt",
      "index 1111111..2222222 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "\\ No newline at end of file",
      "",
    ].join("\r\n");

    const [file] = parser(crlf);
    assert.ok(file !== undefined);
    assert.ok(file.raw.includes("\r\n"), "CRLF should survive");
    assert.ok(file.hunks[0]?.raw.includes("\\ No newline at end of file"));
    assert.ok(buildPatch(file, file.hunks).includes("\r\n"));
  });

  test("stripIndexLine keeps the rest of the header intact", () => {
    assert.strictEqual(
      stripIndexLine("diff --git a/x b/x\nindex 1234567..89abcde 100644\n--- a/x\n"),
      "diff --git a/x b/x\n--- a/x\n",
    );
  });
});
