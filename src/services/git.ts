import { Context, Data, Effect } from "effect";

export type FileChangeType =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "type-changed"
  | "conflicted";

export interface ChangedFile {
  readonly path: string;
  readonly originalPath?: string;
  readonly type: FileChangeType;
  readonly staged: boolean;
  readonly unstaged: boolean;
}

export type DiffArea = "staged" | "unstaged";

export type GitOperation = "diff" | "status" | "ls-files";

export class GitServiceError extends Data.TaggedError("GitServiceError")<{
  readonly operation: GitOperation;
  readonly cwd: string;
  readonly cause: unknown;
}> {}

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
