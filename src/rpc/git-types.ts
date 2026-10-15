/**
 * Data types shared between the extension host and the webview.
 *
 * This module is deliberately dependency-free — no `vscode`, no
 * `effect` — so both rspack bundles can import it. rspack builds each
 * entry's module graph independently, so a module reachable from both
 * `src/extension.ts` and `src/webview/main.tsx` is simply included in
 * both; there is no technical barrier to sharing, and sharing is the
 * right call: a single definition means a change to `ChangedFile`
 * cannot drift between the two sides of the wire.
 *
 * Host-only types (the `GitService` tag, its `Effect`-returning API,
 * and `GitServiceError`) stay in `./git`.
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

export type DiffArea = "staged" | "unstaged";

/**
 * Why the repository changed, for the host's `repo.invalidate` push.
 *
 * Declared here — next to `ChangedFile`, in the module both bundles
 * already share — so the host that produces it and the webview that
 * switches on it cannot disagree about the vocabulary. Adding a reason
 * is one edit, and any consumer with an exhaustive switch finds out.
 */
export type RepositoryChangeReason = "state" | "index" | "workingTree" | "closed" | "opened";
