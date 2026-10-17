import * as assert from "assert";
import { describe, test } from "vitest";
import { consumeStream, type StreamChunkLike } from "../infrastructure/llm-stream";
import { LLMCancelledError, LLMTimeoutError, toLLMGenerateError } from "../services/llm";

const streamOf = (chunks: ReadonlyArray<StreamChunkLike>): (() => AsyncIterable<StreamChunkLike>) =>
  async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  };

describe("consumeStream", () => {
  test("takes the validated object from structured-output.complete", async () => {
    const progress: Array<{ receivedChars: number }> = [];
    let touched = 0;

    const result = await consumeStream({
      open: streamOf([
        { type: "TEXT_MESSAGE_CONTENT", delta: '{"commits":' },
        { type: "TEXT_MESSAGE_CONTENT", delta: '[{"message":"feat: x","hunkIds":["a"]}]}' },
        {
          type: "CUSTOM",
          name: "structured-output.complete",
          value: {
            object: { commits: [{ message: "feat: x", hunkIds: ["a"] }] },
            raw: '{"commits":[{"message":"feat: x","hunkIds":["a"]}]}',
          },
        },
      ]),
      structured: true,
      touch: () => {
        touched += 1;
      },
      onProgress: (event) => progress.push(event),
    });

    assert.deepStrictEqual(result.value, {
      commits: [{ message: "feat: x", hunkIds: ["a"] }],
    });
    assert.strictEqual(result.text, '{"commits":[{"message":"feat: x","hunkIds":["a"]}]}');
    assert.strictEqual(touched, 3);
    assert.strictEqual(progress.at(-1)?.receivedChars, result.text.length);
  });

  test("concatenates text deltas when no schema is requested", async () => {
    const result = await consumeStream({
      open: streamOf([
        { type: "TEXT_MESSAGE_CONTENT", delta: "hello " },
        { type: "TEXT_MESSAGE_CHUNK", delta: "world" },
      ]),
      structured: false,
      touch: () => {},
    });

    assert.deepStrictEqual(result, { text: "hello world" });
  });

  test("fails when a structured run ends without its terminal event", async () => {
    await assert.rejects(
      () =>
        consumeStream({
          open: streamOf([{ type: "TEXT_MESSAGE_CONTENT", delta: '{"commits":[]' }]),
          structured: true,
          touch: () => {},
        }),
      /ended before producing structured output/,
    );
  });

  test("surfaces RUN_ERROR as a failure", async () => {
    await assert.rejects(
      () =>
        consumeStream({
          open: streamOf([{ type: "RUN_ERROR", message: "upstream exploded" }]),
          structured: false,
          touch: () => {},
        }),
      /upstream exploded/,
    );
  });

  test("keeps streaming when a progress observer throws", async () => {
    const result = await consumeStream({
      open: streamOf([{ type: "TEXT_MESSAGE_CONTENT", delta: "ok" }]),
      structured: false,
      touch: () => {},
      onProgress: () => {
        throw new Error("observer bug");
      },
    });

    assert.strictEqual(result.text, "ok");
  });
});

describe("toLLMGenerateError", () => {
  test("maps an idle timeout to an actionable timeout message", () => {
    const error = toLLMGenerateError(
      new LLMTimeoutError({ provider: "openai-compatible", model: "qwen", timeoutMs: 120_000 }),
    );

    assert.strictEqual(error.reason, "timeout");
    assert.match(error.message, /2m/);
    assert.match(error.message, /patchwork\.llm\.idleTimeoutSeconds/);
  });

  test("formats multi-minute idle timeouts", () => {
    const error = toLLMGenerateError(
      new LLMTimeoutError({ provider: "anthropic", model: "claude", timeoutMs: 300_000 }),
    );

    assert.match(error.message, /5m/);
  });

  test("maps cancellation to a short message", () => {
    const error = toLLMGenerateError(new LLMCancelledError({ provider: "openai", model: "gpt" }));

    assert.strictEqual(error.reason, "cancelled");
    assert.strictEqual(error.message, "Generation cancelled.");
  });
});
