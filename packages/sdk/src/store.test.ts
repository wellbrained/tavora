import { afterEach, describe, expect, it, vi } from "vitest";
import { TavoraError, type JsonValue } from "./index.js";
import { MAX_SAVE_ATTEMPTS, openDocument, readStored, type DocumentChangeEvent, type OpenDocumentOptions } from "./store.js";
import { createMemoryHost } from "./testing.js";

interface Plan {
  items: string[];
}

const parse = (raw: JsonValue | null): Plan => (raw ? (raw as unknown as Plan) : { items: [] });
const options = (extra: Partial<OpenDocumentOptions<Plan>> = {}): OpenDocumentOptions<Plan> => ({ parse, title: () => "Plan", debounceMs: 0, ...extra });
const add = (item: string) => (draft: Plan) => void draft.items.push(item);
const stored = (host: { documents: { get(id: string): { data: JsonValue } | null } }) => (host.documents.get("plan")?.data as unknown as Plan | undefined)?.items;
const conflict = () => new TavoraError({ code: "CONFLICT", message: "document changed" });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.useRealTimers());

describe("update and save", () => {
  it("shows an edit at once and saves it after the debounce", async () => {
    vi.useFakeTimers();
    const { sdk, host } = createMemoryHost();
    const doc = await openDocument(sdk, "plan", options({ debounceMs: 300 }));
    const events: DocumentChangeEvent<Plan>[] = [];
    doc.onChange((event) => events.push(event));

    doc.update(add("a"));
    doc.update(add("b"));
    expect(doc.data.items).toEqual(["a", "b"]);
    expect(doc.status).toBe("saving");
    expect(events.map((event) => event.source)).toEqual(["local", "local"]);

    await vi.advanceTimersByTimeAsync(299);
    expect(host.calls["documents.put"]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(host.calls["documents.put"]).toHaveLength(1);
    expect(stored(host)).toEqual(["a", "b"]);
    expect(doc.status).toBe("idle");
    expect(doc.revision).toBe(1);
  });

  it("accepts a returned replacement and never mutates the previous data", async () => {
    const { sdk } = createMemoryHost();
    const doc = await openDocument(sdk, "plan", options());
    const before = doc.data;
    doc.update(() => ({ items: ["x"] }));
    expect(before.items).toEqual([]);
    expect(doc.data).not.toBe(before);
    expect(doc.data.items).toEqual(["x"]);
  });

  it("never has two saves in flight", async () => {
    const { sdk, host } = createMemoryHost();
    const put = sdk.documents.put;
    let inFlight = 0;
    let most = 0;
    sdk.documents.put = async (params) => {
      most = Math.max(most, ++inFlight);
      await tick();
      try {
        return await put(params);
      } finally {
        inFlight--;
      }
    };
    const doc = await openDocument(sdk, "plan", options());
    doc.update(add("a"));
    const first = doc.flush();
    doc.update(add("b"));
    const second = doc.flush();
    doc.update(add("c"));
    await Promise.all([first, second, doc.flush()]);
    expect(most).toBe(1);
    expect(stored(host)).toEqual(["a", "b", "c"]);
  });

  it("flush resolves once the edit is stored", async () => {
    const { sdk, host } = createMemoryHost();
    const doc = await openDocument(sdk, "plan", options({ debounceMs: 60_000 }));
    doc.update(add("a"));
    await doc.flush();
    expect(stored(host)).toEqual(["a"]);
    await doc.flush();
    expect(host.calls["documents.put"]).toHaveLength(1);
  });

  it("flushes on suspend and on dispose", async () => {
    const { sdk, host } = createMemoryHost();
    const doc = await openDocument(sdk, "plan", options({ debounceMs: 60_000 }));
    doc.update(add("a"));
    host.suspend();
    await vi.waitFor(() => expect(stored(host)).toEqual(["a"]));

    doc.update(add("b"));
    await doc.dispose();
    expect(stored(host)).toEqual(["a", "b"]);
    expect(() => doc.update(add("c"))).toThrow();
  });

  it("starts from the stored copy and from parse(null) when there is none", async () => {
    const { sdk, host } = createMemoryHost();
    expect((await openDocument(sdk, "plan", options())).revision).toBe(0);
    host.documents.put({ id: "plan", title: "Plan", data: { items: ["x"] } });
    const doc = await openDocument(sdk, "plan", options());
    expect(doc.data.items).toEqual(["x"]);
    expect(doc.revision).toBe(1);
  });
});

describe("two panels", () => {
  it("re-applies both edits when the other panel saved first", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ debounceMs: 60_000 }));
    const docB = await openDocument(b.sdk, "plan", options({ debounceMs: 60_000 }));
    docA.update(add("from a"));
    docB.update(add("from b"));
    await docA.flush();
    await docB.flush();
    expect(stored(a.host)).toEqual(["from a", "from b"]);
    expect(docB.data.items).toEqual(["from a", "from b"]);
    expect(docB.status).toBe("idle");
    await vi.waitFor(() => expect(docA.data.items).toEqual(["from a", "from b"]));
  });

  it("reloads and emits when another panel saves while idle", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options());
    const events: DocumentChangeEvent<Plan>[] = [];
    docA.onChange((event) => events.push(event));
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["remote"] }, ifRevision: 0 });
    await vi.waitFor(() => expect(docA.data.items).toEqual(["remote"]));
    expect(events).toEqual([{ data: { items: ["remote"] }, revision: 1, source: "remote", deleted: false }]);
    expect(docA.revision).toBe(1);
  });

  it("re-applies unsaved edits on another panel's change without a conflict", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ debounceMs: 60_000 }));
    docA.update(add("mine"));
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["theirs"] }, ifRevision: 0 });
    await vi.waitFor(() => expect(docA.data.items).toEqual(["theirs", "mine"]));
    await docA.flush();
    expect(a.host.calls["documents.put"]).toHaveLength(1);
    expect(stored(a.host)).toEqual(["theirs", "mine"]);
  });

  it("tells the handle when another panel deletes the document", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    a.host.documents.put({ id: "plan", title: "Plan", data: { items: ["x"] } });
    const docA = await openDocument(a.sdk, "plan", options());
    const events: DocumentChangeEvent<Plan>[] = [];
    docA.onChange((event) => events.push(event));
    await b.sdk.documents.delete("plan");
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ deleted: true, source: "remote", data: { items: [] } });
    expect(docA.revision).toBe(0);
  });

  it("ignores other documents", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options());
    await b.sdk.documents.put({ id: "other", title: "Other", data: {} });
    await tick();
    expect(a.host.calls["documents.get"]).toHaveLength(1);
    expect(docA.revision).toBe(0);
  });
});

