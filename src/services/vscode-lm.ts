import { Context, Effect } from "effect";
import type { VscodeLmModelView } from "../rpc/config-types";
import type { LLMContextLimitError, LLMMessage, LLMProgress, LLMProviderError } from "./llm";

/**
 * The parts of `vscode.LanguageModelChat` this module needs, declared
 * structurally so the pure helpers stay testable without the `vscode`
 * module (and without an extension host).
 */
export interface VscodeLmModelIdentity {
  readonly id: string;
  readonly name: string;
  readonly family: string;
}

/** Normalised chat turn for VS Code's language model API. */
export interface VscodeLmMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/**
 * Fold system prompts into the conversation.
 *
 * `vscode.lm` only has `User` and `Assistant` roles, so the system prompt
 * (which carries the whole commit-splitting contract) becomes a preamble
 * on the first user turn. OpenAI-style `system` messages legally arrive
 * anywhere in the list, so they are all collected and joined in order.
 */
export const toVscodeLmMessages = (
  messages: ReadonlyArray<LLMMessage>,
): ReadonlyArray<VscodeLmMessage> => {
  const system: Array<string> = [];
  const conversation: Array<VscodeLmMessage> = [];

  for (const message of messages) {
    if (message.role === "system") {
      system.push(message.content);
    } else {
      conversation.push({ role: message.role, content: message.content });
    }
  }

  const preamble = system.filter((part) => part.length > 0).join("\n\n");
  if (preamble.length === 0) {
    return conversation;
  }

  const first = conversation[0];
  if (first === undefined) {
    return [{ role: "user", content: preamble }];
  }
  if (first.role === "user") {
    return [{ role: "user", content: `${preamble}\n\n${first.content}` }, ...conversation.slice(1)];
  }
  return [{ role: "user", content: preamble }, ...conversation];
};

/**
 * Resolve the model the user picked.
 *
 * VS Code model ids are opaque and can change between releases, so the
 * configured value is matched against `id`, then `family`, then `name`.
 * An empty selector means "auto": the first model VS Code lists.
 */
export const selectVscodeLmModel = <T extends VscodeLmModelIdentity>(
  preferred: string,
  models: ReadonlyArray<T>,
): T | undefined => {
  const wanted = preferred.trim().toLowerCase();
  if (wanted.length === 0) {
    return models[0];
  }

  return (
    models.find((model) => model.id.toLowerCase() === wanted) ??
    models.find((model) => model.family.toLowerCase() === wanted) ??
    models.find((model) => model.name.toLowerCase() === wanted) ??
    undefined
  );
};

/** Human-readable model list for an error message. */
export const describeVscodeLmModels = (models: ReadonlyArray<VscodeLmModelIdentity>): string =>
  models.length === 0
    ? "none"
    : models.map((model) => `${model.name} (${model.family})`).join(", ");

export interface TextStreamOptions {
  /** Starts the request and returns its text deltas. */
  readonly open: () => AsyncIterable<string>;
  /** Resets the caller's idle timer; called for every chunk. */
  readonly touch: () => void;
  readonly onProgress?: (progress: LLMProgress) => void;
}

/**
 * Drain a text-only provider stream.
 *
 * `vscode.lm` has no structured-output mode, so the JSON plan arrives as
 * ordinary text deltas and is recovered by `extractProposal` later. This
 * mirrors `consumeStream` in `infrastructure/llm-stream.ts` so progress
 * and the idle timeout behave identically across providers.
 */
export const consumeTextStream = async (options: TextStreamOptions): Promise<string> => {
  let text = "";

  const report = (): void => {
    if (options.onProgress === undefined) {
      return;
    }
    try {
      options.onProgress({ receivedChars: text.length });
    } catch {
      // Progress is cosmetic; a broken observer must not abort the run.
    }
  };

  report();

  for await (const delta of options.open()) {
    options.touch();
    if (delta.length === 0) {
      continue;
    }
    text += delta;
    report();
  }

  return text;
};

export interface VscodeLmGenerateOptions {
  /** An `id`, `family`, or `name`; empty means "first available". */
  readonly model: string;
  readonly messages: ReadonlyArray<LLMMessage>;
  /** Combined cancellation signal (caller + idle timeout). */
  readonly signal: AbortSignal;
  /** Resets the caller's idle timer; called for every streamed part. */
  readonly touch: () => void;
  /** Suspends the idle timeout while VS Code's consent dialog is open. */
  readonly pauseIdle: () => void;
  readonly onProgress?: (progress: LLMProgress) => void;
}

/**
 * A failed `vscode.lm` call. Cancellation and timeouts are mapped by the
 * caller (`LLMService`), which owns the idle timer and the abort signal.
 */
export type VscodeLmGenerateError = LLMProviderError | LLMContextLimitError;

export interface VscodeLmServiceApi {
  /** The models VS Code can currently serve; never fails. */
  readonly listModels: () => Effect.Effect<ReadonlyArray<VscodeLmModelView>, never>;

  /** One text generation. `vscode.lm` has no structured-output mode. */
  readonly generate: (
    options: VscodeLmGenerateOptions,
  ) => Effect.Effect<string, VscodeLmGenerateError>;
}

export class VscodeLmService extends Context.Service<VscodeLmService, VscodeLmServiceApi>()(
  "patchwork/VscodeLmService",
) {}
