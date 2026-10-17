import { useCallback, useMemo, useState } from "react";
import { isLockedPath } from "../../domain/lock-files";

export interface Selection {
  readonly selected: ReadonlySet<string>;
  readonly count: number;
  readonly toggle: (path: string) => void;
  readonly replace: (paths: Iterable<string>) => void;
  readonly clear: () => void;
}

/**
 * User-chosen paths. Lock files are added as a derived overlay rather
 * than written into the state, so a lock file that stops changing
 * disappears from the selection instead of becoming a stale path.
 */
const NO_LOCK_FILES: readonly string[] = [];

export function useSelection(lockFiles: readonly string[] = NO_LOCK_FILES): Selection {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());

  const selected = useMemo(() => {
    const missing = lockFiles.filter((path) => !chosen.has(path));
    if (missing.length === 0) {
      return chosen;
    }
    const next = new Set(chosen);
    for (const path of missing) {
      next.add(path);
    }
    return next;
  }, [chosen, lockFiles]);

  const toggle = useCallback((path: string) => {
    if (isLockedPath(path)) {
      return;
    }
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const replace = useCallback((paths: Iterable<string>) => {
    setChosen(new Set(paths));
  }, []);

  const clear = useCallback(() => {
    setChosen(new Set());
  }, []);

  return { selected, count: selected.size, toggle, replace, clear };
}
