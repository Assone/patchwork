import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useSubmissionContext } from "../submission-context";
import { useChangedFiles } from "../hooks/useChangedFiles";
import { Button } from "../components/Button";

export const Route = createFileRoute("/done")({
  component: DoneRoute,
});

function DoneRoute() {
  const { status, reset } = useSubmissionContext();
  const { files: allFiles, loading, error } = useChangedFiles();
  const navigate = useNavigate();

  useEffect(() => {
    if (status.kind !== "done") {
      void navigate({ to: "/", replace: true });
    }
  }, [status, navigate]);

  // A file-level comparison cannot tell whether every hunk was committed;
  // the freshly invalidated file list is the authoritative answer.
  const hasRemainingChanges = useMemo(
    () => !loading && error === null && allFiles.length > 0,
    [loading, error, allFiles],
  );

  if (status.kind !== "done") {
    return null;
  }

  const finish = () => {
    reset();
    void navigate({ to: "/" });
  };

  return (
    <div className="bg-background-sidebar flex h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <div className="text-badge-added text-[28px] leading-none" aria-hidden>
        ✓
      </div>
      <h2 className="text-sm font-medium">
        {status.commits.length === 1
          ? "Commit created"
          : `${status.commits.length} commits created`}
      </h2>
      <ul className="m-0 w-full max-w-md list-none p-0 text-left text-xs">
        {status.commits.map((commit) => (
          <li
            key={commit.hash}
            className="border-border flex flex-col gap-0.5 border-b py-1.5 last:border-b-0"
          >
            <span className="font-medium break-words">{commit.message.split("\n")[0] ?? ""}</span>
            <span className="font-editor text-foreground-muted">{commit.hash.slice(0, 10)}</span>
          </li>
        ))}
      </ul>
      <Button onClick={finish} className="mt-2 px-4">
        {hasRemainingChanges ? "New commit" : "Done"}
      </Button>
    </div>
  );
}
