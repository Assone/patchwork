import { Context, Data, Effect } from "effect";
import type { z } from "zod";
import type { CompatibleApi, LLMProvider } from "../rpc/config-types";

export type { CompatibleApi, LLMProvider } from "../rpc/config-types";

export type LLMModelSpec =
  | {
      /** OpenAI's own endpoint (Responses API). */
      readonly provider: "openai";
      readonly model: string;
    }
  | {
      readonly provider: "anthropic";
      readonly model: string;
    }
  | {
      readonly provider: "openai-compatible";
      readonly model: string;
      readonly baseURL: string;
      readonly api?: CompatibleApi;
    };

export class LLMAuthenticationError extends Data.TaggedError("LLMAuthenticationError")<{
  readonly provider: LLMProvider;
  readonly cause: unknown;
}> {}

export class LLMProviderError extends Data.TaggedError("LLMProviderError")<{
  readonly provider: LLMProvider;
  readonly model: string;
  readonly cause: unknown;
}> {}

/**
 * The provider accepted the request but stopped producing data for too
 * long. This is an *idle* timeout, not a wall-clock one: a streaming
 * response resets the timer on every chunk, so a slow but healthy
 * generation is never cut off mid-way.
 */
export class LLMTimeoutError extends Data.TaggedError("LLMTimeoutError")<{
  readonly provider: LLMProvider;
  readonly model: string;
  readonly timeoutMs: number;
}> {}

/** The caller dropped the request (panel closed, retry, explicit cancel). */
export class LLMCancelledError extends Data.TaggedError("LLMCancelledError")<{
  readonly provider: LLMProvider;
  readonly model: string;
}> {}

export class LLMUnknownProviderError extends Data.TaggedError("LLMUnknownProviderError")<{
  readonly provider: string;
}> {}

export class LLMGenerateError extends Data.TaggedError("LLMGenerateError")<{
  readonly reason: "auth" | "provider" | "timeout" | "cancelled" | "unknown";
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Incremental activity reported while a provider stream is arriving. */
export interface LLMProgress {
  /** Characters of model output (text, JSON, or tool args) seen so far. */
  readonly receivedChars: number;
}

export interface LLMMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LLMConversationMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export type LLMSchema = z.ZodType;

export type GenerateResult<TSchema extends LLMSchema | undefined> = TSchema extends LLMSchema
  ? { readonly text: string; readonly value: z.infer<TSchema> }
  : { readonly text: string };

export interface GenerateOptions<TSchema extends LLMSchema | undefined = undefined> {
  readonly model: LLMModelSpec;
  readonly messages: ReadonlyArray<LLMMessage>;
  readonly schema?: TSchema;
  readonly temperature?: number;
  readonly abortSignal?: AbortSignal;
  /**
   * Called with throttling left to the caller as chunks arrive. Must not
   * throw: progress is best-effort and never fails a generation.
   */
  readonly onProgress?: (progress: LLMProgress) => void;
}

export interface LLMServiceApi {
  readonly generate: <TSchema extends LLMSchema | undefined = undefined>(
    options: GenerateOptions<TSchema>,
  ) => Effect.Effect<
    GenerateResult<TSchema>,
    | LLMAuthenticationError
    | LLMProviderError
    | LLMTimeoutError
    | LLMCancelledError
    | LLMUnknownProviderError
  >;

  /**
   * Whether `generate({ schema })` streams the structured payload.
   *
   * When an adapter has no `structuredOutputStream`, `@tanstack/ai`
   * silently falls back to a *non-streaming* call and emits the whole
   * reply at once. Callers that want incremental progress should skip
   * the schema and ask for streamed text JSON instead.
   */
  readonly streamsStructuredOutput: (model: LLMModelSpec) => boolean;
}

export class LLMService extends Context.Service<LLMService, LLMServiceApi>()(
  "patchwork/LLMService",
) {}

/**
 * Pull the most diagnostic line out of any thrown value.
 *
 * `@tanstack/ai-openai` (and the compatible adapter on top of it)
 * throw plain `Error`s with `.message` like `404 Not Found` or
 * `TypeError: fetch failed`, occasionally with a `.cause` carrying the
 * underlying network error. For a single line that helps the user
 * figure out what went wrong, the top-level `.message` is usually enough
 * — the host log keeps the full error and stack.
 */
const describeCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    if (cause.message.length > 0) {
      return cause.message;
    }
    return cause.name;
  }
  if (typeof cause === "string") {
    return cause;
  }
  try {
    const serialised = JSON.stringify(cause);
    if (serialised !== undefined && serialised.length > 0) {
      return serialised;
    }
  } catch {
    // fall through
  }
  return String(cause);
};

/** Turn common provider failures into an actionable next step. */
const providerHint = (detail: string): string => {
  if (/terminated|fetch failed|econnreset|econnrefused|socket hang up|network/i.test(detail)) {
    return " The endpoint closed the connection. Check that it is running and reachable, and that the model fits in memory.";
  }
  if (/timed? out|timeout|aborted/i.test(detail)) {
    return " The request timed out; try a smaller selection or retry.";
  }
  if (/\b401\b|unauthorized|invalid api key/i.test(detail)) {
    return " Check the API key in Patchwork settings.";
  }
  if (/\b403\b|forbidden/i.test(detail)) {
    return " The API key may not have access to this model.";
  }
  if (/\b404\b|not found/i.test(detail)) {
    return " Check the model id and baseURL.";
  }
  if (/\b429\b|rate limit/i.test(detail)) {
    return " Rate limited; retry later.";
  }
  if (/\b5\d\d\b|server error/i.test(detail)) {
    return " The provider returned a server error; retry later.";
  }
  return "";
};

const formatDuration = (ms: number): string => {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
};

/**
 * Collapse any LLM failure into the single wire-facing shape.
 *
 * The host logs the full original error before this runs; what the
 * webview sees is a short headline plus the original `cause` for any
 * additional context. The reason field stays short so the UI can branch
 * on it (e.g. show a "configure API key" CTA only for `reason: "auth"`).
 *
 * The headline message includes the underlying error's `.message` so a
 * user hitting a 401 / wrong model name / network error sees the actual
 * reason — `LLM provider returned an error` alone is not actionable.
 */
export const toLLMGenerateError = (cause: unknown): LLMGenerateError => {
  if (cause instanceof LLMAuthenticationError) {
    return new LLMGenerateError({
      reason: "auth",
      message: `No API key configured for ${cause.provider}`,
      cause: cause.cause,
    });
  }
  if (cause instanceof LLMTimeoutError) {
    return new LLMGenerateError({
      reason: "timeout",
      message:
        `No data received from ${cause.provider} for ${formatDuration(cause.timeoutMs)}; ` +
        "the request was cancelled. Check that the endpoint streams responses, or raise " +
        "patchwork.llm.idleTimeoutSeconds for a model that is slow to start.",
      cause,
    });
  }
  if (cause instanceof LLMCancelledError) {
    return new LLMGenerateError({
      reason: "cancelled",
      message: "Generation cancelled.",
      cause,
    });
  }
  if (cause instanceof LLMProviderError) {
    const detail = describeCause(cause.cause);
    return new LLMGenerateError({
      reason: "provider",
      message: `LLM provider (${cause.provider}) returned an error: ${detail}${providerHint(detail)}`,
      cause: cause.cause,
    });
  }
  if (cause instanceof LLMUnknownProviderError) {
    return new LLMGenerateError({
      reason: "unknown",
      message: `Unknown LLM provider: ${cause.provider}`,
      cause,
    });
  }
  const message = describeCause(cause);
  return new LLMGenerateError({ reason: "unknown", message, cause });
};
