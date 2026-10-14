import { FileSection } from "./FileSection";

export interface DiffAccordionProps {
  readonly files: readonly { readonly path: string; readonly type: string }[];
}

export const DiffAccordion: React.FC<DiffAccordionProps> = ({ files }) => {
  if (files.length === 0) {
    return (
      <div className="text-foreground-muted flex h-full items-center justify-center">
        No files in this commit.
      </div>
    );
  }

  return (
    <div className="font-editor h-full overflow-auto text-[12px]">
      {files.map((file) => (
        <FileSection key={file.path} path={file.path} />
      ))}
    </div>
  );
};
