import { Context, Effect } from "effect";
import type { LLMConfigPatch, LLMConfigView } from "../rpc/config-types";
import type { LLMModelSpec } from "./llm";

export type LLMConfigSnapshot = LLMConfigView;
export type { LLMConfigPatch } from "../rpc/config-types";

export interface LLMConfigApi {
  readonly getConfig: () => Effect.Effect<LLMConfigSnapshot>;
  readonly resolveSpec: () => Effect.Effect<LLMModelSpec, LLMConfigError>;
  /**
   * Undefined fields are left alone; an empty string clears the field.
   * Switching away from `openai-compatible` also clears `baseURL`.
   */
  readonly update: (patch: LLMConfigPatch) => Effect.Effect<LLMConfigSnapshot>;
}

export class LLMConfigError extends Error {
  override readonly name = "LLMConfigError";
  constructor(
    readonly message: string,
    readonly reason: "auth" | "incomplete" = "incomplete",
  ) {
    super(message);
  }
}

export class LLMConfigService extends Context.Service<LLMConfigService, LLMConfigApi>()(
  "patchwork/LLMConfigService",
) {}
