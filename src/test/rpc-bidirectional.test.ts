import * as assert from "assert";
import { describe, test } from "vitest";
import type { ChangedFile } from "../rpc/git-types";
import {
  createRpcClient,
  createTransport,
  parseWireFrame,
  type HostApi,
  type WebviewApi,
  type Wire,
  type WireFrame,
} from "../rpc/protocol";

/**
 * Bidirectional contract tests.
 *
 * The transport is symmetric — either side can call and either can
 * serve — but the *contracts* differ per direction (`HostApi` for what
 * the host serves, `WebviewApi` for what it sends). These cover the
 * push direction the request/response suite doesn't: a notification the
 * host fires must reach a handler registered on the other side.
 *
 * Each side gets two typed facades over one transport, exactly as the
 * app wires them, so this also pins down that a single transport really
 * does serve both directions.
 */

const createPair = () => {
  const aSubs = new Set<(frame: WireFrame) => void>();
  const bSubs = new Set<(frame: WireFrame) => void>();

  const bridge = (
    from: Set<(frame: WireFrame) => void>,
    to: Set<(frame: WireFrame) => void>,
  ): Wire => ({
    send(frame) {
      const parsed = parseWireFrame(JSON.parse(JSON.stringify(frame)) as unknown);
      assert.ok(parsed !== null, "frame failed to survive JSON");
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

  const hostTransport = createTransport(bridge(aSubs, bSubs), { idPrefix: "h" });
  const webviewTransport = createTransport(bridge(bSubs, aSubs), { idPrefix: "w" });

  return {
    /** Methods the host serves; the webview calls these. */
    hostServe: createRpcClient<HostApi>(hostTransport),
    /** Notifications the host sends; the webview handles these. */
    hostNotify: createRpcClient<WebviewApi>(hostTransport),
    /** The webview's side of the same calls. */
    webviewCall: createRpcClient<HostApi>(webviewTransport),
    /** The webview's handlers for host notifications. */
    webviewServe: createRpcClient<WebviewApi>(webviewTransport),
    hostTransport,
    webviewTransport,
  };
};

describe("Bidirectional RPC", () => {
  test("the host can notify the webview", async () => {
    const { hostNotify, webviewServe } = createPair();

    const seen: string[] = [];
    webviewServe.register("repo.invalidate", async ({ reason }) => {
      seen.push(reason);
    });

    hostNotify.notify("repo.invalidate", { reason: "state" });
    await Promise.resolve();
    await Promise.resolve();

    assert.deepStrictEqual(seen, ["state"]);
  });

  test("one transport serves both directions", async () => {
    const { hostServe, hostNotify, webviewCall, webviewServe } = createPair();

    // Host serves a git read.
    hostServe.register("git.getChangedFiles", async (): Promise<readonly ChangedFile[]> => [
      { path: "a.ts", type: "modified", staged: true, unstaged: false },
    ]);
    // Webview serves the host's notification.
    let notified = 0;
    webviewServe.register("repo.invalidate", async () => {
      notified += 1;
    });

    const files = await webviewCall.call("git.getChangedFiles", undefined);
    assert.deepStrictEqual(files, [
      { path: "a.ts", type: "modified", staged: true, unstaged: false },
    ]);

    hostNotify.notify("repo.invalidate", { reason: "state" });
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(notified, 1, "the notification crossed the same wire");
  });

  test("a notification produces no reply frame", async () => {
    const { webviewServe } = createPair();
    const emitted: WireFrame[] = [];

    // Observe the host's outbound frames by wrapping its wire.
    const subscribers = new Set<(frame: WireFrame) => void>();
    const observedWire: Wire = {
      send(frame) {
        emitted.push(frame);
        const parsed = parseWireFrame(JSON.parse(JSON.stringify(frame)) as unknown);
        assert.ok(parsed !== null);
        for (const subscriber of subscribers) {
          subscriber(parsed);
        }
      },
      subscribe(handler) {
        subscribers.add(handler);
        return () => subscribers.delete(handler);
      },
    };
    const notifier = createRpcClient<WebviewApi>(createTransport(observedWire, { idPrefix: "h" }));
    webviewServe.register("repo.invalidate", async () => {});

    notifier.notify("repo.invalidate", { reason: "state" });
    await Promise.resolve();
    await Promise.resolve();

    assert.strictEqual(emitted.length, 1, "exactly one frame: no reply");
    const frame = emitted[0];
    assert.ok(frame?.kind === "notify");
    assert.ok(!("id" in frame), "a notify frame must carry no id");
  });

  test("notifying an unknown method is a no-op", () => {
    const { hostNotify } = createPair();

    assert.doesNotThrow(() => {
      hostNotify.notify("repo.invalidate", { reason: "state" });
    });
  });
});
