import * as assert from "assert";
import { describe, test } from "vitest";
import { groupForLockFile, isLockFile, selectLockFiles } from "../domain/lock-files";

describe("lock files", () => {
  test("pairs a lock file with the manifest in its own directory", () => {
    // A monorepo can hold `packages/a/package-lock.json`; pairing it
    // with the root `package.json` would attach the wrong manifest (and
    // make `reconcileLockFiles` fall back to the first commit).
    assert.strictEqual(groupForLockFile("packages/a/package-lock.json"), "packages/a/package.json");
    assert.strictEqual(groupForLockFile("pnpm-lock.yaml"), "pnpm-workspace.yaml");
    assert.strictEqual(groupForLockFile("nested/go.sum"), "nested/go.mod");
  });

  test("matches the basename, not a path segment", () => {
    assert.strictEqual(isLockFile("nested/go.sum"), true);
    assert.strictEqual(isLockFile("src/lock-files.ts"), false);
  });

  test("reports no manifest for an unknown lock file", () => {
    assert.strictEqual(groupForLockFile("README.md"), undefined);
  });

  test("selectLockFiles preserves input order", () => {
    assert.deepStrictEqual(selectLockFiles(["a.ts", "go.sum", "b.ts", "Cargo.lock"]), [
      "go.sum",
      "Cargo.lock",
    ]);
  });
});
