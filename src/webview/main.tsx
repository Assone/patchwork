import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RpcProvider } from "./rpc-context";
import { createWebviewClient, createWebviewTransport, createWindowWire } from "./rpc";
import "./main.css";
import { vscode } from "./utils/vscode";

const router = createRouter({
  routeTree,
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    readonly router: typeof router;
  }
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Webview root element not found");
}

const client = createWebviewClient(createWebviewTransport(createWindowWire(vscode)));

createRoot(rootElement).render(
  <StrictMode>
    <RpcProvider client={client}>
      <RouterProvider router={router} />
    </RpcProvider>
  </StrictMode>,
);
