import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "../rpc-context";
import type { ChangedFile } from "../../rpc/git-types";

/**
 * Provides the list of changed files by asking the extension host over
 * RPC.
 *
 * The host owns git access *and* knows which repository is open, so
 * this hook needs no repository argument — it just awaits a Promise.
 * No Effect and no `vscode` import, so nothing host-side leaks into
 * this bundle.
 */
export interface ChangedFilesState {
  readonly files: readonly ChangedFile[];
  readonly loading: boolean;
  readonly error: Error | null;
}

/** How long to wait for git before giving up on a refresh. */
const REFRESH_TIMEOUT_MS = 10_000;

export function useChangedFiles(): ChangedFilesState {
  const client = useRpc();
  const [files, setFiles] = useState<readonly ChangedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Guards against an earlier, slower response landing after a newer
  // refresh has already been issued.
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await client.call("git.getChangedFiles", undefined, {
        timeoutMs: REFRESH_TIMEOUT_MS,
      });

      console.log(result);
      if (id !== requestId.current) {
        return;
      }
      setFiles(result);
    } catch (cause) {
      if (id !== requestId.current) {
        return;
      }
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      if (id === requestId.current) {
        setLoading(false);
      }
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { files, loading, error };
}
