import * as assert from "assert";
import {
  AbortError,
  createRpcClient,
  createTransport,
  parseWireFrame,
  RemoteError,
  TimeoutError,
  type Transport,
  type TransportObserver,
  type Wire,
  type WireFrame,
} from "../rpc/protocol";

/**
 * Transport tests.
 *
 * The protocol, the transport state machine and the client are shared
 * between the host and the webview (`src/rpc/protocol.ts`),
 * driven here over an in-memory wire. One implementation means there is
 * no second copy to drift — but the frames still cross a JSON boundary
 * in these tests, so serialization behaviour stays covered.
 *
 * The host- and webview-specific adapters (`createWebviewWire` /
 * `createWindowWire`) are the only untested layer; they need a real
 * VS Code webview and are the first thing to cover when the
 * integration test harness lands.
 */

interface Loopback {
  readonly transport: Transport;
  /** Frames observed leaving, in order. */
  readonly outbound: WireFrame[];
}

/**
 * A transport wired to itself through JSON, the way VS Code does.
 * Delivery is synchronous, which keeps the tests deterministic.
 */
const createLoopback = (
  options: { idPrefix?: string; observer?: TransportObserver } = {},
): Loopback => {
  const subscribers = new Set<(frame: WireFrame) => void>();
  const outbound: WireFrame[] = [];

  const wire: Wire = {
    send(frame) {
      outbound.push(frame);
      // Round-trip through JSON so the parsers stay honest about what
      // actually survives the structured clone.
      const parsed = parseWireFrame(JSON.parse(JSON.stringify(frame)) as unknown);
      assert.ok(parsed !== null, `frame failed to survive JSON: ${JSON.stringify(frame)}`);
      for (const subscriber of subscribers) {
        subscriber(parsed);
      }
    },
    subscribe(handler) {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
  };

  return { outbound, transport: createTransport(wire, options) };
};

interface PairOptions {
  readonly aObserver?: TransportObserver;
  readonly bObserver?: TransportObserver;
  readonly bIncludeStacks?: boolean;
}

/**
 * A pair of transports bridged to each other, so a request from one is
 * served by a handler registered on the other.
 *
 * `sentByA` / `sentByB` record frames each side *emitted*. So when
 * `b.request(...)` is served by a handler on `a`, the `req` lands in
 * `sentByB` and the `res` lands in `sentByA` — the answering side
 * writes the response.
 */
const createPair = ({ aObserver, bObserver, bIncludeStacks = false }: PairOptions = {}) => {
  const aSubs = new Set<(frame: WireFrame) => void>();
  const bSubs = new Set<(frame: WireFrame) => void>();
  const sentByA: WireFrame[] = [];
  const sentByB: WireFrame[] = [];

  const bridge = (
    from: Set<(frame: WireFrame) => void>,
    to: Set<(frame: WireFrame) => void>,
    log: WireFrame[],
  ): Wire => ({
    send(frame) {
      log.push(frame);
      const parsed = parseWireFrame(JSON.parse(JSON.stringify(frame)) as unknown);
      assert.ok(parsed !== null, `frame failed to survive JSON: ${JSON.stringify(frame)}`);
      for (const subscriber of to) {
        subscriber(parsed);
      }
    },
    subscribe(handler) {
      from.add(handler);
      return () => {
        from.delete(handler);
      };
    },
  });

  const a = createTransport(bridge(aSubs, bSubs, sentByA), {
    idPrefix: "a",
    ...(aObserver === undefined ? {} : { observer: aObserver }),
  });
  const b = createTransport(bridge(bSubs, aSubs, sentByB), {
    idPrefix: "b",
    includeErrorStacks: bIncludeStacks,
    ...(bObserver === undefined ? {} : { observer: bObserver }),
  });

  return {
    a,
    b,
    sentByA,
    sentByB,
  };
};

suite("RPC transport", () => {
  test("resolves a request with the handler's return value", async () => {
    const { a, b } = createPair();
    a.register("git.getChangedFiles", async (payload) => {
      const { repositoryRoot } = payload as { repositoryRoot: string };
      return [{ path: `${repositoryRoot}/README.md` }];
    });

    const result = await b.request("git.getChangedFiles", { repositoryRoot: "/tmp/x" });

    assert.deepStrictEqual(result, [{ path: "/tmp/x/README.md" }]);
    a.dispose();
    b.dispose();
  });

  test("roles are symmetric: either side can call the other", async () => {
    const { a, b } = createPair();
    b.register("ui.getTitle", async () => "Commit Composer");

    assert.strictEqual(await a.request("ui.getTitle", undefined), "Commit Composer");
    a.dispose();
    b.dispose();
  });

  test("preserves a null return value instead of coercing it", async () => {
    const { a, b } = createPair();
    a.register("returns.null", async () => null);

    assert.strictEqual(await b.request("returns.null", undefined), null);
    a.dispose();
    b.dispose();
  });

  test("preserves falsy payloads (0, false, empty string)", async () => {
    const { a, b } = createPair();
    a.register("echo", async (payload) => payload);

    assert.strictEqual(await b.request("echo", 0), 0);
    assert.strictEqual(await b.request("echo", false), false);
    assert.strictEqual(await b.request("echo", ""), "");
    a.dispose();
    b.dispose();
  });

  test("preserves nested structures and arrays", async () => {
    const { a, b } = createPair();
    a.register("echo", async (payload) => payload);
    const value = {
      files: [{ path: "a.ts", meta: { staged: true, tags: ["x", "y"] } }],
      count: 2,
      nested: { deep: { deeper: [1, 2, 3] } },
    };

    assert.deepStrictEqual(await b.request("echo", value), value);
    a.dispose();
    b.dispose();
  });

  test("rejects the caller when the handler throws", async () => {
    const { a, b } = createPair();
    a.register("boom", async () => {
      throw new Error("exploded");
    });

    await assert.rejects(
      () => b.request("boom", undefined),
      (error: Error) => {
        assert.strictEqual(error.message, "exploded");
        assert.strictEqual(error.name, "Error");
        return true;
      },
    );
    a.dispose();
    b.dispose();
  });

  test("rejects the caller when the handler rejects", async () => {
    const { a, b } = createPair();
    a.register("rejects", () => Promise.reject(new Error("async failure")));

    await assert.rejects(
      () => b.request("rejects", undefined),
      (error: Error) => {
        assert.strictEqual(error.message, "async failure");
        return true;
      },
    );
    a.dispose();
    b.dispose();
  });

  test("preserves a custom error name so callers can branch on it", async () => {
    const { a, b } = createPair();
    a.register("boom", async () => {
      throw new TypeError("bad type");
    });

    await assert.rejects(
      () => b.request("boom", undefined),
      (error: Error) => {
        assert.ok(error instanceof RemoteError, "should be reconstructed as a RemoteError");
        assert.strictEqual(error.name, "TypeError");
        return true;
      },
    );
    a.dispose();
    b.dispose();
  });

  test("rejects with MethodNotFoundError for an unregistered method", async () => {
    const { a, b } = createPair();

    await assert.rejects(
      () => b.request("missing.method", undefined),
      (error: Error) => {
        assert.ok(error instanceof RemoteError);
        assert.strictEqual(error.name, "MethodNotFoundError");
        assert.match(error.message, /missing\.method/);
        return true;
      },
    );
    a.dispose();
    b.dispose();
  });

  test("carries a nested cause across the wire", async () => {
    const { a, b } = createPair();
    a.register("boom", async () => {
      throw new Error("outer", { cause: new Error("inner") });
    });

    await assert.rejects(
      () => b.request("boom", undefined),
      (error: Error) => {
        assert.strictEqual(error.message, "outer");
        const cause = (error as { cause?: Error }).cause;
        assert.ok(cause instanceof RemoteError);
        assert.strictEqual(cause.message, "inner");
        return true;
      },
    );
    a.dispose();
    b.dispose();
  });

  test("serializes a non-Error rejection value", async () => {
    const { a, b } = createPair();
    a.register("boom", async () => {
      // Reject with a bare value rather than an Error. Written as an
      // explicit Promise so the intent survives the `no-throw-literal`
      // rule: the transport must survive a handler that rejects with
      // something that isn't an error object.
      return Promise.reject("just a string");
    });

    await assert.rejects(
      () => b.request("boom", undefined),
      (error: Error) => {
        assert.strictEqual(error.name, "NonErrorThrown");
        assert.strictEqual(error.message, '"just a string"');
        return true;
      },
    );
    a.dispose();
    b.dispose();
  });

  test("delivers notifications without producing a response", async () => {
    const { a, b, sentByB } = createPair();
    const seen: unknown[] = [];
    b.register("ui.changed", async (payload) => {
      seen.push(payload);
    });

    a.notify("ui.changed", { dirty: true });
    await Promise.resolve();
    await Promise.resolve();

    assert.deepStrictEqual(seen, [{ dirty: true }]);
    assert.strictEqual(sentByB.length, 0, "a notification must not be answered");
    a.dispose();
    b.dispose();
  });

  test("ignores an unknown notification instead of throwing", () => {
    const { a, sentByA } = createPair();

    assert.doesNotThrow(() => a.notify("nobody.listening", { x: 1 }));
    assert.strictEqual(sentByA.length, 1);
    a.dispose();
  });

  test("swallows a failing notification handler", async () => {
    const { a, b } = createPair();
    b.register("ui.boom", async () => {
      throw new Error("no return channel");
    });

    assert.doesNotThrow(() => a.notify("ui.boom", undefined));
    await Promise.resolve();
    await Promise.resolve();
    a.dispose();
    b.dispose();
  });

  test("reports a failing notification handler to the observer", async () => {
    const seen: Array<{ method: string; error: unknown }> = [];
    const { a, b } = createPair({
      bObserver: {
        onNotificationError: (method, error) => seen.push({ method, error }),
      },
    });
    b.register("ui.boom", async () => {
      throw new Error("no return channel");
    });

    a.notify("ui.boom", undefined);
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0]?.method, "ui.boom");
    assert.ok(seen[0]?.error instanceof Error);
    a.dispose();
    b.dispose();
  });

  test("reports an unknown method to the observer", async () => {
    const missing: string[] = [];
    const { a, b } = createPair({
      bObserver: { onMethodNotFound: (method) => missing.push(method) },
    });

    await assert.rejects(() => a.request("nope", undefined));

    assert.deepStrictEqual(missing, ["nope"]);
    a.dispose();
    b.dispose();
  });

  test("reports a failing handler to the observer", async () => {
    const failures: Array<{ method: string; error: unknown }> = [];
    const { a, b } = createPair({
      bObserver: {
        onHandlerError: (method, error) => failures.push({ method, error }),
      },
    });
    b.register("git.boom", async () => {
      throw new Error("handler exploded");
    });

    await assert.rejects(() => a.request("git.boom", undefined));

    assert.strictEqual(failures.length, 1);
    assert.strictEqual(failures[0]?.method, "git.boom");
    assert.strictEqual((failures[0]?.error as Error).message, "handler exploded");
    a.dispose();
    b.dispose();
  });

  test("reports a response for an already-settled request", async () => {
    const orphans: string[] = [];
    const { a, b } = createPair({
      // b is the caller, so b is the side that timed out and will see
      // the late response arrive with no matching in-flight entry.
      bObserver: { onOrphanResponse: (id) => orphans.push(id) },
    });
    a.register("slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "late";
    });

    await assert.rejects(() => b.request("slow", undefined, { timeoutMs: 5 }));
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.strictEqual(orphans.length, 1, "the late response should be reported as orphaned");
    a.dispose();
    b.dispose();
  });

  test("reports disposal to the observer", () => {
    let disposedCount = 0;
    const { transport } = createLoopback({
      observer: { onDispose: () => (disposedCount += 1) },
    });

    transport.dispose();
    transport.dispose();

    assert.strictEqual(disposedCount, 1, "dispose should only report once");
  });

  test("works without an observer", async () => {
    const { a, b } = createPair();
    a.register("boom", async () => {
      throw new Error("no observer configured");
    });

    await assert.rejects(() => b.request("boom", undefined));
    await new Promise((resolve) => setTimeout(resolve, 10));
    a.dispose();
    b.dispose();
  });

  test("keeps concurrent requests correlated by id", async () => {
    const { a, b } = createPair();
    a.register("slow.echo", async (payload) => {
      const { value, delay } = payload as { value: string; delay: number };
      await new Promise((resolve) => setTimeout(resolve, delay));
      return value;
    });

    // Deliberately out of order: the last-sent resolves first.
    const slow = b.request("slow.echo", { value: "slow", delay: 20 });
    const fast = b.request("slow.echo", { value: "fast", delay: 1 });

    assert.deepStrictEqual(await Promise.all([slow, fast]), ["slow", "fast"]);
    a.dispose();
    b.dispose();
  });

  test("handles many concurrent requests", async () => {
    const { a, b } = createPair();
    a.register("double", async (payload) => (payload as number) * 2);

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => b.request("double", i)),
    );

    assert.deepStrictEqual(
      results,
      Array.from({ length: 100 }, (_, i) => i * 2),
    );
    a.dispose();
    b.dispose();
  });

  test("times out a request when the handler never responds", async () => {
    const { a, b } = createPair();
    a.register("never", () => new Promise(() => {}));

    await assert.rejects(
      () => b.request("never", undefined, { timeoutMs: 10 }),
      (error: Error) => {
        assert.ok(error instanceof TimeoutError);
        assert.strictEqual(error.name, "TimeoutError");
        assert.strictEqual(error.method, "never");
        return true;
      },
    );
    a.dispose();
    b.dispose();
  });

  test("aborts an in-flight request via AbortSignal", async () => {
    const { a, b } = createPair();
    a.register("never", () => new Promise(() => {}));
    const controller = new AbortController();

    const pending = b.request("never", undefined, { signal: controller.signal });
    controller.abort();

    await assert.rejects(pending, (error: Error) => {
      assert.ok(error instanceof AbortError);
      assert.strictEqual(error.name, "AbortError");
      return true;
    });
    a.dispose();
    b.dispose();
  });

  test("rejects immediately when the signal is already aborted", async () => {
    const { a, b } = createPair();
    a.register("quick", async () => "done");
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => b.request("quick", undefined, { signal: controller.signal }),
      (error: Error) => {
        assert.ok(error instanceof AbortError);
        return true;
      },
    );
    a.dispose();
    b.dispose();
  });

  test("does not time out a request that already resolved", async () => {
    const { a, b } = createPair();
    a.register("quick", async () => "done");

    assert.strictEqual(await b.request("quick", undefined, { timeoutMs: 5_000 }), "done");
    a.dispose();
    b.dispose();
  });

  test("ignores a response that arrives after a timeout", async () => {
    const { a, b, sentByA } = createPair();
    a.register("slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return "late";
    });

    await assert.rejects(() => b.request("slow", undefined, { timeoutMs: 5 }));
    // Let the handler finish and try to answer an abandoned request.
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.ok(
      sentByA.some((frame) => frame.kind === "res"),
      "the late response should be emitted but ignored, not crash the transport",
    );
    a.dispose();
    b.dispose();
  });

  test("rejects duplicate handler registration for the same method", () => {
    const { a } = createPair();
    a.register("dup", async () => 1);

    assert.throws(() => a.register("dup", async () => 2), /already registered/);
    a.dispose();
  });

  test("unregisters a handler when the disposer is called", async () => {
    const { a, b } = createPair();
    const unregister = a.register("temporary", async () => "here");

    unregister();

    await assert.rejects(
      () => b.request("temporary", undefined),
      (error: Error) => {
        assert.strictEqual(error.name, "MethodNotFoundError");
        return true;
      },
    );
    a.dispose();
    b.dispose();
  });

  test("emits a request frame with the documented shape", () => {
    const { transport, outbound } = createLoopback();

    void transport.request("m", { a: 1 });

    const frame = outbound[0];
    assert.strictEqual(frame?.kind, "req");
    assert.ok(frame?.kind === "req");
    assert.strictEqual(frame.method, "m");
    assert.deepStrictEqual(frame.payload, { a: 1 });
    assert.strictEqual(typeof frame.id, "string");
    transport.dispose();
  });

  test("emits a response frame with the documented shape", async () => {
    const { a, b, sentByA, sentByB } = createPair();
    a.register("m", async () => ({ ok: true }));

    await b.request("m", undefined);

    // b asked; a answered.
    assert.strictEqual(sentByB[0]?.kind, "req");
    const response = sentByA.find((frame) => frame.kind === "res");
    assert.ok(response?.kind === "res");
    assert.strictEqual(response.result.status, "ok");
    a.dispose();
    b.dispose();
  });

  test("emits a notify frame with no id", () => {
    const { transport, outbound } = createLoopback();

    transport.notify("n", { x: 1 });

    const frame = outbound[0];
    assert.ok(frame?.kind === "notify");
    assert.strictEqual(frame.method, "n");
    assert.deepStrictEqual(frame.payload, { x: 1 });
    assert.ok(!("id" in frame), "a notify frame must carry no id");
    transport.dispose();
  });

  test("uses distinct id prefixes per side", () => {
    const a = createLoopback({ idPrefix: "a" });
    const b = createLoopback({ idPrefix: "b" });

    void a.transport.request("m", undefined);
    void b.transport.request("m", undefined);

    assert.ok(a.outbound[0]?.kind === "req" && a.outbound[0].id.startsWith("a"));
    assert.ok(b.outbound[0]?.kind === "req" && b.outbound[0].id.startsWith("b"));
    a.transport.dispose();
    b.transport.dispose();
  });

  test("strips error stacks by default", async () => {
    const { a, b, sentByB } = createPair();
    b.register("boom", async () => {
      throw new Error("nope");
    });

    await assert.rejects(() => a.request("boom", undefined));

    // b handled it, so b wrote the response.
    const response = sentByB.find((frame) => frame.kind === "res");
    assert.ok(response?.kind === "res");
    assert.ok(response.result.status === "err");
    assert.strictEqual(
      response.result.error.stack,
      undefined,
      "stacks must be stripped unless includeErrorStacks is set",
    );
    a.dispose();
    b.dispose();
  });

  test("forwards stacks when includeErrorStacks is set", async () => {
    const { a, b, sentByB } = createPair({ bIncludeStacks: true });
    b.register("boom", async () => {
      throw new Error("nope");
    });

    await assert.rejects(() => a.request("boom", undefined));

    const response = sentByB.find((frame) => frame.kind === "res");
    assert.ok(response?.kind === "res");
    assert.ok(response.result.status === "err");
    assert.strictEqual(typeof response.result.error.stack, "string");
    a.dispose();
    b.dispose();
  });

  test("disposing the transport rejects everything still in flight", async () => {
    const { a, b } = createPair();
    a.register("never", () => new Promise(() => {}));

    const pending = b.request("never", undefined);
    b.dispose();

    await assert.rejects(pending, (error: Error) => {
      assert.ok(error instanceof AbortError);
      return true;
    });
    a.dispose();
  });

  test("unsubscribes from the wire on dispose", () => {
    const loop = createLoopback();

    loop.transport.dispose();
    loop.transport.notify("after-dispose", undefined);

    // The transport forgot its wire subscription, so nothing is emitted.
    assert.strictEqual(loop.outbound.length, 0);
  });

  test("rejects frames that do not match the protocol", () => {
    const invalid: unknown[] = [
      null,
      undefined,
      42,
      "string",
      [],
      {},
      { kind: "req" },
      { kind: "req", id: "1" },
      { kind: "req", id: 1, method: "m" },
      { kind: "notify", method: 1 },
      { kind: "res", id: "1" },
      { kind: "res", id: "1", result: null },
      { kind: "res", id: "1", result: { status: "unknown" } },
      { kind: "res", id: "1", result: { status: "err" } },
      { kind: "res", id: "1", result: { status: "err", error: { name: "E" } } },
      { kind: "nope", method: "m" },
      { kind: 1 },
    ];

    for (const value of invalid) {
      assert.strictEqual(
        parseWireFrame(value),
        null,
        `parser accepted invalid frame: ${JSON.stringify(value)}`,
      );
    }
  });

  test("parses every valid frame shape", () => {
    const valid: unknown[] = [
      { kind: "req", id: "a", method: "m", payload: null },
      { kind: "req", id: "a", method: "m" },
      { kind: "notify", method: "m", payload: { a: 1 } },
      { kind: "notify", method: "m" },
      { kind: "res", id: "a", result: { status: "ok", value: 1 } },
      { kind: "res", id: "a", result: { status: "ok" } },
      { kind: "res", id: "a", result: { status: "ok", value: undefined } },
      {
        kind: "res",
        id: "a",
        result: {
          status: "err",
          error: { name: "E", message: "m", stack: "s", cause: { name: "C", message: "c" } },
        },
      },
    ];

    for (const value of valid) {
      assert.notStrictEqual(
        parseWireFrame(value),
        null,
        `parser rejected valid frame: ${JSON.stringify(value)}`,
      );
    }
  });

  test("rejects a req frame that smuggles a result field", () => {
    assert.strictEqual(
      parseWireFrame({ kind: "req", id: "a", method: "m", result: { status: "ok" } }),
      null,
    );
  });

  test("client facade routes through to the transport", async () => {
    const { a, b } = createPair();
    a.register("echo", async (payload) => payload);
    const client = createRpcClient<{ echo: { payload: number; result: number } }>(b);

    assert.strictEqual(await client.call("echo", 7), 7);
    a.dispose();
    b.dispose();
  });
});
