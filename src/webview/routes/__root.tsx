import { createRootRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { SubmissionProvider } from "../submission-context";
import { ComposerProvider } from "../composer-context";
import { useRepositoryInvalidation } from "../hooks/useRepositoryInvalidation";
import { cn } from "../utils/cn";

/**
 * Root layout — provider wrapper plus app-wide subscriptions.
 *
 * The two providers expose cross-route state: the commit submission
 * state machine and the composer draft/selection. Review focus is
 * route-local and lives in `ReviewBody`.
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

  const location = useLocation();
  // Tabs only appear on the routes that have a permanent UI
  // (composer + settings). Review/done are full-screen workbench
  // pages where a tab header would be noise.
  const showTabs = location.pathname === "/" || location.pathname === "/settings";

  return (
    <SubmissionProvider>
      <ComposerProvider>
        <div className="bg-background-sidebar flex h-screen flex-col">
          <a
            href="#main"
            className="focus:bg-button-background focus:text-button-foreground sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:px-2 focus:py-1"
          >
            Skip to content
          </a>
          <h1 className="sr-only">Patchwork</h1>
          {showTabs && (
            <nav
              aria-label="Patchwork"
              className="border-input-border flex shrink-0 border-b text-xs"
            >
              <TabLink to="/" label="Compose" />
              <TabLink to="/settings" label="Settings" />
            </nav>
          )}
          <main id="main" className="min-h-0 flex-1">
            <Outlet />
          </main>
        </div>
      </ComposerProvider>
    </SubmissionProvider>
  );
}

interface TabLinkProps {
  readonly to: "/" | "/settings";
  readonly label: string;
}

/**
 * A single nav entry. The active tab picks up the focus border via the
 * `data-status` attribute TanStack Router sets on `<Link>` when its
 * `to` matches the current location — no extra `useMatch` needed.
 */
function TabLink(props: TabLinkProps) {
  return (
    <Link
      to={props.to}
      // `exact: true` so `/` doesn't match while the user is on
      // `/settings` (and vice versa) — TanStack Router's default is
      // inclusive matching, which would highlight both tabs on every
      // route that shares a prefix.
      activeOptions={{ exact: true }}
      activeProps={{ "aria-current": "page" }}
      style={{ height: "var(--header-h)" }}
      className={cn(
        "text-foreground-muted flex items-center px-3 leading-none",
        "border-b-2 border-transparent outline-none",
        "hover:bg-row-hover hover:text-foreground",
        "focus-visible:bg-row-hover focus-visible:outline-focus-border focus-visible:outline",
        "[&[data-status=active]]:border-focus-border [&[data-status=active]]:text-foreground",
      )}
    >
      {props.label}
    </Link>
  );
}
