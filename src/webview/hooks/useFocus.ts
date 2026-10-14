import { useCallback, useState } from "react";

/**
 * Generic "which one of these is focused" state.
 *
 * Powers both `useFocusedFile` (the source file shown in the composer's
 * diff pane) and `useFocusedCommit` (the generated commit shown in the
 * review page). They only differ in what the id means, so the shared
 * mechanics live here once.
 *
 * `focus` and `clear` are stable across renders — they never read state,
 * so consumers can pass them straight to memoized children.
 */
export interface Focus<T extends string = string> {
  readonly id: T | null;
  readonly focus: (id: T) => void;
  readonly clear: () => void;
}

export function useFocus<T extends string = string>(): Focus<T> {
  const [id, setId] = useState<T | null>(null);

  const focus = useCallback((next: T) => {
    setId(next);
  }, []);

  const clear = useCallback(() => {
    setId(null);
  }, []);

  return { id, focus, clear };
}
