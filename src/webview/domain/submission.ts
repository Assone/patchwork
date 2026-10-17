import type { GenerateCommitsResult } from "../../rpc/commit-types";

export interface CommitDraft {
  readonly id: string;
  readonly message: string;
  readonly hunkIds: readonly string[];
}

export interface SubmitRequest {
  readonly message: string;
  readonly paths: readonly string[];
}

/** Latest stream snapshot for the in-flight generation. */
export interface SubmissionProgress {
  readonly phase: "structured" | "text";
  readonly receivedChars: number;
}

export type SubmissionStatus =
  | { kind: "idle" }
  | {
      kind: "submitting";
      readonly requestId: string;
      readonly startedAt: number;
      readonly progress: SubmissionProgress | null;
    }
  | { kind: "reviewing"; plan: GenerateCommitsResult; prompt: string }
  | {
      kind: "confirming";
      plan: GenerateCommitsResult;
      prompt: string;
      commits: readonly CommitDraft[];
      idempotencyKey: string;
    }
  | {
      kind: "done";
      readonly commits: readonly { readonly hash: string; readonly message: string }[];
    }
  | {
      kind: "error";
      stage: "generate" | "commit";
      reason: string;
      plan?: GenerateCommitsResult;
      prompt?: string;
      commits?: readonly CommitDraft[];
      idempotencyKey?: string;
    };

export interface UseSubmission {
  readonly status: SubmissionStatus;
  readonly generate: (request: SubmitRequest) => void;
  readonly confirm: (commits: readonly CommitDraft[]) => void;
  readonly cancel: () => void;
  readonly retry: () => void;
  readonly regenerateAll: (prompt: string) => void;
  readonly reset: () => void;
}

export const draftsFromPlan = (plan: GenerateCommitsResult): readonly CommitDraft[] =>
  plan.commits.map((commit) => ({
    id: commit.id,
    message: commit.message,
    hunkIds: commit.hunkIds,
  }));
