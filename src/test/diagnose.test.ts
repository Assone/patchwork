import * as assert from "assert";
import { describe, test } from "vitest";
import { parser } from "../domain/diff";
import { describeDiagnosis, diagnoseProposal } from "../features/compose/diagnose";
import { buildUnits } from "../features/compose/units";
import type { ChangeSet } from "../services/git";

const diffFor = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,3 +1,3 @@",
    " one",
    "-two",
    "+TWO",
    " three",
    "",
  ].join("\n");

/** `count` single-hunk text files plus a lock file, like a real selection. */
const fixture = (count: number) => {
  const paths = Array.from({ length: count }, (_, index) => `f${index}.txt`);
  const changeSet: ChangeSet = {
    headSha: "0".repeat(40),
    changedFiles: [...paths, "pnpm-lock.yaml"].map((path) => ({
      path,
      type: "modified" as const,
      staged: true,
      unstaged: false,
    })),
    files: parser([...paths, "pnpm-lock.yaml"].map(diffFor).join("")),
  };
  return buildUnits(changeSet).units;
};

const ids = (units: ReturnType<typeof fixture>, from: number, to: number) =>
  units.slice(from, to).map((unit) => unit.id);

const proposal = (hunkIds: readonly string[][]) => ({
  commits: hunkIds.map((ids, index) => ({ message: `feat: commit ${index}`, hunkIds: ids })),
});

describe("plan diagnosis", () => {
  const units = fixture(74);
  const context = units.filter((unit) => !unit.isLockFile);

  test("counts how much of the list a truncated reply covered", () => {
    // 74 context units; the model placed the first 66 and never saw the rest.
    const diagnosis = diagnoseProposal({
      proposal: proposal([ids(units, 0, 44), ids(units, 44, 66)]),
      units,
      replyChars: 900,
    });

    assert.strictEqual(diagnosis.expected, 74);
    assert.strictEqual(diagnosis.placed, 66);
    assert.strictEqual(diagnosis.missing.length, 8);
    assert.strictEqual(diagnosis.commits, 2);
    assert.strictEqual(diagnosis.idsReferenced, 66);
    assert.deepStrictEqual(diagnosis.unknown, []);
    assert.deepStrictEqual(diagnosis.duplicated, []);
  });

  test("flags ids that are not aliases, which a truncation would not produce", () => {
    const diagnosis = diagnoseProposal({
      proposal: proposal([[context[0]!.id, "u999", "u1_abc"]]),
      rawIds: ["u1", "u999", "u1_abc"],
      units,
      replyChars: 40,
    });

    assert.deepStrictEqual(diagnosis.unknown, ["u999", "u1_abc"]);
    assert.strictEqual(diagnosis.placed, 1);
  });

  test("flags duplicated ids", () => {
    const diagnosis = diagnoseProposal({
      proposal: proposal([[context[0]!.id], [context[0]!.id]]),
      units,
      replyChars: 40,
    });

    assert.deepStrictEqual(diagnosis.duplicated, [context[0]!.id]);
  });

  test("flags a lock id the model was told not to use", () => {
    const lock = units.find((unit) => unit.isLockFile);
    assert.ok(lock !== undefined);

    const diagnosis = diagnoseProposal({
      proposal: proposal([[context[0]!.id, lock.id]]),
      units,
      replyChars: 40,
    });

    assert.deepStrictEqual(diagnosis.forbidden, [lock.id]);
  });

  test("counts commits the model left empty", () => {
    const diagnosis = diagnoseProposal({
      proposal: proposal([[context[0]!.id], [], []]),
      units,
      replyChars: 40,
    });

    assert.strictEqual(diagnosis.emptyCommits, 2);
  });

  test("the one-line summary carries every count needed to tell the cases apart", () => {
    const line = describeDiagnosis(
      diagnoseProposal({ proposal: proposal([ids(units, 0, 66)]), units, replyChars: 1234 }),
    );

    assert.match(line, /reply 1234 chars/);
    assert.match(line, /placed 66\/74/);
    assert.match(line, /missing=8 \(first u/);
    assert.match(line, /unknown=none/);
    assert.match(line, /duplicated=none/);
  });
});
