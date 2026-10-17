export interface PlannedCommit {
  readonly message: string;
  readonly hunkIds: readonly string[];
}

export interface CommitPlan {
  readonly commits: readonly PlannedCommit[];
}

export interface PlanValidation {
  readonly valid: boolean;
  readonly message: string;
}

const collect = (plan: CommitPlan): readonly string[] =>
  plan.commits.flatMap((commit) => commit.hunkIds);

/**
 * The model's plan is a partition of the expected units.
 *
 * Validation is deliberately strict: the host is about to apply these
 * IDs to a git index, so an unknown ID, a duplicate, or a missing unit
 * is a hard failure rather than something to repair silently.
 */
export const validatePlan = (
  plan: CommitPlan,
  expectedIds: ReadonlySet<string>,
): PlanValidation => {
  const problems: string[] = [];

  if (plan.commits.length === 0) {
    problems.push("the plan has no commits");
  }

  plan.commits.forEach((commit, index) => {
    if (commit.message.trim().length === 0) {
      problems.push(`commit ${index + 1} has an empty message`);
    }
    if (commit.hunkIds.length === 0) {
      problems.push(`commit ${index + 1} has no hunks`);
    }
  });

  const seen = new Map<string, number>();
  for (const id of collect(plan)) {
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }

  const unknown = [...seen.keys()].filter((id) => !expectedIds.has(id));
  if (unknown.length > 0) {
    problems.push(`unknown hunk ids: ${unknown.join(", ")}`);
  }

  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicates.length > 0) {
    problems.push(`hunk ids used more than once: ${duplicates.join(", ")}`);
  }

  const missing = [...expectedIds].filter((id) => !seen.has(id));
  if (missing.length > 0) {
    problems.push(`hunks not assigned to a commit: ${missing.join(", ")}`);
  }

  return problems.length === 0
    ? { valid: true, message: "" }
    : { valid: false, message: problems.join("; ") };
};
