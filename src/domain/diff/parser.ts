import {
  DiffParseError,
  InvalidDiffLine,
  InvalidHunkCount,
  InvalidHunkHeader,
  type DiffFileKind,
  type DiffHunk,
  type DiffLine,
  type DiffParseErrorCode,
  type FileDiff,
} from "./types";

export type { DiffFileKind, DiffHunk, DiffLine, DiffParseErrorCode, FileDiff } from "./types";
export { DiffParseError, InvalidDiffLine, InvalidHunkCount, InvalidHunkHeader } from "./types";

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

const readGitToken = (input: string, start = 0): { value: string; next: number } | undefined => {
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

const parseGitFileHeader = (line: string) => {
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

const NULL_PATH = "/dev/null";

const parseFilePath = (line: string, side: "old" | "new"): string | undefined => {
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

const parseHunkHeader = (line: string, lineNumber: number): HunkHeader => {
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

interface DiffLineContext {
  oldLineNumber: number;
  newLineNumber: number;
  diffLineNumber: number;
  oldPath?: string;
  newPath?: string;
}

const parseDiffLine = (line: string, context: DiffLineContext): DiffLine => {
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

const getFileType = (file: FileDiff): DiffFileKind => {
  if (file.oldPath === "/dev/null") {
    return "added";
  }

  if (file.newPath === "/dev/null") {
    return "deleted";
  }

  if (file.type === "renamed" || file.type === "copied") {
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

const validateHunk = (hunk: DiffHunk, lineNumber: number, file: FileDiff): void => {
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
  // Keep the original line endings for patch assembly. Syntax checks use
  // `lines` (without `\r`), while `rawLines` is what `buildPatch` emits.
  const rawLines = input.split("\n");
  const lines = rawLines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const files: FileDiff[] = [];

  let currentFile: FileDiff | undefined;
  let currentHunk: DiffHunk | undefined;
  let inBinaryPatch = false;
  let currentHunkStartLine = 0;
  let oldLineCursor = 0;
  let newLineCursor = 0;
  let fileStartIndex = 0;
  let hunkStartIndex = 0;
  let firstHunkIndex: number | undefined;

  const rawSlice = (start: number, end: number): string => {
    if (end <= start) {
      return "";
    }
    const text = rawLines.slice(start, end).join("\n");
    return text.endsWith("\n") ? text : `${text}\n`;
  };

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

  const finishHunk = (endIndex: number) => {
    if (!currentHunk || !currentFile) {
      return;
    }

    currentHunk.raw = rawSlice(hunkStartIndex, endIndex);
    validateHunk(currentHunk, currentHunkStartLine, currentFile);
    currentHunk = undefined;
  };

  const finishFile = (endIndex: number): void => {
    if (!currentFile) {
      return;
    }

    finishHunk(endIndex);

    currentFile.header = rawSlice(fileStartIndex, firstHunkIndex ?? endIndex);
    currentFile.raw = rawSlice(fileStartIndex, endIndex);

    // Git terminates a `GIT binary patch` section with a blank line.
    // `rawSlice` normalizes trailing newlines for text patches and drops
    // that terminator; without it `git apply` reports "corrupt binary
    // patch" at the last line and rejects the whole input.
    if (currentFile.isBinary) {
      currentFile.raw = `${currentFile.raw.replace(/\n+$/, "")}\n\n`;
    }

    currentFile.type = getFileType(currentFile);
    files.push(currentFile);
    currentFile = undefined;
    inBinaryPatch = false;
    firstHunkIndex = undefined;
  };

  const startFile = (paths: { oldPath: string; newPath: string }): void => {
    currentFile = {
      oldPath: paths.oldPath,
      newPath: paths.newPath,
      type: "modified",
      additions: 0,
      deletions: 0,
      isBinary: false,
      header: "",
      raw: "",
      hunks: [],
    };
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (line.startsWith("diff --git ")) {
      finishFile(index);
      fileStartIndex = index;
      firstHunkIndex = undefined;

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
      finishHunk(index);
      currentFile.isBinary = true;
      inBinaryPatch = true;
      continue;
    }

    if (/^Binary files .+ differ$/.test(line)) {
      finishHunk(index);
      currentFile.isBinary = true;
      continue;
    }

    if (line.startsWith("@@")) {
      finishHunk(index);
      if (firstHunkIndex === undefined) {
        firstHunkIndex = index;
      }
      hunkStartIndex = index;

      const header = parseHunkHeader(line, lineNumber);

      currentHunk = {
        header: line,
        oldStart: header.oldStart,
        oldLines: header.oldCount,
        newStart: header.newStart,
        newLines: header.newCount,
        section: header.section,
        lines: [],
        raw: "",
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
      currentFile.type = "copied";
      continue;
    }

    if (line.startsWith("copy to ")) {
      currentFile.newPath = line.slice("copy to ".length);
      currentFile.type = "copied";
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

  finishFile(lines.length);

  return files;
};
