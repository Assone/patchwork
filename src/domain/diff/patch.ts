import type { DiffHunk, FileDiff } from "./types";

/**
 * `git apply` does not need the blob hashes, and leaving the line in a
 * partial patch would describe a full-file result that does not exist.
 * Binary patches need it and are returned whole, so this only runs on
 * text patches.
 */
const INDEX_LINE = /^index [0-9a-f]+\.\.[0-9a-f]+(?: [0-7]{6})?\r?\n/m;

export const stripIndexLine = (patch: string): string => patch.replace(INDEX_LINE, "");

/**
 * The patch for `hunks` of `file`, in the file's canonical hunk order.
 *
 * Atomic files (binary, mode-only, added/deleted/renamed) have no
 * meaningful hunk split; callers pass all of their hunks and get the
 * original patch bytes back.
 */
export const buildPatch = (file: FileDiff, hunks: readonly DiffHunk[]): string => {
  if (file.isBinary || file.hunks.length === 0) {
    return file.raw;
  }

  if (hunks.length === 0) {
    return "";
  }

  const selected = new Set(hunks);
  const body = file.hunks
    .filter((hunk) => selected.has(hunk))
    .map((hunk) => hunk.raw)
    .join("");

  if (body.length === 0) {
    return "";
  }

  return stripIndexLine(file.header) + body;
};
