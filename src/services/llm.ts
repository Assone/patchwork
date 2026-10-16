import { Context, Data, Effect } from "effect";
import type { z } from "zod";

/** LLM providers supported by this extension. */
export type LLMProvider = "openai" | "anthropic" | "openai-compatible";

/**
 * Wire format an OpenAI-compatible endpoint speaks.
 *
 * Most compatible servers (Ollama, vLLM, LM Studio, DeepSeek, OpenRouter, ...)
 * implement only the older **Chat Completions** API, which is the default here.
 * `"responses"` is for the few that also expose the Responses API (e.g. Azure
 * OpenAI).
 */
export type CompatibleApi = "chat-completions" | "responses";

/**
 * A configured LLM target: which provider, which model, and — for
 * `openai-compatible` — where the endpoint lives.
 *
 * A discriminated union rather than one bag of optional fields, so the compiler
 * enforces that `openai-compatible` carries a `baseURL` while `openai` and
 * `anthropic` need nothing beyond the model id.
 */
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
      /**
       * Any OpenAI-compatible endpoint: a local server (Ollama, vLLM,
       * LM Studio), a hosted one that speaks the OpenAI wire format (DeepSeek,
       * OpenRouter, Groq, ...), or Azure OpenAI.
       */
      readonly provider: "openai-compatible";
      readonly model: string;
      /**
       * Endpoint root, e.g. `http://localhost:11434/v1` (Ollama) or
       * `https://api.deepseek.com/v1`.
       */
      readonly baseURL: string;
      /** Wire format; defaults to `"chat-completions"` (the common case). */
      readonly api?: CompatibleApi;
      /** Label used in provider error messages. Defaults to the provider id. */
      readonly name?: string;
      /** Extra query params on every request, e.g. Azure's `api-version`. */
      readonly defaultQuery?: Record<string, string>;
      /** Extra headers on every request, e.g. Azure's `api-key`. */
      readonly defaultHeaders?: Record<string, string>;
    };

/**
 * Failed to obtain or use credentials for a provider. Typically surfaced when
 * the user has not yet configured an API key for the requested provider.
 */
export class LLMAuthenticationError extends Data.TaggedError("LLMAuthenticationError")<{
  readonly provider: LLMProvider;
  readonly cause: unknown;
}> {}

/**
 * The provider returned an error (network, rate limit, schema refusal, ...).
 * Includes structured-output validation failures, since the underlying SDK
 * exposes them through the same channel as network errors.
 */
export class LLMProviderError extends Data.TaggedError("LLMProviderError")<{
  readonly provider: LLMProvider;
  readonly model: string;
  readonly cause: unknown;
}> {}

/**
 * Should be unreachable: callers pass `LLMProvider` which is the closed union
 * `"openai" | "anthropic"`. Surfaced as an error rather than an `assert`
 * failure so consuming code can recover in one place.
 */
export class LLMUnknownProviderError extends Data.TaggedError("LLMUnknownProviderError")<{
  readonly provider: string;
}> {}

/** A single chat message in the canonical form expected by the LLM layer. */
export interface LLMMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** Conversation messages, after system prompts have been lifted out. */
export interface LLMConversationMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/**
 * Schema shape accepted for structured output.
 */
export type LLMSchema = z.ZodType;

/**
 * Infer the TS type produced by `LLMService.generate` given an optional schema.
 * Without a schema, the result is just the raw text the model emitted.
 */
export type GenerateResult<TSchema extends LLMSchema | undefined> = TSchema extends LLMSchema
  ? { readonly text: string; readonly value: z.infer<TSchema> }
  : { readonly text: string };

/**
 * Options shared by every generation method.
 *
 * `schema` describes the expected structured output. When omitted, the model
 * returns plain text. Messages with `role: "system"` are lifted out of
 * `messages` and forwarded to the underlying SDK as `systemPrompts`, matching
 * how Anthropic / OpenAI Conversations expect system instructions.
 */
export interface GenerateOptions<TSchema extends LLMSchema | undefined = undefined> {
  readonly model: LLMModelSpec;
  readonly messages: ReadonlyArray<LLMMessage>;
  readonly schema?: TSchema;
  readonly temperature?: number;
  readonly abortSignal?: AbortSignal;
}

export interface LLMServiceApi {
  /**
   * Run a non-streaming generation.
   *
   * Always returns a single, resolved value (never an async iterable).
   * Validates the output against `options.schema` if one is supplied; in that
   * case the result also includes `value` — the typed, schema-checked object.
   */
  readonly generate: <TSchema extends LLMSchema | undefined = undefined>(
    options: GenerateOptions<TSchema>,
  ) => Effect.Effect<
    GenerateResult<TSchema>,
    LLMAuthenticationError | LLMProviderError | LLMUnknownProviderError
  >;
}

export class LLMService extends Context.Service<LLMService, LLMServiceApi>()(
  "patchwork/LLMService",
) {}
