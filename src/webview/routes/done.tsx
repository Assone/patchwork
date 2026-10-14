import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useFocusedCommitContext } from "../focused-commit-context";
import { useSubmissionContext } from "../submission-context";
import { Button } from "../components/Button";

/**
 * `/done` — success screen listing the hashes of the commits just
 * written, plus a button to start a new commit.
 */
export const Route = createFileRoute("/done")({
  component: DoneRoute,
});

function DoneRoute() {
  const { status, cancel } = useSubmissionContext();
  const focusedCommit = useFocusedCommitContext();
  const navigate = useNavigate();

  // Guard: only show this page when we actually have finished commits.
  useEffect(() => {
    if (status.kind !== "done") {
      navigate({ to: "/", replace: true });
    }
  }, [status, navigate]);

  if (status.kind !== "done") {
    return null;
  }

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
      <Button
        onClick={() => {
          cancel();
          focusedCommit.reset();
          navigate({ to: "/" });
        }}
        className="mt-2 px-4"
      >
        New commit
      </Button>
    </div>
  );
}
