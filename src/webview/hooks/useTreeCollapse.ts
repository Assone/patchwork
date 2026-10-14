import { useCallback, useMemo, useState } from "react";
import { allDirPaths, flattenTree, type TreeNode } from "../tree";

/**
 * Owns which directories in the changed-files tree are collapsed.
 *
 * Every directory starts expanded — same as the VS Code SCM view, where
 * changed files are always revealed. The hook exposes the flattened row
 * list so callers can render a flat `<ul>` while keeping the tree
 * structure intact in state.
 *
 * `collapsed` is a `Set<string>` of directory paths; `toggle` is stable
 * and uses a functional update so it never closes over a stale set.
 */
export interface UseTreeCollapse {
  readonly rows: readonly TreeNode[];
  readonly isCollapsed: (dirPath: string) => boolean;
  readonly toggle: (dirPath: string) => void;
  readonly expandAll: () => void;
  readonly collapseAll: () => void;
}

export function useTreeCollapse(tree: readonly TreeNode[]): UseTreeCollapse {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const isCollapsed = useCallback((dirPath: string) => collapsed.has(dirPath), [collapsed]);

  const toggle = useCallback((dirPath: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setCollapsed(() => new Set());
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsed(() => new Set(allDirPaths(tree)));
  }, [tree]);

  // Rows are derived, not stored — collapsing is pure projection of the
  // tree plus the collapsed set, so there is no chance of drift.
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  return { rows, isCollapsed, toggle, expandAll, collapseAll };
}
