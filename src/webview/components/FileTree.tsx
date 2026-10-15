import { memo, useCallback, useId, useMemo } from "react";
import { useTreeCollapse } from "../hooks/useTreeCollapse";
import { buildFileTree, type TreeDir } from "../tree";

import { cn } from "../utils/cn";
import { Chevron } from "./Chevron";
import type { ChangedFile } from "../../rpc/git-types";

/** Horizontal pixels added per nesting level. */
const INDENT_PX = 10;
/** Fixed row height, matching the VS Code tree / SCM list. */
const ROW_H = 22;

/**
 * Tree of changed files, grouped by directory and collapsible per folder.
 *
 *   ┌────────────────────────────────────────────┐
 *   │ ▾ src                                  7   │
 *   │   ▾ webview                            4   │
 *   │     ☑ M App.tsx                            │
 *   │   ▸ services                            2   │
 *   │     ☐ M git.ts                              │
 *   └────────────────────────────────────────────┘
 *
 * Three independent interactions:
 *   - the chevron toggles a directory
 *   - the checkbox toggles commit membership
 *   - the row focuses the file in the diff pane
 *
 * Hover / focus highlight is applied to the whole `<li>` so the row reads
 * as a single surface rather than two disconnected targets.
 */
export interface FileTreeProps {
  readonly files: readonly ChangedFile[];
  readonly selected: ReadonlySet<string>;
  readonly focusedPath: string | null;
  readonly onToggle: (path: string) => void;
  readonly onFocus: (path: string) => void;
}

const FileTreeImpl: React.FC<FileTreeProps> = ({
  files,
  selected,
  focusedPath,
  onToggle,
  onFocus,
}) => {
  // Building the tree is O(files). Toggling a checkbox changes `selected`
  // but not `files`, so memoising on `files` keeps the tree identity
  // stable and lets `useTreeCollapse` skip re-flattening.
  const tree = useMemo(() => buildFileTree(files), [files]);
  const { rows, isCollapsed, toggle } = useTreeCollapse(tree);

  if (files.length === 0) {
    return <div className="text-foreground-muted flex-1 px-3 py-2">No changed files.</div>;
  }

  return (
    <ul className="m-0 flex-1 list-none overflow-auto p-0" aria-label="Changed files">
      {rows.map((node) =>
        node.kind === "dir" ? (
          <DirRow
            key={`dir:${node.path}`}
            dir={node}
            collapsed={isCollapsed(node.path)}
            onToggle={toggle}
          />
        ) : (
          <FileRow
            key={`file:${node.path}`}
            name={node.name}
            file={node.file}
            depth={node.depth}
            selected={selected.has(node.file.path)}
            focused={focusedPath === node.file.path}
            onToggle={onToggle}
            onFocus={onFocus}
          />
        ),
      )}
    </ul>
  );
};

export const FileTree = memo(FileTreeImpl);

/**
 * Hover / focus surface shared by both row kinds.
 *
 * Returns one of two contrasting classes — `tailwind-merge` is irrelevant,
 * so a plain ternary is the clearest expression of intent.
 */
function surface(active: boolean): string {
  return active ? "bg-row-active text-row-active-foreground" : "hover:bg-row-hover";
}

interface DirRowProps {
  readonly dir: TreeDir;
  readonly collapsed: boolean;
  readonly onToggle: (dirPath: string) => void;
}

const DirRow: React.FC<DirRowProps> = memo(function DirRow({ dir, collapsed, onToggle }) {
  const handleClick = useCallback(() => onToggle(dir.path), [onToggle, dir.path]);

  return (
    <li
      className={cn("flex items-center", surface(false))}
      style={{ height: ROW_H, paddingLeft: INDENT_PX * dir.depth }}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={handleClick}
        title={dir.path}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-1 text-left",
          "font-ui pr-2 pl-1 text-xs",
          "focus-visible:bg-row-hover outline-none",
        )}
      >
        <Chevron expanded={!collapsed} />
        <span className="flex-1 truncate">{dir.name}</span>
      </button>
    </li>
  );
});

interface FileRowProps {
  readonly name: string;
  readonly file: ChangedFile;
  readonly depth: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly onToggle: (path: string) => void;
  readonly onFocus: (path: string) => void;
}

const FileRow: React.FC<FileRowProps> = memo(function FileRow({
  name,
  file,
  depth,
  selected,
  focused,
  onToggle,
  onFocus,
}) {
  const checkboxId = useId();
  const { path, staged } = file;
  // Kept for assistive tech only — never rendered as visible text.
  const staging = staged ? "staged" : "unstaged";

  const handleToggle = useCallback(() => onToggle(path), [onToggle, path]);
  const handleFocus = useCallback(() => onFocus(path), [onFocus, path]);

  return (
    <li
      className={cn("flex items-center", surface(focused))}
      style={{ height: ROW_H, paddingLeft: INDENT_PX * depth }}
    >
      <label
        htmlFor={checkboxId}
        className="grid h-full w-6 shrink-0 cursor-pointer place-items-center"
      >
        <Checkbox id={checkboxId} checked={selected} onChange={handleToggle} />
        <span className="sr-only">{`${staging} · ${path}`}</span>
      </label>

      <button
        type="button"
        aria-pressed={focused}
        onClick={handleFocus}
        title={path}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center text-left",
          "font-editor pr-2 text-xs",
          "focus-visible:bg-row-hover outline-none",
        )}
      >
        <span className="flex-1 truncate">{name}</span>
      </button>
    </li>
  );
});

/**
 * Checkbox styled after VS Code's own: a small rounded square that fills
 * with the focus-border colour when checked.
 *
 * The real `<input>` stays in place (so keyboard and screen-reader
 * behaviour remain native) with `appearance-none`; the tick is a sibling
 * SVG stacked on top of it via `peer-checked`. Both live in one
 * zero-size grid cell so the tick is always centred on the box, with no
 * dependence on a positioned ancestor.
 */
interface CheckboxProps {
  readonly id: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}

const Checkbox: React.FC<CheckboxProps> = memo(function Checkbox({ id, checked, onChange }) {
  return (
    <span className="grid place-items-center">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className={cn(
          "peer col-start-1 row-start-1 size-3.5 appearance-none rounded-[3px]",
          "border-checkbox-border cursor-pointer border",
          "checked:border-focus-border bg-transparent",
          "checked:bg-focus-border",
          "outline-none focus-visible:outline-1 focus-visible:outline-offset-1",
          "focus-visible:outline-focus-border",
        )}
      />
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className={cn(
          "pointer-events-none col-start-1 row-start-1 size-3",
          "opacity-0 peer-checked:opacity-100",
        )}
      >
        <path
          d="M2.5 6.2 4.8 8.5 9.5 3.8"
          fill="none"
          stroke="var(--vscode-checkbox-foreground, #fff)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
});
