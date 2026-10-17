import type { ChangedFile, RepositoryChangeReason } from "./git-types";
import type { CommitPlanPayload, CommitPlanResult, GenerateCommitsResult } from "./commit-types";
import type { LLMConfigPatch, LLMConfigView, TestConnectionResult } from "./config-types";

/* ------------------------------------------------------------------ *
 * Contract
 * ------------------------------------------------------------------ */

/**
 * Methods the extension host serves to the webview.
 *
 * Every payload and result must be JSON-only — everything here is
 * structured-cloned by `postMessage`. `ChangedFile` comes from
 * `./git-types`, which has no `effect` dependency, so importing this
 * module into the webview bundle stays clean.
 */
export type HostApi = {
  /** Fetch the changed files for the current repository. */
  readonly "git.getChangedFiles": {
    readonly payload: undefined;
    readonly result: readonly ChangedFile[];
  };
  /**
   * Fetch the unified HEAD→worktree diff for one file.
   *
   * The webview passes only a path; the host decides how to obtain the
   * diff (including the untracked-file fallback). Returns the raw patch
   * text, empty when the file has no changes.
   */
  readonly "git.getFileDiff": {
    readonly payload: { readonly path: string };
    readonly result: string;
  };

  /* ------------------------------------------------------------------ *
   * LLM methods
   *
   * The webview holds the selection (a list of file paths), the user's
   * prompt, and the commit-shape state machine. The host owns the diff
   * text (it has the git binary) and the LLM layer (it has the secret
   * store). The composer therefore asks the host for "draft N commits
   * from these files + this prompt", and the host does the rest:
   *
   *   1. fetch raw diffs,
   *   2. project them through the LLM with a structured-output schema,
   *   3. return the proposed commits.
   *
   * All failures collapse into `LLMGenerateError` (its name survives the
   * wire; see `serializeError` / `RemoteError`). The webview branches on
   * `.reason` to render the right banner.
   * ------------------------------------------------------------------ */

  readonly "llm.getConfig": {
    readonly payload: undefined;
    readonly result: LLMConfigView;
  };

  /**
   * Draft N commits from the selected files + prompt. The host fetches
   * the diff for each file (staged/unstaged decided by the host's
   * existing `getFileDiff` rules), asks the LLM to partition them, and
   * returns the proposed partition.
   *
   * `requestId` ties progress notifications and `llm.cancelGenerate` to
   * this call. The webview generates it so a late progress frame from an
   * abandoned request can be ignored.
   *
   * The webview passes an `AbortSignal` at the transport level (see
   * `RpcCallOptions`): cancelling rejects the caller's promise
   * immediately. Call `llm.cancelGenerate` as well so the host stops
   * talking to the provider instead of finishing in the background.
   */
  readonly "llm.generateCommits": {
    readonly payload: {
      readonly requestId: string;
      readonly paths: readonly string[];
      readonly prompt: string;
    };
    readonly result: GenerateCommitsResult;
  };

  /**
   * Ask the host to abort an in-flight `llm.generateCommits` call.
   *
   * Sent as a notification: the caller has already rejected its own
   * promise, so there is nothing to wait for. Unknown or already-finished
   * ids are ignored.
   */
  readonly "llm.cancelGenerate": {
    readonly payload: { readonly requestId: string };
    readonly result: void;
  };

  /**
   * Apply a previously generated plan. The host re-derives the units
   * from the current HEAD→worktree diff and rejects a stale plan; the
   * `idempotencyKey` makes a retried call safe after the first one has
   * already moved HEAD.
   */
  readonly "git.commitPlan": {
    readonly payload: CommitPlanPayload;
    readonly result: CommitPlanResult;
  };
  /**
   * Stores an API key in VS Code's encrypted `SecretStorage`. The webview
   * uses this from its "configure model" form; the host is the only
   * process that can talk to `SecretStorage`, so this is the typed
   * bridge.
   */
  readonly "secrets.setApiKey": {
    readonly payload: { readonly provider: string; readonly key: string };
    readonly result: void;
  };

  /**
   * Apply a single-field update to the LLM configuration.
   *
   * Each field is optional and only present fields are written —
   * passing only `{ provider }` swaps providers without touching the
   * model or baseURL.
   *
   * API keys are intentionally *not* handled here: they live in VS
   * Code's encrypted `SecretStorage` and the webview cannot read them
   * back, so showing an "API key is set" status without ever displaying
   * the value is the only safe shape. Set the key via
   * `secrets.setApiKey`; clear it via `secrets.clearApiKey`.
   *
   * Returns the snapshot after the write, so the webview can update
   * its "currently using X" line without an extra round-trip.
   */
  readonly "llm.updateConfig": {
    readonly payload: LLMConfigPatch;
    readonly result: LLMConfigView;
  };

  /**
   * Erase the stored API key for a provider. Used by the settings panel's
   * "Clear" button. Returns the post-clear snapshot.
   *
   * Mirrors `secrets.setApiKey` so the API key surface stays symmetric
   * (set / clear) rather than only set.
   */
  readonly "secrets.clearApiKey": {
    readonly payload: { readonly provider: string };
    readonly result: LLMConfigView;
  };

  /**
   * Smoke-test the configured LLM endpoint with a tiny request.
   *
   * Used by the settings panel's "Test connection" button to give the
   * user immediate feedback on whether the API key / model id / baseURL
   * they just typed actually works. The test sends a single-token
   * generation; on failure the original `cause` is collapsed into the
   * same `LLMGenerateError` shape the host returns to the composer,
   * so the settings panel renders the same banner it would in the
   * composer.
   *
   * The webview never invokes the LLM layer directly — it has no
   * access to the secret store — so this is the only place that
   * surfaces "yes, that combination works" feedback.
   */
  readonly "llm.testConnection": {
    readonly payload: undefined;
    readonly result: TestConnectionResult;
  };
};

/**
 * Notifications the host sends *to* the webview — fire-and-forget, no
 * reply. The webview is the handling side here.
 *
 * This is the push half of the data flow. Without it the webview can
 * only ever show a snapshot taken at mount: if the user stages a file
 * from the VS Code UI, nothing tells us to re-read the repository.
 */
export type WebviewApi = {
  /**
   * The repository changed and cached reads are stale.
   *
   * The payload carries only *why* — the webview is told *that* things
   * changed and re-reads through the normal request methods. Pushing the
   * new state here would mean serialising a whole file list into every
   * notification.
   *
   * `reason` is the host's own union (see `./git-types`), not `string`,
   * so a consumer that switches on it is checked against what the host
   * can actually emit.
   */
  readonly "repo.invalidate": {
    readonly payload: { readonly reason: RepositoryChangeReason };
    /** Notifications have no reply channel, so there is no result. */
    readonly result: void;
  };

  /**
   * Incremental output from `llm.generateCommits`.
   *
   * Throttled by the host (a few frames per second), so it proves the
   * request is alive without flooding the message channel. `requestId`
   * matches the one sent with the call; `phase` says which attempt —
   * structured output or the text fallback — is streaming.
   */
  readonly "llm.progress": {
    readonly payload: {
      readonly requestId: string;
      readonly phase: "structured" | "text";
      readonly receivedChars: number;
    };
    readonly result: void;
  };
};
