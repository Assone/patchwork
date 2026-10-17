import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { parser, type FileDiff } from "../domain/diff";
import {
  CommitWriteError,
  GitService,
  GitServiceError,
  type ChangeSet,
  type CommitToWrite,
  type CreateCommitsOptions,
  type GitOperation,
} from "../services/git";
import type { ChangedFile, FileChangeType } from "../rpc/git-types";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface GitCommandOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: string;
  readonly timeoutMs?: number;
}

const runGitCommand = (
  gitPath: string,
  cwd: string,
  args: readonly string[],
  options: GitCommandOptions = {},
): Promise<GitCommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(gitPath, [...args], {
      cwd,
      env: { ...process.env, GIT_PAGER: "cat", LC_ALL: "C", ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    // The child may exit before stdin is fully written.
    child.stdin.on("error", () => {});

    const finish = (result: GitCommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const fail = (cause: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(cause);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(
        new Error(
          `git ${args.join(" ")} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
        ),
      );
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        fail(new Error(`git ${args.join(" ")} produced more than ${MAX_OUTPUT_BYTES} bytes`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      finish({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? -1,
      });
    });

    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });

interface RunGitOptions extends GitCommandOptions {
  readonly allowedExitCodes?: readonly number[];
}

const runGit = (
  gitPath: string,
  operation: GitOperation,
  cwd: string,
  args: readonly string[],
  options: RunGitOptions = {},
): Effect.Effect<string, GitServiceError> =>
  Effect.tryPromise({
    try: async () => {
      const result = await runGitCommand(gitPath, cwd, args, options);
      const allowed = options.allowedExitCodes ?? [0];
      if (!allowed.includes(result.exitCode)) {
        throw new Error(
          `git ${args.join(" ")} failed with exit code ${result.exitCode}: ${result.stderr.trim()}`,
        );
      }
      return result.stdout;
    },
    catch: (cause) =>
      new GitServiceError({
        message: cause instanceof Error ? cause.message : String(cause),
        operation,
        cwd,
        cause,
      }),
  });

/**
 * Point the real index at `commit` for `paths`, preserving unrelated
 * staged changes.
 *
 * `git restore --source=<commit>` rejects a path that exists in neither
 * `<commit>` nor the index as an unknown pathspec, and one such path
 * aborts the whole command. That is exactly the state of a file the user
 * had already staged as deleted: the commit removes it, so it is absent
 * from both. Remove those paths with `git update-index --force-remove`
 * and restore only the survivors.
 */
const syncIndexToCommit = (
  gitPath: string,
  repositoryRoot: string,
  commit: string,
  paths: readonly string[],
): Effect.Effect<void, GitServiceError> =>
  Effect.gen(function* () {
    if (paths.length === 0) {
      return;
    }

    const listed = yield* runGit(gitPath, "ls-tree", repositoryRoot, [
      "--literal-pathspecs",
      "--no-pager",
      "ls-tree",
      "-r",
      "-z",
      "--name-only",
      commit,
      "--",
      ...paths,
    ]);
    const present = listed.split("\0").filter((path) => path.length > 0);
    const presentSet = new Set(present);
    const absent = paths.filter((path) => !presentSet.has(path));

    if (absent.length > 0) {
      // `--force-remove` is unconditional and a no-op when the path is
      // already absent, which is the common case for a staged deletion.
      yield* runGit(gitPath, "update-index", repositoryRoot, [
        "--no-pager",
        "update-index",
        "--force-remove",
        "--",
        ...absent,
      ]);
    }

    if (present.length > 0) {
      yield* runGit(gitPath, "restore", repositoryRoot, [
        "--literal-pathspecs",
        "--no-pager",
        "restore",
        "--staged",
        `--source=${commit}`,
        "--",
        ...present,
      ]);
    }
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

const getChangedFiles = (
  gitPath: string,
  repositoryRoot: string,
): Effect.Effect<readonly ChangedFile[], GitServiceError> =>
  runGit(gitPath, "status", repositoryRoot, [
    "--no-pager",
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
            message: cause instanceof Error ? cause.message : String(cause),
            operation: "status",
            cwd: repositoryRoot,
            cause,
          }),
      }),
    ),
  );

const getHeadSha = (
  gitPath: string,
  repositoryRoot: string,
): Effect.Effect<string | null, GitServiceError> =>
  runGit(
    gitPath,
    "rev-parse",
    repositoryRoot,
    ["--no-pager", "rev-parse", "--verify", "--quiet", "HEAD"],
    {
      allowedExitCodes: [0, 1],
    },
  ).pipe(
    Effect.map((stdout) => {
      const sha = stdout.trim();
      return sha.length === 0 ? null : sha;
    }),
  );

const diffArgs = (extra: readonly string[]): readonly string[] => [
  "--literal-pathspecs",
  "--no-pager",
  "diff",
  "--no-ext-diff",
  "--no-color",
  "--no-textconv",
  "--binary",
  "--find-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  ...extra,
];

const getChangeSet = (
  gitPath: string,
  repositoryRoot: string,
  paths?: readonly string[],
): Effect.Effect<ChangeSet, GitServiceError> =>
  Effect.gen(function* () {
    const allChangedFiles = yield* getChangedFiles(gitPath, repositoryRoot);
    const headSha = yield* getHeadSha(gitPath, repositoryRoot);

    const selected =
      paths === undefined
        ? allChangedFiles
        : allChangedFiles.filter((file) => paths.includes(file.path));

    const conflicted = selected.filter((file) => file.type === "conflicted");
    const composable = selected.filter((file) => file.type !== "conflicted");
    const tracked = composable.filter((file) => file.type !== "untracked");

    const parsed: FileDiff[] = [];
    if (tracked.length > 0 && headSha !== null) {
      const pathspecs = new Set<string>();
      for (const file of tracked) {
        pathspecs.add(file.path);
        if (file.originalPath !== undefined) {
          pathspecs.add(file.originalPath);
        }
      }
      const stdout = yield* runGit(
        gitPath,
        "diff",
        repositoryRoot,
        diffArgs(["HEAD", "--", ...pathspecs]),
      );
      parsed.push(...parser(stdout));
    }

    for (const file of composable) {
      // Tracked files are already covered by the combined HEAD diff.
      if (headSha !== null && file.type !== "untracked") {
        continue;
      }
      const result = yield* Effect.tryPromise({
        try: () =>
          runGitCommand(
            gitPath,
            repositoryRoot,
            [
              "--literal-pathspecs",
              "--no-pager",
              "diff",
              "--no-ext-diff",
              "--no-color",
              "--no-textconv",
              "--binary",
              "--no-index",
              "--",
              "/dev/null",
              file.path,
            ],
            { timeoutMs: DEFAULT_TIMEOUT_MS },
          ),
        catch: (cause) =>
          new GitServiceError({
            message: cause instanceof Error ? cause.message : String(cause),
            operation: "diff",
            cwd: repositoryRoot,
            cause,
          }),
      });
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        return yield* Effect.fail(
          new GitServiceError({
            message: `git diff --no-index failed for ${file.path}: ${result.stderr.trim()}`,
            operation: "diff",
            cwd: repositoryRoot,
            cause: new Error(result.stderr),
          }),
        );
      }
      parsed.push(...parser(result.stdout));
    }

    const selectedPaths = new Set<string>();
    for (const file of composable) {
      selectedPaths.add(file.path);
      if (file.originalPath !== undefined) {
        selectedPaths.add(file.originalPath);
      }
    }
    const files = parsed.filter(
      (file) => selectedPaths.has(file.newPath) || selectedPaths.has(file.oldPath),
    );

    // The combined diff omits untracked files and any path that has no
    // textual change (an empty new file, for example). Keep the status
    // rows available so the compose layer can reject or describe them.
    return {
      headSha,
      changedFiles: [...composable, ...conflicted],
      files,
    };
  });

const preflight = (
  gitPath: string,
  repositoryRoot: string,
): Effect.Effect<
  { headSha: string | null; ref: string; sign: boolean },
  CommitWriteError | GitServiceError
> =>
  Effect.gen(function* () {
    const gitDir = (yield* runGit(gitPath, "rev-parse", repositoryRoot, [
      "--no-pager",
      "rev-parse",
      "--absolute-git-dir",
    ])).trim();

    const markers = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"] as const;
    for (const marker of markers) {
      const found = yield* runGit(
        gitPath,
        "rev-parse",
        repositoryRoot,
        ["--no-pager", "rev-parse", "--verify", "--quiet", marker],
        { allowedExitCodes: [0, 1] },
      );
      if (found.trim().length > 0) {
        return yield* Effect.fail(
          new CommitWriteError({
            message: `Cannot create commits while ${marker.replace("_", " ").toLowerCase()} is present.`,
            reason: "merge-in-progress",
            step: "precondition",
            cwd: repositoryRoot,
          }),
        );
      }
    }

    for (const directory of ["rebase-merge", "rebase-apply"]) {
      const exists = yield* Effect.promise(() =>
        access(join(gitDir, directory))
          .then(() => true)
          .catch(() => false),
      );
      if (exists) {
        return yield* Effect.fail(
          new CommitWriteError({
            message: `Cannot create commits during a rebase.`,
            reason: "merge-in-progress",
            step: "precondition",
            cwd: repositoryRoot,
          }),
        );
      }
    }

    const unmerged = yield* runGit(gitPath, "ls-files", repositoryRoot, [
      "--no-pager",
      "ls-files",
      "-u",
    ]);
    if (unmerged.trim().length > 0) {
      return yield* Effect.fail(
        new CommitWriteError({
          message: "Resolve the conflicted files before creating commits.",
          reason: "unmerged",
          step: "precondition",
          cwd: repositoryRoot,
        }),
      );
    }

    const lockExists = yield* Effect.promise(() =>
      access(join(gitDir, "index.lock"))
        .then(() => true)
        .catch(() => false),
    );
    if (lockExists) {
      return yield* Effect.fail(
        new CommitWriteError({
          message: "The git index is locked by another process.",
          reason: "index-locked",
          step: "precondition",
          cwd: repositoryRoot,
        }),
      );
    }

    const identity = yield* runGit(gitPath, "rev-parse", repositoryRoot, [
      "--no-pager",
      "var",
      "GIT_AUTHOR_IDENT",
    ]).pipe(Effect.option);
    if (identity._tag === "None") {
      return yield* Effect.fail(
        new CommitWriteError({
          message: "Set git user.name and user.email before creating commits.",
          reason: "identity-missing",
          step: "identity",
          cwd: repositoryRoot,
        }),
      );
    }

    const headSha = yield* getHeadSha(gitPath, repositoryRoot);
    const symbolic = yield* runGit(
      gitPath,
      "rev-parse",
      repositoryRoot,
      ["--no-pager", "symbolic-ref", "-q", "HEAD"],
      { allowedExitCodes: [0, 1] },
    );
    const ref = symbolic.trim().length > 0 ? symbolic.trim() : "HEAD";
    const gpgSign = yield* runGit(
      gitPath,
      "rev-parse",
      repositoryRoot,
      ["--no-pager", "config", "--bool", "--get", "commit.gpgSign"],
      { allowedExitCodes: [0, 1] },
    );

    return { headSha, ref, sign: gpgSign.trim() === "true" };
  });

/**
 * Opt-in hook path: `git commit` runs the repository's hooks and signing
 * configuration, using the same temporary index. It is deliberately
 * non-atomic — `git commit` moves HEAD after each step, so a later hook
 * failure leaves earlier commits on the branch.
 */
const createCommitsSequential = (
  gitPath: string,
  repositoryRoot: string,
  commits: readonly CommitToWrite[],
  headSha: string | null,
): Effect.Effect<readonly string[], GitServiceError | CommitWriteError> =>
  Effect.gen(function* () {
    const directory = yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "patchwork-commit-")),
      catch: (cause) =>
        new GitServiceError({
          message: "Could not create a temporary index directory.",
          operation: "read-tree",
          cwd: repositoryRoot,
          cause,
        }),
    });
    const env = { GIT_INDEX_FILE: join(directory, "index") };

    return yield* Effect.gen(function* () {
      yield* runGit(
        gitPath,
        "read-tree",
        repositoryRoot,
        ["--no-pager", "read-tree", headSha ?? "--empty"],
        { env },
      );

      let previousTree = (yield* runGit(
        gitPath,
        "write-tree",
        repositoryRoot,
        ["--no-pager", "write-tree"],
        { env },
      )).trim();
      const hashes: string[] = [];

      for (const commit of commits) {
        for (const patch of commit.patches) {
          if (patch.patch.trim().length === 0) {
            continue;
          }
          yield* runGit(
            gitPath,
            "apply",
            repositoryRoot,
            ["--no-pager", "apply", "--cached", "--binary", "--whitespace=nowarn", "-p1"],
            { env, stdin: patch.patch },
          );
        }

        const tree = (yield* runGit(
          gitPath,
          "write-tree",
          repositoryRoot,
          ["--no-pager", "write-tree"],
          { env },
        )).trim();
        if (tree === previousTree) {
          return yield* Effect.fail(
            new CommitWriteError({
              message: `Commit "${commit.message.split("\n")[0] ?? ""}" contains no changes.`,
              reason: "empty-commit",
              step: "write-tree",
              cwd: repositoryRoot,
              hashes,
            }),
          );
        }

        yield* runGit(gitPath, "commit", repositoryRoot, ["--no-pager", "commit", "-F", "-"], {
          env,
          stdin: commit.message,
        }).pipe(
          Effect.mapError((cause) => {
            const firstLine = commit.message.split("\n")[0] ?? "";
            return new CommitWriteError({
              message:
                hashes.length > 0
                  ? `Commit hooks failed for "${firstLine}" after ${hashes.length} commit(s) were created (${hashes.join(", ")}). Regenerate to draft the remaining changes. ${cause.message}`
                  : `Commit hooks failed for "${firstLine}": ${cause.message}`,
              reason: "hook-failed",
              step: "commit",
              cwd: repositoryRoot,
              hashes,
              cause,
            });
          }),
        );

        const hash = (yield* runGit(gitPath, "rev-parse", repositoryRoot, [
          "--no-pager",
          "rev-parse",
          "HEAD",
        ])).trim();
        hashes.push(hash);
        previousTree = (yield* runGit(gitPath, "rev-parse", repositoryRoot, [
          "--no-pager",
          "rev-parse",
          `${hash}^{tree}`,
        ])).trim();
      }

      const touchedPaths = [
        ...new Set(commits.flatMap((commit) => commit.patches.map((p) => p.path))),
      ];
      if (touchedPaths.length > 0) {
        yield* syncIndexToCommit(gitPath, repositoryRoot, hashes.at(-1)!, touchedPaths).pipe(
          Effect.mapError(
            (cause) =>
              new CommitWriteError({
                message: `Commits were created but the index could not be synced: ${cause.message}. Resync the selected paths with \`git reset -- <paths>\`; a plain \`git reset\` also unstages unrelated changes.`,
                reason: "index-sync-failed",
                step: "index-sync",
                cwd: repositoryRoot,
                hashes,
                cause,
              }),
          ),
        );
      }

      return hashes;
    }).pipe(
      Effect.ensuring(
        Effect.promise(() => rm(directory, { recursive: true, force: true })).pipe(
          Effect.orElseSucceed(() => undefined),
        ),
      ),
    );
  });

