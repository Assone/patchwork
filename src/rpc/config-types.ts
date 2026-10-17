export type LLMProvider = "openai" | "anthropic" | "openai-compatible";
export type CompatibleApi = "chat-completions" | "responses";

export interface LLMConfigView {
  readonly configured: boolean;
  readonly apiKeyPresent: boolean;
  readonly provider: LLMProvider;
  readonly model: string;
  readonly baseURL?: string;
  readonly api?: CompatibleApi;
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
