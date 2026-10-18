import { Effect, Layer } from "effect";
import * as vscode from "vscode";
import { LLMConfigError, LLMConfigService, type LLMConfigSnapshot } from "../services/config";
import type { CompatibleApi, LLMModelSpec, LLMProvider } from "../services/llm";
import {
  selectVscodeLmModel,
  VscodeLmService,
  type VscodeLmServiceApi,
} from "../services/vscode-lm";
import { SecretService, type SecretServiceApi } from "../services/secret";

const CONFIG_SECTION = "patchwork.llm" as const;

const resolveProvider = (raw: string): LLMProvider => {
  if (
    raw === "openai" ||
    raw === "anthropic" ||
    raw === "openai-compatible" ||
    raw === "vscode-lm"
  ) {
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
  provider === "vscode-lm"
    ? Effect.succeed(false)
    : secrets.getApiKey(provider).pipe(
        Effect.map(() => true),
        Effect.orElseSucceed(() => false),
      );

const readSnapshot = (
  secrets: SecretServiceApi,
  vscodeLm: VscodeLmServiceApi,
): Effect.Effect<LLMConfigSnapshot> =>
  Effect.gen(function* () {
    const { provider, model, baseURL, api } = readRawConfig();

    // VS Code owns these models; the list is what the settings panel
    // offers and what makes "auto" meaningful.
    const vscodeModels = provider === "vscode-lm" ? yield* vscodeLm.listModels() : [];

    const apiKeyPresent = yield* hasApiKey(secrets, provider);
    const hasModel = model.length > 0;
    const hasBaseURL = baseURL.length > 0;

    // `openai` and `anthropic` know their own endpoint; only the
    // compatible adapter needs a baseURL, and only `vscode-lm` needs a
    // model VS Code actually exposes.
    const providerReady =
      provider === "vscode-lm"
        ? vscodeModels.length > 0 &&
          (!hasModel || selectVscodeLmModel(model, vscodeModels) !== undefined)
        : provider !== "openai-compatible" || hasBaseURL;

    const configured =
      provider === "vscode-lm" ? providerReady : hasModel && providerReady && apiKeyPresent;

    return {
      configured,
      apiKeyPresent,
      provider,
      model,
      ...(hasBaseURL ? { baseURL } : {}),
      ...(api !== "chat-completions" ? { api } : {}),
      ...(provider === "vscode-lm" ? { vscodeModels } : {}),
    } satisfies LLMConfigSnapshot;
  });

export const LLMConfigServiceLive: Layer.Layer<
  LLMConfigService,
  never,
  SecretService | VscodeLmService
> = Layer.effect(
  LLMConfigService,
  Effect.gen(function* () {
    const secrets = yield* SecretService;
    const vscodeLm = yield* VscodeLmService;

    return LLMConfigService.of({
      getConfig: () => readSnapshot(secrets, vscodeLm),
      resolveSpec: () =>
        Effect.gen(function* () {
          const { provider, model, baseURL, api } = readRawConfig();

          // VS Code models are already authenticated by the editor, and
          // an empty model means "the first one VS Code lists".
          if (provider === "vscode-lm") {
            const models = yield* vscodeLm.listModels();
            if (models.length === 0) {
              return yield* Effect.fail(
                new LLMConfigError(
                  "No VS Code language model is available. Install GitHub Copilot Chat, or " +
                    'add a model with "Chat: Manage Models".',
                ),
              );
            }
            if (model.length > 0 && selectVscodeLmModel(model, models) === undefined) {
              return yield* Effect.fail(
                new LLMConfigError(
                  `The VS Code model "${model}" is not available any more. Pick another one ` +
                    "in Patchwork settings.",
                ),
              );
            }
            return { provider: "vscode-lm", model };
          }

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
            const previous = resolveProvider(config.get<string>("provider", "openai"));
            yield* Effect.promise(() =>
              config.update("provider", patch.provider, vscode.ConfigurationTarget.Global),
            );

            // Model ids are provider-specific. Crossing into or out of
            // `vscode-lm` would carry an id that provider can never
            // resolve, so fall back to "auto" (empty).
            if (
              patch.provider !== previous &&
              (patch.provider === "vscode-lm" || previous === "vscode-lm")
            ) {
              yield* Effect.promise(() =>
                config.update("model", "", vscode.ConfigurationTarget.Global),
              );
            }
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

          return yield* readSnapshot(secrets, vscodeLm);
        }),
    });
  }),
);
