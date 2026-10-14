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
}

export const WaitingScreen: React.FC<WaitingScreenProps> = ({
  message = "Drafting commits…",
  size = 20,
}) => {
  return (
    <div className="bg-background-sidebar text-foreground-muted flex h-screen flex-col items-center justify-center gap-3">
      <Spinner size={size} />
      <span className="text-xs">{message}</span>
    </div>
  );
};
