import * as assert from "assert";
import { describe, test } from "vitest";
import { extractProposal, inspectProposal } from "../features/llm-compose";

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

describe("inspectProposal", () => {
  test("accepts `units` as an alias for `hunkIds`", () => {
    // The model answers in the prompt's vocabulary; a key name is not a
    // reason to throw the whole plan away.
    const parsed = extractProposal({
      commits: [{ message: "feat(x): y", units: ["u1", "u2"] }],
    });

    assert.ok(parsed);
    assert.deepStrictEqual(parsed.commits[0]?.hunkIds, ["u1", "u2"]);
  });

  test("accepts a text reply that uses `units`", () => {
    const text = JSON.stringify({
      commits: [{ message: "feat(x): y", units: ["u1"] }],
    });

    const parsed = extractProposal(text);
    assert.ok(parsed);
    assert.deepStrictEqual(parsed.commits[0]?.hunkIds, ["u1"]);
  });

  test("tells unparseable text apart from a well-formed reply with the wrong shape", () => {
    const notJson = inspectProposal("I'd rather not guess at the partitioning.");
    assert.strictEqual(notJson.ok, false);
    assert.strictEqual(notJson.ok === false && notJson.rejection, "not-json");

    const wrongShape = inspectProposal(JSON.stringify({ commits: [{ message: "chore: x" }] }));
    assert.strictEqual(wrongShape.ok, false);
    assert.strictEqual(wrongShape.ok === false && wrongShape.rejection, "shape");
  });

  test("a valid plan is reported as such", () => {
    const inspection = inspectProposal(valid);
    assert.strictEqual(inspection.ok, true);
    assert.deepStrictEqual(inspection.ok === true && inspection.proposal, valid);
  });

  test("recovers a body written with real newlines instead of escapes", () => {
    // A body needs a blank line, and models often write that literally.
    // One stray newline should not cost the whole plan.
    const text = [
      '{"commits":[{"message":"fix(commit): keep the index in sync',
      "",
      'Applying the remaining hunks failed when a file had already been staged.",',
      '"hunkIds":["u1"]}]}',
    ].join("\n");

    const parsed = extractProposal(text);
    assert.ok(parsed);
    assert.match(parsed.commits[0]?.message ?? "", /fix\(commit\)/);
    assert.match(parsed.commits[0]?.message ?? "", /already been staged/);
    assert.deepStrictEqual(parsed.commits[0]?.hunkIds, ["u1"]);
  });
});
