export type LineChangeType = "add" | "delete" | "normal";
export type FileChangeType = "modified" | "added" | "deleted" | "renamed" | "copy" | "mode-change";

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

  type: FileChangeType;

  oldMode?: string;
  newMode?: string;

  oldHash?: string;
  newHash?: string;

  additions: number;
  deletions: number;

  similarity?: number;
  isBinary: boolean;

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
}

export type DiffParseErrorCode =
  | "INVALID_FILE_HEADER"
  | "INVALID_HUNK_HEADER"
  | "INVALID_DIFF_LINE"
  | "INVALID_HUNK_COUNT"
  | "INVALID_METADATA"
  | "INVALID_NO_NEWLINE_MARKER";
// | "HUNK_COUNT_MISMATCH";

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
    super({
      message,
      code: "INVALID_HUNK_HEADER",
      line,
      content,
      oldPath,
      newPath,
    });

    this.name = "InvalidHunkHeader";
  }
}

export class InvalidHunkCount extends DiffParseError {
  constructor({ message, line, content, oldPath, newPath }: Omit<DiffParseErrorInit, "code">) {
    super({
      message,
      code: "INVALID_HUNK_COUNT",
      line,
      content,
      oldPath,
      newPath,
    });

    this.name = "InvalidHunkCount";
  }
}

export class InvalidDiffLine extends DiffParseError {
  constructor({ message, line, content, oldPath, newPath }: Omit<DiffParseErrorInit, "code">) {
    super({
      message,
      code: "INVALID_DIFF_LINE",
      line,
      content,
      oldPath,
      newPath,
    });

    this.name = "InvalidDiffLine";
  }
}

const simpleEscapes: Record<string, string> = {
  a: "\x07",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\x0b",
  f: "\f",
  r: "\r",
  "\\": "\\",
  '"': '"',
};

export const readGitToken = (
  input: string,
  start = 0,
): { value: string; next: number } | undefined => {
  if (start >= input.length) {
    return undefined;
  }

  if (input[start] !== '"') {
    let end = start;

    while (end < input.length && input[end] !== " ") {
      end++;
    }

    return {
      value: input.slice(start, end),
      next: end,
    };
  }

  let end = start + 1;
  let value = "";

  while (end < input.length) {
    const char = input[end++];

    if (char === '"') {
      return { value, next: end };
    }

    if (char !== "\\") {
      value += char;
      continue;
    }

    if (end >= input.length) {
      return undefined;
    }

    const escaped = input[end++];

    if (escaped in simpleEscapes) {
      value += simpleEscapes[escaped];
      continue;
    }

    if (/[0-7]/.test(escaped)) {
      const octal = escaped + input.slice(end, end + 2);
      const digits = octal.match(/^[0-7]{1,3}/)?.[0] ?? escaped;

      value += String.fromCharCode(Number.parseInt(digits, 8));
      end += digits.length - 1;
      continue;
    }

    // Preserve an unknown escape rather than silently losing data.
    value += `\\${escaped}`;
  }

  return undefined;
};

export const parseGitFileHeader = (line: string) => {
  const prefix = "diff --git ";

  if (!line.startsWith(prefix)) {
    return undefined;
  }

  const input = line.slice(prefix.length);
  const oldToken = readGitToken(input);

  if (!oldToken) {
    return undefined;
  }

  const newToken = readGitToken(input, oldToken.next + 1);

  if (!newToken) {
    return undefined;
  }

  if (!oldToken.value.startsWith("a/") || !newToken.value.startsWith("b/")) {
    return undefined;
  }

  return {
    oldPath: oldToken.value.slice(2),
    newPath: newToken.value.slice(2),
  };
};

export const NULL_PATH = "/dev/null";

export const parseFilePath = (line: string, side: "old" | "new"): string | undefined => {
  const input = line.startsWith("--- ") || line.startsWith("+++ ") ? line.slice(4) : line;

  const token = readGitToken(input);
  if (!token || token.value === "") {
    return undefined;
  }

  let path = token.value;

  if (path === NULL_PATH) {
    return path;
  }

  const expected = side === "old" ? "a/" : "b/";
  if (path.startsWith(expected)) {
    path = path.slice(2);
  }

  return path;
};

interface HunkHeader {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  section: string | undefined;
}

const HUNK_HEADER_PATTERN =
  /^@@ -(?<oldStart>\d+)(?:,(?<oldCount>\d+))? \+(?<newStart>\d+)(?:,(?<newCount>\d+))? @@(?: ?(?<section>.*))?$/;

