/**
 * Wire protocol shared by the extension host and the webview.
 *
 * Both sides import this module. rspack builds each entry's module
 * graph independently, so a dependency-free module like this one is
 * simply included in whichever bundles reach it — sharing it is what
 * keeps the two sides from drifting apart.
 *
 * The contract: every outgoing frame is one of three shapes. Every
 * incoming frame is validated by `parseWireFrame`, which returns `null`
 * for anything that doesn't match. Callers treat `null` as "not ours,
 * ignore" so that a stray `postMessage` from elsewhere in the webview
 * can never tear down a transport.
 *
 * Frame shapes are declared once as schemas and the types are derived
 * from them, so a change to the parser and a change to the type cannot
 * drift apart. `parseWireFrame` used to be hand-written predicates; it
 * silently dropped a nested `error.cause`, which is exactly the class
 * of bug a single declaration avoids.
 *
 * Everything here is JSON-only: values are structured-cloned by
 * `vscode.Webview.postMessage` and the webview's `window.message`.
 */
/**
 * Wire protocol shared by the extension host and the webview.
 *
 * Both sides import this module. rspack builds each entry's module
 * graph independently, so a dependency-free module like this one is
 * simply included in whichever bundles reach it — sharing it is what
 * keeps the two sides from drifting apart.
 *
 * The contract: every outgoing frame is one of three shapes. Every
 * incoming frame is validated by `parseWireFrame`, which returns `null`
 * for anything that doesn't match. Callers treat `null` as "not ours,
 * ignore" so that a stray `postMessage` from elsewhere in the webview
 * can never tear down a transport.
 *
 * Frame shapes are declared once as schemas and the types are derived
 * from them, so a change to the parser and a change to the type cannot
 * drift apart. `parseWireFrame` used to be hand-written predicates; it
 * silently dropped a nested `error.cause`, which is exactly the class
 * of bug a single declaration avoids.
 *
 * **Why Zod and not Effect Schema.** This module is shared with the
 * webview bundle, so whatever it imports lands there too. Measured on
 * this project: Effect Schema adds ~119 KB minified (~38 KB gzip) to
 * `dist/webview.js`, Zod adds ~40 KB minified (~13 KB gzip). Both
 * replace the same hand-written parsing; Zod is the cheaper way to get
 * a single source of truth across the boundary.
 *
 * Everything here is JSON-only: values are structured-cloned by
 * `vscode.Webview.postMessage` and the webview's `window.message`.
 */
import * as z from "zod";
import type { ChangedFile, DiffArea } from "./git-types";

/* ------------------------------------------------------------------ *
 * Frame schemas
 *
 * The types below are derived from these schemas rather than written by
 * hand, so parsing and typing have one source of truth.
 *
 * Every object is `strictObject` so an unexpected key is rejected rather
 * than silently stripped — notably a `req` that also carries `result`.
 * ------------------------------------------------------------------ */

/** Anything JSON can carry across the wire. */
const Json = z.unknown();

/**
 * Error shape carried by a `status: "err"` result.
 *
 * `cause` recurses, so the schema is declared with an explicit
 * `z.ZodType` annotation and lazily self-references.
 */
export interface WireSerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: WireSerializedError;
}

const SerializedError: z.ZodType<WireSerializedError> = z.strictObject({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
  cause: z.lazy(() => SerializedError).optional(),
});

const RequestFrame = z.strictObject({
  kind: z.literal("req"),
  id: z.string(),
  method: z.string(),
  payload: Json.optional(),
});

const NotifyFrame = z.strictObject({
  kind: z.literal("notify"),
  method: z.string(),
  payload: Json.optional(),
});

/**
 * `value` is optional because `JSON.stringify` drops `undefined`: a
 * handler returning `undefined` legitimately produces `{"status":"ok"}`
 * on the wire. `null` still round-trips as `null`, so the two stay
 * distinguishable to the caller.
 */
const OkResult = z.strictObject({
  status: z.literal("ok"),
  value: Json.optional(),
});

const ErrResult = z.strictObject({
  status: z.literal("err"),
  error: SerializedError,
});

const ResponseFrame = z.strictObject({
  kind: z.literal("res"),
  id: z.string(),
  result: z.discriminatedUnion("status", [OkResult, ErrResult]),
});

export type WireRequestFrame = z.infer<typeof RequestFrame>;
export type WireNotifyFrame = z.infer<typeof NotifyFrame>;
export type WireResponseFrame = z.infer<typeof ResponseFrame>;
export type WireResult = z.infer<typeof OkResult | typeof ErrResult>;

/**
 * A frame, discriminated on `kind`.
 */
