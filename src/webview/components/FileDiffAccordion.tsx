import { memo, useMemo, useState } from "react";
import type { DiffHunk, FileDiff } from "../../domain/diff";
import type { FileView, UnitView } from "../../rpc/commit-types";
import { Chevron } from "./Chevron";
import { DiffBody } from "./DiffBody";

export interface FileDiffAccordionProps {
  readonly files: readonly FileView[];
  readonly units: readonly UnitView[];
  readonly hunkIds: readonly string[];
}

interface FileSectionModel {
  readonly path: string;
  readonly file: FileDiff;
}

const toFileDiff = (view: FileView, hunks: readonly Omit<DiffHunk, "raw">[]): FileDiff => ({
  oldPath: view.oldPath,
  newPath: view.path,
  type: view.diffKind,
  ...(view.oldMode === undefined ? {} : { oldMode: view.oldMode }),
  ...(view.newMode === undefined ? {} : { newMode: view.newMode }),
  ...(view.oldHash === undefined ? {} : { oldHash: view.oldHash }),
  ...(view.newHash === undefined ? {} : { newHash: view.newHash }),
  additions: view.additions,
  deletions: view.deletions,
  ...(view.similarity === undefined ? {} : { similarity: view.similarity }),
  isBinary: view.isBinary,
  header: view.header,
  raw: "",
  hunks: hunks.map((hunk) => ({ ...hunk, raw: "" })),
});

const selectedSections = (
  files: readonly FileView[],
  units: readonly UnitView[],
  hunkIds: readonly string[],
): readonly FileSectionModel[] => {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const selected = hunkIds.flatMap((id) => {
    const unit = byId.get(id);
    return unit === undefined ? [] : [unit];
  });

  const byPath = new Map<string, { wholeFile: boolean; hunkIndexes: Set<number> }>();
  for (const unit of selected) {
    const entry = byPath.get(unit.path) ?? { wholeFile: false, hunkIndexes: new Set<number>() };
    if (unit.kind === "file") {
      entry.wholeFile = true;
    } else if (unit.hunkIndex !== undefined) {
      entry.hunkIndexes.add(unit.hunkIndex);
    }
    byPath.set(unit.path, entry);
  }

  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const sections: FileSectionModel[] = [];
  for (const [path, entry] of byPath) {
    const view = filesByPath.get(path);
    if (view === undefined) {
      continue;
    }
    const hunks = entry.wholeFile
      ? view.hunks
      : view.hunks.filter((_, index) => entry.hunkIndexes.has(index));
    sections.push({ path, file: toFileDiff(view, hunks) });
  }
  return sections;
};

export const FileDiffAccordion = memo(function FileDiffAccordion({
  files,
  units,
  hunkIds,
}: FileDiffAccordionProps) {
  const sections = useMemo(() => selectedSections(files, units, hunkIds), [files, units, hunkIds]);

  if (sections.length === 0) {
    return (
      <div className="text-foreground-muted flex h-full items-center justify-center">
        No changes in this commit.
      </div>
    );
  }

  return (
    <div className="font-editor h-full overflow-auto overscroll-contain text-[12px]">
      {sections.map((section) => (
        <FileSection key={section.path} path={section.path} file={section.file} />
      ))}
    </div>
  );
});

const FileSection: React.FC<{ path: string; file: FileDiff }> = ({ path, file }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="border-border border-b [contain-intrinsic-size:auto_200px] [content-visibility:auto]">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
        className="hover:bg-row-hover focus-visible:bg-row-hover focus-visible:outline-focus-border flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs outline-none focus-visible:outline"
      >
        <Chevron expanded={!collapsed} />
        <span className="flex-1 truncate">{path}</span>
      </button>
      {!collapsed &&
        (file.isBinary ? (
          <div className="text-foreground-muted px-3 py-2 text-xs">Binary file.</div>
        ) : file.hunks.length > 0 ? (
          <DiffBody file={file} />
        ) : (
          <div className="text-foreground-muted px-3 py-2 text-xs">No textual diff available.</div>
        ))}
    </section>
  );
};
