import { Effect, Layer } from "effect";
import * as vscode from "vscode";
import { LLMConfigError, LLMConfigService, type LLMConfigSnapshot } from "../services/config";
import type { CompatibleApi, LLMModelSpec, LLMProvider } from "../services/llm";
import { SecretService, type SecretServiceApi } from "../services/secret";

const CONFIG_SECTION = "patchwork.llm" as const;

const resolveProvider = (raw: string): LLMProvider => {
  if (raw === "openai" || raw === "anthropic" || raw === "openai-compatible") {
    return raw;
  }

  return "openai";
};

// settings.json is user-editable; unknown values fall back to the default.
const resolveApi = (raw: string): CompatibleApi =>
  raw === "responses" ? "responses" : "chat-completions";

interface RawConfig {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly baseURL: string;
  readonly api: CompatibleApi;
}

// One reader for getConfig and resolveSpec, so their defaults cannot drift.
const readRawConfig = (): RawConfig => {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

  return {
    provider: resolveProvider(config.get<string>("provider", "openai")),
    model: config.get<string>("model", ""),
    baseURL: config.get<string>("baseURL", ""),
    api: resolveApi(config.get<string>("chat-completions", "chat-completions")),
  };
};

const hasApiKey = (secrets: SecretServiceApi, provider: LLMProvider): Effect.Effect<boolean> =>
  secrets.getApiKey(provider).pipe(
    Effect.map(() => true),
    Effect.orElseSucceed(() => false),
  );

const readSnapshot = (secrets: SecretServiceApi): Effect.Effect<LLMConfigSnapshot> =>
  Effect.gen(function* () {
    const { provider, model, baseURL, api } = readRawConfig();

    const apiKeyPresent = yield* hasApiKey(secrets, provider);
    const hasModel = model.length > 0;
    const hasBaseURL = baseURL.length > 0;
    // `openai` and `anthropic` know their own endpoint; only the
    // compatible adapter needs a baseURL to be usable.
    const providerReady = provider !== "openai-compatible" || hasBaseURL;

    return {
      configured: hasModel && providerReady && apiKeyPresent,
      apiKeyPresent,
      provider,
      model,
      ...(hasBaseURL ? { baseURL } : {}),
      ...(api !== "chat-completions" ? { api } : {}),
    } satisfies LLMConfigSnapshot;
  });

export const LLMConfigServiceLive: Layer.Layer<LLMConfigService, never, SecretService> =
  Layer.effect(
    LLMConfigService,
    Effect.gen(function* () {
      const secrets = yield* SecretService;

      return LLMConfigService.of({
        getConfig: () => readSnapshot(secrets),
        resolveSpec: () =>
          Effect.gen(function* () {
            const { provider, model, baseURL, api } = readRawConfig();

            // Keep `resolveSpec` consistent with the `configured` flag.
            if (!(yield* hasApiKey(secrets, provider))) {
              return yield* Effect.fail(
                new LLMConfigError(`No API key configured for ${provider}`, "auth"),
              );
            }

            if (model.length === 0) {
              return yield* Effect.fail(
                new LLMConfigError("No model configured. Set patchwork.llm.model."),
              );
            }

            const spec: LLMModelSpec =
              provider === "openai-compatible"
                ? baseURL.length === 0
                  ? yield* Effect.fail(
                      new LLMConfigError("openai-compatible needs patchwork.llm.baseURL."),
                    )
                  : {
                      provider: "openai-compatible",
                      model,
                      baseURL,
                      ...(api !== "chat-completions" ? { api } : {}),
                    }
                : { provider, model };

            return spec;
          }),

        update: (patch) =>
          Effect.gen(function* () {
            const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

            // Each field is written independently so an unrelated
            // failure (e.g. settings.json locked by another tool) only
            // blocks the field the user touched. `undefined` keys are
            // skipped; empty strings clear the value.
            if (patch.provider !== undefined) {
              yield* Effect.promise(() =>
                config.update("provider", patch.provider, vscode.ConfigurationTarget.Global),
              );
            }
            if (patch.model !== undefined) {
              yield* Effect.promise(() =>
                config.update("model", patch.model, vscode.ConfigurationTarget.Global),
              );
            }
            if (patch.baseURL !== undefined) {
              yield* Effect.promise(() =>
                config.update("baseURL", patch.baseURL, vscode.ConfigurationTarget.Global),
              );
            }
            if (patch.api !== undefined) {
              yield* Effect.promise(() =>
                config.update("chat-completions", patch.api, vscode.ConfigurationTarget.Global),
              );
            }

            // Switching away from a provider that has its own endpoint
            // drops the cached `baseURL` so the next call doesn't try
            // to reuse an OpenAI-only URL with Anthropic, etc.
            if (patch.provider !== undefined && patch.provider !== "openai-compatible") {
              const currentBaseURL = config.get<string>("baseURL", "");
              if (currentBaseURL.length > 0) {
                yield* Effect.promise(() =>
                  config.update("baseURL", "", vscode.ConfigurationTarget.Global),
                );
              }
            }

            return yield* readSnapshot(secrets);
          }),
      });
    }),
  );
