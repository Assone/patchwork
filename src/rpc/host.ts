import * as vscode from "vscode";
import { Effect } from "effect";
import type { ManagedRuntime } from "effect/ManagedRuntime";
import {
  createRpcClient,
  createTransport,
  parseWireFrame,
  type HostApi,
  type RpcClient,
  type Transport,
  type TransportObserver,
  type Wire,
  type WireFrame,
} from "./protocol";
import { LoggerService } from "../services/log";

export type {
  HostApi,
  RpcCallOptions,
  RpcClient,
  RpcContract,
  RpcHandler,
  RpcMethod,
  Transport,
  Wire,
  WireFrame,
  WireResult,
  WireSerializedError,
} from "./protocol";
export {
  AbortError,
  RemoteError,
  TimeoutError,
  createRpcClient,
  createTransport,
  parseWireFrame,
  serializeError,
} from "./protocol";

/**
 * Host-side adapters.
 *
 * This file is thin on purpose. The protocol, the transport state
 * machine and the client live in `../rpc/protocol`, which the
 * webview imports too — so the two sides cannot drift. All that remains
 * here is the part that genuinely differs: bridging `vscode.Webview`'s
 * one-way `postMessage` / `onDidReceiveMessage` pair to a `Wire`.
 */

/**
 * Wraps a `vscode.Webview` as a bidirectional `Wire`.
 *
 * `onDidReceiveMessage` delivers `unknown`, so every inbound value goes
 * through `parseWireFrame`; anything that doesn't match the protocol is
 * dropped rather than throwing, so an unrelated `postMessage` elsewhere
 * in the webview can't take down the transport.
 */
export function createWebviewWire(webview: vscode.Webview): Wire {
  const handlers = new Set<(frame: WireFrame) => void>();
  const subscription = webview.onDidReceiveMessage((raw) => {
    const frame = parseWireFrame(raw);
    if (frame !== null) {
      for (const handler of handlers) {
        handler(frame);
      }
    }
  });

  return {
    send(frame) {
      // `Webview.postMessage` structured-clones for us; frames are
      // JSON-safe by construction, so no manual stringify.
      webview.postMessage(frame);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    dispose() {
      handlers.clear();
      subscription.dispose();
    },
  };
}

export interface HostTransportOptions {
  /** Forward `.stack` on handler errors. Useful in dev, noisy in prod. */
  readonly includeErrorStacks?: boolean;
  /** Receives notice of failures the transport would otherwise hide. */
  readonly observer?: TransportObserver;
}

/**
 * Builds a host `Transport` over a webview.
 *
 * @param includeErrorStacks forward stacks on handler failures — pass
 * `isDev` from the extension context.
 */
export function createHostTransport(wire: Wire, options: HostTransportOptions = {}): Transport {
  return createTransport(wire, {
    includeErrorStacks: options.includeErrorStacks === true,
    // Distinguishes host-originated ids from webview-originated ones
    // when reading a captured frame.
    idPrefix: "h",
    ...(options.observer === undefined ? {} : { observer: options.observer }),
  });
}

export function createHostClient<T extends HostApi = HostApi>(transport: Transport): RpcClient<T> {
  return createRpcClient<T>(transport);
}

/**
 * Bridges an Effect-returning handler into the Promise-shaped RPC
 * layer.
 *
 * `runPromise` rejects with the squashed cause on failure, so the
 * rejection is caught by the transport and serialized into a
 * `status: "err"` frame — no manual `Exit` inspection needed, and the
 * Effect never crosses the wire.
 */
export const effectHandler =
  <A, E, R>(runtime: ManagedRuntime<R, never>, fn: (payload: never) => Effect.Effect<A, E, R>) =>
  (payload: unknown): Promise<unknown> =>
    runtime.runPromise(fn(payload as never));

/**
 * Adapts the host's `LoggerService` to the transport's logger-neutral
 * `TransportObserver`.
 *
 * This is the only place the two worlds meet. `protocol.ts` stays free
 * of `effect` so the webview can share it; the host supplies the
 * implementation. Resolved from the runtime on first use because the
 * transport is created outside any Effect context — the panel command
 * handler is plain imperative code.
 */
export const createLoggerObserver = (
  runtime: ManagedRuntime<LoggerService, never>,
): TransportObserver => {
  /**
   * The transport runs outside any Effect context (it is driven by the
   * panel's imperative command handler), so logging has to re-enter the
   * runtime. Fire-and-forget by design: a logging failure must never
   * take down the transport it is observing.
   */
  const log = (level: "debug" | "warn" | "error", message: string): void => {
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const logger = yield* LoggerService;
          yield* Effect.sync(() => logger[level](message));
        }),
      )
      .catch(() => {});
  };

  const describe = (error: unknown): string =>
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return {
    onMethodNotFound: (method) => {
      log("warn", `RPC: no handler registered for "${method}"`);
    },
    onHandlerError: (method, error) => {
      log("error", `RPC handler "${method}" failed: ${describe(error)}`);
    },
    onNotificationError: (method, error) => {
      log("error", `RPC notification "${method}" failed: ${describe(error)}`);
    },
    onOrphanResponse: (id) => {
      log("debug", `RPC: ignoring response ${id} for an already-settled request`);
    },
    onDispose: () => {
      log("debug", "RPC: transport disposed");
    },
  };
};

/**
 * Registers an Effect handler against a typed payload. Keeps the
 * runPromise plumbing in one place so callers don't reinvent it per
 * method.
 */
export const registerEffectHandler =
  <R>(client: RpcClient<HostApi>, runtime: ManagedRuntime<R, never>) =>
  <A, E, K extends keyof HostApi>(
    method: K,
    fn: (payload: HostApi[K]["payload"]) => Effect.Effect<A, E, R>,
  ): (() => void) =>
    client.register(
      method,
      (payload) => runtime.runPromise(fn(payload)) as Promise<HostApi[K]["result"]>,
    );
