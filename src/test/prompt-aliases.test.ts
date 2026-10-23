import * as assert from "assert";
import { describe, test } from "vitest";
import { parser } from "../domain/diff";
import { toModelIds, translateProposal, unitAliases } from "../features/compose/aliases";
import {
  buildMessages,
  describePrompt,
  jsonInstruction,
  PromptTooLargeError,
} from "../features/compose/prompt";
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

  test("the prompt's output format names the key the plan schema expects", () => {
    // The prompt and the schema must agree on the key: a reply that says
    // "units" where the schema says "hunkIds" fails validation, and the
    // plan is thrown away for a spelling.
    const prompt = buildMessages("", units)[0]?.content ?? "";

    assert.match(prompt, /"hunkIds": \["u1", "u3"\]/);
    assert.doesNotMatch(prompt, /"units":/);
    assert.match(jsonInstruction(""), /"hunkIds":\["u1","u2"\]/);
  });

  test("the prompt asks for a body when the change shows a reason", () => {
    // Without this, the model writes a subject line and nothing else:
    // a rewrite of the prompt dropped the body example and the bodies
    // stopped coming.
    const prompt = buildMessages("", units)[0]?.content ?? "";

    assert.match(prompt, /body is expected/i);
    assert.match(prompt, /blank line/);
  });

  /** A change set whose diff genuinely exceeded the old 128 KiB budget. */
  const oversized = () => {
    const paths = Array.from({ length: 8 }, (_, index) => `big${index}.txt`);
    // Give each unit a body far larger than the old 32 KiB per-unit cap,
    // so the old allocator spent the budget on the first units and handed
    // 0 to the rest.
    return buildUnits(changeSet(paths)).units.map((unit, index) => ({
      ...unit,
      text: `${unit.text}\n${"x".repeat(48 * 1024)}u${index}`,
    }));
  };

  test("the fixture really would have overflowed the old two-tier budget", () => {
    const units = oversized();
    const total = units.reduce((sum, unit) => sum + unit.text.length, 0);
    assert.ok(total > 128 * 1024, `${total} should exceed the old total cap`);
  });

  test("a unit is never emitted with an empty body", () => {
    // The old budget handed out what was left to the first oversized unit
    // and then 0 to every unit after it, producing an empty ```diff block.
    // A model cannot place what it cannot read, and the plan came back
    // with the tail unassigned.
    const units = oversized();
    const prompt = buildMessages("", units, { maxDiffChars: 10_000_000 })[1]?.content ?? "";

    assert.doesNotMatch(prompt, /```diff\n\n```/);
    assert.doesNotMatch(prompt, /truncated/);
    const headings = prompt.match(/^### /gm) ?? [];
    assert.strictEqual(headings.length, units.length, "every unit keeps its heading");
  });

  test("an oversized selection fails loudly instead of being truncated", () => {
    assert.throws(
      () => buildMessages("", oversized()),
      (error: unknown) => {
        assert.ok(error instanceof PromptTooLargeError);
        assert.match(error.message, /too large/);
        assert.match(error.message, /Select fewer files/);
        return true;
      },
    );
  });

  test("the prompt report names the unit, file, and token counts", () => {
    const report = describePrompt(buildMessages("", units), units);
    assert.match(report, /unit\(s\)/);
    assert.match(report, /file\(s\)/);
    assert.match(report, /token/);
  });
});