const WireFrameSchema = z.discriminatedUnion("kind", [RequestFrame, NotifyFrame, ResponseFrame]);

export type WireFrame = z.infer<typeof WireFrameSchema>;

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

/**
 * Validates an inbound value against the protocol.
 *
 * Returns `null` for anything that isn't a well-formed frame, so a
 * transport can drop it instead of throwing. `safeParse` avoids the
 * throw/catch that a `parse` would need; the failure detail is
 * intentionally discarded, since either it is a valid frame or we
 * ignore it.
 */
export function parseWireFrame(value: unknown): WireFrame | null {
  const result = WireFrameSchema.safeParse(value);
  return result.success ? result.data : null;
}

/* ------------------------------------------------------------------ *
 * Caller-side errors
 * ------------------------------------------------------------------ */

/**
 * Reconstructed on the caller side from a `status: "err"` frame.
 *
 * `name` mirrors the *remote* error's name rather than a fixed string
 * so callers can branch on it:
 * `if (err instanceof RemoteError && err.name === "MethodNotFoundError")`.
 * `instanceof` tells you it came from the other side; `.name` tells you
 * what went wrong over there.
 */
export class RemoteError extends Error {
  constructor(readonly serialized: WireSerializedError) {
    super(serialized.message);
    this.name = serialized.name;
    if (serialized.stack !== undefined) {
      this.stack = serialized.stack;
    }
    if (serialized.cause !== undefined) {
      this.cause = new RemoteError(serialized.cause);
    }
  }
}

export class TimeoutError extends Error {
  override readonly name = "TimeoutError";
  constructor(
    public readonly method: string,
    public readonly timeoutMs: number,
  ) {
    super(`RPC call "${method}" timed out after ${timeoutMs}ms`);
  }
}

export class AbortError extends Error {
  override readonly name = "AbortError";
  constructor(public readonly method: string) {
    super(`RPC call "${method}" was aborted`);
  }
}

/* ------------------------------------------------------------------ *
 * Serialization
 * ------------------------------------------------------------------ */

/**
 * Flattens any thrown value into the wire shape. `cause` chains are
 * walked recursively; non-`Error` throws are stringified, falling back
 * to `String(cause)` if even `JSON.stringify` throws (cycles).
 */
export function serializeError(cause: unknown, includeStack: boolean): WireSerializedError {
  if (cause instanceof Error) {
    const stack = includeStack && typeof cause.stack === "string" ? cause.stack : undefined;
    const nested =
      "cause" in cause && cause.cause !== undefined
        ? serializeError(cause.cause, includeStack)
        : undefined;
    return {
      name: cause.name,
      message: cause.message,
      ...(stack === undefined ? {} : { stack }),
      ...(nested === undefined ? {} : { cause: nested }),
    };
  }
  let message: string;
  try {
    message = JSON.stringify(cause);
  } catch {
    message = String(cause);
  }
  return { name: "NonErrorThrown", message };
}

/* ------------------------------------------------------------------ *
 * Transport surface
 * ------------------------------------------------------------------ */

/**
 * A handler runs on the *receiving* side. It returns a Promise;
 * throwing or rejecting is reported back to the caller as a
 * `status: "err"` response.
 *
 * Payload and result *shape* safety comes from the contract, not from
 * this signature — see `register` on the client, which is typed
 * against `RpcContract`.
 */
export type RpcHandler = (payload: unknown) => Promise<unknown>;

/** Options for a single call. Both fields are optional. */
export interface RpcCallOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * The message channel, one direction pair, abstracted away.
 *
 * `Wire` is the only place that knows about `vscode.Webview` or the
 * browser `message` event, which is what lets the transport be shared.
 */
export interface Wire {
  /** Send a frame to the peer. */
  send(frame: WireFrame): void;
  /** Subscribe to incoming frames. Returns an unsubscribe function. */
  subscribe(handler: (frame: WireFrame) => void): () => void;
  /** Optional lifecycle teardown. */
  dispose?(): void;
}

export interface Transport {
  request<T = unknown>(method: string, payload: unknown, options?: RpcCallOptions): Promise<T>;
  notify(method: string, payload: unknown): void;
  register(method: string, handler: RpcHandler): () => void;
  dispose(): void;
}

/* ------------------------------------------------------------------ *
 * Contracts and clients
 * ------------------------------------------------------------------ */

/**
 * Shape of a single method entry in a contract.
 */
export type RpcMethod = { readonly payload: unknown; readonly result: unknown };

/**
 * A contract maps a method name to its payload/result pair.
 *
 * Contracts are declared with `type` rather than `interface`: only type
 * aliases with object-literal bodies get an implicit index signature,
 * so an `interface` would not satisfy this `Record` constraint.
 */
