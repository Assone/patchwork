import * as assert from "assert";
import { describe, test } from "vitest";
import { extractProposal } from "../features/llm-compose";

const valid = {
  commits: [
    {
      message: "feat(settings): add model picker",
      hunkIds: ["u1_aaaa", "u1_bbbb"],
    },
  ],
};

describe("extractProposal", () => {
  test("passes through an object already matching the schema", () => {
    assert.deepStrictEqual(extractProposal(valid), valid);
  });

  test("wraps a bare array, which is what a schema-ignoring model emits", () => {
    const parsed = extractProposal(valid.commits);
    assert.ok(parsed);
    assert.strictEqual(parsed.commits.length, 1);
    assert.deepStrictEqual(parsed.commits[0]?.hunkIds, ["u1_aaaa", "u1_bbbb"]);
  });

  test("parses JSON embedded in a fenced code block", () => {
    const text = ["Here is the plan:", "", "```json", JSON.stringify(valid), "```", ""].join("\n");
    assert.deepStrictEqual(extractProposal(text), valid);
  });

  test("parses JSON surrounded by prose", () => {
    const text = `Sure! Based on the units:\n${JSON.stringify(valid)}\nLet me know if…`;
    assert.deepStrictEqual(extractProposal(text), valid);
  });

  test("recovers a fenced bare array too", () => {
    const text = ["```", JSON.stringify(valid.commits), "```"].join("\n");
    const parsed = extractProposal(text);
    assert.ok(parsed);
    assert.strictEqual(parsed.commits.length, 1);
  });

  test("returns null for prose with no JSON at all", () => {
    assert.strictEqual(extractProposal("I'd rather not guess at the partitioning."), null);
    assert.strictEqual(extractProposal(""), null);
    assert.strictEqual(extractProposal(undefined), null);
  });

  test("refuses to coerce a structurally wrong payload", () => {
    assert.strictEqual(extractProposal({ commits: [{ message: "chore: x" }] }), null);
  });

  test("refuses an empty commit list", () => {
    assert.strictEqual(extractProposal({ commits: [] }), null);
  });
});
