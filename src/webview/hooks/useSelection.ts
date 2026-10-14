import { useCallback, useMemo, useState } from "react";

/**
 * Tracks the set of files the user has selected for the next commit.
 *
 * Uses `Set<string>` for O(1) toggle / membership checks and exposes a
 * memoized `count` so consumers don't have to recompute it. All mutators
 * are stable via `useCallback` and use functional setState, so they
 * never close over stale state.
 */
export interface Selection {
  /** The underlying set, exposed so consumers can pass it as a prop. */
  readonly selected: ReadonlySet<string>;
  readonly count: number;
  readonly toggle: (path: string) => void;
  /** Replace the whole selection, e.g. for "select all". */
  readonly replace: (paths: Iterable<string>) => void;
  readonly clear: () => void;
}

export function useSelection(): Selection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((path: string) => {
    setSelected((current) => {
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
    setSelected(() => new Set(paths));
  }, []);

  const clear = useCallback(() => {
    setSelected(() => new Set());
  }, []);

  // Set is rebuilt only when the underlying set identity changes (i.e. on
  // toggle/clear). `count` is cheap but memoizing it lets consumers put it
  // in a dependency array without forcing extra work.
  const count = useMemo(() => selected.size, [selected]);

  return { selected, count, toggle, replace, clear };
}
