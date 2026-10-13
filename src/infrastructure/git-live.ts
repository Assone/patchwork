import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  GitService,
  GitServiceError,
  type ChangedFile,
  type FileChangeType,
  type GitOperation,
} from "../services/git";
import { Effect, Layer } from "effect";

const execFileAsync = promisify(execFile);

interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const runGitCommand = async (cwd: string, args: readonly string[]): Promise<GitCommandResult> => {
  try {
    const { stdout, stderr } = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });

    return {
      stdout,
      stderr,
      exitCode: 0,
    };
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      typeof cause.code === "number"
    ) {
      return {
        stdout: "stdout" in cause && typeof cause.stdout === "string" ? cause.stdout : "",
        stderr: "stderr" in cause && typeof cause.stderr === "string" ? cause.stderr : "",
        exitCode: cause.code,
      };
    }

    throw cause;
  }
};

const runGit = (
  operation: GitOperation,
  cwd: string,
  args: readonly string[],
  allowedExitCodes: readonly number[] = [0],
): Effect.Effect<string, GitServiceError> =>
  Effect.tryPromise({
    try: async () => {
      const result = await runGitCommand(cwd, args);

      if (!allowedExitCodes.includes(result.exitCode)) {
        throw new Error(
          `git ${args.join(" ")} failed with exit code ${result.exitCode}: ${result.stderr}`,
        );
      }

      return result.stdout;
    },
    catch: (cause) => new GitServiceError({ operation, cwd, cause }),
  });

const isConflict = (x: string, y: string): boolean =>
  x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");

const getFileChangeType = (x: string, y: string): FileChangeType => {
  if (isConflict(x, y)) {
    return "conflicted";
  }

  if (x === "R" || y === "R") {
    return "renamed";
  }

  if (x === "C" || y === "C") {
    return "copied";
  }

  if (x === "?" && y === "?") {
    return "untracked";
  }

  if (x === "A" || y === "A") {
    return "added";
  }

  if (x === "D" || y === "D") {
    return "deleted";
  }

  if (x === "T" || y === "T") {
    return "type-changed";
  }

  return "modified";
};

const parseChangedFiles = (stdout: string): readonly ChangedFile[] => {
  const records = stdout.split("\0");
  const files: ChangedFile[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    if (record === "") {
      continue;
    }

    if (record.length < 4 || record[2] !== " ") {
      throw new Error(`Invalid git status record: ${JSON.stringify(record)}`);
    }

    const x = record[0];
    const y = record[1];
    const path = record.slice(3);

    let originalPath: string | undefined;

    if (x === "R" || y === "R" || x === "C" || y === "C") {
      originalPath = records[++i];

      if (originalPath === undefined || originalPath === "") {
        throw new Error(`Missing original path for ${JSON.stringify(record)}`);
      }
    }

    files.push({
      path,
      ...(originalPath === undefined ? {} : { originalPath }),
      type: getFileChangeType(x, y),
      staged: x !== " " && x !== "?",
      unstaged: y !== " " && y !== "?",
    });
  }

  return files;
};

export const GitServiceLive = Layer.succeed(GitService, {
  getChangedFiles: (repositoryRoot) =>
    runGit("status", repositoryRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]).pipe(
      Effect.flatMap((stdout) =>
        Effect.try({
          try: () => parseChangedFiles(stdout),
          catch: (cause) =>
            new GitServiceError({
              operation: "status",
              cwd: repositoryRoot,
              cause,
            }),
        }),
      ),
    ),

  getFileDiff: (repositoryRoot, path, area) =>
    Effect.gen(function* () {
      const args =
        area === "staged"
          ? ["diff", "--cached", "--no-ext-diff", "--no-color", "--", path]
          : ["diff", "--no-ext-diff", "--no-color", "--", path];

      const diff = yield* runGit("diff", repositoryRoot, args);

      if (diff !== "" || area === "staged") {
        return diff;
      }

      const trackedResult = yield* Effect.tryPromise({
        try: () => runGitCommand(repositoryRoot, ["ls-files", "--error-unmatch", "--", path]),
        catch: (cause) =>
          new GitServiceError({
            operation: "ls-files",
            cwd: repositoryRoot,
            cause,
          }),
      });

      if (trackedResult.exitCode === 0) {
        return diff;
      }

      if (trackedResult.exitCode !== 1) {
        return yield* new GitServiceError({
          operation: "ls-files",
          cwd: repositoryRoot,
          cause: new Error(
            `git ls-files failed with exit code ${trackedResult.exitCode}: ${trackedResult.stderr}`,
          ),
        });
      }

      return yield* runGit(
        "diff",
        repositoryRoot,
        ["diff", "--no-index", "--no-ext-diff", "--no-color", "--", "/dev/null", path],
        [0, 1],
      );
    }),
});