describe("failures", () => {
  it("gives up after the attempt limit, surfaces the error and rolls back to the newest copy", async () => {
    const { sdk, host } = createMemoryHost();
    host.documents.put({ id: "plan", title: "Plan", data: { items: ["base"] } });
    const doc = await openDocument(sdk, "plan", options());
    const errors: unknown[] = [];
    doc.onError((error) => errors.push(error));
    host.answer("documents.put", () => {
      throw conflict();
    });
    doc.update(add("lost"));
    await doc.flush();
    expect(host.calls["documents.put"]).toHaveLength(MAX_SAVE_ATTEMPTS);
    expect(MAX_SAVE_ATTEMPTS).toBe(5);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "CONFLICT" });
    expect(doc.status).toBe("error");
    expect(doc.data.items).toEqual(["base"]);
  });

  it("rolls back on any other error and goes on after the next edit", async () => {
    const { sdk, host } = createMemoryHost();
    const doc = await openDocument(sdk, "plan", options());
    const errors: unknown[] = [];
    const events: string[] = [];
    doc.onError((error) => errors.push(error));
    doc.onChange((event) => events.push(event.source));
    host.answer("documents.put", () => {
      throw new TavoraError({ code: "QUOTA_EXCEEDED", message: "too big" });
    });
    doc.update(add("a"));
    doc.update(add("b"));
    await doc.flush();
    expect(host.calls["documents.put"]).toHaveLength(1);
    expect(errors).toMatchObject([{ code: "QUOTA_EXCEEDED" }]);
    expect(doc.status).toBe("error");
    expect(doc.data.items).toEqual([]);
    expect(events.at(-1)).toBe("local");

    host.unanswer("documents.put");
    doc.update(add("c"));
    expect(doc.status).toBe("saving");
    await doc.flush();
    expect(doc.status).toBe("idle");
    expect(stored(host)).toEqual(["c"]);
  });
});

describe('merge: "mine"', () => {
  it("wins on a conflict", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ merge: "mine", debounceMs: 60_000 }));
    const docB = await openDocument(b.sdk, "plan", options({ merge: "mine", debounceMs: 60_000 }));
    docA.update(() => ({ items: ["a"] }));
    docB.update(() => ({ items: ["b"] }));
    await docA.flush();
    await docB.flush();
    expect(stored(a.host)).toEqual(["b"]);
    expect(docB.status).toBe("idle");
    expect(a.host.documents.get("plan")?.revision).toBe(2);
  });

  it("keeps the local copy on a remote change while dirty and reports the remote revision", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ merge: "mine", debounceMs: 60_000 }));
    const events: DocumentChangeEvent<Plan>[] = [];
    docA.onChange((event) => events.push(event));
    docA.update(() => ({ items: ["local"] }));
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["remote"] }, ifRevision: 0 });
    await vi.waitFor(() => expect(events.at(-1)?.source).toBe("remote"));
    expect(docA.data.items).toEqual(["local"]);
    expect(events.at(-1)).toMatchObject({ revision: 1, deleted: false, data: { items: ["local"] } });
  });

  it("still reloads when idle", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ merge: "mine" }));
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["remote"] }, ifRevision: 0 });
    await vi.waitFor(() => expect(docA.data.items).toEqual(["remote"]));
  });
});

describe("readStored", () => {
  it("parses a stored value, with the default for a missing key", async () => {
    const { sdk } = createMemoryHost();
    const parseCount = (raw: JsonValue | null) => (typeof raw === "number" ? raw : 0);
    expect(await readStored(sdk.storage, "count", parseCount)).toBe(0);
    await sdk.storage.set("count", 3);
    expect(await readStored(sdk.storage, "count", parseCount)).toBe(3);
  });
});
