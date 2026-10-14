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
  const { status, confirm, cancel, retry, regenerateAll } = useSubmissionContext();
  const focusedCommit = useFocusedCommitContext();
  const navigate = useNavigate();

  const draft =
    status.kind === "reviewing" || status.kind === "confirming"
      ? { commits: status.commits, prompt: status.prompt }
      : null;

  // Focus the first commit whenever a fresh review arrives. Also
  // recover if the previously-focused commit disappeared (e.g. after
  // regenerate-all produced an entirely new set of ids).
  useEffect(() => {
    if (!draft || draft.commits.length === 0) {
      return;
    }
    if (focusedCommit.id === null || !draft.commits.some((c) => c.id === focusedCommit.id)) {
      focusedCommit.focus(draft.commits[0].id);
    }
  }, [draft, focusedCommit]);

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

  if (!draft) {
    return null;
  }

  return (
    <ReviewBody
      commits={draft.commits}
      confirming={status.kind === "confirming"}
      prompt={draft.prompt}
      onConfirm={(updated) => confirm(updated)}
      onCancel={() => {
        cancel();
        focusedCommit.reset();
        navigate({ to: "/", replace: true });
      }}
      onRegenerate={(prompt) => regenerateAll(prompt)}
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
