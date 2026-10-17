import type { DiffFileKind, DiffHunk } from "../domain/diff/types";
import type { FileChangeType } from "./git-types";

/**
 * Wire shapes for hunk-level composition. Kept dependency-free so the
 * extension host and the webview can share one definition.
 */

export interface FileView {
  readonly path: string;
  readonly oldPath: string;
  readonly diffKind: DiffFileKind;
  readonly oldMode?: string;
  readonly newMode?: string;
  readonly oldHash?: string;
  readonly newHash?: string;
  readonly additions: number;
  readonly deletions: number;
  readonly similarity?: number;
  readonly isBinary: boolean;
  readonly header: string;
  readonly hunks: readonly Omit<DiffHunk, "raw">[];
}

export interface UnitView {
  readonly id: string;
  readonly kind: "hunk" | "file";
  readonly path: string;
  readonly oldPath: string;
  readonly fileType: FileChangeType;
  readonly diffKind: DiffFileKind;
  readonly header?: string;
  readonly hunkIndex?: number;
  readonly oldStart?: number;
  readonly newStart?: number;
  readonly isBinary: boolean;
  readonly isLockFile: boolean;
}

export interface WireCommit {
  readonly id: string;
  readonly message: string;
  readonly hunkIds: readonly string[];
}

export interface GenerateCommitsResult {
  readonly headSha: string | null;
  readonly prompt: string;
  readonly paths: readonly string[];
  readonly files: readonly FileView[];
  readonly units: readonly UnitView[];
  readonly commits: readonly WireCommit[];
}

export interface CommitPlanPayload {
  readonly paths: readonly string[];
  readonly commits: readonly {
    readonly message: string;
    readonly hunkIds: readonly string[];
  }[];
  readonly idempotencyKey: string;
}

export interface CommitPlanResult {
  readonly hashes: readonly string[];
}
