import { createRootRoute, Outlet } from "@tanstack/react-router";
import { SubmissionProvider } from "../submission-context";
import { FocusedCommitProvider } from "../focused-commit-context";

/**
 * Root layout — provider wrapper only.
 *
 * The two providers expose cross-route state: the commit submission
 * state machine and the focused-commit pointer. Everything else lives
 * inside the route that needs it.
 *
 * Each route still owns its full layout because the composer page and
 * the review page have very different shapes; routes can change their
 * layout without ripple effects on siblings.
 */
export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <SubmissionProvider>
      <FocusedCommitProvider>
        <Outlet />
      </FocusedCommitProvider>
    </SubmissionProvider>
  );
}
