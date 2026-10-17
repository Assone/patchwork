import { useCallback, useMemo, useState } from "react";
import { flattenTree, type TreeNode } from "../tree";

export interface UseTreeCollapse {
  readonly rows: readonly TreeNode[];
  readonly isCollapsed: (dirPath: string) => boolean;
  readonly toggle: (dirPath: string) => void;
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

  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  return { rows, isCollapsed, toggle };
}