export const parseHunkHeader = (line: string, lineNumber: number): HunkHeader => {
  const match = HUNK_HEADER_PATTERN.exec(line);
  const groups = match?.groups;

  if (!groups) {
    throw new InvalidHunkHeader({
      message: "Invalid unified diff hunk header",
      line: lineNumber,
      content: line,
    });
  }

  const oldStart = Number(groups.oldStart);
  const oldCount = groups.oldCount === undefined ? 1 : Number(groups.oldCount);
  const newStart = Number(groups.newStart);
  const newCount = groups.newCount === undefined ? 1 : Number(groups.newCount);

  if (![oldStart, oldCount, newStart, newCount].every(Number.isSafeInteger)) {
    throw new InvalidHunkHeader({
      message: "Hunk header contains an invalid line number or count",
      line: lineNumber,
      content: line,
    });
  }

  return {
    oldStart,
    oldCount,
    newStart,
    newCount,
    section: groups.section || undefined,
  };
};

export interface DiffLineContext {
  oldLineNumber: number;
  newLineNumber: number;
  diffLineNumber: number;
  oldPath?: string;
  newPath?: string;
}

export const parseDiffLine = (line: string, context: DiffLineContext): DiffLine => {
  const prefix = line[0];
  const content = line.slice(1);

  switch (prefix) {
    case "+":
      return { type: "add", content, newLineNumber: context.newLineNumber };

    case "-":
      return { type: "delete", content, oldLineNumber: context.oldLineNumber };

    case " ":
      return {
        type: "normal",
        content,
        newLineNumber: context.newLineNumber,
        oldLineNumber: context.oldLineNumber,
      };

    default:
      throw new InvalidDiffLine({
        message: `Invalid diff line prefix: ${JSON.stringify(prefix)}`,
        line: context.diffLineNumber,
        content: line,
        oldPath: context.oldPath,
        newPath: context.newPath,
      });
  }
};

export const getFileType = (file: FileDiff): FileChangeType => {
  if (file.oldPath === "/dev/null") {
    return "added";
  }

  if (file.newPath === "/dev/null") {
    return "deleted";
  }

  if (file.type === "renamed" || file.type === "copy") {
    return file.type;
  }

  if (
    file.hunks.length === 0 &&
    !file.isBinary &&
    file.oldMode !== undefined &&
    file.newMode !== undefined &&
    file.oldMode !== file.newMode
  ) {
    return "mode-change";
  }

  return "modified";
};

export const validateHunk = (hunk: DiffHunk, lineNumber: number, file: FileDiff): void => {
  let oldCount = 0;
  let newCount = 0;

  for (const line of hunk.lines) {
    if (line.type !== "add") {
      oldCount++;
    }

    if (line.type !== "delete") {
      newCount++;
    }
  }

  if (oldCount !== hunk.oldLines || newCount !== hunk.newLines) {
    throw new InvalidHunkCount({
      message: `Hunk line count mismatch: expected old=${hunk.oldLines}, new=${hunk.newLines}; got old=${oldCount}, new=${newCount}`,

      line: lineNumber,
      content: hunk.header,
      oldPath: file.oldPath,
      newPath: file.newPath,
    });
  }
};

