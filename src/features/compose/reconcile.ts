import type { CommitPlan } from "../../domain/commit-plan";
import { groupForLockFile } from "../../domain/lock-files";
import type { ComposeUnit } from "./units";

/**
 * Attach every lock unit to the commit holding its manifest.
 *
 * The model never sees lock-file bodies or ids, so this is host policy,
 * not a suggestion. A lock file dropped by the model would otherwise be
 * left unstaged; one split across commits would be unreproducible.
 */
export const reconcileLockUnits = (plan: CommitPlan, units: readonly ComposeUnit[]): CommitPlan => {
  const locks = units.filter((unit) => unit.isLockFile);
  if (locks.length === 0) {
    return plan;
  }

  const commits = plan.commits.map((commit) => ({
    ...commit,
    hunkIds: [...commit.hunkIds],
  }));
  const pathById = new Map(units.map((unit) => [unit.id, unit.path]));

  const assigned = new Set(commits.flatMap((commit) => commit.hunkIds));

  for (const lock of locks) {
    if (assigned.has(lock.id)) {
      continue;
    }
    const manifest = groupForLockFile(lock.path);
    const manifestCommit =
      manifest === undefined
        ? -1
        : commits.findIndex((commit) => commit.hunkIds.some((id) => pathById.get(id) === manifest));
    const target = manifestCommit === -1 ? 0 : manifestCommit;
    commits[target]?.hunkIds.push(lock.id);
  }

  return { commits };
};
