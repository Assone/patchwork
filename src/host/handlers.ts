import { type ManagedRuntime, Effect } from "effect";
import * as vscode from "vscode";
import { DEFAULT_MAX_DIFF_CHARS } from "../features/compose/prompt";
import { commitPlan, generateCommits, type ComposeProgress } from "../features/llm-compose";
import { registerEffectHandler } from "../rpc/host";
import type { HostApi, RpcClient, WebviewApi } from "../rpc/protocol";
import { LLMConfigError, LLMConfigService } from "../services/config";
import { GitService } from "../services/git";
import { LLMGenerateError, LLMService, toLLMGenerateError } from "../services/llm";
import type { LoggerService } from "../services/log";
import { SecretService } from "../services/secret";

/** Minimum gap between progress notifications for one generation. */
const PROGRESS_INTERVAL_MS = 200;

/**
 * Throttled bridge from the LLM stream to the webview.
 *
 * Token deltas can arrive hundreds of times per second; `postMessage`
 * cannot usefully redraw that often. Phase changes are always sent so the
 * UI switches to "text fallback" immediately.
 */
const createProgressPublisher = (notifier: RpcClient<WebviewApi>, requestId: string) => {
  let lastSent = 0;
  let lastPhase: ComposeProgress["phase"] | undefined;

  return (progress: ComposeProgress): void => {
    const now = Date.now();
    if (progress.phase === lastPhase && now - lastSent < PROGRESS_INTERVAL_MS) {
      return;
    }
    lastSent = now;
    lastPhase = progress.phase;
    notifier.notify("llm.progress", {
      requestId,
      phase: progress.phase,
      receivedChars: progress.receivedChars,
    });
  };
};

/**
 * Registers every host-side RPC handler for one composer panel.
 *
 * Returns a cleanup that aborts in-flight generations. The panel calls it
 * on dispose so a closed webview does not keep streaming from the
 * provider in the background.
 */
export const registerClientHandler = (
  client: RpcClient<HostApi>,
  notifier: RpcClient<WebviewApi>,
  runtime: ManagedRuntime.ManagedRuntime<
    LoggerService | SecretService | GitService | LLMService | LLMConfigService,
    never
  >,
  repositoryRoot: string,
): (() => void) => {
  const registerRPCHandler = registerEffectHandler(client, runtime);

  /** In-flight generation per webview-issued request id. */
  const generations = new Map<string, AbortController>();

  registerRPCHandler("git.getChangedFiles", () =>
    Effect.gen(function* () {
      const git = yield* GitService;
      return yield* git.getChangedFiles(repositoryRoot);
    }),
  );
  registerRPCHandler("git.getFileDiff", ({ path }) =>
    Effect.gen(function* () {
      const git = yield* GitService;
      return yield* git.getFileDiff(repositoryRoot, path);
    }),
  );

  registerRPCHandler("llm.getConfig", () =>
    Effect.gen(function* () {
      const config = yield* LLMConfigService;
      return yield* config.getConfig();
    }),
  );

  registerRPCHandler("llm.generateCommits", ({ requestId, paths, prompt }) =>
    Effect.gen(function* () {
      const controller = new AbortController();
      generations.set(requestId, controller);
      const publishProgress = createProgressPublisher(notifier, requestId);

      // Read per call so a settings edit applies without reloading.
      const maxPromptChars = vscode.workspace
        .getConfiguration("patchwork.llm")
        .get<number>("maxPromptChars", DEFAULT_MAX_DIFF_CHARS);

      return yield* generateCommits({
        repositoryRoot,
        files: paths.map((path) => ({ path })),
        prompt,
        maxPromptChars,
        abortSignal: controller.signal,
        onProgress: publishProgress,
      }).pipe(
        Effect.mapError((cause): LLMGenerateError =>
          cause instanceof LLMGenerateError ? cause : toLLMGenerateError(cause),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            generations.delete(requestId);
          }),
        ),
      );
    }),
  );

  // Notifications get no reply. The webview aborts its own promise first;
  // this stops the provider request behind it.
  registerRPCHandler("llm.cancelGenerate", ({ requestId }) =>
    Effect.sync(() => {
      generations.get(requestId)?.abort();
      generations.delete(requestId);
    }),
  );

  registerRPCHandler("git.commitPlan", ({ paths, commits, idempotencyKey }) =>
    Effect.gen(function* () {
      const runHooks = vscode.workspace
        .getConfiguration("patchwork.commits")
        .get<boolean>("runHooks", false);
      return yield* commitPlan({ repositoryRoot, paths, commits, idempotencyKey, runHooks });
    }),
  );

  registerRPCHandler("secrets.setApiKey", ({ provider, key }) =>
    Effect.gen(function* () {
      const secrets = yield* SecretService;
      yield* secrets.setApiKey(provider, key);
    }),
  );

  registerRPCHandler("llm.updateConfig", (patch) =>
    Effect.gen(function* () {
      const configService = yield* LLMConfigService;
      return yield* configService.update(patch);
    }),
  );

  registerRPCHandler("secrets.clearApiKey", ({ provider }) =>
    Effect.gen(function* () {
      const secrets = yield* SecretService;
      yield* secrets.deleteApiKey(provider);
      const configService = yield* LLMConfigService;
      return yield* configService.getConfig();
    }),
  );

  registerRPCHandler("llm.testConnection", () =>
    Effect.gen(function* () {
      const configService = yield* LLMConfigService;
      const llm = yield* LLMService;

      // The protocol's result is a discriminated union, so expected
      // failures are folded into it instead of being thrown. `RemoteError`
      // and the generic error banner are then reserved for transport and
      // programmer errors, not "your key is wrong". Config resolution is
      // inside the matched effect for the same reason: a missing key is a
      // test result, not an RPC failure.
      return yield* Effect.gen(function* () {
        const spec = yield* configService.resolveSpec().pipe(
          Effect.mapError(
            (cause: LLMConfigError) =>
              new LLMGenerateError({
                reason: cause.reason === "auth" ? "auth" : "unknown",
                message: cause.message,
                cause,
              }),
          ),
        );

        yield* llm
          .generate({
            model: spec,
            messages: [{ role: "user", content: "ping" }],
            temperature: 0,
          })
          .pipe(Effect.mapError(toLLMGenerateError));

        return spec.model;
      }).pipe(
        Effect.match({
          onSuccess: (model) => ({ ok: true as const, model }),
          onFailure: (cause) => ({
            ok: false as const,
            reason: cause.reason,
            message: cause.message,
          }),
        }),
      );
    }),
  );

  return () => {
    for (const controller of generations.values()) {
      controller.abort();
    }
    generations.clear();
  };
};
