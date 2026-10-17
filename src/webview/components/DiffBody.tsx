import { memo, useEffect, useMemo, useState } from "react";
import type { FileDiff } from "../../domain/diff";
import { cn } from "../utils/cn";
import { buildDiffRows, type DiffRow, type LineRow } from "../utils/diffRows";
import {
  highlightLine,
  languageForPath,
  mergeSegments,
  type RenderPiece,
} from "../utils/highlight";

export interface DiffBodyProps {
  readonly file: FileDiff;
}

export const DiffBody: React.FC<DiffBodyProps> = memo(function DiffBody({ file }) {
  const rows = useMemo(() => buildDiffRows(file), [file]);
  const displayPath = file.newPath === "/dev/null" ? file.oldPath : file.newPath;
  const language = languageForPath(displayPath);

  return (
    <div className="w-max min-w-full">
      {rows.map((row, index) => (
        <DiffRowView
          key={`${row.kind}:${row.kind === "line" ? `${row.oldNumber}:${row.newNumber}` : index}`}
          row={row}
          language={language}
        />
      ))}
    </div>
  );
});

const DiffRowView: React.FC<{ row: DiffRow; language: string | undefined }> = ({
  row,
  language,
}) => {
  if (row.kind === "gap") {
    return (
      <div className="text-foreground-muted bg-background-sidebar flex items-center text-[11px]">
        <span className="w-10 shrink-0" />
        <span className="w-10 shrink-0" />
        <span className="w-4 shrink-0 text-center">⋯</span>
        <span className="flex-1 pr-3 pl-1 italic">
          {row.count} unchanged {row.count === 1 ? "line" : "lines"}
        </span>
      </div>
    );
  }

  if (row.kind === "hunk") {
    return (
      <div className="bg-diff-gutter-foreground/10 text-foreground-muted flex items-center text-[11px]">
        <span className="w-10 shrink-0" />
        <span className="w-10 shrink-0" />
        <span className="w-4 shrink-0" />
        <span className="flex-1 pr-3 pl-1">
          {row.header}
          {row.section !== undefined && row.section !== "" ? `  ${row.section}` : ""}
        </span>
      </div>
    );
  }

  return <DiffLineRow row={row} language={language} />;
};

interface HighlightState {
  readonly key: string;
  readonly pieces: readonly RenderPiece[];
}

// The key prevents a reused line from briefly showing stale tokens.
function useHighlightedPieces(row: LineRow, language: string | undefined) {
  const [state, setState] = useState<HighlightState | undefined>(undefined);
  const text = row.line.content;
  const key = `${language ?? ""}\0${text}`;

  useEffect(() => {
    if (language === undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const tokens = await highlightLine(text, language);
        if (!cancelled) {
          setState({
            key,
            pieces: mergeSegments(tokens ?? [{ text, color: undefined }], row.segments),
          });
        }
      } catch {
        // Highlighting is cosmetic; fall through to plain text.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, text, language, row.segments]);

  if (state?.key !== key) {
    return mergeSegments([{ text, color: undefined }], row.segments);
  }
  return state.pieces;
}

const DiffLineRow: React.FC<{ row: LineRow; language: string | undefined }> = ({
  row,
  language,
}) => {
  const pieces = useHighlightedPieces(row, language);
  const isAdd = row.line.type === "add";
  const isDelete = row.line.type === "delete";

  return (
    <div
      className={cn(
        "flex items-start whitespace-pre",
        isAdd && "bg-diff-insert-background",
        isDelete && "bg-diff-delete-background",
      )}
      style={{ color: "var(--color-diff-line-foreground)" }}
    >
      <span
        aria-hidden
        className="text-diff-line-number-foreground w-10 shrink-0 pr-2 text-right tabular-nums select-none"
      >
        {row.oldNumber ?? ""}
      </span>
      <span
        aria-hidden
        className="text-diff-line-number-foreground w-10 shrink-0 pr-2 text-right tabular-nums select-none"
      >
        {row.newNumber ?? ""}
      </span>
      <span
        aria-hidden
        className="text-diff-gutter-foreground w-4 shrink-0 text-center select-none"
      >
        {isAdd ? "+" : isDelete ? "-" : " "}
      </span>
      <span className="flex-1 pr-3 pl-1">
        {pieces.map((piece, index) => (
          <span
            key={index}
            style={piece.color === undefined ? undefined : { color: piece.color }}
            className={cn(
              piece.changed && isAdd && "bg-diff-insert-background",
              piece.changed && isDelete && "bg-diff-delete-background",
              piece.changed && (isAdd || isDelete) && "font-medium",
            )}
          >
            {piece.text}
          </span>
        ))}
      </span>
    </div>
  );
};
