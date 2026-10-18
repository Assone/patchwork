export type LLMProvider = "openai" | "anthropic" | "openai-compatible" | "vscode-lm";
export type CompatibleApi = "chat-completions" | "responses";

/**
 * One model that VS Code itself can run.
 *
 * VS Code 1.140 exposes the models of GitHub Copilot Chat plus every
 * provider the user added under **Chat: Manage Models** through
 * `vscode.lm`. The ids are opaque and can change between releases, so
 * the settings panel shows the human-readable `name` and stores `id`,
 * falling back to `family` when a model is re-registered.
 */
export interface VscodeLmModelView {
  readonly id: string;
  readonly name: string;
  readonly vendor: string;
  readonly family: string;
  readonly maxInputTokens: number;
}

export interface LLMConfigView {
  readonly configured: boolean;
  readonly apiKeyPresent: boolean;
  readonly provider: LLMProvider;
  readonly model: string;
  readonly baseURL?: string;
  readonly api?: CompatibleApi;
  /** Populated only when `provider` is `vscode-lm`; never read for others. */
  readonly vscodeModels?: readonly VscodeLmModelView[];
}

export interface LLMConfigPatch {
  readonly provider?: LLMProvider;
  readonly model?: string;
  readonly baseURL?: string;
  readonly api?: CompatibleApi;
}

export type TestConnectionResult =
  | { readonly ok: true; readonly model: string }
  | {
      readonly ok: false;
      readonly reason: "auth" | "provider" | "timeout" | "cancelled" | "unknown";
      readonly message: string;
    };
