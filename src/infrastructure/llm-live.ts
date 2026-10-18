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
  LLMContextLimitError,
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
import { VscodeLmService } from "../services/vscode-lm";
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

/** What a provider call may use while it streams. */
interface ProviderCallScope {
  /** Aborted by the caller, the panel closing, or the idle timeout. */
  readonly controller: AbortController;
  /** Resets the idle timer; call for every chunk that proves liveness. */
  readonly touch: () => void;
  /**
   * Suspends the idle timeout until the next `touch()`.
   *
   * VS Code raises its access-consent dialog from inside the first
   * request, and a user reading it can easily take longer than the idle
   * timeout. The dialog is not a silent provider, so it must not count.
   */
  readonly pauseIdle: () => void;
}

type ProviderCallError =
  | LLMAuthenticationError
  | LLMProviderError
  | LLMTimeoutError
  | LLMCancelledError
  | LLMContextLimitError;

/**
 * Run one provider call under a shared cancellation + idle-timeout regime.
 *
 * Keeping this outside the provider branches means the timeout and cancel
 * semantics cannot drift between `@tanstack/ai` adapters and the
 * `vscode.lm` API, which has its own cancellation token.
 */
const runProviderCall = <T>(
  provider: LLMProvider,
  model: string,
  abortSignal: AbortSignal | undefined,
  run: (scope: ProviderCallScope) => Effect.Effect<T, unknown>,
): Effect.Effect<T, ProviderCallError> =>
  Effect.gen(function* () {
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

    if (abortSignal?.aborted === true) {
      cancelled = true;
      controller.abort();
    } else {
      abortSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    armIdle();

    const mapFailure = (cause: unknown): ProviderCallError => {
      // A timeout or cancellation is reported as such even when the
      // provider also raised its own abort error: the flags are the
      // authoritative record of *why* the request ended.
      if (timedOut) {
        return new LLMTimeoutError({ provider, model, timeoutMs });
      }
      if (cancelled) {
        return new LLMCancelledError({ provider, model });
      }
      if (
        cause instanceof LLMAuthenticationError ||
        cause instanceof LLMProviderError ||
        cause instanceof LLMContextLimitError
      ) {
        return cause;
      }
      return toProviderError(provider, model, cause);
    };

    return yield* run({ controller, touch: armIdle, pauseIdle: disarmIdle }).pipe(
      Effect.catch((cause) => Effect.fail(mapFailure(cause))),
      Effect.ensuring(
        Effect.sync(() => {
          disarmIdle();
          abortSignal?.removeEventListener("abort", abortFromCaller);
        }),
      ),
    );
  });

export const LLMServiceLive: Layer.Layer<LLMService, never, SecretService | VscodeLmService> =
  Layer.effect(
    LLMService,
    Effect.gen(function* () {
      const secrets = yield* SecretService;
      const vscodeLm = yield* VscodeLmService;

      return LLMService.of({
        // Anthropic 0.22 has no `structuredOutputStream`, so `@tanstack/ai`
        // synthesizes one from a blocking tool-use call: no deltas and no
        // defence against a slow plan. OpenAI and OpenAI-compatible adapters
        // stream structured output natively. `vscode.lm` exposes text parts
        // only, so it uses the text-JSON path as well.
        streamsStructuredOutput: (model) =>
          model.provider !== "anthropic" && model.provider !== "vscode-lm",

        generate: <TSchema extends LLMSchema | undefined = undefined>(
          options: GenerateOptions<TSchema>,
        ): Effect.Effect<
          GenerateResult<TSchema>,
          | LLMAuthenticationError
          | LLMProviderError
          | LLMTimeoutError
          | LLMCancelledError
          | LLMUnknownProviderError
          | LLMContextLimitError
        > =>
          Effect.gen(function* () {
            const spec = options.model;

            // VS Code owns the account, the model selection and the quota
            // for its own models; there is no key for Patchwork to read.
            if (spec.provider === "vscode-lm") {
              const text = yield* runProviderCall(
                spec.provider,
                spec.model,
                options.abortSignal,
                (scope) =>
                  vscodeLm.generate({
                    model: spec.model,
                    messages: options.messages,
                    signal: scope.controller.signal,
                    touch: scope.touch,
                    pauseIdle: scope.pauseIdle,
                    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
                  }),
              );

              return { text } as GenerateResult<TSchema>;
            }

            const key = yield* secrets.getApiKey(spec.provider).pipe(
              Effect.mapError((cause) =>
                cause instanceof MissingApiKeyError
                  ? new LLMAuthenticationError({
                      provider: spec.provider,
                      cause,
                    })
                  : new LLMProviderError({
                      provider: spec.provider,
                      model: spec.model,
                      cause,
                    }),
              ),
            );

            const keyString = Redacted.value(key);

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
                return yield* Effect.fail(
                  new LLMUnknownProviderError({ provider: unknownProvider }),
                );
              }
            }

            const { system, conversation } = splitSystemMessages(options.messages);
            const schema = options.schema as LLMSchema | undefined;

            const result = yield* runProviderCall(
              provider,
              spec.model,
              options.abortSignal,
              (scope) => {
                const opened = {
                  adapter: adapter as Parameters<typeof chat>[0]["adapter"],
                  messages: [...conversation],
                  ...(system.length > 0 ? { systemPrompts: [...system] } : {}),
                  ...(schema !== undefined
                    ? { outputSchema: schema as never, stream: true as const }
                    : { stream: true as const }),
                  ...(options.temperature !== undefined
                    ? { temperature: options.temperature }
                    : {}),
                  abortController: scope.controller,
                };

                return Effect.tryPromise({
                  try: () =>
                    consumeStream({
                      open: () =>
                        chat(opened as never) as unknown as AsyncIterable<StreamChunkLike>,
                      structured: schema !== undefined,
                      touch: scope.touch,
                      ...(options.onProgress === undefined
                        ? {}
                        : { onProgress: options.onProgress }),
                    }),
                  catch: (cause) => cause,
                });
              },
            );

            if (schema === undefined) {
              return { text: result.text } as GenerateResult<TSchema>;
            }

            return { text: result.text, value: result.value } as GenerateResult<TSchema>;
          }),
      });
    }),
  );
