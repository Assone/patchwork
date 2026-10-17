/**
 * Webview-side wire adapters. The protocol and transport state machine
 * are shared with the host; only the browser `message` bridge lives here.
 */
import {
  createRpcClient,
  createTransport,
  parseWireFrame,
  type HostApi,
  type RpcClient,
  type RpcContract,
  type Transport,
  type Wire,
  type WireFrame,
} from "../rpc/protocol";
import type { VsCodeWebviewApi } from "./utils/vscode";

/**
 * Wraps the browser `message` event plus `acquireVsCodeApi()` as a
 * bidirectional `Wire`.
 *
 * `acquireVsCodeApi()` may only be called once per webview session, so
 * the acquired object is captured in this closure and never exposed.
 * VS Code's guidance is also to keep that object off the global scope,
 * which this satisfies.
 *
 * @param api inject an already-acquired instance; mainly for tests.
 */
export function createWindowWire(api?: VsCodeWebviewApi): Wire {
  const acquired = api ?? window.acquireVsCodeApi?.();
  if (acquired === undefined) {
    throw new Error(
      "acquireVsCodeApi() is unavailable — this bundle is not running inside a VS Code webview",
    );
  }

  const handlers = new Set<(frame: WireFrame) => void>();
  const onMessage = (event: MessageEvent) => {
    const frame = parseWireFrame(event.data);
    if (frame !== null) {
      for (const handler of handlers) {
        handler(frame);
      }
    }
  };
  window.addEventListener("message", onMessage);

  return {
    send(frame) {
      acquired.postMessage(frame);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    dispose() {
      handlers.clear();
      window.removeEventListener("message", onMessage);
    },
  };
}

export interface WebviewTransportOptions {
  /** Forward `.stack` on handler errors. Off by default. */
  readonly includeErrorStacks?: boolean;
}

export function createWebviewTransport(
  wire: Wire,
  options: WebviewTransportOptions = {},
): Transport {
  return createTransport(wire, {
    includeErrorStacks: options.includeErrorStacks === true,
    idPrefix: "w",
  });
}

/**
 * A typed facade over the webview's transport.
 *
 * `T` selects the contract being checked against:
 *
 * - `HostApi` for requests the webview **sends** (`call`);
 * - `WebviewApi` for notifications it **handles** (`register`).
 *
 * Both directions share one transport — the wire is symmetric — the
 * contracts just differ, which is why they're separate types.
 */
export function createWebviewClient<T extends RpcContract = HostApi>(
  transport: Transport,
): RpcClient<T> {
  return createRpcClient<T>(transport);
}
