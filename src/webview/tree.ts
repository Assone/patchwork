import type { ChangedFile } from "../rpc/git-types";

/**
 * A directory node in the changed-files tree.
 *
 * Directories own their children; files are leaves carrying the change
 * metadata. Intermediate directories are only created for paths that
 * actually lead to a changed file, so there are never empty folders.
 */
export interface TreeDir {
  readonly kind: "dir";
  /** Full path from the repo root, e.g. `src/webview/components`. */
  readonly path: string;
  /** Last path segment only, e.g. `components`. */
  readonly name: string;
  readonly depth: number;
  readonly children: readonly TreeNode[];
}

/** A changed-file leaf. */
export interface TreeFile {
  readonly kind: "file";
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly file: ChangedFile;
}

export type TreeNode = TreeDir | TreeFile;

/**
 * Builds a directory tree from a flat list of changed files.
 *
 * Paths are treated as `/`-separated and repo-root-relative. Siblings are
 * sorted directories-first, then case-insensitively by name — the same
 * ordering VS Code uses in its explorer views.
 *
 * The result is fully deterministic and independent of input order, which
 * keeps `memo` comparisons stable.
 */
export function buildFileTree(files: readonly ChangedFile[]): readonly TreeNode[] {
  const root = new MutableDir("", "");
  for (const file of files) {
    root.insert(file);
  }
  return root.finalise(0);
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

  insert(file: ChangedFile): void {
    const segments = file.path.split("/").filter(Boolean);
    const fileName = segments.pop();
    if (fileName === undefined) {
      return;
    }

    let cursor: MutableDir = this;
    for (const segment of segments) {
      const existing = cursor.children.get(segment);
      if (existing instanceof MutableDir) {
        cursor = existing;
        continue;
      }
      // A file already occupied this name; the directory wins because a
      // changed file can never also be a parent directory.
      const child = new MutableDir(cursor.path ? `${cursor.path}/${segment}` : segment, segment);
      cursor.children.set(segment, child);
      cursor = child;
    }

    cursor.children.set(fileName, file);
  }

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
 * Collects every directory path in the tree, depth-first.
 *
 * Used by `collapseAll` to snapshot the full set in one pass.
 */
export function allDirPaths(nodes: readonly TreeNode[]): readonly string[] {
  const paths: string[] = [];
  const walk = (list: readonly TreeNode[]) => {
    for (const node of list) {
      if (node.kind === "dir") {
        paths.push(node.path);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return paths;
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
