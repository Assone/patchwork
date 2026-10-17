import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRpc } from "../rpc-context";
import type { ChangedFile } from "../../rpc/git-types";
import { repoKeys, HOST_READ_TIMEOUT_MS } from "./queryKeys";

/**
 * The changed files for the current repository.
 *
 * Reads through TanStack Query so the result is cached, de-duplicated
 * across components, and re-fetched automatically when the host tells us
 * the repository changed (see `useRepositoryInvalidation`).
 *
 * The host owns git access and knows which repository is open, so this
 * takes no arguments. No Effect and no `vscode` import, so nothing
 * host-side leaks into this bundle.
 */
export interface ChangedFilesState {
  readonly files: readonly ChangedFile[];
  readonly loading: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

export function useChangedFiles(): ChangedFilesState {
  const client = useRpc();

  // `refetchOnWindowFocus` and `retry` are inherited from the
  // QueryClient's defaults (see main.tsx); restating them here would let
  // the two copies drift.
  const query = useQuery({
    queryKey: repoKeys.changedFiles(),
    queryFn: async (): Promise<readonly ChangedFile[]> => {
      return await client.call("git.getChangedFiles", undefined, {
        timeoutMs: HOST_READ_TIMEOUT_MS,
      });
    },
  });

  const refetchQuery = query.refetch;
  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);

  return {
    // Keep showing the previous list while revalidating so the file
    // tree doesn't blank out on every repository change.
    files: query.data ?? [],
    loading: query.isPending,
    error: query.error,
    refetch,
  };
}
