import { memo, useCallback, useId, useMemo } from "react";
import { useTreeCollapse } from "../hooks/useTreeCollapse";
import { buildFileTree, type TreeDir } from "../tree";
import { isLockedPath } from "../../domain/lock-files";

import { cn } from "../utils/cn";
import { Chevron } from "./Chevron";
import type { ChangedFile } from "../../rpc/git-types";

const INDENT_PX = 10;
const ROW_H = 22;

export interface FileTreeProps {
  readonly files: readonly ChangedFile[];
  readonly selected: ReadonlySet<string>;
  readonly focusedPath: string | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly onRetry: () => void;
  readonly onToggle: (path: string) => void;
  readonly onFocus: (path: string) => void;
}

const FileTreeImpl: React.FC<FileTreeProps> = ({
  files,
  selected,
  focusedPath,
  loading,
  error,
  onRetry,
  onToggle,
  onFocus,
}) => {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const { rows, isCollapsed, toggle } = useTreeCollapse(tree);

  if (error !== null) {
    return (
      <div className="flex flex-1 flex-col gap-2 px-3 py-2 text-xs" role="alert">
        <span style={{ color: "var(--color-badge-deleted)" }}>
          Could not read changed files: {error.message}
        </span>
        <button type="button" className="self-start underline" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  if (loading && files.length === 0) {
    return (
      <div
        className="text-foreground-muted flex-1 px-3 py-2"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        Loading changed files…
      </div>
    );
  }

  if (files.length === 0) {
    return <div className="text-foreground-muted flex-1 px-3 py-2">No changed files.</div>;
  }

  return (
    <ul
      className="m-0 min-h-0 flex-1 list-none overflow-auto overscroll-contain p-0"
      aria-label="Changed files"
    >
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
            locked={isLockedPath(node.file.path)}
            onToggle={onToggle}
            onFocus={onFocus}
          />
        ),
      )}
    </ul>
  );
};

export const FileTree = memo(FileTreeImpl);

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
      className={cn(
        "flex items-center [contain-intrinsic-size:auto_22px] [content-visibility:auto]",
        surface(false),
      )}
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
  readonly locked: boolean;
  readonly onToggle: (path: string) => void;
  readonly onFocus: (path: string) => void;
}

const FileRow: React.FC<FileRowProps> = memo(function FileRow({
  name,
  file,
  depth,
  selected,
  focused,
  locked,
  onToggle,
  onFocus,
}) {
  const checkboxId = useId();
  const { path, staged } = file;
  const staging = staged ? "staged" : "unstaged";

  const handleToggle = useCallback(() => onToggle(path), [onToggle, path]);
  const handleFocus = useCallback(() => onFocus(path), [onFocus, path]);

  return (
    <li
      className={cn(
        "flex items-center [contain-intrinsic-size:auto_22px] [content-visibility:auto]",
        surface(focused),
      )}
      style={{ height: ROW_H, paddingLeft: INDENT_PX * depth }}
    >
      <label
        htmlFor={checkboxId}
        className={cn(
          "grid h-full w-6 shrink-0 place-items-center",
          // A locked row keeps its label hit-area for the title
          // attribute but must not present a toggle affordance.
          locked ? "cursor-default" : "cursor-pointer",
        )}
      >
        <Checkbox id={checkboxId} checked={selected} disabled={locked} onChange={handleToggle} />
        <span className="sr-only">
          {locked ? `${staging} · ${path} · included automatically` : `${staging} · ${path}`}
        </span>
      </label>

      <button
        type="button"
        aria-pressed={focused}
        onClick={handleFocus}
        title={`${path} · ${staging}`}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center text-left",
          "font-editor pr-2 text-xs",
          "focus-visible:bg-row-hover outline-none",
        )}
      >
        <span className="flex-1 truncate">{name}</span>
        {locked && (
          <span
            aria-hidden
            title="Lock file — always committed with the change it belongs to"
            className="text-foreground-muted shrink-0 pl-1 text-[10px]"
          >
            🔒
          </span>
        )}
      </button>
    </li>
  );
});

// A disabled checkbox stays visible and checked for lock-file rows.
interface CheckboxProps {
  readonly id: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: () => void;
}

const Checkbox: React.FC<CheckboxProps> = memo(function Checkbox({
  id,
  checked,
  disabled = false,
  onChange,
}) {
  return (
    <span className="grid place-items-center">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className={cn(
          "peer col-start-1 row-start-1 size-3.5 appearance-none rounded-[3px]",
          "border-checkbox-border border",
          "bg-checkbox-background",
          "checked:border-checkbox-select-border checked:bg-checkbox-select-background",
          "outline-none focus-visible:outline-1 focus-visible:outline-offset-1",
          "focus-visible:outline-focus-border",
          disabled ? "cursor-default" : "cursor-pointer",
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
