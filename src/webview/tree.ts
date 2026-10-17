import type { ChangedFile } from "../rpc/git-types";

export interface TreeDir {
  readonly kind: "dir";
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly children: readonly TreeNode[];
}

export interface TreeFile {
  readonly kind: "file";
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly file: ChangedFile;
}

export type TreeNode = TreeDir | TreeFile;

// Deterministic and independent of input order, so `memo` stays stable.
export function buildFileTree(files: readonly ChangedFile[]): readonly TreeNode[] {
  const root = new MutableDir("", "");
  for (const file of files) {
    insertPath(root, file);
  }
  return root.finalise(0);
}

function insertPath(root: MutableDir, file: ChangedFile): void {
  const segments = file.path.split("/").filter(Boolean);
  const fileName = segments.pop();
  if (fileName === undefined) {
    return;
  }

  let cursor = root;
  for (const segment of segments) {
    const existing = cursor.children.get(segment);
    if (existing instanceof MutableDir) {
      cursor = existing;
      continue;
    }
    const child = new MutableDir(cursor.path ? `${cursor.path}/${segment}` : segment, segment);
    cursor.children.set(segment, child);
    cursor = child;
  }

  cursor.children.set(fileName, file);
}

/**
 * Mutable directory used only while building. Kept separate from the
 * public `TreeDir` so consumers can never observe a half-built tree
 * (no `depth`).
 */
class MutableDir {
  readonly children = new Map<string, MutableDir | ChangedFile>();

  constructor(
    readonly path: string,
    readonly name: string,
  ) {}

  finalise(depth: number): readonly TreeNode[] {
    const dirs: TreeDir[] = [];
    const files: TreeFile[] = [];

    for (const [name, child] of this.children) {
      if (child instanceof MutableDir) {
        const nested = child.finalise(depth + 1);
        dirs.push({
          kind: "dir",
          path: child.path,
          name,
          depth,
          children: nested,
        });
      } else {
        files.push({
          kind: "file",
          path: child.path,
          name,
          depth,
          file: child,
        });
      }
    }

    // Directories first, then files — each group alphabetical and
    // case-insensitive so `src` sorts before `Src`.
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    dirs.sort(byName);
    files.sort(byName);

    return [...dirs, ...files];
  }
}

/**
 * Flattens the tree into the rows that should actually be rendered,
 * honouring the collapsed set.
 *
 * A collapsed directory contributes a single row and its subtree is
 * skipped entirely. Keeping this a pure projection (rather than
 * recursive rendering with early returns) means the row list is a
 * memoisable value, so row component identity stays stable.
 */
export function flattenTree(
  nodes: readonly TreeNode[],
  collapsed: ReadonlySet<string>,
): readonly TreeNode[] {
  const rows: TreeNode[] = [];
  const walk = (list: readonly TreeNode[]) => {
    for (const node of list) {
      rows.push(node);
      if (node.kind === "dir" && !collapsed.has(node.path)) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return rows;
}