export type RpcContract = Record<string, RpcMethod>;

/**
 * Typed facade over a `Transport`.
 *
 * Payload is optional so void-payload methods can be called as
 * `client.call("git.refresh")`.
 */
export interface RpcClient<T extends RpcContract> {
  call<K extends keyof T>(
    method: K,
    payload?: T[K]["payload"],
    options?: RpcCallOptions,
  ): Promise<T[K]["result"]>;
  notify<K extends keyof T>(method: K, payload?: T[K]["payload"]): void;
  register<K extends keyof T>(
    method: K,
    handler: (payload: T[K]["payload"]) => Promise<T[K]["result"]>,
  ): () => void;
  dispose(): void;
}

/**
 * Builds a client from a transport. Shared by both sides so the two
 * cannot drift on call semantics.
 */
export function createRpcClient<T extends RpcContract>(transport: Transport): RpcClient<T> {
  return {
    call: (method, payload, options) => transport.request(String(method), payload, options),
    notify: (method, payload) => transport.notify(String(method), payload),
    register: (method, handler) => transport.register(String(method), handler),
    dispose: () => transport.dispose(),
  };
}

/* ------------------------------------------------------------------ *
 * Shared transport implementation
 * ------------------------------------------------------------------ */

interface InflightEntry {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly method: string;
  readonly timeoutHandle?: ReturnType<typeof setTimeout>;
}

export interface CreateTransportOptions {
  /**
   * Whether the *handling* side forwards `.stack` when a handler
   * throws. Defaults to false: stack traces are large and rarely
   * useful across the boundary.
   */
  readonly includeErrorStacks?: boolean;
  /**
   * Prefix for generated request ids. Distinct per side so a frame
   * captured in a log is trivially attributable.
   */
  readonly idPrefix?: string;
  /**
   * Observes what the transport does. Both sides accept one; only the
   * host is expected to pass a real logger, since the webview has no
   * durable place to write.
   *
   * This exists because the transport is otherwise silent about its own
   * failures. A handler that throws is answered to the peer, so without
   * this the host would have no record that anything went wrong on its
   * side at all.
   */
  readonly observer?: TransportObserver;
}

/**
 * Observation hooks for a `Transport`.
 *
 * Deliberately plain functions rather than a logger type: this module is
 * shared with the webview and must stay free of `effect`, so the host
 * adapts `LoggerService` to these signatures instead of the other way
 * around.
 */
export interface TransportObserver {
  /** An inbound request found no registered handler. */
  readonly onMethodNotFound?: (method: string, id: string) => void;
  /** An inbound handler threw or rejected. */
  readonly onHandlerError?: (method: string, error: unknown) => void;
  /** A `notify` handler threw. Notifications have no reply channel. */
  readonly onNotificationError?: (method: string, error: unknown) => void;
  /** A response arrived for a request that already settled. */
  readonly onOrphanResponse?: (id: string) => void;
  /** The transport was disposed. */
  readonly onDispose?: () => void;
}

/**
 * Creates a `Transport` over any `Wire`.
 *
 * Shared by both sides. The state machine is identical on each side —
 * what differs is only the `Wire` implementation underneath, which is
 * the entire reason this can be one function instead of two.
 */
