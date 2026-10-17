import { Effect } from "effect";
import { validatePlan, type CommitPlan } from "../../domain/commit-plan";
import { buildPatch, type DiffHunk, type FileDiff } from "../../domain/diff";
import {
  CommitWriteError,
  GitService,
  type CommitToWrite,
  type CommitWriteReason,
  type CommitWriteStep,
  type GitServiceError,
} from "../../services/git";
import { LoggerService } from "../../services/log";
import { buildUnits, type ComposeUnit } from "./units";

export interface CommitPlanInput {
  readonly repositoryRoot: string;
  readonly paths: readonly string[];
  readonly commits: readonly {
    readonly message: string;
    readonly hunkIds: readonly string[];
  }[];
  readonly idempotencyKey: string;
  readonly runHooks?: boolean;
}

export interface CommitPlanResult {
  readonly hashes: readonly string[];
}

const writeError = (
  message: string,
  reason: CommitWriteReason,
  step: CommitWriteStep,
  cwd: string,
  cause?: unknown,
): CommitWriteError =>
  new CommitWriteError({
    message,
    reason,
    step,
    cwd,
    ...(cause === undefined ? {} : { cause }),
  });

interface FileGroup {
  readonly file: FileDiff;
  readonly hunks: DiffHunk[];
  atomicPatch?: string;
}

type BuildCommitsResult =
  | { readonly ok: true; readonly commits: readonly CommitToWrite[] }
  | { readonly ok: false; readonly error: CommitWriteError };

const toCommits = (
  plan: CommitPlan,
  unitsById: ReadonlyMap<string, ComposeUnit>,
  repositoryRoot: string,
): BuildCommitsResult => {
  const commits: CommitToWrite[] = [];

  for (const commit of plan.commits) {
    const groups = new Map<string, FileGroup>();

    for (const id of commit.hunkIds) {
      const unit = unitsById.get(id);
      if (unit === undefined) {
        return {
          ok: false,
          error: writeError(
            `The plan references an unknown unit: ${id}`,
            "stale-plan",
            "precondition",
            repositoryRoot,
          ),
        };
      }

      const group = groups.get(unit.path);
      if (unit.kind === "file") {
        groups.set(unit.path, { file: unit.file, hunks: [...unit.hunks], atomicPatch: unit.patch });
      } else if (group !== undefined) {
        group.hunks.push(...unit.hunks);
      } else {
        groups.set(unit.path, { file: unit.file, hunks: [...unit.hunks] });
      }
    }

    const patches = [...groups.entries()]
      .map(([path, group]) => ({
        path,
        patch: group.atomicPatch ?? buildPatch(group.file, group.hunks),
      }))
      .filter((entry) => entry.patch.length > 0);

    if (patches.length === 0) {
      return {
        ok: false,
        error: writeError(
          `Commit "${commit.message.split("\n")[0] ?? ""}" has no changes.`,
          "empty-commit",
          "write-tree",
          repositoryRoot,
        ),
      };
    }

    commits.push({ message: commit.message, patches });
  }

  return { ok: true, commits };
};

/**
 * Re-derive the units from the current HEAD→worktree diff and apply the
 * plan atomically. Re-deriving is what makes a stale plan fail safely:
 * the ids the webview holds no longer exist if the worktree changed.
 */
export const commitPlan = (
  input: CommitPlanInput,
): Effect.Effect<
  CommitPlanResult,
  CommitWriteError | GitServiceError,
  GitService | LoggerService
> =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const log = yield* LoggerService;

    const changeSet = yield* git
      .getChangeSet(input.repositoryRoot, input.paths)
      .pipe(
        Effect.mapError((cause) =>
          writeError(cause.message, "stale-plan", "precondition", input.repositoryRoot, cause),
        ),
      );

    const built = buildUnits(changeSet);
    if (built.conflicted.length > 0) {
      return yield* Effect.fail(
        writeError(
          `Resolve the conflicted files first: ${built.conflicted.join(", ")}`,
          "unmerged",
          "precondition",
          input.repositoryRoot,
        ),
      );
    }
    if (built.missing.length > 0) {
      return yield* Effect.fail(
        writeError(
          `The change set changed for: ${built.missing.join(", ")}. Regenerate the plan.`,
          "stale-plan",
          "precondition",
          input.repositoryRoot,
        ),
      );
    }

    const plan: CommitPlan = {
      commits: input.commits.map((commit) => ({
        message: commit.message,
        hunkIds: commit.hunkIds,
      })),
    };

    const validation = validatePlan(plan, new Set(built.units.map((unit) => unit.id)));
    if (!validation.valid) {
      return yield* Effect.fail(
        writeError(
          `The plan is stale: ${validation.message}. Regenerate it.`,
          "stale-plan",
          "precondition",
          input.repositoryRoot,
        ),
      );
    }

    const byId = new Map(built.units.map((unit) => [unit.id, unit]));
    const builtCommits = toCommits(plan, byId, input.repositoryRoot);
    if (!builtCommits.ok) {
      return yield* Effect.fail(builtCommits.error);
    }

    const hashes = yield* git.createCommits(input.repositoryRoot, builtCommits.commits, {
      idempotencyKey: input.idempotencyKey,
      ...(input.runHooks === undefined ? {} : { runHooks: input.runHooks }),
    });

    log.info(`created ${hashes.length} commit(s): ${hashes.join(", ")}`);
    return { hashes };
  });
