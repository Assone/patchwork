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

// `acquireVsCodeApi()` may only be called once per session.
const transport = createWebviewTransport(createWindowWire());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
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
