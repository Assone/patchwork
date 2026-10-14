import { useState } from "react";
import { MOCK_CHANGED_FILES } from "../mocks/changed-files";
import type { ChangedFile } from "../types";

/**
 * Provides the list of changed files for the current repository.
 *
 * Today this returns the mock list synchronously. When the real git
 * service lands, this hook will:
 *   1. set `loading: true` immediately,
 *   2. fire `GitService.getChangedFiles(repoRoot)` (over IPC),
 *   3. write the result into `files` and flip `loading` / `error`.
 *
 * The shape is already async-friendly so consumers don't need to change.
 */
export interface ChangedFilesState {
  readonly files: readonly ChangedFile[];
  readonly loading: boolean;
  readonly error: Error | null;
}

export function useChangedFiles(): ChangedFilesState {
  const [files] = useState<readonly ChangedFile[]>(MOCK_CHANGED_FILES);
  return { files, loading: false, error: null };
}
