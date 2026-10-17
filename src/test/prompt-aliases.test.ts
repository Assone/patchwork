import * as assert from "assert";
import { describe, test } from "vitest";
import { parser } from "../domain/diff";
import { toModelIds, translateProposal, unitAliases } from "../features/compose/aliases";
import { buildMessages, jsonInstruction } from "../features/compose/prompt";
import { buildUnits } from "../features/compose/units";
import type { ChangedFile } from "../rpc/git-types";
import type { ChangeSet } from "../services/git";

const modified = (path: string): ChangedFile => ({
  path,
  type: "modified",
  staged: true,
  unstaged: false,
});

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
    "@@ -10,3 +10,3 @@",
    " ten",
    "-eleven",
    "+ELEVEN",
    " twelve",
    "",
  ].join("\n");

const changeSet = (paths: readonly string[]): ChangeSet => {
  const diff = paths.map(diffFor).join("");
  return {
    headSha: "0".repeat(40),
    changedFiles: paths.map(modified),
    files: parser(diff),
  };
};

describe("model-facing unit aliases", () => {
  const units = buildUnits(changeSet(["a.txt", "pnpm-lock.yaml"])).units;

  test("the prompt shows short aliases, not content hashes", () => {
    const messages = buildMessages("", units);
    const prompt = messages.map((message) => message.content).join("\n");

    assert.match(prompt, /### u1 — a\.txt/);
    assert.match(prompt, /### u2 — a\.txt/);
    for (const unit of units) {
      if (!unit.isLockFile) {
        assert.ok(!prompt.includes(unit.id), `prompt leaked unit id ${unit.id}`);
      }
    }
  });

  test("aliases map back to the content-addressed ids and skip lock units", () => {
    const aliases = unitAliases(units);
    const context = units.filter((unit) => !unit.isLockFile);

    assert.strictEqual(aliases.size, context.length);
    assert.strictEqual(aliases.get("u1"), context[0]?.id);
    assert.strictEqual(aliases.get("u2"), context[1]?.id);
    assert.ok(![...aliases.values()].some((id) => id === units.find((u) => u.isLockFile)?.id));
  });

  test("translates the model reply back to real ids", () => {
    const translated = translateProposal(
      { commits: [{ message: "feat: x", hunkIds: ["u1", "u9"] }] },
      units,
    );
    const context = units.filter((unit) => !unit.isLockFile);

    assert.deepStrictEqual(translated.commits[0]?.hunkIds, [context[0]?.id, "u9"]);
  });

  test("validation feedback speaks aliases so a retry can act on it", () => {
    const context = units.filter((unit) => !unit.isLockFile);
    const message = `unknown hunk ids: ${context[1]?.id}; hunks not assigned: ${context[0]?.id}`;

    assert.strictEqual(toModelIds(message, units), "unknown hunk ids: u2; hunks not assigned: u1");
  });

  test("the JSON instruction does not claim a previous reply exists on the first attempt", () => {
    assert.doesNotMatch(jsonInstruction(""), /previous reply/);
    assert.match(jsonInstruction("hunks not assigned: u1"), /previous reply was invalid/);
  });
});
