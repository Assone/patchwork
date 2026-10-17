import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useSubmissionContext } from "../submission-context";
import { draftsFromPlan } from "../domain/submission";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { ReviewBody } from "../components/ReviewBody";
import { WaitingScreen } from "../components/WaitingScreen";

export const Route = createFileRoute("/review")({
  component: ReviewView,
});

function ReviewView() {
  const { status, confirm, cancel, retry, regenerateAll } = useSubmissionContext();
  const navigate = useNavigate();

  const draft = useMemo(() => {
    if (status.kind === "reviewing") {
      return {
        plan: status.plan,
        prompt: status.prompt,
        commits: draftsFromPlan(status.plan),
      };
    }
    if (status.kind === "confirming") {
      return { plan: status.plan, prompt: status.prompt, commits: status.commits };
    }
    return null;
  }, [status]);

  useEffect(() => {
    if (status.kind === "done") {
      void navigate({ to: "/done", replace: true });
    }
  }, [status, navigate]);

  if (status.kind === "submitting") {
    return (
      <WaitingScreen
        startedAt={status.startedAt}
        progress={status.progress}
        onCancel={() => {
          cancel();
          void navigate({ to: "/", replace: true });
        }}
      />
    );
  }

  if (status.kind === "error") {
    return (
      <ErrorScreen
        reason={status.reason}
        retrying={status.stage === "commit"}
        onBack={() => {
          cancel();
          void navigate({ to: "/", replace: true });
        }}
        onRetry={retry}
      />
    );
  }

  if (draft === null) {
    return null;
  }

  return (
    <ReviewBody
      plan={draft.plan}
      commits={draft.commits}
      confirming={status.kind === "confirming"}
      prompt={draft.prompt}
      onConfirm={(updated) => confirm(updated)}
      onCancel={() => {
        cancel();
        void navigate({ to: "/", replace: true });
      }}
      onRegenerate={(prompt) => regenerateAll(prompt)}
    />
  );
}

interface ErrorScreenProps {
  readonly reason: string;
  readonly retrying: boolean;
  readonly onBack: () => void;
  readonly onRetry?: () => void;
}

const ErrorScreen: React.FC<ErrorScreenProps> = ({ reason, retrying, onBack, onRetry }) => {
  return (
    <div className="bg-background-sidebar flex h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <ErrorBanner
        title={retrying ? "Commit failed:" : "Drafting failed:"}
        message={reason}
        className="rounded-sm border px-3 py-2"
      />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onBack} className="px-4">
          Back to selection
        </Button>
        {onRetry !== undefined && (
          <Button onClick={onRetry} className="px-4">
            {retrying ? "Retry commit" : "Retry"}
          </Button>
        )}
      </div>
    </div>
  );
};
