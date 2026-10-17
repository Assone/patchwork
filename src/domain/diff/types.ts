export type LineChangeType = "add" | "delete" | "normal";

/**
 * What the unified-diff header says about a file. Deliberately distinct
 * from `FileChangeType` in `rpc/git-types.ts`: the diff can report a
 * mode-only change, which `git status` folds into `modified`.
 */
export type DiffFileKind = "modified" | "added" | "deleted" | "renamed" | "copied" | "mode-change";

type LineNumberFields = {
  add: { newLineNumber: number };
  delete: { oldLineNumber: number };
  normal: { oldLineNumber: number; newLineNumber: number };
};

type DiffLineData<T extends LineChangeType> = {
  type: T;
  content: string;
  noNewlineAtEof?: boolean;
} & LineNumberFields[T];

export type DiffLine = { [K in LineChangeType]: DiffLineData<K> }[LineChangeType];

export interface FileDiff {
  oldPath: string;
  newPath: string;

  type: DiffFileKind;

  oldMode?: string;
  newMode?: string;

  oldHash?: string;
  newHash?: string;

  additions: number;
  deletions: number;

  similarity?: number;
  isBinary: boolean;

  /** File-level metadata only, from `diff --git` through `+++`. */
  header: string;
  /** Exact bytes of the whole file section, including hunk bodies. */
  raw: string;

  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  section?: string;
  lines: DiffLine[];
  /** Exact bytes of the header and body, including no-newline markers. */
  raw: string;
}

export type DiffParseErrorCode =
  | "INVALID_FILE_HEADER"
  | "INVALID_HUNK_HEADER"
  | "INVALID_DIFF_LINE"
  | "INVALID_HUNK_COUNT"
  | "INVALID_METADATA"
  | "INVALID_NO_NEWLINE_MARKER";

export interface DiffParseErrorInit {
  message: string;
  code: DiffParseErrorCode;
  line: number;
  content: string;
  oldPath?: string;
  newPath?: string;
}

export class DiffParseError extends Error {
  readonly code: DiffParseErrorCode;
  readonly line: number;
  readonly content: string;
  readonly oldPath: string | undefined;
  readonly newPath: string | undefined;

  constructor(init: DiffParseErrorInit) {
    super(init.message);
    this.code = init.code;
    this.line = init.line;
    this.content = init.content;
    this.oldPath = init.oldPath;
    this.newPath = init.newPath;
    this.name = "DiffParseError";
  }
}

export class InvalidHunkHeader extends DiffParseError {
  constructor({ message, line, content, oldPath, newPath }: Omit<DiffParseErrorInit, "code">) {
    super({ message, code: "INVALID_HUNK_HEADER", line, content, oldPath, newPath });
    this.name = "InvalidHunkHeader";
  }
}

export class InvalidHunkCount extends DiffParseError {
  constructor({ message, line, content, oldPath, newPath }: Omit<DiffParseErrorInit, "code">) {
    super({ message, code: "INVALID_HUNK_COUNT", line, content, oldPath, newPath });
    this.name = "InvalidHunkCount";
  }
}

export class InvalidDiffLine extends DiffParseError {
  constructor({ message, line, content, oldPath, newPath }: Omit<DiffParseErrorInit, "code">) {
    super({ message, code: "INVALID_DIFF_LINE", line, content, oldPath, newPath });
    this.name = "InvalidDiffLine";
  }
}
