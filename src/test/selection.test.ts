import * as assert from "assert";
import { describe, test } from "vitest";
import type { ChangedFile } from "../rpc/git-types";
import { stagedPaths } from "../webview/domain/selection";

const file = (path: string, staged: boolean, unstaged: boolean): ChangedFile => ({
  path,
  type: "modified",
  staged,
  unstaged,
});

describe("default selection", () => {
  test("selects files with staged changes, including partially staged ones", () => {
    assert.deepStrictEqual(
      stagedPaths([
        file("staged.ts", true, false),
        file("partial.ts", true, true),
        file("unstaged.ts", false, true),
      ]),
      ["staged.ts", "partial.ts"],
    );
  });

  test("selects nothing when only unstaged or untracked work exists", () => {
    assert.deepStrictEqual(
      stagedPaths([file("unstaged.ts", false, true), file("new.ts", false, false)]),
      [],
    );
  });

  test("leaves conflicted files out of the default selection", () => {
    assert.deepStrictEqual(
      stagedPaths([
        { path: "conflicted.ts", type: "conflicted", staged: true, unstaged: true },
        file("staged.ts", true, false),
      ]),
      ["staged.ts"],
    );
  });
});
