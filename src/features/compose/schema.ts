import * as z from "zod";
import type { CommitPlan } from "../../domain/commit-plan";

export const CommitPlanSchema = z.object({
  commits: z
    .array(
      z.object({
        message: z.string().min(1),
        hunkIds: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

export type Proposal = z.infer<typeof CommitPlanSchema>;

export const toCommitPlan = (proposal: Proposal): CommitPlan => ({
  commits: proposal.commits.map((commit) => ({
    message: commit.message,
    hunkIds: commit.hunkIds,
  })),
});
