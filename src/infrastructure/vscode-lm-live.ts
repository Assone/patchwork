import { Effect, Layer } from "effect";
import * as vscode from "vscode";
import type { VscodeLmModelView } from "../rpc/config-types";
import { LLMContextLimitError, LLMProviderError, type LLMMessage } from "../services/llm";
import {
  consumeTextStream,
  describeVscodeLmModels,
  selectVscodeLmModel,
  toVscodeLmMessages,
  VscodeLmService,
  type VscodeLmGenerateOptions,
} from "../services/vscode-lm";

const PROVIDER = "vscode-lm";

/**
 * Shown in the consent dialog VS Code raises the first time an extension
 * asks for a model. It has to explain the data flow in one sentence.
 */
const JUSTIFICATION =
  "Patchwork sends the selected diff to this model to split it into commits and write their commit messages.";

const providerError = (model: string, message: string): LLMProviderError =>
  new LLMProviderError({ provider: PROVIDER, model, cause: new Error(message) });

/** Turn a `vscode.lm` failure into one of the host's tagged errors. */
const mapError = (model: string, cause: unknown): unknown => {
  if (cause instanceof vscode.LanguageModelError) {
    if (cause.code === vscode.LanguageModelError.NoPermissions.name) {
      return providerError(
        model,
        "Patchwork was not granted access to this VS Code model. Run Generate Commits again " +
          "and allow access in the prompt, or check the model's access settings in VS Code.",
      );
    }
    if (cause.code === vscode.LanguageModelError.NotFound.name) {
      return providerError(
        model,
        "This VS Code model is no longer available. Pick another one in Patchwork settings.",
      );
    }
    if (cause.code === vscode.LanguageModelError.Blocked.name) {
      return providerError(
        model,
        `VS Code blocked the request (${cause.message}). Check the Copilot quota or the ` +
          "model's access settings.",
      );
    }
  }

  return cause;
};

/**
 * The models VS Code can currently serve, in the order it lists them.
 *
 * `selectChatModels` does not prompt the user, so this is safe to call
 * from the settings panel. The webview only needs the display fields; the
 * opaque `id` is what gets persisted.
 */
const listModels = async (): Promise<ReadonlyArray<VscodeLmModelView>> => {
  try {
    const models = await vscode.lm.selectChatModels();
    return models.map((model) => ({
      id: model.id,
      name: model.name,
      vendor: model.vendor,
      family: model.family,
      maxInputTokens: model.maxInputTokens,
    }));
  } catch {
    // A broken provider registration must not break the settings panel;
    // an empty list makes the UI say that no model is available.
    return [];
  }
};

const toChatMessages = (messages: ReadonlyArray<LLMMessage>): vscode.LanguageModelChatMessage[] =>
  toVscodeLmMessages(messages).map((message) =>
    message.role === "assistant"
      ? vscode.LanguageModelChatMessage.Assistant(message.content)
      : vscode.LanguageModelChatMessage.User(message.content),
  );

const streamedText = async function* (stream: AsyncIterable<unknown>): AsyncIterable<string> {
  for await (const part of stream) {
    // Tool-call and data parts are not requested here; only text is the
    // reply. Ignoring them keeps a model that adds a tool call anyway
    // from corrupting the JSON.
    if (part instanceof vscode.LanguageModelTextPart) {
      yield part.value;
    }
  }
};

/**
 * Fail before sending when the diff cannot fit the model's input window.
 *
 * The whole change set goes in one request, so a small local model would
 * otherwise fail with an opaque provider error. Tokenisation is
 * best-effort: if the model cannot count, the request goes out and the
 * provider decides.
 */
const assertFitsContext = async (
  model: vscode.LanguageModelChat,
  messages: ReadonlyArray<vscode.LanguageModelChatMessage>,
): Promise<void> => {
  const limit = model.maxInputTokens;
  if (!Number.isFinite(limit) || limit <= 0) {
    return;
  }

  let tokens = 0;
  try {
    for (const message of messages) {
      tokens += await model.countTokens(message);
    }
  } catch {
    return;
  }

  if (tokens > limit) {
    throw new LLMContextLimitError({ provider: PROVIDER, model: model.name, tokens, limit });
  }
};

/**
 * Run one generation through `vscode.lm` and return the text reply.
 *
 * The caller falls back to the text JSON path because this API has no
 * structured-output mode.
 */
const generate = async (options: VscodeLmGenerateOptions): Promise<string> => {
  const models = await vscode.lm.selectChatModels();
  const chosen = selectVscodeLmModel(options.model, models);
  if (chosen === undefined) {
    throw providerError(
      options.model.length > 0 ? options.model : "auto",
      options.model.length > 0
        ? `The VS Code model "${options.model}" is not available. Available: ` +
            `${describeVscodeLmModels(models)}.`
        : "No VS Code language model is available. Install GitHub Copilot Chat, or add a " +
            'model with "Chat: Manage Models".',
    );
  }

  const messages = toChatMessages(options.messages);
  await assertFitsContext(chosen, messages);

  const source = new vscode.CancellationTokenSource();
  const cancel = (): void => {
    source.cancel();
  };

  if (options.signal.aborted) {
    cancel();
  } else {
    options.signal.addEventListener("abort", cancel, { once: true });
  }

  try {
    // The first request may open VS Code's access-consent dialog. Stop
    // the idle clock until the request has been accepted and starts
    // streaming, otherwise a user reading the dialog could trip it.
    options.pauseIdle();

    const response = await chosen.sendRequest(
      messages,
      { justification: JUSTIFICATION },
      source.token,
    );

    // Accepted: silence from here on is the provider's, so restart the
    // idle clock before waiting for the first token.
    options.touch();

    return await consumeTextStream({
      open: () => streamedText(response.stream),
      touch: options.touch,
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    });
  } catch (cause) {
    throw mapError(chosen.name, cause);
  } finally {
    options.signal.removeEventListener("abort", cancel);
    source.dispose();
  }
};

export const VscodeLmServiceLive: Layer.Layer<VscodeLmService> = Layer.succeed(VscodeLmService, {
  listModels: () => Effect.promise(listModels),

  generate: (options) =>
    Effect.tryPromise({
      try: () => generate(options),
      catch: (cause) =>
        cause instanceof LLMProviderError || cause instanceof LLMContextLimitError
          ? cause
          : new LLMProviderError({ provider: PROVIDER, model: options.model, cause }),
    }),
});
