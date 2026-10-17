import { useEffect, useState } from "react";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

/**
 * Full-screen placeholder shown while an async step is in flight.
 *
 * Both the composer (waiting on `generate`) and the review page (waiting
 * on `confirm`) replace their entire layout with this, so the two
 * routes can't drift apart on wording or spacing.
 */
export interface WaitingScreenProps {
  /** Line under the spinner. Defaults to the draft-generation copy. */
  readonly message?: string;
  /** Spinner diameter in pixels. */
  readonly size?: number;
  /** Wall-clock start of the step, used for a live elapsed counter. */
  readonly startedAt?: number;
  /** Latest stream snapshot, or null before the first progress frame. */
  readonly progress?: {
    readonly phase: "structured" | "text";
    readonly receivedChars: number;
  } | null;
  /** Shows a Cancel button when provided. */
  readonly onCancel?: () => void;
}

/** Re-renders once a second so a long wait visibly keeps counting. */
const useElapsedSeconds = (startedAt: number | undefined): number | null => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === undefined) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (startedAt === undefined) {
    return null;
  }
  return Math.max(0, Math.floor((now - startedAt) / 1000));
};

const progressLabel = (progress: WaitingScreenProps["progress"]): string | null => {
  if (progress === undefined || progress === null) {
    return null;
  }
  if (progress.receivedChars === 0) {
    return "Waiting for the first token…";
  }
  const source = progress.phase === "text" ? "Text plan" : "Structured plan";
  return `${source} · ${progress.receivedChars.toLocaleString()} characters received`;
};

export const WaitingScreen: React.FC<WaitingScreenProps> = ({
  message = "Drafting commits…",
  size = 20,
  startedAt,
  progress = null,
  onCancel,
}) => {
  const elapsed = useElapsedSeconds(startedAt);
  const label = progressLabel(progress);

  const elapsedLabel = elapsed === null ? null : `${elapsed}s`;
  const details = [
    elapsedLabel,
    label ?? (elapsed === null ? null : "Waiting for the first token…"),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <div
      className="bg-background-sidebar text-foreground-muted flex h-screen flex-col items-center justify-center gap-3"
      role="status"
      aria-busy="true"
    >
      <Spinner size={size} />
      <span className="text-xs">{message}</span>
      {/* Ticks every second; keep it out of the live region. */}
      <span className="text-[10px]" aria-live="off">
        {details}
      </span>
      {onCancel === undefined ? null : (
        <Button variant="secondary" onClick={onCancel} className="mt-1 px-4">
          Cancel
        </Button>
      )}
    </div>
  );
};
