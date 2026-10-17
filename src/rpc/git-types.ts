// Shared by both bundles; keep this module free of `vscode` and `effect`.
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

export type RepositoryChangeReason = "state" | "closed" | "opened";
