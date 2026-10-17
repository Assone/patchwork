import { Effect, Layer, Redacted } from "effect";
import { chat } from "@tanstack/ai";
import { createAnthropicChat } from "@tanstack/ai-anthropic";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import * as vscode from "vscode";
import { consumeStream, type StreamChunkLike } from "./llm-stream";
import {
  type GenerateOptions,
  type GenerateResult,
  type LLMConversationMessage,
  type LLMMessage,
  LLMAuthenticationError,
  LLMCancelledError,
  type LLMProvider,
  LLMProviderError,
  LLMService,
  type LLMSchema,
  LLMTimeoutError,
  LLMUnknownProviderError,
} from "../services/llm";
import { MissingApiKeyError, SecretService } from "../services/secret";

/** Errors that bubble up from `@tanstack/ai` collapse into a single tagged error. */
const toProviderError = (provider: LLMProvider, model: string, cause: unknown): LLMProviderError =>
  new LLMProviderError({ provider, model, cause });

/** Split system messages out of the conversation list. */
const splitSystemMessages = (
  messages: ReadonlyArray<LLMMessage>,
): {
  system: Array<string>;
  conversation: Array<LLMConversationMessage>;
} => {
  const system: Array<string> = [];
  const conversation: Array<LLMConversationMessage> = [];
  for (const message of messages) {
    if (message.role === "system") {
      system.push(message.content);
    } else {
      conversation.push({ role: message.role, content: message.content });
    }
  }
  return { system, conversation };
};

const CONFIG_SECTION = "patchwork.llm";
const DEFAULT_IDLE_TIMEOUT_SECONDS = 120;
const MIN_IDLE_TIMEOUT_SECONDS = 10;

/**
 * How long the provider may stay silent before we give up.
 *
 * This is deliberately an *idle* timeout: every streamed chunk resets it.
 * A five-minute generation that keeps producing tokens is fine; a provider
 * that accepts the request and then hangs is not. Read per call so a
 * settings edit applies without reloading the extension.
 */
const idleTimeoutMs = (): number => {
  const configured = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>("idleTimeoutSeconds", DEFAULT_IDLE_TIMEOUT_SECONDS);
  const seconds = Number.isFinite(configured) ? configured : DEFAULT_IDLE_TIMEOUT_SECONDS;
  return Math.max(MIN_IDLE_TIMEOUT_SECONDS, seconds) * 1000;
};

export const LLMServiceLive: Layer.Layer<LLMService, never, SecretService> = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const secrets = yield* SecretService;

    return LLMService.of({
      // Anthropic 0.22 has no `structuredOutputStream`, so `@tanstack/ai`
      // synthesizes one from a blocking tool-use call: no deltas and no
      // defence against a slow plan. OpenAI and OpenAI-compatible adapters
      // stream structured output natively.
      streamsStructuredOutput: (model) => model.provider !== "anthropic",

      generate: <TSchema extends LLMSchema | undefined = undefined>(
        options: GenerateOptions<TSchema>,
      ): Effect.Effect<
        GenerateResult<TSchema>,
        | LLMAuthenticationError
        | LLMProviderError
        | LLMTimeoutError
        | LLMCancelledError
        | LLMUnknownProviderError
      > =>
        Effect.gen(function* () {
          const key = yield* secrets.getApiKey(options.model.provider).pipe(
            Effect.mapError((cause) =>
              cause instanceof MissingApiKeyError
                ? new LLMAuthenticationError({
                    provider: options.model.provider,
                    cause,
                  })
                : new LLMProviderError({
                    provider: options.model.provider,
                    model: options.model.model,
                    cause,
                  }),
            ),
          );

          const keyString = Redacted.value(key);
          const spec = options.model;

          let provider: LLMProvider;
          let adapter: unknown;
          switch (spec.provider) {
            case "openai":
              provider = "openai";
              adapter = createOpenaiChat(spec.model as never, keyString as never);
              break;
            case "anthropic":
              provider = "anthropic";
              adapter = createAnthropicChat(spec.model as never, keyString as never);
              break;
            case "openai-compatible":
              provider = "openai-compatible";
              adapter = openaiCompatibleText(spec.model, {
                baseURL: spec.baseURL,
                apiKey: keyString,
                ...(spec.api !== undefined ? { api: spec.api } : {}),
              });
              break;
            default: {
              // Unreachable for typed callers: the provider union is closed.
              // Kept so an untyped caller — a provider id read from settings,
              // say — surfaces a typed error instead of an opaque crash.
              const { provider: unknownProvider } = spec as { readonly provider: string };
              return yield* Effect.fail(new LLMUnknownProviderError({ provider: unknownProvider }));
            }
          }

          const { system, conversation } = splitSystemMessages(options.messages);
          const schema = options.schema as LLMSchema | undefined;
          const timeoutMs = idleTimeoutMs();

          const controller = new AbortController();
          let timedOut = false;
          let cancelled = false;
          let idleTimer: ReturnType<typeof setTimeout> | undefined;

          const disarmIdle = (): void => {
            if (idleTimer !== undefined) {
              clearTimeout(idleTimer);
              idleTimer = undefined;
            }
          };

          const armIdle = (): void => {
            disarmIdle();
            idleTimer = setTimeout(() => {
              timedOut = true;
              controller.abort(new Error(`LLM request idle for ${timeoutMs}ms`));
            }, timeoutMs);
          };

          const abortFromCaller = (): void => {
            cancelled = true;
            controller.abort();
          };

          if (options.abortSignal?.aborted === true) {
            cancelled = true;
            controller.abort();
          } else {
            options.abortSignal?.addEventListener("abort", abortFromCaller, { once: true });
          }
          armIdle();

          const opened = {
            adapter: adapter as Parameters<typeof chat>[0]["adapter"],
            messages: [...conversation],
            ...(system.length > 0 ? { systemPrompts: [...system] } : {}),
            ...(schema !== undefined
              ? { outputSchema: schema as never, stream: true as const }
              : { stream: true as const }),
            ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
            abortController: controller,
          };

          const result = yield* Effect.tryPromise({
            try: () =>
              consumeStream({
                open: () => chat(opened as never) as unknown as AsyncIterable<StreamChunkLike>,
                structured: schema !== undefined,
                touch: armIdle,
                ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
              }),
            catch: (cause) => {
              if (timedOut) {
                return new LLMTimeoutError({ provider, model: spec.model, timeoutMs });
              }
              if (cancelled) {
                return new LLMCancelledError({ provider, model: spec.model });
              }
              return toProviderError(provider, spec.model, cause);
            },
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                disarmIdle();
                options.abortSignal?.removeEventListener("abort", abortFromCaller);
              }),
            ),
          );

          if (schema === undefined) {
            return { text: result.text } as GenerateResult<TSchema>;
          }

          return { text: result.text, value: result.value } as GenerateResult<TSchema>;
        }),
    });
  }),
);
