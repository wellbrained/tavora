import { LIMITS } from "@tavora/sdk/protocol";
import { describe, expect, it } from "vitest";
import { MAX_PENDING_BYTES, relayBridge, type RelayPort } from "./relay";
import { measureWire } from "../shared/wire";

/** A fake end of a channel: records what is posted and lets a test deliver messages. */
class FakePort implements RelayPort {
  readonly posted: unknown[] = [];
  private listener: ((event: { data: unknown }) => void) | undefined;
  started = false;
  addEventListener(_type: "message", listener: (event: { data: unknown }) => void): void {
    this.listener = listener;
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  start(): void {
    this.started = true;
  }
  receive(data: unknown): void {
    this.listener?.({ data });
  }
}

function setup() {
  const host = new FakePort();
  const page = new FakePort();
  relayBridge(host, page);
  return { host, page };
}

const request = (id: number, params: unknown = {}) => ({ v: 1, id, method: "storage.set", params });

describe("relayBridge", () => {
  it("passes a valid request to the host and the answer back", () => {
    const { host, page } = setup();
    page.receive(request(1, { key: "a", value: 1 }));
    expect(host.posted).toEqual([request(1, { key: "a", value: 1 })]);
    host.receive({ v: 1, id: 1, ok: true, result: null });
    expect(page.posted).toEqual([{ v: 1, id: 1, ok: true, result: null }]);
    expect(host.started && page.started).toBe(true);
  });

  it("passes host events through", () => {
    const { host, page } = setup();
    host.receive({ v: 1, event: "ui.theme", data: {} });
    expect(page.posted).toHaveLength(1);
  });

  it("refuses an oversized message without ever passing it on", () => {
    const { host, page } = setup();
    page.receive(request(7, { value: "x".repeat(LIMITS.maxMessageBytes + 1) }));
    expect(host.posted).toEqual([]);
    expect(page.posted).toEqual([{ v: 1, id: 7, ok: false, error: { code: "BAD_REQUEST", message: "message is too large" } }]);
  });

  it("refuses data that is not plain JSON, including a big buffer that looks tiny to JSON.stringify", () => {
    const { host, page } = setup();
    for (const [id, value] of [
      [1, new Date()],
      [2, new ArrayBuffer(16)],
      [3, new Uint8Array(4)],
      [4, new Map()],
      [5, Number.NaN],
      [6, () => 1],
      [7, new (class Thing {})()],
    ] as const) {
      page.receive(request(id, { value }));
    }
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    page.receive(request(8, cycle));
    expect(host.posted).toEqual([]);
    expect(page.posted).toHaveLength(8);
    for (const answer of page.posted) expect(answer).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("limits requests waiting for an answer, and frees a slot when one is answered", () => {
    const { host, page } = setup();
    for (let id = 1; id <= LIMITS.maxInFlight + 5; id++) page.receive(request(id));
    expect(host.posted).toHaveLength(LIMITS.maxInFlight);
    expect(page.posted).toHaveLength(5);
    expect(page.posted[0]).toMatchObject({ id: LIMITS.maxInFlight + 1, error: { code: "BAD_REQUEST", message: "too many concurrent requests" } });
    host.receive({ v: 1, id: 1, ok: true, result: null });
    page.receive(request(500));
    expect(host.posted).toHaveLength(LIMITS.maxInFlight + 1);
  });

  it("limits the bytes waiting for an answer, so many big messages cannot pile up in the host", () => {
    const { host, page } = setup();
    const big = LIMITS.maxMessageBytes - 1000;
    page.receive(request(1, { value: "x".repeat(big) }));
    page.receive(request(2, { value: "x".repeat(big) }));
    page.receive(request(3, { value: "x".repeat(big) }));
    expect(host.posted).toHaveLength(2);
    expect(page.posted).toMatchObject([{ id: 3, error: { code: "BAD_REQUEST" } }]);
    expect(2 * big).toBeLessThanOrEqual(MAX_PENDING_BYTES);
    host.receive({ v: 1, id: 1, ok: true, result: null });
    page.receive(request(4, { value: "x".repeat(big) }));
    expect(host.posted).toHaveLength(3);
  });

  it("does not let a reused id break the accounting", () => {
    const { host, page } = setup();
    page.receive(request(1));
    page.receive(request(1));
    expect(host.posted).toHaveLength(1);
    expect(page.posted).toMatchObject([{ id: 1, error: { message: "request id is already in use" } }]);
    host.receive({ v: 1, id: 1, ok: true, result: null });
    page.receive(request(1));
    expect(host.posted).toHaveLength(2);
  });

  it("drops messages nobody could answer", () => {
    const { host, page } = setup();
    for (const data of [null, "text", 5, [], {}, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: "1" }, { id: Number.MAX_SAFE_INTEGER + 2 }]) page.receive(data);
    expect(host.posted).toEqual([]);
    expect(page.posted).toEqual([]);
  });
});

describe("measureWire", () => {
  it("counts about as many characters as JSON.stringify and stops early", () => {
    const value = { v: 1, id: 3, method: "x", params: { list: [1, 2.5, "text", null, true], nested: { a: "b" } } };
    const measured = measureWire(value, 1_000_000);
    expect(measured).toMatchObject({ ok: true });
    if (measured.ok) expect(Math.abs(measured.bytes - JSON.stringify(value).length)).toBeLessThan(40);
    expect(measureWire("x".repeat(1000), 100)).toEqual({ ok: false, reason: "too-large" });
    expect(measureWire(Array.from({ length: 1000 }, () => 1), 100)).toEqual({ ok: false, reason: "too-large" });
  });

  it("refuses nesting that is too deep", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = [deep];
    expect(measureWire(deep, 1_000_000)).toEqual({ ok: false, reason: "not-json" });
  });

  it("lets undefined through, as the SDK sends it for a missing parameter", () => {
    expect(measureWire({ v: 1, id: 1, method: "x", params: undefined }, 1000)).toMatchObject({ ok: true });
    expect(measureWire([undefined], 1000)).toMatchObject({ ok: true });
  });

  it("accepts objects without a prototype", () => {
    const bare = Object.assign(Object.create(null), { a: 1 });
    expect(measureWire(bare, 1000)).toMatchObject({ ok: true });
  });
});
