import { useQuery } from "@tanstack/react-query";
import { useRpc } from "../rpc-context";
import { parser, type FileDiff } from "../../diff";
import { repoKeys, HOST_READ_TIMEOUT_MS } from "./queryKeys";

/**
 * The unified diff for one focused file.
 *
 * Cached per path, so switching between files and back is instant
 * instead of re-issuing an RPC each time — the previous version of this
 * hook re-fetched on every focus change.
 *
 * The caller passes only a path. Whether the interesting diff is the
 * staged one or the working-tree one is decided by the host, which
 * already knows each file's flags — the webview has no business knowing
 * git has two kinds of diff.
 */
export interface FocusedFileDiffState {
  readonly file: FileDiff | undefined;
  readonly loading: boolean;
  readonly error: Error | null;
}

export function useFocusedFileDiff(path: string | null): FocusedFileDiffState {
  const client = useRpc();

  // `refetchOnWindowFocus` and `retry` come from the QueryClient's
  // defaults (see main.tsx) — restating them here would let the copies
  // drift apart.
  const query = useQuery({
    queryKey: repoKeys.file(path ?? ""),
    queryFn: async (): Promise<FileDiff | undefined> => {
      const raw = await client.call(
        "git.getFileDiff",
        { path: path! },
        {
          timeoutMs: HOST_READ_TIMEOUT_MS,
        },
      );
      const parsed = parser(raw);
      // RPC delivers one path's diff; the parser walks a multi-file
      // stream, so pick the first file whose `newPath` matches.
      return parsed.find((entry) => entry.newPath === path || entry.oldPath === path);
    },
    // Nothing selected: don't fire a request for an empty path.
    enabled: path !== null,
  });

  return {
    file: query.data,
    loading: query.isPending && path !== null,
    error: query.error,
  };
}
