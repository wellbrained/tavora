import { afterEach, describe, expect, it, vi } from "vitest";
import { TavoraError, type JsonValue } from "./index.js";
import { MAX_SAVE_ATTEMPTS, openDocument, type DocumentChangeEvent, type OpenDocumentOptions } from "./store.js";
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
    expect(doc.status).toBe("dirty");
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
    expect(events).toEqual([{ data: { items: ["remote"] }, revision: 1, source: "remote", deleted: false, remote: { items: ["remote"] } }]);
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
    expect(events.at(-1)).toBe("rollback");

    host.unanswer("documents.put");
    doc.update(add("c"));
    expect(doc.status).toBe("dirty");
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
    expect(events.at(-1)).toMatchObject({ revision: 1, deleted: false, data: { items: ["local"] }, remote: { items: ["remote"] } });
  });

  it("still reloads when idle", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ merge: "mine" }));
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["remote"] }, ifRevision: 0 });
    await vi.waitFor(() => expect(docA.data.items).toEqual(["remote"]));
  });
});

/** Makes the next `put` of this panel wait until `release()`, so another panel can save in between. */
function gatePut(sdk: { documents: unknown }) {
  const target = sdk.documents as { put: (params: unknown) => Promise<unknown> };
  const real = target.put;
  let release!: () => void;
  let entered!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  const reached = new Promise<void>((resolve) => (entered = resolve));
  let gated = true;
  target.put = async (params) => {
    if (gated) {
      gated = false;
      entered();
      await open;
    }
    return real(params);
  };
  return { release, reached };
}

const quota = () => new TavoraError({ code: "QUOTA_EXCEEDED", message: "too big" });