export const parser = (input: string): FileDiff[] => {
  const lines = input.split(/\r?\n/);
  const files: FileDiff[] = [];

  let currentFile: FileDiff | undefined;
  let currentHunk: DiffHunk | undefined;
  let inBinaryPatch = false;
  let currentHunkStartLine = 0;
  let oldLineCursor = 0;
  let newLineCursor = 0;

  const fail = (
    message: string,
    code: DiffParseErrorCode,
    lineNumber: number,
    raw: string,
  ): never => {
    throw new DiffParseError({
      message,
      code,
      line: lineNumber,
      content: raw,
      oldPath: currentFile?.oldPath,
      newPath: currentFile?.newPath,
    });
  };

  const finishHunk = () => {
    if (!currentHunk || !currentFile) {
      return;
    }

    validateHunk(currentHunk, currentHunkStartLine, currentFile);
    currentHunk = undefined;
  };

  const finishFile = (): void => {
    if (!currentFile) {
      return;
    }

    finishHunk();

    currentFile.type = getFileType(currentFile);
    files.push(currentFile);
    currentFile = undefined;
    inBinaryPatch = false;
  };

  const startFile = (paths: { oldPath: string; newPath: string }): void => {
    currentFile = {
      oldPath: paths.oldPath,
      newPath: paths.newPath,
      type: "modified",
      additions: 0,
      deletions: 0,
      isBinary: false,
      hunks: [],
    };
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (line.startsWith("diff --git ")) {
      finishFile();

      const paths = parseGitFileHeader(line);

      if (!paths) {
        return fail(
          "Invalid or unsupported Git file header",
          "INVALID_FILE_HEADER",
          lineNumber,
          line,
        );
      }

      startFile(paths);
      continue;
    }

    if (!currentFile) {
      if (line === "") {
        continue;
      }

      return fail("Unexpected content outside a file diff", "INVALID_METADATA", lineNumber, line);
    }

    if (inBinaryPatch) {
      // Binary patch payload is not line-oriented source code.
      continue;
    }

    if (line.startsWith("GIT binary patch")) {
      finishHunk();
      currentFile.isBinary = true;
      inBinaryPatch = true;
      continue;
    }

    if (/^Binary files .+ differ$/.test(line)) {
      finishHunk();
      currentFile.isBinary = true;
      continue;
    }

    if (line.startsWith("@@")) {
      finishHunk();

      const header = parseHunkHeader(line, lineNumber);

      currentHunk = {
        header: line,
        oldStart: header.oldStart,
        oldLines: header.oldCount,
        newStart: header.newStart,
        newLines: header.newCount,
        section: header.section,
        lines: [],
      };

      currentHunkStartLine = lineNumber;
      oldLineCursor = header.oldStart;
      newLineCursor = header.newStart;

      currentFile.hunks.push(currentHunk);

      continue;
    }

    if (currentHunk) {
      if (line === "") {
        continue;
      }

      if (line === "\\ No newline at end of file") {
        const previous = currentHunk.lines.at(-1);

        if (!previous) {
          return fail(
            "No-newline marker has no preceding diff line",
            "INVALID_NO_NEWLINE_MARKER",
            lineNumber,
            line,
          );
        }

        previous.noNewlineAtEof = true;
        continue;
      }

      const oldLineNumber = oldLineCursor;
      const newLineNumber = newLineCursor;

      const parsed = parseDiffLine(line, {
        oldLineNumber,
        newLineNumber,
        diffLineNumber: lineNumber,
        oldPath: currentFile.oldPath,
        newPath: currentFile.newPath,
      });

      currentHunk.lines.push(parsed);

      if (parsed.type === "add") {
        currentFile.additions++;
        newLineCursor++;
      } else if (parsed.type === "delete") {
        currentFile.deletions++;
        oldLineCursor++;
      } else {
        oldLineCursor++;
        newLineCursor++;
      }

      continue;
    }

    // File-level metadata, outside a hunk.
    if (line.startsWith("index ")) {
      const match = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d{6}))?$/.exec(line);

      if (!match) {
        return fail("Invalid index metadata", "INVALID_METADATA", lineNumber, line);
      }

      currentFile.oldHash = match[1];
      currentFile.newHash = match[2];

      if (match[3]) {
        currentFile.oldMode ??= match[3];
        currentFile.newMode ??= match[3];
      }

      continue;
    }

    if (line.startsWith("old mode ")) {
      currentFile.oldMode = line.slice("old mode ".length);
      continue;
    }

    if (line.startsWith("new mode ")) {
      currentFile.newMode = line.slice("new mode ".length);
      continue;
    }

    if (line.startsWith("new file mode ")) {
      currentFile.newMode = line.slice("new file mode ".length);
      currentFile.oldPath = "/dev/null";
      currentFile.type = "added";
      continue;
    }

    if (line.startsWith("deleted file mode ")) {
      currentFile.oldMode = line.slice("deleted file mode ".length);
      currentFile.newPath = "/dev/null";
      currentFile.type = "deleted";
      continue;
    }

    if (line.startsWith("similarity index ")) {
      const value = line.slice("similarity index ".length);
      const match = /^(\d+)%$/.exec(value);

      if (!match) {
        return fail("Invalid similarity index", "INVALID_METADATA", lineNumber, line);
      }

      currentFile.similarity = Number(match[1]);
      continue;
    }

    if (line.startsWith("rename from ")) {
      currentFile.oldPath = line.slice("rename from ".length);
      currentFile.type = "renamed";
      continue;
    }

    if (line.startsWith("rename to ")) {
      currentFile.newPath = line.slice("rename to ".length);
      currentFile.type = "renamed";
      continue;
    }

    if (line.startsWith("copy from ")) {
      currentFile.oldPath = line.slice("copy from ".length);
      currentFile.type = "copy";
      continue;
    }

    if (line.startsWith("copy to ")) {
      currentFile.newPath = line.slice("copy to ".length);
      currentFile.type = "copy";
      continue;
    }

    if (line.startsWith("--- ")) {
      const path = parseFilePath(line, "old");

      if (path === undefined) {
        return fail("Invalid old file path", "INVALID_METADATA", lineNumber, line);
      }

      if (path === "/dev/null") {
        currentFile.oldPath = path;
        currentFile.type = "added";
      }

      continue;
    }

    if (line.startsWith("+++ ")) {
      const path = parseFilePath(line, "new");

      if (path === undefined) {
        return fail("Invalid new file path", "INVALID_METADATA", lineNumber, line);
      }

      if (path === "/dev/null") {
        currentFile.newPath = path;
        currentFile.type = "deleted";
      }

      continue;
    }

    if (line === "") {
      continue;
    }

    return fail("Unsupported or invalid file metadata", "INVALID_METADATA", lineNumber, line);
  }

  finishFile();

  return files;
};
