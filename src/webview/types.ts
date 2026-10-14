/**
 * Webview-side mirror of `ChangedFile` from `services/git.ts`.
 *
 * The extension host and the webview run in separate JS contexts; we
 * intentionally don't import across the boundary in either direction at
 * compile time. The contract is "whatever JSON shape the IPC layer
 * hands us". Keeping a local copy here lets the webview typecheck in
 * isolation and gives us a single seam to evolve (e.g. switch to a
 * generated types package) without touching every consumer.
 */
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
