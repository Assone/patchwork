import * as z from "zod";

/* Frame schemas */

const Json = z.unknown();

/** The wire shape of a thrown error; `details` carries tagged-error fields. */
export interface WireSerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  /** Own, JSON-safe properties of a tagged error (`reason`, `operation`, …). */
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: WireSerializedError;
}

const SerializedError: z.ZodType<WireSerializedError> = z.strictObject({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
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

// `undefined` is dropped by JSON; `null` still round-trips.
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

const WireFrameSchema = z.discriminatedUnion("kind", [RequestFrame, NotifyFrame, ResponseFrame]);

export type WireFrame = z.infer<typeof WireFrameSchema>;

/** Returns null for malformed frames so the transport can drop them. */
export function parseWireFrame(value: unknown): WireFrame | null {
  const result = WireFrameSchema.safeParse(value);
  return result.success ? result.data : null;
}

/* Caller-side errors */

/** Reconstructed from a `status: "err"` frame; `.name` is the remote name. */
export class RemoteError extends Error {
  readonly details: Readonly<Record<string, unknown>> | undefined;
  constructor(readonly serialized: WireSerializedError) {
    super(serialized.message);
    this.name = serialized.name;
    this.details = serialized.details;
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

/* Serialization */

const errorDetails = (error: Error): Readonly<Record<string, unknown>> | undefined => {
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (key === "name" || key === "message" || key === "stack" || key === "cause") {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    try {
      JSON.stringify(value);
      details[key] = value;
    } catch {
      // Not wire-safe; leave it to the host log.
    }
  }
  return Object.keys(details).length === 0 ? undefined : details;
};

/**
 * Flattens any thrown value into the wire shape. Tagged-error fields
 * (`reason`, `operation`, `cwd`, …) travel in `details`, so the caller
 * can act on them without parsing the message.
 */
const serializeErrorSeen = (
  cause: unknown,
  includeStack: boolean,
  seen: Set<unknown>,
): WireSerializedError => {
  if (cause instanceof Error) {
    if (seen.has(cause)) {
      return { name: cause.name, message: "[circular cause]" };
    }
    seen.add(cause);

    const stack = includeStack && typeof cause.stack === "string" ? cause.stack : undefined;
    const details = errorDetails(cause);
    const nested =
      cause.cause !== undefined ? serializeErrorSeen(cause.cause, includeStack, seen) : undefined;

    return {
      name: cause.name,
      message: cause.message,
      ...(stack === undefined ? {} : { stack }),
      ...(details === undefined ? {} : { details }),
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
};

export function serializeError(cause: unknown, includeStack: boolean): WireSerializedError {
  return serializeErrorSeen(cause, includeStack, new Set());
}

/* Transport surface */

/** A handler runs on the receiving side; failures become `status: "err"`. */
export type RpcHandler = (payload: unknown) => Promise<unknown>;

export interface RpcCallOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** The message channel; the only place that knows about webview/browser APIs. */
export interface Wire {
  send(frame: WireFrame): void;
  subscribe(handler: (frame: WireFrame) => void): () => void;
  dispose?(): void;
}

export interface Transport {
  request<T = unknown>(method: string, payload: unknown, options?: RpcCallOptions): Promise<T>;
  notify(method: string, payload: unknown): void;
  register(method: string, handler: RpcHandler): () => void;
  dispose(): void;
}

/* Contracts and clients */

export type RpcMethod = { readonly payload: unknown; readonly result: unknown };

/** A contract maps a method name to its payload/result pair. */
export type RpcContract = Record<string, RpcMethod>;

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

export function createRpcClient<T extends RpcContract>(transport: Transport): RpcClient<T> {
  return {
    call: (method, payload, options) => transport.request(String(method), payload, options),
    notify: (method, payload) => transport.notify(String(method), payload),
    register: (method, handler) => transport.register(String(method), handler),
    dispose: () => transport.dispose(),
  };
}

/* Shared transport implementation */

interface InflightEntry {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly method: string;
  readonly timeoutHandle?: ReturnType<typeof setTimeout>;
}

export interface CreateTransportOptions {
  /** Forward `.stack` on handler errors. Off by default; stacks are large. */
  readonly includeErrorStacks?: boolean;
  /** Request-id prefix, so a captured frame is attributable to a side. */
  readonly idPrefix?: string;
  /** Observer for failures the transport would otherwise hide. */
  readonly observer?: TransportObserver;
}

/** Plain callbacks, so this module stays free of `effect`. */
export interface TransportObserver {
  readonly onMethodNotFound?: (method: string, id: string) => void;
  readonly onHandlerError?: (method: string, error: unknown) => void;
  readonly onNotificationError?: (method: string, error: unknown) => void;
  readonly onOrphanResponse?: (id: string) => void;
  readonly onDispose?: () => void;
}

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
    // Frames can arrive between dispose() and the wire teardown.
    if (disposed) {
      return;
    }
    if (frame.kind === "res") {
      const entry = inflight.get(frame.id);
      if (entry === undefined) {
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

    // Notifications have no reply channel; the observer is the only trace.
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

export type { HostApi, WebviewApi } from "./contract";
