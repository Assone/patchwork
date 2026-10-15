import { createRootRoute, Outlet } from "@tanstack/react-router";
import { SubmissionProvider } from "../submission-context";
import { FocusedCommitProvider } from "../focused-commit-context";
import { useRepositoryInvalidation } from "../hooks/useRepositoryInvalidation";

/**
 * Root layout — provider wrapper plus app-wide subscriptions.
 *
 * The two providers expose cross-route state: the commit submission
 * state machine and the focused-commit pointer. Everything else lives
 * inside the route that needs it.
 *
 * `useRepositoryInvalidation` is mounted here rather than in a route
 * because it must stay subscribed across navigation — a repository
 * change while the user is on `/review` still has to invalidate, even
 * though that route has no file tree of its own.
 *
 * Each route still owns its full layout because the composer page and
 * the review page have very different shapes; routes can change their
 * layout without ripple effects on siblings.
 */
export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  // Subscribes for the webview's lifetime; see the hook for why this
  // lives at the root rather than in a route.
  useRepositoryInvalidation();

  return (
    <SubmissionProvider>
      <FocusedCommitProvider>
        <Outlet />
      </FocusedCommitProvider>
    </SubmissionProvider>
  );
}
