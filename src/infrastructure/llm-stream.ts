import type { LLMProgress } from "../services/llm";

/**
 * The subset of `@tanstack/ai`'s stream chunk union we consume.
 *
 * Typing the whole union here would force a different cast at every call
 * site (schema vs. no schema produce different stream types), and the
 * fields we need are identical in both.
 */
export interface StreamChunkLike {
  readonly type: string;
  readonly delta?: unknown;
  readonly name?: string;
  readonly value?: unknown;
  readonly message?: string;
}

export interface ConsumeStreamOptions {
  /** Starts the provider request and returns its chunk stream. */
  readonly open: () => AsyncIterable<StreamChunkLike>;
  /** Whether a terminal `structured-output.complete` event is required. */
  readonly structured: boolean;
  /** Resets the caller's idle timer; called for every chunk. */
  readonly touch: () => void;
  readonly onProgress?: (progress: LLMProgress) => void;
}

export interface ConsumeStreamResult {
  readonly text: string;
  readonly value?: unknown;
}

const textDelta = (chunk: StreamChunkLike): string =>
  typeof chunk.delta === "string" ? chunk.delta : "";

/**
 * Drain a streaming run.
 *
 * With a schema, `@tanstack/ai` streams partial JSON and emits the
 * validated object in a terminal `structured-output.complete` event — the
 * partial deltas are never parsed here. Without a schema, text deltas are
 * concatenated into the final reply.
 */
export const consumeStream = async (
  options: ConsumeStreamOptions,
): Promise<ConsumeStreamResult> => {
  let receivedChars = 0;
  let text = "";
  let value: unknown;
  let structuredComplete = false;

  const report = (): void => {
    if (options.onProgress === undefined) {
      return;
    }
    try {
      options.onProgress({ receivedChars });
    } catch {
      // Progress is cosmetic; a broken observer must not abort the run.
    }
  };

  report();

  for await (const chunk of options.open()) {
    options.touch();

    const delta = textDelta(chunk);
    if (delta.length > 0) {
      receivedChars += delta.length;
      // `TEXT_MESSAGE_CONTENT` is the documented delta event;
      // `TEXT_MESSAGE_CHUNK` is the AG-UI 1.0 shorthand some adapters use.
      if (
        !options.structured &&
        (chunk.type === "TEXT_MESSAGE_CONTENT" || chunk.type === "TEXT_MESSAGE_CHUNK")
      ) {
        text += delta;
      }
      report();
    }

    if (chunk.type === "CUSTOM" && chunk.name === "structured-output.complete") {
      const payload = chunk.value as
        | { readonly object?: unknown; readonly raw?: string }
        | undefined;
      value = payload?.object;
      text = payload?.raw ?? text;
      receivedChars = Math.max(receivedChars, text.length);
      structuredComplete = true;
      report();
      continue;
    }

    if (chunk.type === "RUN_ERROR") {
      throw new Error(chunk.message ?? "The model stream ended with an error");
    }
  }

  if (options.structured && !structuredComplete) {
    throw new Error("The model stream ended before producing structured output");
  }

  return options.structured ? { text, value } : { text };
};
