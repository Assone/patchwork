import * as assert from "assert";
import { describe, test } from "vitest";
import { validatePlan } from "../domain/commit-plan";
import { parser } from "../domain/diff";
import { buildPlan } from "../features/compose/plan";
import { buildUnits, contextUnits } from "../features/compose/units";
import type { ChangeSet } from "../services/git";

const diff = [
  "diff --git a/a.txt b/a.txt",
  "index 1111111..2222222 100644",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
  "index 3333333..4444444 100644",
  "--- a/pnpm-lock.yaml",
  "+++ b/pnpm-lock.yaml",
  "@@ -1 +1 @@",
  "-lock-old",
  "+lock-new",
  "",
].join("\n");

const changeSet: ChangeSet = {
  headSha: "0".repeat(40),
  changedFiles: [
    { path: "a.txt", type: "modified", staged: true, unstaged: false },
    { path: "pnpm-lock.yaml", type: "modified", staged: true, unstaged: false },
  ],
  files: parser(diff),
};

describe("commit plan validation", () => {
  test("accepts an exact partition", () => {
    const result = validatePlan(
      { commits: [{ message: "feat: x", hunkIds: ["a", "b"] }] },
      new Set(["a", "b"]),
    );
    assert.strictEqual(result.valid, true);
  });

  test("rejects missing, duplicate, and unknown ids", () => {
    assert.strictEqual(
      validatePlan({ commits: [{ message: "feat: x", hunkIds: ["a"] }] }, new Set(["a", "b"]))
        .valid,
      false,
    );
    assert.strictEqual(
      validatePlan({ commits: [{ message: "feat: x", hunkIds: ["a", "a"] }] }, new Set(["a"]))
        .valid,
      false,
    );
    assert.strictEqual(
      validatePlan({ commits: [{ message: "feat: x", hunkIds: ["a", "z"] }] }, new Set(["a"]))
        .valid,
      false,
    );
  });

  test("rejects empty messages and empty commits", () => {
    assert.strictEqual(
      validatePlan({ commits: [{ message: "  ", hunkIds: ["a"] }] }, new Set(["a"])).valid,
      false,
    );
    assert.strictEqual(
      validatePlan({ commits: [{ message: "feat: x", hunkIds: [] }] }, new Set<string>()).valid,
      false,
    );
  });

  test("accepts any non-empty message so a custom prompt can override the default", () => {
    assert.strictEqual(
      validatePlan(
        { commits: [{ message: "custom edited message", hunkIds: ["a"] }] },
        new Set(["a"]),
      ).valid,
      true,
    );
    assert.strictEqual(
      validatePlan({ commits: [{ message: "  ", hunkIds: ["a"] }] }, new Set(["a"])).valid,
      false,
    );
  });

  test("pins a lock unit to the commit holding its manifest", () => {
    const built = buildUnits(changeSet);
    const [manifest] = contextUnits(built.units);
    const lock = built.units.find((unit) => unit.isLockFile);
    assert.ok(manifest !== undefined);
    assert.ok(lock !== undefined);

    const result = buildPlan(
      { commits: [{ message: "chore: update dependency", hunkIds: [manifest.id] }] },
      built.units,
    );
    assert.strictEqual(result.validation.valid, true);
    assert.deepStrictEqual(result.plan.commits[0]?.hunkIds, [manifest.id, lock.id]);
  });

  test("the model cannot place a lock unit itself", () => {
    const built = buildUnits(changeSet);
    const lock = built.units.find((unit) => unit.isLockFile);
    assert.ok(lock !== undefined);

    const result = buildPlan(
      { commits: [{ message: "chore: lock", hunkIds: [lock.id] }] },
      built.units,
    );
    assert.strictEqual(result.validation.valid, false);
  });
});