describe("review fixes", () => {
  it("saves the copy the panel shows, ids made inside a change included (1)", async () => {
    const { sdk, host } = createMemoryHost();
    const doc = await openDocument(sdk, "plan", options());
    let n = 0;
    doc.update((draft) => void draft.items.push(`id-${++n}`));
    const shown = doc.data.items[0];
    await doc.flush();
    expect(stored(host)).toEqual([shown]);
    expect(doc.data.items).toEqual([shown]);
    expect(n).toBe(1);
  });

  it("after a conflict, shows what it saved (1)", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ debounceMs: 60_000 }));
    let n = 0;
    docA.update((draft) => void draft.items.push(`id-${++n}`));
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["theirs"] }, ifRevision: 0 });
    await docA.flush();
    expect(docA.data.items).toEqual(stored(a.host));
  });

  it("tries edits made while a failing save is in flight (2)", async () => {
    const { sdk, host } = createMemoryHost();
    const doc = await openDocument(sdk, "plan", options({ debounceMs: 60_000 }));
    const errors: unknown[] = [];
    doc.onError((error) => errors.push(error));
    let failIn!: () => void;
    const failing = new Promise<void>((resolve) => (failIn = resolve));
    const real = sdk.documents.put;
    let first = true;
    sdk.documents.put = async (params) => {
      if (first) {
        first = false;
        await failing;
        throw quota();
      }
      return real(params);
    };
    doc.update(add("a"));
    const done = doc.flush();
    await vi.waitFor(() => expect(doc.status).toBe("saving"));
    doc.update(add("b"));
    failIn();
    await done;
    expect(errors).toHaveLength(1);
    expect(stored(host)).toEqual(["b"]);
    expect(doc.data.items).toEqual(["b"]);
  });

  it("keeps the error status through an empty flush, suspend and dispose (3)", async () => {
    const { sdk, host } = createMemoryHost();
    const doc = await openDocument(sdk, "plan", options());
    host.answer("documents.put", () => {
      throw quota();
    });
    doc.update(add("a"));
    await doc.flush();
    expect(doc.status).toBe("error");
    await doc.flush();
    expect(doc.status).toBe("error");
    host.suspend();
    await tick();
    expect(doc.status).toBe("error");
    await doc.dispose();
    expect(doc.status).toBe("error");
  });

  it("drops only the change that throws on the newest copy and keeps the others (4)", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ debounceMs: 60_000 }));
    const errors: { error: unknown; kind: string }[] = [];
    docA.onError((error, kind) => errors.push({ error, kind }));
    docA.update(add("fine"));
    docA.update((draft) => {
      if (draft.items.includes("theirs")) throw new Error("bad change");
      draft.items.push("risky");
    });
    docA.update(add("also fine"));
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["theirs"] }, ifRevision: 0 });
    await vi.waitFor(() => expect(docA.data.items).toEqual(["theirs", "fine", "also fine"]));
    expect(errors).toMatchObject([{ kind: "change" }]);
    expect(docA.revision).toBe(1);
    await docA.flush();
    expect(stored(a.host)).toEqual(["theirs", "fine", "also fine"]);
    expect(docA.status).toBe("idle");
  });

  it("drops a throwing change during a conflict re-apply too (4)", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ debounceMs: 60_000 }));
    const kinds: string[] = [];
    docA.onError((_error, kind) => kinds.push(kind));
    docA.update(add("fine"));
    docA.update((draft) => {
      if (draft.items.includes("theirs")) throw new Error("bad change");
      draft.items.push("risky");
    });
    const gate = gatePut(a.sdk);
    const done = docA.flush();
    await gate.reached;
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["theirs"] }, ifRevision: 0 });
    gate.release();
    await done;
    expect(kinds).toEqual(["change"]);
    expect(stored(a.host)).toEqual(["theirs", "fine"]);
    expect(docA.data.items).toEqual(["theirs", "fine"]);
    expect(docA.status).toBe("idle");
  });

  it("reloads a document deleted and recreated while idle (5)", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    a.host.documents.put({ id: "plan", title: "Plan", data: { items: ["old"] } });
    const docA = await openDocument(a.sdk, "plan", options());
    await b.sdk.documents.delete("plan");
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["new"] }, ifRevision: 0 });
    await vi.waitFor(() => expect(docA.data.items).toEqual(["new"]));
    expect(docA.revision).toBe(1);
  });

  it("does not recreate a document deleted elsewhere until the next edit or flush (6)", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    a.host.documents.put({ id: "plan", title: "Plan", data: { items: ["old"] } });
    const docA = await openDocument(a.sdk, "plan", options({ debounceMs: 50 }));
    const events: DocumentChangeEvent<Plan>[] = [];
    docA.onChange((event) => events.push(event));
    docA.update(add("mine"));
    await b.sdk.documents.delete("plan");
    await vi.waitFor(() => expect(events.some((event) => event.deleted)).toBe(true));
    expect(docA.status).toBe("dirty");
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(a.host.documents.get("plan")).toBeNull();
    expect(docA.data.items).toEqual(["mine"]);

    await docA.flush();
    expect(stored(a.host)).toEqual(["mine"]);
    expect(docA.status).toBe("idle");
  });

  it("pauses saving when the document is deleted during a save (6)", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    a.host.documents.put({ id: "plan", title: "Plan", data: { items: ["old"] } });
    const docA = await openDocument(a.sdk, "plan", options({ debounceMs: 60_000 }));
    const events: DocumentChangeEvent<Plan>[] = [];
    docA.onChange((event) => events.push(event));
    docA.update(add("mine"));
    const gate = gatePut(a.sdk);
    const done = docA.flush();
    await gate.reached;
    await b.sdk.documents.delete("plan");
    gate.release();
    await done;
    expect(a.host.documents.get("plan")).toBeNull();
    expect(events.some((event) => event.deleted)).toBe(true);
    expect(docA.status).toBe("dirty");
    expect(docA.data.items).toEqual(["mine"]);
    docA.update(add("more"));
    await docA.flush();
    expect(stored(a.host)).toEqual(["mine", "more"]);
  });

  it("tells listeners about a rollback with its own source (7)", async () => {
    const { sdk, host } = createMemoryHost();
    const doc = await openDocument(sdk, "plan", options());
    const sources: string[] = [];
    doc.onChange((event) => sources.push(event.source));
    host.answer("documents.put", () => {
      throw quota();
    });
    doc.update(add("a"));
    await doc.flush();
    expect(sources).toEqual(["local", "rollback"]);
  });

  it("stays on the copy it re-read in mine mode when a later error comes (8)", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ merge: "mine", debounceMs: 60_000 }));
    docA.update(() => ({ items: ["mine"] }));
    let calls = 0;
    a.sdk.documents.put = async () => {
      if (++calls === 1) {
        await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["theirs"] }, ifRevision: 0 });
        throw conflict();
      }
      throw quota();
    };
    await docA.flush();
    expect(docA.status).toBe("error");
    expect(docA.revision).toBe(1);
  });

  it("two panels saving at the same moment keep both edits, including ones added during the put", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ debounceMs: 60_000 }));
    const docB = await openDocument(b.sdk, "plan", options({ debounceMs: 60_000 }));
    docA.update(add("a1"));
    const gate = gatePut(a.sdk);
    const done = docA.flush();
    await gate.reached;
    docA.update(add("a2")); // typed while the put is on its way
    docB.update(add("b1"));
    await docB.flush(); // lands first: A's put conflicts
    gate.release();
    await done;
    await docA.flush();
    expect([...(stored(a.host) ?? [])].sort()).toEqual(["a1", "a2", "b1"]);
    expect(docA.data.items).toEqual(stored(a.host));
    expect(docA.status).toBe("idle");
    await vi.waitFor(() => expect(docB.data.items).toEqual(stored(a.host)));
  });

  it("dispose during a conflict re-read still saves everything", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ debounceMs: 60_000 }));
    docA.update(add("a1"));
    const gate = gatePut(a.sdk);
    const done = docA.flush();
    await gate.reached;
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["theirs"] }, ifRevision: 0 });
    gate.release();
    const disposing = docA.dispose();
    await Promise.all([done, disposing]);
    expect(stored(a.host)).toEqual(["theirs", "a1"]);
  });
});

