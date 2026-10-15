import { createContext, useContext, type ReactNode } from "react";
import type { HostApi, RpcClient } from "../rpc/protocol";

/**
 * Shares the extension-host RPC client across the webview component
 * tree.
 *
 * The client is created exactly once at the entrypoint (see
 * `main.tsx`) because `acquireVsCodeApi()` may only be called once per
 * webview session. This provider just makes that single instance
 * reachable from hooks without threading it through every route.
 */
const RpcContext = createContext<RpcClient<HostApi> | null>(null);

export interface RpcProviderProps {
  readonly client: RpcClient<HostApi>;
  readonly children: ReactNode;
}

export const RpcProvider = ({ client, children }: RpcProviderProps) => {
  return <RpcContext.Provider value={client}>{children}</RpcContext.Provider>;
};

/** Throws when used outside the provider — the connection is hard. */
export function useRpc(): RpcClient<HostApi> {
  const value = useContext(RpcContext);
  if (value === null) {
    throw new Error("useRpc must be used within RpcProvider");
  }
  return value;
}
