import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RemoteError } from "../../rpc/protocol";
import type { GenerateCommitsResult } from "../../rpc/commit-types";
import { useHostNotifications, useRpc } from "../rpc-context";
import type {
  CommitDraft,
  SubmissionStatus,
  SubmitRequest,
  UseSubmission,
} from "../domain/submission";
import { repoKeys } from "./queryKeys";

const createdHashes = (error: RemoteError): readonly string[] => {
  const value = error.details?.hashes;
  return Array.isArray(value)
    ? value.filter((hash): hash is string => typeof hash === "string")
    : [];
};

const describeFailure = (error: unknown): string => {
  if (error instanceof RemoteError) {
    if (error.name === "CommitWriteError") {
      const hashes = createdHashes(error);
      return hashes.length > 0 && !hashes.every((hash) => error.message.includes(hash))
        ? `${error.message} Created commits: ${hashes.join(", ")}.`
        : error.message;
    }
    if (error.name === "LLMGenerateError") {
      return error.message;
    }
    if (error.name === "AbortError") {
      return "cancelled";
    }
    return `${error.name}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "the request failed";
};

export function useSubmission(): UseSubmission {
  const client = useRpc();
  const notifications = useHostNotifications();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SubmissionStatus>({ kind: "idle" });
  const lastRequestRef = useRef<SubmitRequest | null>(null);
  const inflightRef = useRef<AbortController | null>(null);
  const statusRef = useRef<SubmissionStatus>(status);

  const transition = useCallback((next: SubmissionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  /**
   * Abort the webview-side promise and, when a generation is in flight,
   * tell the host to stop the provider request as well. Without the second
   * half, cancelling only orphans the promise and the extension keeps
   * streaming in the background until the idle timeout fires.
   */
  const stopInflight = useCallback(
    (tellHost: boolean) => {
      inflightRef.current?.abort();
      inflightRef.current = null;

      const current = statusRef.current;
      if (tellHost && current.kind === "submitting") {
        client.notify("llm.cancelGenerate", { requestId: current.requestId });
      }
    },
    [client],
  );

  // Progress frames are cheap and already throttled by the host. Ignore
  // any frame belonging to a request that has since been abandoned.
  useEffect(() => {
    return notifications.register("llm.progress", async (progress) => {
      const current = statusRef.current;
      if (current.kind !== "submitting" || current.requestId !== progress.requestId) {
        return;
      }
      transition({ ...current, progress });
    });
  }, [notifications, transition]);

  useEffect(() => {
    return () => {
      // Unmount is the last chance to stop a provider request; `notify` is
      // a no-op once the transport has been disposed.
      const current = statusRef.current;
      inflightRef.current?.abort();
      inflightRef.current = null;
      if (current.kind === "submitting") {
        client.notify("llm.cancelGenerate", { requestId: current.requestId });
      }
    };
  }, [client]);

  const runGenerate = useCallback(
    (request: SubmitRequest) => {
      stopInflight(true);

      const requestId = crypto.randomUUID();
      const controller = new AbortController();
      inflightRef.current = controller;
      lastRequestRef.current = request;
      transition({
        kind: "submitting",
        requestId,
        startedAt: Date.now(),
        progress: null,
      });

      void (async () => {
        try {
          const plan = await client.call(
            "llm.generateCommits",
            { requestId, paths: request.paths, prompt: request.message },
            { signal: controller.signal },
          );
          if (controller.signal.aborted) {
            return;
          }
          inflightRef.current = null;
          transition({ kind: "reviewing", plan, prompt: request.message });
        } catch (cause) {
          if (controller.signal.aborted) {
            return;
          }
          inflightRef.current = null;
          transition({ kind: "error", stage: "generate", reason: describeFailure(cause) });
        }
      })();
    },
    [client, stopInflight, transition],
  );

  const runCommit = useCallback(
    (
      plan: GenerateCommitsResult,
      prompt: string,
      commits: readonly CommitDraft[],
      idempotencyKey: string,
    ) => {
      transition({ kind: "confirming", plan, prompt, commits, idempotencyKey });

      void (async () => {
        try {
          const { hashes } = await client.call("git.commitPlan", {
            paths: plan.paths,
            commits: commits.map((commit) => ({
              message: commit.message,
              hunkIds: commit.hunkIds,
            })),
            idempotencyKey,
          });
          void queryClient.invalidateQueries({ queryKey: repoKeys.changedFiles() });
          void queryClient.invalidateQueries({ queryKey: repoKeys.files() });
          transition({
            kind: "done",
            commits: hashes.map((hash, index) => ({
              hash,
              message: commits[index]?.message ?? "",
            })),
          });
        } catch (cause) {
          transition({
            kind: "error",
            stage: "commit",
            reason: describeFailure(cause),
            plan,
            prompt,
            commits,
            idempotencyKey,
          });
        }
      })();
    },
    [client, queryClient, transition],
  );

  const confirm = useCallback(
    (commits: readonly CommitDraft[]) => {
      const current = statusRef.current;
      if (current.kind !== "reviewing") {
        return;
      }
      runCommit(current.plan, current.prompt, commits, crypto.randomUUID());
    },
    [runCommit],
  );

  const cancel = useCallback(() => {
    stopInflight(true);
    transition({ kind: "idle" });
  }, [stopInflight, transition]);

  const reset = useCallback(() => {
    stopInflight(true);
    lastRequestRef.current = null;
    transition({ kind: "idle" });
  }, [stopInflight, transition]);

  const retry = useCallback(() => {
    const current = statusRef.current;
    if (current.kind !== "error") {
      return;
    }

    if (
      current.stage === "commit" &&
      current.plan !== undefined &&
      current.prompt !== undefined &&
      current.commits !== undefined &&
      current.idempotencyKey !== undefined
    ) {
      runCommit(current.plan, current.prompt, current.commits, current.idempotencyKey);
      return;
    }

    if (lastRequestRef.current !== null) {
      runGenerate(lastRequestRef.current);
    }
  }, [runCommit, runGenerate]);

  const regenerateAll = useCallback(
    (prompt: string) => {
      const current = statusRef.current;
      if (current.kind !== "reviewing" && current.kind !== "confirming") {
        return;
      }
      const request = lastRequestRef.current;
      if (request === null) {
        return;
      }
      runGenerate({ message: prompt, paths: request.paths });
    },
    [runGenerate],
  );

  return useMemo(
    () => ({
      status,
      generate: runGenerate,
      confirm,
      cancel,
      retry,
      regenerateAll,
      reset,
    }),
    [status, runGenerate, confirm, cancel, retry, regenerateAll, reset],
  );
}
