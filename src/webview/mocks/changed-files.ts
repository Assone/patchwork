import type { ChangedFile } from "../types";

/**
 * Mock changeset used while the real git integration is being built.
 *
 * Covers a realistic mix of change types and staging states so the file
 * tree and diff view have something representative to render. Each entry
 * is `as const`-friendly and uses stable paths so tests / stories can
 * rely on them.
 */
export const MOCK_CHANGED_FILES: readonly ChangedFile[] = [
  {
    path: "src/webview/App.tsx",
    type: "modified",
    staged: true,
    unstaged: false,
  },
  {
    path: "src/webview/components/CommitComposer.tsx",
    type: "modified",
    staged: false,
    unstaged: true,
  },
  {
    path: "src/webview/hooks/useCommitDraft.ts",
    type: "added",
    staged: true,
    unstaged: false,
  },
  {
    path: "src/webview/hooks/useSelection.ts",
    type: "added",
    staged: false,
    unstaged: true,
  },
  {
    path: "src/services/git.ts",
    type: "modified",
    staged: false,
    unstaged: true,
  },
  {
    path: "src/services/secret.ts",
    type: "deleted",
    staged: true,
    unstaged: false,
  },
  {
    path: "src/mocks/changed-files.ts",
    type: "untracked",
    staged: false,
    unstaged: true,
  },
];
