/**
 * Header for the file list: shows how many files are selected and offers
 * bulk actions.
 *
 * The header is presentational — it receives `count` and `total` as
 * primitives plus two stable callbacks, so it never re-renders unless
 * one of those actually changes.
 */
export interface SelectionHeaderProps {
  readonly count: number;
  readonly total: number;
  readonly onSelectAll: () => void;
  readonly onClear: () => void;
}

export function SelectionHeader({ count, total, onSelectAll, onClear }: SelectionHeaderProps) {
  const allSelected = total > 0 && count === total;

  return (
    <div
      className="border-border text-foreground-muted flex items-center justify-between gap-2 border-b px-2 text-[11px] tracking-wider uppercase"
      style={{ height: "var(--header-h)" }}
    >
      <span>
        {count} / {total} {total === 1 ? "file" : "files"}
      </span>
      <span className="flex gap-2 normal-case">
        <button
          type="button"
          onClick={onSelectAll}
          disabled={allSelected || total === 0}
          className="text-foreground underline-offset-2 outline-none hover:underline focus-visible:underline disabled:cursor-default disabled:no-underline disabled:opacity-40"
        >
          All
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={count === 0}
          className="text-foreground underline-offset-2 outline-none hover:underline focus-visible:underline disabled:cursor-default disabled:no-underline disabled:opacity-40"
        >
          None
        </button>
      </span>
    </div>
  );
}
