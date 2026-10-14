import { useState } from "react";
import { getMockDiff } from "../mocks/diffs";
import { Chevron } from "./Chevron";
import { DiffBody } from "./DiffBody";

export interface FileSectionProps {
  readonly path: string;
}

export const FileSection: React.FC<FileSectionProps> = ({ path }) => {
  const [collapsed, setCollapsed] = useState(false);
  const diff = getMockDiff(path);

  return (
    <section className="border-border border-b">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
        className="hover:bg-row-hover flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs"
      >
        <Chevron expanded={!collapsed} />
        <span className="flex-1 truncate">{path}</span>
      </button>
      {!collapsed && diff && <DiffBody diff={diff} />}
      {!collapsed && !diff && (
        <div className="text-foreground-muted px-3 py-2 text-xs">No diff available.</div>
      )}
    </section>
  );
};