describe("dirty status", () => {
  it("is dirty from an edit until the save starts, and goes back to idle", async () => {
    vi.useFakeTimers();
    const { sdk } = createMemoryHost();
    const doc = await openDocument(sdk, "plan", options({ debounceMs: 100 }));
    const seen: string[] = [];
    doc.onStatus((status) => seen.push(status));
    expect(doc.status).toBe("idle");
    doc.update(add("a"));
    doc.update(add("b"));
    expect(doc.status).toBe("dirty");
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(["dirty", "saving", "idle"]);
  });
});

describe('merge: "mine" failures and remote copies', () => {
  it("keeps the user's work on screen when a save fails and retries on the next flush", async () => {
    const { sdk, host } = createMemoryHost();
    const doc = await openDocument(sdk, "plan", options({ merge: "mine", debounceMs: 60_000 }));
    const errors: unknown[] = [];
    const sources: string[] = [];
    doc.onError((error) => errors.push(error));
    doc.onChange((event) => sources.push(event.source));
    host.answer("documents.put", () => {
      throw quota();
    });
    doc.update(() => ({ items: ["work"] }));
    await doc.flush();
    expect(errors).toHaveLength(1);
    expect(doc.status).toBe("error");
    expect(doc.data.items).toEqual(["work"]);
    expect(sources).toEqual(["local"]);

    host.unanswer("documents.put");
    await doc.flush();
    expect(stored(host)).toEqual(["work"]);
    expect(doc.status).toBe("idle");
  });

  it("keeps the work on screen after the conflict attempts run out", async () => {
    const { sdk, host } = createMemoryHost();
    host.documents.put({ id: "plan", title: "Plan", data: { items: ["base"] } });
    const doc = await openDocument(sdk, "plan", options({ merge: "mine" }));
    host.answer("documents.put", () => {
      throw conflict();
    });
    doc.update(() => ({ items: ["work"] }));
    await doc.flush();
    expect(doc.status).toBe("error");
    expect(doc.data.items).toEqual(["work"]);
  });

  it("adoptRemote replaces the copy with the last remote one and drops pending edits", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ merge: "mine", debounceMs: 60_000 }));
    docA.update(() => ({ items: ["local"] }));
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["remote"] }, ifRevision: 0 });
    await vi.waitFor(() => expect(docA.revision).toBe(1));
    const events: DocumentChangeEvent<Plan>[] = [];
    docA.onChange((event) => events.push(event));
    await docA.adoptRemote();
    expect(docA.data.items).toEqual(["remote"]);
    expect(docA.status).toBe("idle");
    expect(events.at(-1)).toMatchObject({ source: "remote", data: { items: ["remote"] } });
    await docA.flush();
    expect(a.host.calls["documents.put"]).toBeUndefined();
    expect(stored(a.host)).toEqual(["remote"]);
  });
});

