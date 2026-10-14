import { createContext, useContext, type ReactNode } from "react";
import { useFocus } from "./hooks/useFocus";

interface UseFocusedCommit {
  readonly id: string | null;
  readonly focus: (id: string) => void;
  readonly reset: () => void;
}

const FocusedCommitContext = createContext<UseFocusedCommit | null>(null);

export interface FocusedCommitProviderProps {
  readonly children: ReactNode;
}

export const FocusedCommitProvider: React.FC<FocusedCommitProviderProps> = ({ children }) => {
  const { id, focus, clear } = useFocus();

  return (
    <FocusedCommitContext.Provider value={{ id, focus, reset: clear }}>
      {children}
    </FocusedCommitContext.Provider>
  );
};

export function useFocusedCommitContext(): UseFocusedCommit {
  const value = useContext(FocusedCommitContext);
  if (value === null) {
    throw new Error("useFocusedCommitContext must be used within FocusedCommitProvider");
  }
  return value;
}
