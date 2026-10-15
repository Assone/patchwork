import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import { RpcProvider } from "./rpc-context";
import { createWebviewTransport, createWindowWire } from "./rpc";
import "./main.css";

declare module "@tanstack/react-router" {
  interface Register {
    readonly router: typeof router;
  }
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Webview root element not found");
}

// Built once per webview session: `acquireVsCodeApi()` may only be
// called once, so the wire captures it here. `RpcProvider` turns this
// into the typed facades hooks use.
//
// Error stacks are not forwarded here: the webview has no privileged
// internals to leak, and the host side already controls what it sends.
const transport = createWebviewTransport(createWindowWire());

// Caches host reads so switching files is instant, and gives the
// invalidation hook somewhere to mark data stale when the repository
// changes. One instance for the webview's lifetime.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Host reads are fast and the host pushes invalidation when
      // something actually changes, so there's no reason to re-fetch on
      // a timer or refetch aggressively.
      staleTime: Infinity,
      // `staleTime` alone still lets the default gcTime drop inactive
      // entries after 5 minutes, which would quietly re-issue an RPC on
      // returning to a file. The cache is deliberately bounded anyway —
      // one file list plus one diff per file, invalidated by the host.
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const router = createRouter({
  routeTree,
  history: createHashHistory(),
  Wrap: ({ children }) => (
    // QueryClientProvider owns the cache; `useQueryClient()` is the only
    // way hooks should reach it.
    <QueryClientProvider client={queryClient}>
      <RpcProvider transport={transport}>{children}</RpcProvider>
    </QueryClientProvider>
  ),
});

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
