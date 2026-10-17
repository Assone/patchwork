import { createHash } from "node:crypto";
import { buildPatch, type DiffFileKind, type DiffHunk, type FileDiff } from "../../domain/diff";
import { isLockFile } from "../../domain/lock-files";
import type { ChangeSet } from "../../services/git";
import type { ChangedFile, FileChangeType } from "../../rpc/git-types";

export type UnitKind = "hunk" | "file";

/**
 * One indivisible thing the model can place in a commit.
 *
 * `patch` is exactly what `git apply --cached` consumes: a file header
 * plus either one hunk or the whole file (for atomic units). `text` is
 * what the model sees; it is empty for lock files, whose bodies are
 * deliberately withheld.
 */
export interface ComposeUnit {
  readonly id: string;
  readonly kind: UnitKind;
  readonly path: string;
  readonly oldPath: string;
  readonly fileType: FileChangeType;
  readonly diffKind: DiffFileKind;
  readonly header?: string;
  readonly hunkIndex?: number;
  readonly oldStart?: number;
  readonly newStart?: number;
  readonly text: string;
  readonly patch: string;
  readonly file: FileDiff;
  readonly hunks: readonly DiffHunk[];
  readonly isBinary: boolean;
  readonly isLockFile: boolean;
}

/** Units the model is asked to partition; lock units are host-pinned. */
export const contextUnits = (units: readonly ComposeUnit[]): readonly ComposeUnit[] =>
  units.filter((unit) => !unit.isLockFile);

export interface UnitBuildResult {
  readonly units: readonly ComposeUnit[];
  /** Selected files with no parsed diff (empty untracked files, for example). */
  readonly missing: readonly string[];
  readonly conflicted: readonly string[];
}

const hash = (value: string): string => createHash("sha256").update(value).digest("base64url");

const unitId = (parts: readonly unknown[]): string =>
  `u1_${hash(JSON.stringify(["patchwork-unit-v1", ...parts])).slice(0, 22)}`;

const pathOf = (file: FileDiff): string =>
  file.newPath === "/dev/null" ? file.oldPath : file.newPath;

const hasModeChange = (file: FileDiff): boolean =>
  file.oldMode !== undefined && file.newMode !== undefined && file.oldMode !== file.newMode;

const isAtomic = (file: FileDiff, path: string): boolean =>
  file.isBinary ||
  file.hunks.length === 0 ||
  file.type !== "modified" ||
  hasModeChange(file) ||
  isLockFile(path);

const atomicText = (file: FileDiff, path: string): string => {
  if (isLockFile(path)) {
    return "";
  }
  if (file.isBinary) {
    return "[binary file — diff withheld]";
  }
  if (file.type === "renamed" || file.type === "copied") {
    return `[whole file — ${file.type} from ${file.oldPath}]`;
  }
  if (hasModeChange(file)) {
    return `[whole file — mode ${file.oldMode} → ${file.newMode}]`;
  }
  if (file.hunks.length === 0) {
    return "[whole file — no textual diff]";
  }
  return "[whole file]";
};

const buildFileUnit = (file: FileDiff, status: ChangedFile | undefined): ComposeUnit => {
  const path = pathOf(file);
  return {
    id: unitId([
      "file",
      path,
      file.oldPath,
      file.type,
      file.oldMode ?? null,
      file.newMode ?? null,
      hash(file.raw),
    ]),
    kind: "file",
    path,
    oldPath: file.oldPath,
    fileType: status?.type ?? "modified",
    diffKind: file.type,
    text: atomicText(file, path),
    patch: file.raw,
    file,
    hunks: file.hunks,
    isBinary: file.isBinary,
    isLockFile: isLockFile(path),
  };
};

const buildHunkUnits = (file: FileDiff, status: ChangedFile | undefined): ComposeUnit[] => {
  const path = pathOf(file);
  return file.hunks.map((hunk, hunkIndex) => ({
    id: unitId([
      "hunk",
      path,
      file.oldPath,
      file.type,
      hunk.oldStart,
      hunk.newStart,
      hunk.header,
      hash(hunk.raw),
    ]),
    kind: "hunk" as const,
    path,
    oldPath: file.oldPath,
    fileType: status?.type ?? "modified",
    diffKind: file.type,
    header: hunk.header,
    hunkIndex,
    oldStart: hunk.oldStart,
    newStart: hunk.newStart,
    text: hunk.raw,
    patch: buildPatch(file, [hunk]),
    file,
    hunks: [hunk],
    isBinary: false,
    isLockFile: false,
  }));
};

/**
 * Build the model-facing units for a change set.
 *
 * Atomicity is a correctness rule, not a presentation choice: an added,
 * deleted, renamed, binary, lock, or mode-changed file cannot be split
 * across patches without producing a patch that fails to apply.
 */
export const buildUnits = (changeSet: ChangeSet): UnitBuildResult => {
  const units: ComposeUnit[] = [];
  const missing: string[] = [];
  const conflicted = changeSet.changedFiles
    .filter((file) => file.type === "conflicted")
    .map((file) => file.path);
  const parsedByPath = new Map<string, FileDiff>();

  for (const file of changeSet.files) {
    parsedByPath.set(pathOf(file), file);
    if (file.oldPath !== "/dev/null") {
      parsedByPath.set(file.oldPath, file);
    }
  }

  for (const status of changeSet.changedFiles) {
    if (status.type === "conflicted") {
      continue;
    }
    const file = parsedByPath.get(status.path);
    if (file === undefined) {
      missing.push(status.path);
      continue;
    }
    const path = pathOf(file);
    if (isAtomic(file, path)) {
      units.push(buildFileUnit(file, status));
    } else {
      units.push(...buildHunkUnits(file, status));
    }
  }

  return { units, missing, conflicted };
};
