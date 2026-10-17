import { useCallback, useMemo, useState } from "react";

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

  return useMemo(() => ({ id, focus, clear }), [id, focus, clear]);
}
