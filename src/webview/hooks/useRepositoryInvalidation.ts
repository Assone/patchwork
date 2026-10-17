import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useHostNotifications } from "../rpc-context";
import type { RepositoryChangeReason } from "../../rpc/git-types";
import { repoKeys } from "./queryKeys";

/** Invalidates cached reads when the host reports a repository change. */
export function useRepositoryInvalidation(): void {
  const notifications = useHostNotifications();
  const queryClient = useQueryClient();

  useEffect(() => {
    const unregister = notifications.register("repo.invalidate", async ({ reason }) => {
      const { diff, files } = INVALIDATION_BY_REASON[reason];

      await Promise.all([
        diff && queryClient.invalidateQueries({ queryKey: repoKeys.files() }),
        files && queryClient.invalidateQueries({ queryKey: repoKeys.changedFiles() }),
      ]);
    });

    return unregister;
  }, [notifications, queryClient]);
}

// The exhaustive record makes a new reason a compile error here.
const INVALIDATION_BY_REASON: Readonly<
  Record<RepositoryChangeReason, { readonly diff: boolean; readonly files: boolean }>
> = {
  state: { diff: true, files: true },
  opened: { diff: true, files: true },
  closed: { diff: true, files: true },
};