const createCommitsUncached = (
  gitPath: string,
  repositoryRoot: string,
  commits: readonly CommitToWrite[],
  options: CreateCommitsOptions = {},
): Effect.Effect<readonly string[], GitServiceError | CommitWriteError> =>
  Effect.gen(function* () {
    if (commits.length === 0) {
      return yield* Effect.fail(
        new CommitWriteError({
          message: "The commit plan is empty.",
          reason: "empty-commit",
          step: "precondition",
          cwd: repositoryRoot,
        }),
      );
    }

    const { headSha, ref, sign } = yield* preflight(gitPath, repositoryRoot);
    if (options.runHooks === true) {
      return yield* createCommitsSequential(gitPath, repositoryRoot, commits, headSha);
    }
    const zero = "0".repeat(40);
    const directory = yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "patchwork-commit-")),
      catch: (cause) =>
        new GitServiceError({
          message: "Could not create a temporary index directory.",
          operation: "read-tree",
          cwd: repositoryRoot,
          cause,
        }),
    });
    const env = { GIT_INDEX_FILE: join(directory, "index") };

    const mapWriteError =
      (step: CommitWriteError["step"], reason: CommitWriteError["reason"]) =>
      (cause: unknown): CommitWriteError =>
        new CommitWriteError({
          message: cause instanceof Error ? cause.message : String(cause),
          reason,
          step,
          cwd: repositoryRoot,
          cause,
        });

    return yield* Effect.gen(function* () {
      yield* runGit(
        gitPath,
        "read-tree",
        repositoryRoot,
        ["--no-pager", "read-tree", headSha ?? "--empty"],
        { env },
      );

      const baseTree = (yield* runGit(
        gitPath,
        "write-tree",
        repositoryRoot,
        ["--no-pager", "write-tree"],
        { env },
      )).trim();

      let parent = headSha ?? undefined;
      let previousTree = baseTree;
      const hashes: string[] = [];

      for (const commit of commits) {
        for (const patch of commit.patches) {
          if (patch.patch.trim().length === 0) {
            continue;
          }
          yield* runGit(
            gitPath,
            "apply",
            repositoryRoot,
            ["--no-pager", "apply", "--cached", "--binary", "--whitespace=nowarn", "-p1"],
            { env, stdin: patch.patch },
          ).pipe(Effect.mapError(mapWriteError("apply", "apply-failed")));
        }

        const tree = (yield* runGit(
          gitPath,
          "write-tree",
          repositoryRoot,
          ["--no-pager", "write-tree"],
          { env },
        )).trim();

        if (tree === previousTree) {
          return yield* Effect.fail(
            new CommitWriteError({
              message: `Commit "${commit.message.split("\n")[0] ?? ""}" contains no changes.`,
              reason: "empty-commit",
              step: "write-tree",
              cwd: repositoryRoot,
            }),
          );
        }

        const args = ["--no-pager", "commit-tree"];
        if (sign) {
          args.push("-S");
        }
        args.push(tree);
        if (parent !== undefined) {
          args.push("-p", parent);
        }
        args.push("-F", "-");

        const hash = (yield* runGit(gitPath, "commit-tree", repositoryRoot, args, {
          env,
          stdin: commit.message,
        })).trim();

        hashes.push(hash);
        parent = hash;
        previousTree = tree;
      }

      yield* runGit(gitPath, "update-ref", repositoryRoot, [
        "--no-pager",
        "update-ref",
        "-m",
        `patchwork: ${hashes.length} commit(s)`,
        ref,
        hashes.at(-1)!,
        headSha ?? zero,
      ]).pipe(Effect.mapError(mapWriteError("update-ref", "ref-conflict")));

      const touchedPaths = [
        ...new Set(commits.flatMap((commit) => commit.patches.map((p) => p.path))),
      ];
      if (touchedPaths.length > 0) {
        yield* syncIndexToCommit(gitPath, repositoryRoot, hashes.at(-1)!, touchedPaths).pipe(
          Effect.mapError(
            (cause) =>
              new CommitWriteError({
                message: `Commits were created but the index could not be synced: ${cause.message}. Resync the selected paths with \`git reset -- <paths>\`; a plain \`git reset\` also unstages unrelated changes.`,
                reason: "index-sync-failed",
                step: "index-sync",
                cwd: repositoryRoot,
                hashes,
                cause,
              }),
          ),
        );
      }

      return hashes;
    }).pipe(
      Effect.ensuring(
        Effect.promise(() => rm(directory, { recursive: true, force: true })).pipe(
          Effect.orElseSucceed(() => undefined),
        ),
      ),
    );
  });

