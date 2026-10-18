import * as assert from "assert";
import { describe, test } from "vitest";
import {
  consumeTextStream,
  describeVscodeLmModels,
  selectVscodeLmModel,
  toVscodeLmMessages,
} from "../services/vscode-lm";
import { LLMContextLimitError, toLLMGenerateError } from "../services/llm";

const model = (id: string, family: string, name: string) => ({ id, family, name });

const models = [
  model("copilot/gpt-4o", "gpt-4o", "GPT-4o"),
  model("copilot/claude-sonnet-4", "claude-sonnet-4", "Claude Sonnet 4"),
];

describe("toVscodeLmMessages", () => {
  test("folds the system prompt into the first user turn", () => {
    const messages = toVscodeLmMessages([
      { role: "system", content: "You split commits." },
      { role: "user", content: "here is the diff" },
    ]);

    assert.deepStrictEqual(messages, [
      { role: "user", content: "You split commits.\n\nhere is the diff" },
    ]);
  });

  test("joins every system prompt in order", () => {
    const messages = toVscodeLmMessages([
      { role: "system", content: "one" },
      { role: "system", content: "two" },
      { role: "user", content: "three" },
      { role: "assistant", content: "four" },
    ]);

    assert.deepStrictEqual(messages, [
      { role: "user", content: "one\n\ntwo\n\nthree" },
      { role: "assistant", content: "four" },
    ]);
  });

  test("leaves a conversation without system prompts untouched", () => {
    const input = [
      { role: "user" as const, content: "a" },
      { role: "assistant" as const, content: "b" },
    ];

    assert.deepStrictEqual(toVscodeLmMessages(input), input);
  });

  test("produces a user turn when only a system prompt is present", () => {
    assert.deepStrictEqual(toVscodeLmMessages([{ role: "system", content: "rules" }]), [
      { role: "user", content: "rules" },
    ]);
  });

  test("ignores empty system prompts", () => {
    const messages = toVscodeLmMessages([
      { role: "system", content: "" },
      { role: "user", content: "hi" },
    ]);

    assert.deepStrictEqual(messages, [{ role: "user", content: "hi" }]);
  });

  test("keeps an assistant-first conversation behind a user preamble", () => {
    const messages = toVscodeLmMessages([
      { role: "system", content: "rules" },
      { role: "assistant", content: "earlier" },
    ]);

    assert.deepStrictEqual(messages, [
      { role: "user", content: "rules" },
      { role: "assistant", content: "earlier" },
    ]);
  });
});

describe("selectVscodeLmModel", () => {
  test("picks the first model for an empty selection", () => {
    assert.strictEqual(selectVscodeLmModel("", models)?.id, "copilot/gpt-4o");
    assert.strictEqual(selectVscodeLmModel("   ", models)?.id, "copilot/gpt-4o");
  });

  test("matches the stored id", () => {
    assert.strictEqual(
      selectVscodeLmModel("copilot/claude-sonnet-4", models)?.name,
      "Claude Sonnet 4",
    );
  });

  test("falls back to family then name, case-insensitively", () => {
    assert.strictEqual(selectVscodeLmModel("GPT-4O", models)?.id, "copilot/gpt-4o");
    assert.strictEqual(
      selectVscodeLmModel("claude sonnet 4", models)?.id,
      "copilot/claude-sonnet-4",
    );
  });

  test("returns undefined for a model that no longer exists", () => {
    assert.strictEqual(selectVscodeLmModel("gone", models), undefined);
  });

  test("returns undefined when VS Code exposes no models", () => {
    assert.strictEqual(selectVscodeLmModel("", []), undefined);
  });
});

describe("describeVscodeLmModels", () => {
  test("lists names and families", () => {
    assert.strictEqual(
      describeVscodeLmModels(models),
      "GPT-4o (gpt-4o), Claude Sonnet 4 (claude-sonnet-4)",
    );
  });

  test("says none when the list is empty", () => {
    assert.strictEqual(describeVscodeLmModels([]), "none");
  });
});

describe("consumeTextStream", () => {
  const streamOf = (chunks: readonly string[]): (() => AsyncIterable<string>) =>
    async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    };

  test("concatenates deltas and reports progress", async () => {
    const progress: number[] = [];
    let touched = 0;

    const text = await consumeTextStream({
      open: streamOf(['{"commits":', "[]}"]),
      touch: () => {
        touched += 1;
      },
      onProgress: (event) => progress.push(event.receivedChars),
    });

    assert.strictEqual(text, '{"commits":[]}');
    assert.strictEqual(touched, 2);
    assert.deepStrictEqual(progress, [0, 11, 14]);
  });

  test("keeps streaming when a progress observer throws", async () => {
    const text = await consumeTextStream({
      open: streamOf(["ok"]),
      touch: () => {},
      onProgress: () => {
        throw new Error("observer bug");
      },
    });

    assert.strictEqual(text, "ok");
  });

  test("propagates stream failures", async () => {
    await assert.rejects(
      () =>
        consumeTextStream({
          open: async function* () {
            yield "partial";
            throw new Error("upstream exploded");
          },
          touch: () => {},
        }),
      /upstream exploded/,
    );
  });
});

describe("LLMContextLimitError", () => {
  test("maps to a message that names the model and the token counts", () => {
    const error = toLLMGenerateError(
      new LLMContextLimitError({
        provider: "vscode-lm",
        model: "GPT-4o mini",
        tokens: 40_000,
        limit: 8_000,
      }),
    );

    assert.match(error.message, /40,000 tokens/);
    assert.match(error.message, /GPT-4o mini/);
    assert.match(error.message, /8,000 input tokens/);
    assert.match(error.message, /fewer files/);
  });
});
