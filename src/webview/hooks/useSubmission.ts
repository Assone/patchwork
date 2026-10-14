import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One proposed commit, generated server-side from the user's selection.
 *
 * `files` is a snapshot of paths at the moment the user submitted. The
 * diff itself is owned by the review view (looked up via the mock diff
 * service) — what `Commit` carries is *which* files belong to this
 * commit, and the message. The view is responsible for rendering.
 */
export interface Commit {
  readonly id: string;
  readonly message: string;
  readonly files: readonly { readonly path: string; readonly type: string }[];
}

/**
 * Submission status the composer / review page react to.
 *
 *   idle       – user is editing the message
 *   submitting – request in flight; the composer is replaced by a spinner
 *   reviewing  – one or more commits were generated; the review page
 *                shows the list and the focused commit's diff
 *   confirming – the user clicked "Commit"; the CTA shows a spinner
 *   done       – commits were written; the success page is up
 *   error      – submission failed; the composer shows the reason
 */
export type SubmissionStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "reviewing"; commits: readonly Commit[] }
  | { kind: "confirming"; commits: readonly Commit[] }
  | { kind: "done"; hashes: readonly string[] }
  | { kind: "error"; reason: string };

export interface UseSubmission {
  readonly status: SubmissionStatus;
  /** Starts a commit generation. Resolves when the status leaves `idle`. */
  readonly generate: (request: SubmitRequest) => void;
  /** Confirms the commits with their current (possibly edited) messages. */
  readonly confirm: (commits: readonly Commit[]) => void;
  /** Returns to the composer, dropping any transient state. */
  readonly cancel: () => void;
  /** Re-runs the most recent generate() with the same request. */
  readonly retry: () => void;
}

export interface SubmitRequest {
  readonly message: string;
  readonly files: readonly { readonly path: string; readonly type: string }[];
}

/**
 * Mock commit-generation service.
 *
 * Takes the user's selection and splits it into 1–3 commits at random.
 * The message is generated too: it's the user's draft, prefixed by
 * `[generated]` so the user can see what's synthetic. Each commit
 * contains a contiguous slice of the input files.
 *
 * This will eventually call into the extension-host git service; for now
 * it exists in-module so the UI can be built without a real backend.
 */
function mockGenerate(request: SubmitRequest): readonly Commit[] {
  const groupCount = Math.min(request.files.length, 1 + Math.floor(Math.random() * 3));
  const groups: Commit[] = [];
  // Round-robin split: file i lands in group (i % groupCount).
  const buckets: { path: string; type: string }[][] = Array.from({ length: groupCount }, () => []);
  request.files.forEach((file, index) => {
    buckets[index % groupCount].push(file);
  });
  for (const bucket of buckets) {
    if (bucket.length === 0) {
      continue;
    }
    const summary = bucket.map((f) => f.path.split("/").pop()).join(", ");
    groups.push({
      id: `c_${groups.length}_${Date.now().toString(36)}`,
      message: request.message
        ? `${request.message}\n\n[generated] touches ${summary}`
        : `[generated] touches ${summary}`,
      files: bucket,
    });
  }
  return groups;
}

/**
 * Owns the multi-step commit submission state.
 *
 * Transitions are one-way and explicit — there is no `setState` outside
 * the hook, so the routes can never disagree about what the user is
 * currently looking at. Status itself is a discriminated union so the
 * call site narrows automatically.
 *
 * Both async steps are modelled as a single in-flight timer held in a
 * ref, which buys three things at once:
 *
 *   - a new request supersedes the previous one, so a stale response can
 *     never win a race,
 *   - unmounting clears the timer, so a late callback can never call
 *     `setStatus` on a dead component, and
 *   - cancelling drops the in-flight request outright rather than racing
 *     it.
 *
 * `statusRef` mirrors the rendered status purely so the transition
 * guards can read it synchronously. That indirection is what lets those
 * guards stay outside `setStatus`'s updater — an updater must be pure,
 * because StrictMode invokes it twice and a `setTimeout` placed there
 * would register the timer twice.
 */
export function useSubmission(): UseSubmission {
  const [status, setStatus] = useState<SubmissionStatus>({ kind: "idle" });
  // Stash the most recent request so `retry` can replay it. Held in a
  // ref so updating it doesn't trigger a re-render.
  const lastRequestRef = useRef<SubmitRequest | null>(null);
  // The one in-flight mock request, if any. Overwriting the ref cancels
  // the previous request implicitly — see `schedule`.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest status, readable synchronously from inside a callback.
  const statusRef = useRef<SubmissionStatus>(status);

  // Single funnel for every state transition, keeping `statusRef` in
  // lockstep with the rendered value.
  const transition = useCallback((next: SubmissionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const schedule = useCallback((run: () => void, delay: number) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      run();
    }, delay);
  }, []);

  // Drop the pending request when the provider unmounts (a route change
  // can unmount the whole tree). Without this the timer would fire into
  // an unmounted component.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const generate = useCallback(
    (request: SubmitRequest) => {
      lastRequestRef.current = request;
      transition({ kind: "submitting" });
      // Mock: 20% failure, latency 1.5–3s.
      const delay = 1500 + Math.random() * 1500;
      schedule(() => {
        if (Math.random() < 0.2) {
          const reasons = [
            "pre-commit hook failed",
            "permission denied: index.lock",
            "CONFLICT (content): Merge conflict in App.tsx",
            "nothing to commit, working tree clean",
          ];
          const reason = reasons[Math.floor(Math.random() * reasons.length)];
          transition({ kind: "error", reason });
          return;
        }
        transition({
          kind: "reviewing",
          commits: mockGenerate(request),
        });
      }, delay);
    },
    [schedule, transition],
  );

  const confirm = useCallback(
    (commits: readonly Commit[]) => {
      // Ignore a confirm that isn't arriving from `reviewing` — a
      // double-click during `confirming`, say. The guard reads the ref
      // because it has to run *before* scheduling the side effect.
      if (statusRef.current.kind !== "reviewing") {
        return;
      }
      // Move into a confirming state immediately so the Review page can
      // swap its CTA for a spinner; the actual commit happens after a
      // short mock latency.
      transition({ kind: "confirming", commits });
      schedule(() => {
        const hashes = commits.map(() => Math.random().toString(16).slice(2, 9));
        transition({ kind: "done", hashes });
      }, 1200);
    },
    [schedule, transition],
  );

  const cancel = useCallback(() => {
    // Drop any in-flight request so a pending response can't resurrect
    // the composer the user just left.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    transition({ kind: "idle" });
  }, [transition]);

  const retry = useCallback(() => {
    const request = lastRequestRef.current;
    if (request === null) {
      return;
    }
    generate(request);
  }, [generate]);

  return { status, generate, confirm, cancel, retry };
}