function gateGet(sdk: { documents: unknown }) {
  const target = sdk.documents as { get: (id: string) => Promise<unknown> };
  const real = target.get;
  let release!: () => void;
  let entered!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  const reached = new Promise<void>((resolve) => (entered = resolve));
  let gated = true;
  target.get = async (id) => {
    if (gated) {
      gated = false;
      entered();
      await open;
    }
    return real(id);
  };
  return { reached, release };
}

describe("re-check fixes", () => {
  it("notices a second delete after the document came back, instead of recreating it (1)", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    a.host.documents.put({ id: "plan", title: "Plan", data: { items: ["old"] } });
    const docA = await openDocument(a.sdk, "plan", options({ debounceMs: 50 }));
    const deletes: number[] = [];
    docA.onChange((event) => {
      if (event.deleted) deletes.push(event.revision);
    });
    docA.update(add("mine"));
    await b.sdk.documents.delete("plan");
    await vi.waitFor(() => expect(deletes).toHaveLength(1));
    // The user edits again, which would bring the document back. Before that save, another panel creates and deletes it
    // so fast that this panel's re-reads for both events find nothing.
    docA.update(add("more"));
    const gate = gateGet(a.sdk);
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["theirs"] }, ifRevision: 0 });
    await gate.reached;
    await b.sdk.documents.delete("plan");
    gate.release();
    await vi.waitFor(() => expect(deletes.length).toBeGreaterThanOrEqual(2));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(a.host.documents.get("plan")).toBeNull();
    expect(docA.status).toBe("dirty");
    expect(docA.data.items).toEqual(["mine", "more"]);

    await docA.flush();
    expect(stored(a.host)).toEqual(["mine", "more"]);
  });

  it("skips only the one delete a save already found (1)", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    a.host.documents.put({ id: "plan", title: "Plan", data: { items: ["old"] } });
    const docA = await openDocument(a.sdk, "plan", options({ debounceMs: 60_000 }));
    const deletes: boolean[] = [];
    docA.onChange((event) => deletes.push(event.deleted));
    docA.update(add("mine"));
    const gate = gatePut(a.sdk);
    const done = docA.flush();
    await gate.reached;
    await b.sdk.documents.delete("plan");
    gate.release();
    await done;
    await tick();
    expect(deletes.filter(Boolean)).toHaveLength(1);
    docA.update(add("more"));
    await tick();
    expect(docA.status).toBe("dirty");
    await docA.flush();
    expect(stored(a.host)).toEqual(["mine", "more"]);
  });

  it("adoptRemote saves the other copy back when this panel's own save already went over it (2)", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const docA = await openDocument(a.sdk, "plan", options({ merge: "mine", debounceMs: 20 }));
    const events: DocumentChangeEvent<Plan>[] = [];
    docA.onChange((event) => events.push(event));
    docA.update(() => ({ items: ["local"] }));
    await b.sdk.documents.put({ id: "plan", title: "Plan", data: { items: ["remote"] }, ifRevision: 0 });
    await vi.waitFor(() => expect(events.some((event) => event.remote?.items[0] === "remote")).toBe(true));
    await vi.waitFor(() => expect(stored(a.host)).toEqual(["local"]));
    expect(docA.revision).toBe(2);

    await docA.adoptRemote();
    expect(docA.data.items).toEqual(["remote"]);
    expect(stored(a.host)).toEqual(["remote"]);
    expect(docA.revision).toBe(3);
    expect(docA.status).toBe("idle");
    expect(events.at(-1)).toMatchObject({ source: "remote", data: { items: ["remote"] } });
  });
});
