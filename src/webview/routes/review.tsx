import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useFocusedCommitContext } from "../focused-commit-context";
import { useSubmissionContext } from "../submission-context";
import { Button } from "../components/Button";
import { ReviewBody } from "../components/ReviewBody";
import { WaitingScreen } from "../components/WaitingScreen";

/**
 * `/review` — the workbench after commits have been drafted.
 *
 * `ReviewView` owns its own navigation guards: if status isn't
 * reviewing / confirming it redirects back to `/`.
 */
export const Route = createFileRoute("/review")({
  component: ReviewView,
});

function ReviewView() {
  const { status, generate, confirm, cancel, retry } = useSubmissionContext();
  const focusedCommit = useFocusedCommitContext();
  const navigate = useNavigate();

  const commits =
    status.kind === "reviewing" || status.kind === "confirming" ? status.commits : null;

  // Focus the first commit whenever a fresh review arrives.
  useEffect(() => {
    if (commits && commits.length > 0 && focusedCommit.id === null) {
      focusedCommit.focus(commits[0].id);
    }
  }, [commits, focusedCommit]);

  // Auto-navigate to /done once the commits have been written.
  useEffect(() => {
    if (status.kind === "done") {
      navigate({ to: "/done", replace: true });
    }
  }, [status, navigate]);

  if (status.kind === "submitting") {
    return <WaitingScreen />;
  }

  if (status.kind === "error") {
    return (
      <ErrorScreen
        reason={status.reason}
        onBack={() => {
          cancel();
          focusedCommit.reset();
          navigate({ to: "/", replace: true });
        }}
        onRetry={retry}
      />
    );
  }

  if (!commits) {
    return null;
  }

  return (
    <ReviewBody
      commits={commits}
      confirming={status.kind === "confirming"}
      onConfirm={(updated) => confirm(updated)}
      onCancel={() => {
        cancel();
        focusedCommit.reset();
        navigate({ to: "/", replace: true });
      }}
      onRegenerate={() => {
        const focused = commits.find((c) => c.id === focusedCommit.id) ?? commits[0];
        generate({
          message: "",
          files: focused.files,
        });
      }}
    />
  );
}

interface ErrorScreenProps {
  readonly reason: string;
  readonly onBack: () => void;
  readonly onRetry?: () => void;
}

const ErrorScreen: React.FC<ErrorScreenProps> = ({ reason, onBack, onRetry }) => {
  return (
    <div className="bg-background-sidebar flex h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <div
        className="border-border flex items-start gap-2 rounded-sm border px-3 py-2 text-xs"
        style={{
          background: "var(--color-diff-delete-background)",
          color: "var(--color-badge-deleted)",
        }}
        role="alert"
      >
        <span aria-hidden className="shrink-0 leading-none">
          ⚠
        </span>
        <span className="flex-1 leading-snug">
          <span className="font-medium">Drafting failed:</span> {reason}
        </span>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onBack} className="px-4">
          Back to selection
        </Button>
        {onRetry !== undefined && (
          <Button onClick={onRetry} className="px-4">
            Retry
          </Button>
        )}
      </div>
    </div>
  );
};
