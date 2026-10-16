import { Effect, Layer, Redacted } from "effect";
import { chat } from "@tanstack/ai";
import { createAnthropicChat } from "@tanstack/ai-anthropic";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import {
  type GenerateOptions,
  type GenerateResult,
  type LLMConversationMessage,
  type LLMMessage,
  LLMAuthenticationError,
  type LLMProvider,
  LLMProviderError,
  LLMService,
  type LLMSchema,
  LLMUnknownProviderError,
} from "../services/llm";
import { SecretService } from "../services/secret";

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

/**
 * Bridge an `AbortSignal` to the `AbortController` shape `@tanstack/ai` expects.
 * The signal may already be aborted; we mirror that state on the controller.
 */
const toAbortController = (signal: AbortSignal): AbortController => {
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort();
    return controller;
  }
  signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
};

/**
 * The base layer for `LLMService`. Requires `SecretService` in the
 * environment; compose with `SecretServiceLive(context)` before merging into
 * the runtime (or use the `LLMServiceLive` factory below, which does this for
 * you).
 *
 * The public `LLMServiceApi` exposes no `SecretService` dependency, so callers
 * that consume `LLMService` do not need to be aware of it. The dependency
 * lives here, in the layer graph, where it belongs.
 */
export const LLMServiceLiveBase: Layer.Layer<LLMService, never, SecretService> = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    // Pull the service up front so the implementation captures it through a
    // normal closure, and so the `Effect.gen` body satisfies the layer's
    // declared requirement on `SecretService`.
    const secrets = yield* SecretService;

    return LLMService.of({
      generate: <TSchema extends LLMSchema | undefined = undefined>(
        options: GenerateOptions<TSchema>,
      ): Effect.Effect<
        GenerateResult<TSchema>,
        LLMAuthenticationError | LLMProviderError | LLMUnknownProviderError
      > =>
        Effect.gen(function* () {
          const key = yield* secrets.getApiKey(options.model.provider).pipe(
            Effect.mapError(
              (cause): LLMAuthenticationError =>
                new LLMAuthenticationError({
                  provider: options.model.provider,
                  cause,
                }),
            ),
          );

          const keyString = Redacted.value(key);
          const spec = options.model;

          // Pick the right adapter. `createOpenaiChat` / `createAnthropicChat`
          // are typed against a finite set of known model literals; users can
          // configure arbitrary model ids, so we cast at the seam.
          // `openaiCompatibleText` already accepts arbitrary model ids.
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
                ...(spec.name !== undefined ? { name: spec.name } : {}),
                ...(spec.defaultQuery !== undefined ? { defaultQuery: spec.defaultQuery } : {}),
                ...(spec.defaultHeaders !== undefined
                  ? { defaultHeaders: spec.defaultHeaders }
                  : {}),
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

          const chatResult = yield* Effect.tryPromise({
            try: () =>
              chat({
                adapter: adapter as Parameters<typeof chat>[0]["adapter"],
                messages: conversation,
                ...(system.length > 0 ? { systemPrompts: system } : {}),
                ...(schema !== undefined ? { outputSchema: schema as never } : {}),
                stream: false,
                ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
                ...(options.abortSignal !== undefined
                  ? { abortController: toAbortController(options.abortSignal) }
                  : {}),
              }),
            catch: (cause) => toProviderError(provider, spec.model, cause),
          });

          // Without a schema, `chat({ stream: false })` resolves to
          // `ChatResult`; with a schema, it resolves to the validated value
          // (typed as `unknown` here since the generic is bound at the call
          // site via the TS schema).
          if (schema === undefined) {
            const text = (chatResult as { text: string }).text;
            return { text } as GenerateResult<TSchema>;
          }

          const value = chatResult as unknown;
          const text = typeof value === "string" ? value : JSON.stringify(value);
          return { text, value } as GenerateResult<TSchema>;
        }),
    });
  }),
);

/**
 * Ready-to-use layer that pulls `SecretService` itself from a caller-supplied
 * `secretLayer` (typically `SecretServiceLive(context)`).
 *
 * @example
 *   const AppLive = Layer.mergeAll(
 *     LLMServiceLive(SecretServiceLive(context)),
 *     ...
 *   );
 */
export const LLMServiceLive = (
  secretLayer: Layer.Layer<SecretService, never, never>,
): Layer.Layer<LLMService> => LLMServiceLiveBase.pipe(Layer.provide(secretLayer));
