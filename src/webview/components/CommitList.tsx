import type { Commit } from "../hooks/useSubmission";
import { cn } from "../utils/cn";

export interface CommitListProps {
  readonly commits: readonly Commit[];
  readonly focusedId: string;
  readonly onFocus: (id: string) => void;
}

export const CommitList: React.FC<CommitListProps> = ({ commits, focusedId, onFocus }) => {
  return (
    <div className="border-border flex flex-col border-b">
      <div
        className="border-border text-foreground-muted flex items-center border-b px-2 text-[11px] tracking-wider uppercase"
        style={{ height: "var(--header-h)" }}
      >
        Commits ({commits.length})
      </div>
      <ul className="m-0 list-none overflow-auto p-0">
        {commits.map((commit) => {
          const isFocused = commit.id === focusedId;
          const firstLine = commit.message.split("\n")[0] ?? "";
          return (
            <li key={commit.id}>
              <button
                type="button"
                onClick={() => onFocus(commit.id)}
                className={cn(
                  "border-border flex w-full flex-col gap-0.5 border-b px-2 py-1.5 text-left",
                  isFocused ? "bg-row-active text-row-active-foreground" : "hover:bg-row-hover",
                )}
              >
                <span className="font-editor truncate text-xs font-medium">{firstLine}</span>
                <span className="text-foreground-muted text-[10px]">
                  {commit.files.length} {commit.files.length === 1 ? "file" : "files"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