export function createTransport(wire: Wire, options: CreateTransportOptions = {}): Transport {
  const includeStacks = options.includeErrorStacks === true;
  const idPrefix = options.idPrefix ?? "r";
  const observer = options.observer ?? {};
  const handlers = new Map<string, RpcHandler>();
  const inflight = new Map<string, InflightEntry>();
  let nextId = 0;
  let disposed = false;

  const sendError = (id: string, error: WireSerializedError): void => {
    wire.send({ kind: "res", id, result: { status: "err", error } });
  };

  const unsubscribe = wire.subscribe((frame) => {
    // Frames can still arrive between `dispose()` and the wire actually
    // tearing down its listener. Answering them would resurrect a
    // transport the owner believes is gone.
    if (disposed) {
      return;
    }
    // Response to one of our own outgoing requests.
    if (frame.kind === "res") {
      const entry = inflight.get(frame.id);
      if (entry === undefined) {
        // A late reply to a call we already timed out or aborted.
        observer.onOrphanResponse?.(frame.id);
        return;
      }
      inflight.delete(frame.id);
      if (entry.timeoutHandle !== undefined) {
        clearTimeout(entry.timeoutHandle);
      }
      if (frame.result.status === "ok") {
        entry.resolve(frame.result.value);
      } else {
        entry.reject(new RemoteError(frame.result.error));
      }
      return;
    }

    // Someone asking us to do work.
    if (frame.kind === "req") {
      const handler = handlers.get(frame.method);
      if (handler === undefined) {
        observer.onMethodNotFound?.(frame.method, frame.id);
        sendError(frame.id, {
          name: "MethodNotFoundError",
          message: `No handler registered for "${frame.method}"`,
        });
        return;
      }
      void (async () => {
        try {
          const value = await handler(frame.payload);
          wire.send({ kind: "res", id: frame.id, result: { status: "ok", value } });
        } catch (cause) {
          observer.onHandlerError?.(frame.method, cause);
          sendError(frame.id, serializeError(cause, includeStacks));
        }
      })();
      return;
    }

    // Fire-and-forget. No return channel exists, so a failing handler
    // has nowhere to report to — the observer is the only place it
    // leaves a trace.
    const handler = handlers.get(frame.method);
    if (handler !== undefined) {
      void handler(frame.payload).catch((cause: unknown) => {
        observer.onNotificationError?.(frame.method, cause);
      });
    }
  });

  const generateId = (): string => {
    nextId = (nextId + 1) >>> 0;
    return `${idPrefix}${nextId.toString(36)}`;
  };

  const request = <T = unknown>(
    method: string,
    payload: unknown,
    callOptions: RpcCallOptions = {},
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (disposed) {
        reject(new AbortError(method));
        return;
      }

      const id = generateId();
      let settled = false;

      const cleanup = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (inflight.delete(id) && timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
        signal?.removeEventListener("abort", onAbort);
      };

      const timeoutMs = callOptions.timeoutMs;
      const signal = callOptions.signal;

      const timeoutHandle =
        typeof timeoutMs === "number"
          ? setTimeout(() => {
              cleanup();
              reject(new TimeoutError(method, timeoutMs));
            }, timeoutMs)
          : undefined;

      // Don't let a pending RPC timer hold the Node process open. Only
      // the host side has an `unref`, hence the structural check.
      const maybeUnref = timeoutHandle as { unref?: () => void } | undefined;
      maybeUnref?.unref?.();

      const onAbort = (): void => {
        cleanup();
        reject(new AbortError(method));
      };

      if (signal?.aborted === true) {
        cleanup();
        reject(new AbortError(method));
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });

      inflight.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value as T);
        },
        reject: (reason) => {
          cleanup();
          reject(reason);
        },
        method,
        ...(timeoutHandle === undefined ? {} : { timeoutHandle }),
      });

      wire.send({ kind: "req", id, method, payload });
    });

  const notify = (method: string, payload: unknown): void => {
    if (disposed) {
      return;
    }
    wire.send({ kind: "notify", method, payload });
  };

  const register = (method: string, handler: RpcHandler): (() => void) => {
    if (disposed) {
      throw new Error("Cannot register a handler on a disposed transport");
    }
    if (handlers.has(method)) {
      throw new Error(`RPC handler "${method}" is already registered`);
    }
    handlers.set(method, handler);
    return () => {
      handlers.delete(method);
    };
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    observer.onDispose?.();
    for (const entry of inflight.values()) {
      if (entry.timeoutHandle !== undefined) {
        clearTimeout(entry.timeoutHandle);
      }
      entry.reject(new AbortError(entry.method));
    }
    inflight.clear();
    handlers.clear();
    unsubscribe();
    wire.dispose?.();
  };

  return { request, notify, register, dispose };
}

/* ------------------------------------------------------------------ *
 * Contract
 * ------------------------------------------------------------------ */

/**
 * Methods the extension host serves to the webview.
 *
 * Every payload and result must be JSON-only — everything here is
 * structured-cloned by `postMessage`. `ChangedFile` / `DiffArea` come
 * from `./git-types`, which has no `effect` dependency, so importing
 * this module into the webview bundle stays clean.
 */
export type HostApi = {
  /**
   * Handshake. The webview calls this once on boot to confirm the host
   * is wired up *and* to learn which repository it is operating on —
   * the webview deliberately has no filesystem or workspace access of
   * its own, so the host is the authority on where the repository is.
   */
  readonly "host.handshake": {
    readonly payload: undefined;
    readonly result: {
      readonly repositoryRoot: string;
      readonly workspaceFolders: readonly string[];
    };
  };
  /** Fetch the changed files for the current repository. */
  readonly "git.getChangedFiles": {
    readonly payload: undefined;
    readonly result: readonly ChangedFile[];
  };
  /** Fetch a unified diff for one file in one area. */
  readonly "git.getFileDiff": {
    readonly payload: { readonly path: string; readonly area: DiffArea };
    readonly result: string;
  };
};
