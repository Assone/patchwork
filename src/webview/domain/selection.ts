import type { ChangedFile } from "../../rpc/git-types";

/**
 * The composer's initial selection: files that already have something in
 * the index.
 *
 * A partially staged file counts, because its staged side is exactly what
 * the user just prepared. Untracked files, unstaged-only edits, and
 * conflicted entries (which cannot be committed anyway) stay unselected so
 * opening the panel never silently sweeps in work the user has not staged.
 */
export const stagedPaths = (files: readonly ChangedFile[]): readonly string[] =>
  files.filter((file) => file.staged && file.type !== "conflicted").map((file) => file.path);
