import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useHostNotifications } from "../rpc-context";
import type { RepositoryChangeReason } from "../../rpc/git-types";
import { repoKeys } from "./queryKeys";

/**
 * Subscribes to the host's "repository changed" notifications and
 * invalidates the affected cached reads.
 *
 * This is what turns the UI from a snapshot into a live view: without
 * it, staging a file from the VS Code source control view would never
 * be reflected here, because nothing would tell us to re-read.
 *
 * We never invalidate `repoKeys.all`: that would discard diffs that are
 * still perfectly valid and re-fetch more than necessary.
 */
export function useRepositoryInvalidation(): void {
  // `useHostNotifications` is the webview's handling side: the host
  // sends `repo.invalidate` and we serve it.
  const notifications = useHostNotifications();
  const queryClient = useQueryClient();

  useEffect(() => {
    const unregister = notifications.register("repo.invalidate", async ({ reason }) => {
      const { diff, files } = INVALIDATION_BY_REASON[reason];

      // Both invalidations are independent, so don't serialize them —
      // awaiting the diffs first would visibly lag the file list.
      await Promise.all([
        diff && queryClient.invalidateQueries({ queryKey: repoKeys.files() }),
        files && queryClient.invalidateQueries({ queryKey: repoKeys.changedFiles() }),
      ]);
    });

    return unregister;
  }, [notifications, queryClient]);
}

/**
 * What each change could have invalidated.
 *
 * A table rather than a conditional so the host's whole vocabulary is
 * covered: adding a reason to `RepositoryChangeReason` is a compile
 * error here until someone decides what it invalidates, instead of
 * silently falling into a default.
 *
 * - `diff` — file contents may differ, so cached diffs are stale.
 * - `files` — the changed-file list may differ.
 */
const INVALIDATION_BY_REASON: Readonly<
  Record<RepositoryChangeReason, { readonly diff: boolean; readonly files: boolean }>
> = {
  // Staging, HEAD moves, and edits on disk all touch content.
  state: { diff: true, files: true },
  index: { diff: true, files: true },
  workingTree: { diff: true, files: true },
  // The set of repositories changed, but existing diffs still describe
  // the same content.
  opened: { diff: false, files: true },
  closed: { diff: false, files: true },
};
