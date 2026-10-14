import { createContext, useContext, type ReactNode } from "react";
import { useSubmission, type UseSubmission } from "./hooks/useSubmission";

/**
 * Shares the multi-step commit-submission state across all routes.
 *
 * Composer triggers `generate`, review triggers `confirm`/`cancel`/
 * `retry`, done reads the resulting hashes. Because each route unmounts
 * the previous one (TanStack Router's `<Outlet />` swaps the subtree),
 * the only way to preserve the state machine across navigation is to
 * hold it in a provider mounted at the root.
 */
const SubmissionContext = createContext<UseSubmission | null>(null);

export function SubmissionProvider({ children }: { readonly children: ReactNode }) {
  return (
    <SubmissionContext.Provider value={useSubmission()}>{children}</SubmissionContext.Provider>
  );
}

/** Throws when used outside the provider — the dependency is hard. */
export function useSubmissionContext(): UseSubmission {
  const value = useContext(SubmissionContext);
  if (value === null) {
    throw new Error("useSubmissionContext must be used within SubmissionProvider");
  }
  return value;
}
