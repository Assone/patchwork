import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useFocusedCommitContext } from "../focused-commit-context";
import { useSubmissionContext } from "../submission-context";
import { useChangedFiles } from "../hooks/useChangedFiles";
import { Button } from "../components/Button";

/**
 * `/done` — success screen listing the hashes of the commits just
 * written, plus a button to start a new commit.
 */
export const Route = createFileRoute("/done")({
  component: DoneRoute,
});

function DoneRoute() {
  const { status } = useSubmissionContext();
  const focusedCommit = useFocusedCommitContext();
  const { files: allFiles } = useChangedFiles();
  const navigate = useNavigate();

  // Guard: only show this page when we actually have finished commits.
  useEffect(() => {
    if (status.kind !== "done") {
      navigate({ to: "/", replace: true });
    }
  }, [status, navigate]);

  // hasRemainingChanges is the question "does the workspace still have
  // anything the user hasn't committed?" Answered here, not in
  // useSubmission, because useSubmission only knows what the user
  // submitted — it can't see the full workspace. We compare the
  // committed paths against the full file list. While useChangedFiles
  // is mocked this reads as a snapshot; once it goes over IPC it'll
  // re-query naturally on remount.
  const hasRemainingChanges = useMemo(() => {
    if (status.kind !== "done") {
      return false;
    }
    const committed = new Set(status.committedPaths);
    return allFiles.some((file) => !committed.has(file.path));
  }, [status, allFiles]);

  if (status.kind !== "done") {
    return null;
  }

  // The status carries a snapshot of `hasRemainingChanges` captured at
  // commit time. "Close" means "session is over" — no reset, since the
  // status will be replaced once the user starts a new session and the
  // submission state machine moves on naturally.
  const primaryAction = hasRemainingChanges
    ? {
        label: "New commit",
        handler: () => {
          focusedCommit.reset();
          navigate({ to: "/" });
        },
      }
    : {
        label: "Close",
        handler: () => {
          navigate({ to: "/" });
        },
      };

  return (
    <div className="bg-background-sidebar flex h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <div className="text-badge-added text-[28px] leading-none" aria-hidden>
        ✓
      </div>
      <h2 className="text-sm font-medium">
        {status.hashes.length === 1 ? "Commit created" : `${status.hashes.length} commits created`}
      </h2>
      <ul className="m-0 list-none p-0 text-xs">
        {status.hashes.map((hash, index) => (
          <li key={hash} className="font-editor text-foreground-muted">
            {index + 1}. {hash}
          </li>
        ))}
      </ul>
      <Button onClick={primaryAction.handler} className="mt-2 px-4">
        {primaryAction.label}
      </Button>
    </div>
  );
}
