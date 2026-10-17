import { createContext, use, useMemo, type ReactNode } from "react";
import type { HostApi, RpcClient, Transport, WebviewApi } from "../rpc/protocol";
import { createWebviewClient } from "./rpc";

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
  const value = use(RpcContext);
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
