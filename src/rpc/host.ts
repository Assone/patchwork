import * as vscode from "vscode";
import { Effect } from "effect";
import type { ManagedRuntime } from "effect/ManagedRuntime";
import {
  createRpcClient,
  createTransport,
  parseWireFrame,
  type HostApi,
  type RpcClient,
  type RpcContract,
  type Transport,
  type TransportObserver,
  type Wire,
  type WireFrame,
} from "./protocol";
import { LoggerService } from "../services/log";

/* Host-side wire and transport adapters. */

/** Malformed inbound messages are dropped, not thrown. */
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

export function createHostTransport(wire: Wire, options: HostTransportOptions = {}): Transport {
  return createTransport(wire, {
    includeErrorStacks: options.includeErrorStacks === true,
    // Distinguishes host-originated ids from webview-originated ones
    // when reading a captured frame.
    idPrefix: "h",
    ...(options.observer === undefined ? {} : { observer: options.observer }),
  });
}

/** `T` picks the contract checked by `register`/`notify`. */
export function createHostClient<T extends RpcContract = HostApi>(
  transport: Transport,
): RpcClient<T> {
  return createRpcClient<T>(transport);
}

/** Logging re-enters the runtime; a logging failure must never escape. */
export const createLoggerObserver = (
  runtime: ManagedRuntime<LoggerService, never>,
): TransportObserver => {
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
