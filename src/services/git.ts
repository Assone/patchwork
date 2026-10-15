import { Context, Data, Effect } from "effect";
import type { ChangedFile, DiffArea } from "../rpc/git-types";

/**
 * The data types (`ChangedFile`, `DiffArea`, `FileChangeType`) live in
 * `../rpc/git-types` so the webview can share them without pulling in
 * `effect`. They are re-exported here because host-side callers
 * already import them from this module.
 */
export type { ChangedFile, DiffArea, FileChangeType } from "../rpc/git-types";

export class GitServiceError extends Data.TaggedError("GitServiceError")<{
  readonly operation: GitOperation;
  readonly cwd: string;
  readonly cause: unknown;
}> {}

export type GitOperation = "diff" | "status" | "ls-files";

interface GitServiceApi {
  readonly getChangedFiles: (
    repositoryRoot: string,
  ) => Effect.Effect<readonly ChangedFile[], GitServiceError>;
  readonly getFileDiff: (
    repositoryRoot: string,
    path: string,
    area: DiffArea,
  ) => Effect.Effect<string, GitServiceError>;
}

export class GitService extends Context.Service<GitService, GitServiceApi>()(
  "patchwork/GitService",
) {}
