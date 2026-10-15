import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { HostApi, RpcClient, Transport, WebviewApi } from "../rpc/protocol";
import { createWebviewClient } from "./rpc";

/**
 * Shares the extension-host RPC connection across the webview tree.
 *
 * The transport is created once at the entrypoint (see `main.tsx`)
 * because `acquireVsCodeApi()` may only be called once per session. This
 * provider turns it into the two typed facades consumers need:
 *
 * - `useRpc()` — calls the host (`HostApi`);
 * - `useHostNotifications()` — handles what the host sends (`WebviewApi`).
 *
 * Building both here, rather than casting one client at each call site,
 * means a method name is checked against its real contract instead of
 * being trusted by assertion.
 *
 * The `QueryClient` is deliberately *not* provided here: TanStack
 * Query's own `QueryClientProvider` owns it, and `useQueryClient()` is
 * the single source of truth. Carrying a second copy would let the two
 * drift apart.
 */
interface RpcContextValue {
  readonly call: RpcClient<HostApi>;
  readonly serve: RpcClient<WebviewApi>;
}

const RpcContext = createContext<RpcContextValue | null>(null);

export interface RpcProviderProps {
  readonly transport: Transport;
  readonly children: ReactNode;
}

export const RpcProvider = ({ transport, children }: RpcProviderProps) => {
  // Both facades share one transport — the wire is symmetric, only the
  // contracts differ.
  const value = useMemo<RpcContextValue>(
    () => ({
      call: createWebviewClient<HostApi>(transport),
      serve: createWebviewClient<WebviewApi>(transport),
    }),
    [transport],
  );

  return <RpcContext.Provider value={value}>{children}</RpcContext.Provider>;
};

function useRpcContext(): RpcContextValue {
  const value = useContext(RpcContext);
  if (value === null) {
    throw new Error("useRpc must be used within RpcProvider");
  }
  return value;
}

/** Calls a method the host serves. */
export function useRpc(): RpcClient<HostApi> {
  return useRpcContext().call;
}

/** Registers handlers for notifications the host sends. */
export function useHostNotifications(): RpcClient<WebviewApi> {
  return useRpcContext().serve;
}