export const GitServiceLive = (gitPath = "git") => {
  const idempotency = new Map<string, Promise<readonly string[]>>();

  return Layer.succeed(GitService, {
    getChangedFiles: (repositoryRoot) => getChangedFiles(gitPath, repositoryRoot),
    getChangeSet: (repositoryRoot, paths) => getChangeSet(gitPath, repositoryRoot, paths),
    getFileDiff: (repositoryRoot, path) =>
      getChangeSet(gitPath, repositoryRoot, [path]).pipe(
        Effect.map((changeSet) => {
          const file = changeSet.files.find(
            (entry) => entry.newPath === path || entry.oldPath === path,
          );
          return file?.raw ?? "";
        }),
      ),
    createCommits: (repositoryRoot, commits, options?: CreateCommitsOptions) => {
      const key =
        options?.idempotencyKey === undefined
          ? undefined
          : `${repositoryRoot}\0${options.idempotencyKey}`;

      if (key === undefined) {
        return createCommitsUncached(gitPath, repositoryRoot, commits, options);
      }

      const existing = idempotency.get(key);
      if (existing !== undefined) {
        return Effect.promise(() => existing);
      }

      const promise = Effect.runPromise(
        createCommitsUncached(gitPath, repositoryRoot, commits, options),
      );
      idempotency.set(key, promise);
      return Effect.promise(async () => {
        try {
          return await promise;
        } catch (cause) {
          idempotency.delete(key);
          throw cause;
        }
      });
    },
  });
};
