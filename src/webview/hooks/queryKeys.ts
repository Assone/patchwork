/**
 * Query keys for the webview's cached host reads.
 *
 * Keys are declared once so invalidation can target a *scope* rather
 * than guessing strings: `repoKeys.all` invalidates every repository
 * read, `repoKeys.file(path)` only one file's diff. Invalidating "the
 * whole repository" on every keystroke-scale notification would throw
 * away diffs that are still perfectly valid.
 */
export const repoKeys = {
  all: ["repo"] as const,
  /** The changed-file list for the current repository. */
  changedFiles: () => [...repoKeys.all, "changedFiles"] as const,
  /** One file's diff. */
  file: (path: string) => [...repoKeys.all, "file", path] as const,
  /** Every per-file diff, but not the file list. */
  files: () => [...repoKeys.all, "file"] as const,
};

/**
 * How long to wait for git before giving up on a host read.
 *
 * Shared because every host read is a git subprocess: they all want the
 * same bound, and a per-hook copy would let them drift.
 */
export const HOST_READ_TIMEOUT_MS = 10_000;
