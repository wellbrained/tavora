import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HELLO_MESSAGE, PORT_MESSAGE, PROTOCOL_VERSION } from "./protocol.js";

type Request = { v: number; id: number; method: string; params?: unknown };
type Responder = (request: Request) => { result: unknown } | { error: Record<string, unknown> } | undefined;

/**
 * A stand-in for the module window and the Tavora host: answers the hello
 * with a port and serves requests on it with `respond`.
 */
function fakeHost(respond: Responder, { answerHello = true } = {}) {
  const target = new EventTarget();
  const requests: Request[] = [];
  let hostPort: MessagePort | undefined;
  const fakeWindow = {
    location: { origin: "tavora-module://local.test.sdk" },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    postMessage(data: { type?: string }) {
      if (data.type !== HELLO_MESSAGE || !answerHello) return;
      const channel = new MessageChannel();
      hostPort = channel.port1;
      hostPort.onmessage = (event: MessageEvent<Request>) => {
        requests.push(event.data);
        const answer = respond(event.data);
        if (answer) hostPort!.postMessage({ v: PROTOCOL_VERSION, id: event.data.id, ok: !("error" in answer), ...answer });
      };
      const message = new MessageEvent("message", { data: { type: PORT_MESSAGE }, ports: [channel.port2] });
      Object.defineProperty(message, "source", { value: fakeWindow });
      queueMicrotask(() => target.dispatchEvent(message));
    },
  };
  vi.stubGlobal("window", fakeWindow);
  return {
    requests,
    emit: (event: string, data: unknown) => hostPort!.postMessage({ v: PROTOCOL_VERSION, event, data }),
    raw: (message: unknown) => hostPort!.postMessage(message),
    close: () => hostPort?.close(),
  };
}

const handshake = {
  protocol: 1,
  host: { name: "tavora-desktop", version: "0.0.0" },
  module: { id: "local.test.sdk", version: "1.0.0" },
  capabilities: [],
};

const standard: Responder = ({ method, params }) => {
  if (method === "bridge.handshake") return { result: handshake };
  if (method === "storage.get") return { result: (params as { key: string }).key === "count" ? 3 : null };
  if (method === "documents.put") return { error: { code: "CONFLICT", message: "stale", revision: 7 } };
  return { error: { code: "UNKNOWN_METHOD", message: `unknown ${method}` } };
};

let sdk: typeof import("./index.js");
let hosts: ReturnType<typeof fakeHost>[] = [];

beforeEach(async () => {
  vi.resetModules();
  sdk = await import("./index.js");
});

afterEach(() => {
  hosts.forEach((host) => host.close());
  hosts = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("connect", () => {
  it("performs the handshake first and reports what the host sent", async () => {
    const host = fakeHost(standard);
    hosts.push(host);
    const tavora = await sdk.connect();
    expect(tavora.host).toEqual(handshake);
    expect(host.requests[0]).toEqual({
      v: 1,
      id: 1,
      method: "bridge.handshake",
      params: { protocol: 1, sdkVersion: sdk.SDK_VERSION },
    });
    expect(await tavora.storage.get("count")).toBe(3);
  });

  it("returns the same connection when called again", async () => {
    hosts.push(fakeHost(standard));
    const [a, b] = await Promise.all([sdk.connect(), sdk.connect()]);
    expect(a).toBe(b);
    expect(await sdk.connect()).toBe(a);
  });

  it("rejects with INCOMPATIBLE when the host does not speak this protocol", async () => {
    hosts.push(
      fakeHost(({ method }) =>
        method === "bridge.handshake"
          ? { error: { code: "INCOMPATIBLE", message: "nope", supported: [2] } }
          : undefined,
      ),
    );
    await expect(sdk.connect()).rejects.toMatchObject({ name: "TavoraError", code: "INCOMPATIBLE" });
  });

  it("rejects with HOST_UNAVAILABLE outside Tavora, and can be retried", async () => {
    hosts.push(fakeHost(standard, { answerHello: false }));
    await expect(sdk.connect({ connectTimeoutMs: 20 })).rejects.toMatchObject({ code: "HOST_UNAVAILABLE" });
    vi.unstubAllGlobals();
    hosts.push(fakeHost(standard));
    await expect(sdk.connect()).resolves.toBeDefined();
  });
});

describe("requests", () => {
  it("turns host errors into TavoraError with their details", async () => {
    hosts.push(fakeHost(standard));
    const tavora = await sdk.connect();
    const error = await tavora.documents.put({ id: "a", title: "A", data: 1, ifRevision: 2 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(sdk.TavoraError);
    expect(error).toMatchObject({ code: "CONFLICT", revision: 7, message: "stale" });
  });

  it("times out requests the host never answers", async () => {
    hosts.push(fakeHost((request) => (request.method === "bridge.handshake" ? { result: handshake } : undefined)));
    const tavora = await sdk.connect({ requestTimeoutMs: 20 });
    await expect(tavora.game.getCurrent()).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("ignores messages for another protocol version", async () => {
    const host = fakeHost(standard);
    hosts.push(host);
    const tavora = await sdk.connect();
    const seen = vi.fn();
    tavora.ui.onThemeChange(seen);
    host.raw({ v: 0, event: "ui.theme", data: { mode: "old" } });
    host.raw("not an object");
    host.emit("ui.theme", { mode: "dark" });
    await vi.waitFor(() => expect(seen).toHaveBeenCalled());
    expect(seen.mock.calls).toEqual([[{ mode: "dark" }]]);
  });
});

describe("events", () => {
  it("delivers events to listeners until they unsubscribe", async () => {
    const host = fakeHost(standard);
    hosts.push(host);
    const tavora = await sdk.connect();
    const changes: unknown[] = [];
    const off = tavora.documents.onChange((change) => changes.push(change));
    const suspended = vi.fn();
    tavora.lifecycle.onSuspend(suspended);

    host.emit("documents.changed", { id: "a", revision: 2, deleted: false });
    host.emit("lifecycle.suspend", null);
    await vi.waitFor(() => expect(suspended).toHaveBeenCalled());
    off();
    host.emit("documents.changed", { id: "a", revision: 3, deleted: false });
    host.emit("lifecycle.suspend", null);
    await vi.waitFor(() => expect(suspended).toHaveBeenCalledTimes(2));
    expect(changes).toEqual([{ id: "a", revision: 2, deleted: false }]);
  });

  it("keeps other listeners running when one throws", async () => {
    const host = fakeHost(standard);
    hosts.push(host);
    const tavora = await sdk.connect();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const second = vi.fn();
    tavora.lifecycle.onResume(() => {
      throw new Error("boom");
    });
    tavora.lifecycle.onResume(second);
    host.emit("lifecycle.resume", null);
    await vi.waitFor(() => expect(second).toHaveBeenCalled());
    expect(error).toHaveBeenCalled();
  });
});

it("SDK_VERSION matches the package version", async () => {
  const { default: pkg } = await import("../package.json", { with: { type: "json" } });
  expect(sdk.SDK_VERSION).toBe(pkg.version);
});
