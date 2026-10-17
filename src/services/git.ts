import { Context, Data, Effect } from "effect";
import type { FileDiff } from "../domain/diff";
import type { ChangedFile } from "../rpc/git-types";

export type { ChangedFile, FileChangeType } from "../rpc/git-types";

export type GitOperation =
  | "diff"
  | "status"
  | "ls-files"
  | "rev-parse"
  | "read-tree"
  | "apply"
  | "write-tree"
  | "commit-tree"
  | "commit"
  | "update-ref"
  | "restore";

export class GitServiceError extends Data.TaggedError("GitServiceError")<{
  readonly message: string;
  readonly operation: GitOperation;
  readonly cwd: string;
  readonly cause: unknown;
}> {}

export type CommitWriteReason =
  | "stale-plan"
  | "index-locked"
  | "merge-in-progress"
  | "unmerged"
  | "apply-failed"
  | "empty-commit"
  | "ref-conflict"
  | "identity-missing"
  | "index-sync-failed"
  | "hook-failed";

export type CommitWriteStep =
  | "precondition"
  | "identity"
  | "apply"
  | "write-tree"
  | "commit"
  | "update-ref"
  | "index-sync";

export class CommitWriteError extends Data.TaggedError("CommitWriteError")<{
  readonly message: string;
  readonly reason: CommitWriteReason;
  readonly step: CommitWriteStep;
  readonly cwd: string;
  /** Present when the commits were written but a later step failed. */
  readonly hashes?: readonly string[];
  readonly cause?: unknown;
}> {}

/**
 * HEAD→working-tree diff for the requested paths.
 *
 * `headSha` is null on an unborn branch. `changedFiles` is the status
 * snapshot used to distinguish untracked and conflicted files; the
 * parsed `files` come from one combined diff, so a partially staged
 * file appears once with all of its changes.
 */
export interface ChangeSet {
  readonly headSha: string | null;
  readonly changedFiles: readonly ChangedFile[];
  readonly files: readonly FileDiff[];
}

export interface CommitToWrite {
  readonly message: string;
  /** Patches are grouped per path and applied in array order. */
  readonly patches: readonly { readonly path: string; readonly patch: string }[];
}

export interface CreateCommitsOptions {
  /**
   * Retries with the same key return the first result instead of
   * re-deriving the plan after HEAD has moved.
   */
  readonly idempotencyKey?: string;
  /**
   * Commit through `git commit` with the temporary index so repository
   * hooks run. This gives up atomicity: a hook failure after the first
   * commit leaves earlier commits on the branch.
   */
  readonly runHooks?: boolean;
}

export interface GitServiceApi {
  readonly getChangedFiles: (
    repositoryRoot: string,
  ) => Effect.Effect<readonly ChangedFile[], GitServiceError>;
  readonly getChangeSet: (
    repositoryRoot: string,
    paths?: readonly string[],
  ) => Effect.Effect<ChangeSet, GitServiceError>;
  /** Raw HEAD→worktree diff for one file; the webview parses it. */
  readonly getFileDiff: (
    repositoryRoot: string,
    path: string,
  ) => Effect.Effect<string, GitServiceError>;
  readonly createCommits: (
    repositoryRoot: string,
    commits: readonly CommitToWrite[],
    options?: CreateCommitsOptions,
  ) => Effect.Effect<readonly string[], GitServiceError | CommitWriteError>;
}

export class GitService extends Context.Service<GitService, GitServiceApi>()(
  "patchwork/GitService",
) {}
