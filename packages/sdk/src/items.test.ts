import { describe, expect, it, vi } from "vitest";
import type { JsonValue, TavoraSDK } from "./index.js";
import { ItemNotFoundError, openItems, type ItemSessionEvent, type OpenItemsOptions } from "./store.js";
import { createMemoryHost, type MemoryHost } from "./testing.js";

interface Plan {
  name: string;
  items: string[];
}

const parse = (raw: JsonValue | null): Plan => (raw ? (raw as unknown as Plan) : { name: "New plan", items: [] });
const options = (extra: Partial<OpenItemsOptions<Plan>> = {}): OpenItemsOptions<Plan> => ({
  prefix: "plan-",
  parse,
  title: (plan) => plan.name,
  rename: (draft, name) => void (draft.name = name),
  debounceMs: 0,
  ...extra,
});
const seed = (host: MemoryHost, id: string, name: string, items: string[] = []) =>
  host.documents.put({ id: `plan-${id}`, title: name, data: { name, items } as unknown as JsonValue });
const add = (item: string) => (draft: Plan) => void draft.items.push(item);
const names = (session: { items: readonly { title: string }[] }) => session.items.map((item) => item.title).sort();
const storedPlan = (host: MemoryHost, id: string) => host.documents.get(id)?.data as unknown as Plan | undefined;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** A clock that moves on with every call, so saves have distinct times and the list order is known. */
const ticking = () => {
  let t = 1_000;
  return () => (t += 1000);
};

/** Holds `documents.get` of one id until `release()`, to make a slow open. */
function gateGet(sdk: TavoraSDK, id: string) {
  const get = sdk.documents.get.bind(sdk.documents);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  sdk.documents.get = (async (wanted: string) => {
    if (wanted === id) await gate;
    return get(wanted);
  }) as typeof sdk.documents.get;
  return release;
}

describe("restore", () => {
  it("opens the item a restored panel showed", async () => {
    const { sdk, host } = createMemoryHost({ launch: { reason: "restore", content: { id: "plan-b", title: "B" } } });
    seed(host, "a", "A");
    seed(host, "b", "B");
    const session = await openItems(sdk, options());
    expect(session.currentId).toBe("plan-b");
    expect(session.current?.data.name).toBe("B");
    expect(host.content).toEqual({ id: "plan-b", title: "B" });
    await session.dispose();
  });

  it("falls back to the add rule when the restored item is gone or is not one of ours", async () => {
    const { sdk, host } = createMemoryHost({ launch: { reason: "restore", content: { id: "plan-gone", title: "Gone" } } });
    seed(host, "a", "A");
    const session = await openItems(sdk, options());
    expect(session.currentId).toBe("plan-a");

    const other = createMemoryHost({ launch: { reason: "open", content: { id: "note-x", title: "X" } } });
    seed(other.host, "a", "A");
    expect((await openItems(other.sdk, options({ onAdd: "none" }))).currentId).toBeNull();
  });

  it("on add opens the last used item, the first, or nothing", async () => {
    const first = createMemoryHost({ now: ticking() });
    seed(first.host, "a", "A");
    await first.sdk.storage.set("items.last.plan-", "plan-a");
    seed(first.host, "b", "B"); // the newest save comes first in the list
    expect((await openItems(first.sdk, options())).currentId).toBe("plan-a");
    expect((await openItems(createMemoryHost({ share: first.host }).sdk, options({ onAdd: "first" }))).currentId).toBe("plan-b");
    expect((await openItems(createMemoryHost({ share: first.host }).sdk, options({ onAdd: "none" }))).currentId).toBeNull();
  });

  it("remembers the last pick for the next panel", async () => {
    const a = createMemoryHost({ now: ticking() });
    seed(a.host, "a", "A");
    seed(a.host, "b", "B");
    const session = await openItems(a.sdk, options({ onAdd: "first" }));
    await session.pick("plan-a");
    await vi.waitFor(() => expect(a.host.storage.get("items.last.plan-")).toBe("plan-a"));
    expect((await openItems(createMemoryHost({ share: a.host }).sdk, options())).currentId).toBe("plan-a");
  });

  it("starts with nothing open, and lists only its own prefix", async () => {
    const { sdk, host } = createMemoryHost();
    host.documents.put({ id: "other", title: "Other", data: {} });
    const session = await openItems(sdk, options());
    expect(session.items).toEqual([]);
    expect(session.current).toBeNull();
    expect(session.status).toBe("idle");
  });
});

describe("navigate", () => {
  it("flushes the open item and switches when another panel asks", async () => {
    const { sdk, host } = createMemoryHost({ now: ticking() });
    seed(host, "a", "A");
    seed(host, "b", "B");
    const session = await openItems(sdk, options({ debounceMs: 60_000, onAdd: "first" }));
    const first = session.currentId!;
    const other = first === "plan-a" ? "plan-b" : "plan-a";
    session.current!.update(add("edit"));
    expect(await host.navigate({ id: other, title: "x" })).toEqual({ handled: true, ok: true });
    expect(session.currentId).toBe(other);
    expect(storedPlan(host, first)?.items).toEqual(["edit"]);
    expect(host.content?.id).toBe(other);
  });

  it("answers failed for an item that does not exist, and keeps the open one", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    const session = await openItems(sdk, options());
    expect(await host.navigate({ id: "plan-nope", title: "x" })).toEqual({ handled: true, ok: false });
    expect(await host.navigate({ id: "note-a", title: "x" })).toEqual({ handled: true, ok: false });
    expect(session.currentId).toBe("plan-a");
    await expect(session.pick("plan-nope")).rejects.toBeInstanceOf(ItemNotFoundError);
  });

  it("is reached through panels.open from a second panel", async () => {
    const a = createMemoryHost({ panelType: "plans" });
    const b = createMemoryHost({ share: a.host, panelType: "plans" });
    seed(a.host, "a", "A");
    seed(a.host, "b", "B");
    const session = await openItems(a.sdk, options({ onAdd: "first" }));
    const other = session.currentId === "plan-a" ? "plan-b" : "plan-a";
    await b.host.click(async () => expect(await b.sdk.panels.open("plans", { content: { id: other, title: "x" } })).toBe("switched"));
    expect(session.currentId).toBe(other);
  });

  it("is left alone with followNavigate: false", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    await openItems(sdk, options({ followNavigate: false }));
    expect(await host.navigate({ id: "plan-a", title: "x" })).toEqual({ handled: false, ok: false });
  });
});

describe("pick", () => {
  it("ignores a slow pick that finishes after a newer one", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    seed(host, "b", "B");
    seed(host, "c", "C");
    const session = await openItems(sdk, options({ onAdd: "none" }));
    const release = gateGet(sdk, "plan-a");
    const slow = session.pick("plan-a");
    await session.pick("plan-b");
    release();
    expect(await slow).toBe(false);
    expect(session.currentId).toBe("plan-b");
    expect(host.content?.id).toBe("plan-b");
    await session.dispose();
  });

  it("saves the previous item before opening the next", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    seed(host, "b", "B");
    const session = await openItems(sdk, options({ debounceMs: 60_000, onAdd: "none" }));
    await session.pick("plan-a");
    session.current!.update(add("x"));
    await session.pick("plan-b");
    expect(storedPlan(host, "plan-a")?.items).toEqual(["x"]);
    expect(session.current?.data.name).toBe("B");
  });

  it("can pick nothing, which clears the panel content", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    const session = await openItems(sdk, options({ onAdd: "first" }));
    expect(await session.pick(null)).toBe(true);
    expect(session.current).toBeNull();
    await vi.waitFor(() => expect(host.content).toBeNull());
  });

  it("uses the content option and follows a rename of the open item", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    const session = await openItems(sdk, options({ content: (id, plan) => ({ id, title: `Plan ${plan.name}` }) }));
    expect(host.content).toEqual({ id: "plan-a", title: "Plan A" });
    await session.rename("plan-a", "Z");
    await vi.waitFor(() => expect(host.content).toEqual({ id: "plan-a", title: "Plan Z" }));
  });
});

describe("create, rename, remove", () => {
  it("creates an item, saves it, opens it and lists it", async () => {
    const { sdk, host } = createMemoryHost();
    const session = await openItems(sdk, options({ newItem: () => ({ name: "Fresh", items: ["start"] }) }));
    const events: ItemSessionEvent[] = [];
    session.onChange((event) => events.push(event));
    const id = await session.create();
    expect(id.startsWith("plan-")).toBe(true);
    expect(session.currentId).toBe(id);
    expect(session.current?.data).toEqual({ name: "Fresh", items: ["start"] });
    expect(storedPlan(host, id)).toEqual({ name: "Fresh", items: ["start"] });
    expect(session.items.map((item) => item.title)).toEqual(["Fresh"]);
    expect(events.map((event) => event.type)).toContain("list");
    const second = await session.create({ name: "Mine", items: [] }, "Named");
    expect(storedPlan(host, second)?.name).toBe("Named");
    expect(names(session)).toEqual(["Fresh", "Named"]);
    expect(host.documents.list().find((doc) => doc.id === second)?.title).toBe("Named");
  });

  it("renames the open item through its handle and another item directly", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    seed(host, "b", "B");
    const session = await openItems(sdk, options({ onAdd: "none" }));
    await session.pick("plan-a");
    await session.rename("plan-a", "A2");
    await session.rename("plan-b", "B2");
    expect(session.current?.data.name).toBe("A2");
    expect(storedPlan(host, "plan-b")?.name).toBe("B2");
    expect(names(session)).toEqual(["A2", "B2"]);
    await expect(session.rename("plan-nope", "x")).rejects.toBeInstanceOf(ItemNotFoundError);
    const { rename: _unused, ...withoutRename } = options();
    const plain = await openItems(sdk, withoutRename);
    await expect(plain.rename("plan-a", "x")).rejects.toThrow("rename");
  });

  it("removes an item that is not open and can undo it", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A", ["keep"]);
    seed(host, "b", "B");
    const session = await openItems(sdk, options({ onAdd: "none" }));
    await session.pick("plan-b");
    const undo = await session.remove("plan-a");
    expect(host.documents.get("plan-a")).toBeNull();
    expect(names(session)).toEqual(["B"]);
    expect(session.currentId).toBe("plan-b");
    await undo();
    expect(storedPlan(host, "plan-a")).toEqual({ name: "A", items: ["keep"] });
    expect(names(session)).toEqual(["A", "B"]);
    expect(session.currentId).toBe("plan-b");
  });

  it("falls back to the next item when the open one is removed, and undo brings it back open", async () => {
    const { sdk, host } = createMemoryHost({ now: ticking() });
    seed(host, "a", "A");
    seed(host, "b", "B");
    seed(host, "c", "C"); // list: C, B, A
    const session = await openItems(sdk, options({ debounceMs: 60_000, onAdd: "none" }));
    await session.pick("plan-b");
    session.current!.update(add("last words"));
    const undo = await session.remove("plan-b");
    expect(host.documents.get("plan-b")).toBeNull();
    expect(session.currentId).toBe("plan-a"); // the one that followed it in the list
    await undo();
    expect(session.currentId).toBe("plan-b");
    expect(session.current?.data.items).toEqual(["last words"]);
  });

  it("ends with nothing open when the last item is removed", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    const session = await openItems(sdk, options());
    await session.remove("plan-a");
    expect(session.current).toBeNull();
    expect(session.items).toEqual([]);
    await vi.waitFor(() => expect(host.content).toBeNull());
  });

  it("does not delete an item another panel saved since the list was read", async () => {
    const a = createMemoryHost();
    seed(a.host, "a", "A");
    const session = await openItems(a.sdk, options({ onAdd: "none" }));
    a.host.documents.put({ id: "plan-a", title: "A", data: { name: "A", items: ["theirs"] }, ifRevision: 1 });
    // no documents.changed has been handled yet: the list still says revision 1
    await expect(session.remove("plan-a")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(storedPlan(a.host, "plan-a")?.items).toEqual(["theirs"]);
  });
});

describe("other panels", () => {
  it("reaches the open item and keeps the list in step", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    seed(a.host, "a", "A");
    const sessionA = await openItems(a.sdk, options());
    const sessionB = await openItems(b.sdk, options());
    sessionB.current!.update(add("from b"));
    await sessionB.flush();
    await vi.waitFor(() => expect(sessionA.current?.data.items).toEqual(["from b"]));
    await sessionB.create({ name: "New", items: [] });
    await vi.waitFor(() => expect(names(sessionA)).toEqual(["A", "New"]));
    await sessionB.rename("plan-a", "Renamed");
    await vi.waitFor(() => expect(names(sessionA)).toEqual(["New", "Renamed"]));
  });

  it("falls back when the open item is deleted elsewhere", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    seed(a.host, "a", "A");
    seed(a.host, "b", "B");
    const session = await openItems(a.sdk, options({ onAdd: "none" }));
    await session.pick("plan-a");
    await b.sdk.documents.delete("plan-a");
    await vi.waitFor(() => expect(session.currentId).toBe("plan-b"));
    expect(names(session)).toEqual(["B"]);
    await b.sdk.documents.delete("plan-b");
    await vi.waitFor(() => expect(session.currentId).toBeNull());
  });

  it('keeps the paused handle with onDeleted: "keep", and its next flush brings the item back', async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    seed(a.host, "a", "A");
    seed(a.host, "b", "B");
    const session = await openItems(a.sdk, options({ onAdd: "none", onDeleted: "keep", debounceMs: 60_000 }));
    await session.pick("plan-a");
    const events: ItemSessionEvent[] = [];
    session.onChange((event) => events.push(event));
    session.current!.update(add("unsaved"));
    await b.sdk.documents.delete("plan-a");
    await vi.waitFor(() => expect(events).toContainEqual({ type: "current", id: "plan-a", source: "remote", deleted: true }));
    expect(session.currentId).toBe("plan-a");
    await vi.waitFor(() => expect(names(session)).toEqual(["B"]));
    await session.flush(); // "bring it back"
    expect(storedPlan(a.host, "plan-a")?.items).toEqual(["unsaved"]);
    // the store re-applies the edit to an empty document, so the item comes back with parse(null)'s name
    await vi.waitFor(() => expect(names(session)).toEqual(["B", "New plan"]));
  });
});

describe("job", () => {
  it("runs one job at a time and returns its result", async () => {
    const { sdk } = createMemoryHost();
    const session = await openItems(sdk, options());
    const order: string[] = [];
    const slow = session.job(async () => {
      order.push("a start");
      await wait(10);
      order.push("a end");
      return 1;
    });
    const quick = session.job(async () => (order.push("b"), 2));
    expect(await Promise.all([slow, quick])).toEqual([1, 2]);
    expect(order).toEqual(["a start", "a end", "b"]);
    await expect(session.job(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await session.job(async () => 3)).toBe(3);
  });

  it("replays once what other panels changed meanwhile", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    seed(a.host, "a", "A");
    const session = await openItems(a.sdk, options());
    const events: ItemSessionEvent[] = [];
    session.onChange((event) => events.push(event));
    const lists = vi.spyOn(a.sdk.documents, "list");
    let finish!: () => void;
    const running = session.job(() => new Promise<void>((resolve) => (finish = resolve)));
    await b.sdk.documents.put({ id: "plan-a", title: "A", data: { name: "A", items: ["1"] }, ifRevision: 1 });
    await b.sdk.documents.put({ id: "plan-a", title: "A", data: { name: "A", items: ["1", "2"] }, ifRevision: 2 });
    await b.sdk.documents.put({ id: "plan-z", title: "Z", data: { name: "Z", items: [] }, ifRevision: 0 });
    await wait(20);
    expect(lists).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === "current")).toEqual([]);
    finish();
    await running;
    await vi.waitFor(() => expect(names(session)).toEqual(["A", "Z"]));
    expect(lists).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === "current")).toEqual([{ type: "current", id: "plan-a", source: "remote", deleted: false }]);
    expect(session.current?.data.items).toEqual(["1", "2"]);
  });

  it("replays a delete of the open item once the job is done", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    seed(a.host, "a", "A");
    seed(a.host, "b", "B");
    const session = await openItems(a.sdk, options({ onAdd: "none" }));
    await session.pick("plan-a");
    let finish!: () => void;
    const running = session.job(() => new Promise<void>((resolve) => (finish = resolve)));
    await b.sdk.documents.delete("plan-a");
    await wait(20);
    expect(session.currentId).toBe("plan-a");
    finish();
    await running;
    await vi.waitFor(() => expect(session.currentId).toBe("plan-b"));
  });
});

describe("errors and dispose", () => {
  it("reports a list that cannot be read, and rejects when the first read fails", async () => {
    const { sdk } = createMemoryHost();
    const session = await openItems(sdk, options());
    const errors: string[] = [];
    session.onError((_error, kind) => errors.push(kind));
    sdk.documents.list = async () => {
      throw new Error("down");
    };
    await session.refresh();
    expect(errors).toEqual(["list"]);
    await expect(openItems(sdk, options())).rejects.toThrow("down");
  });

  it("forwards the open item's save errors and status", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    const session = await openItems(sdk, options());
    const statuses: string[] = [];
    session.onStatus((status) => statuses.push(status));
    session.current!.update(add("x"));
    await session.flush();
    expect(statuses).toEqual(["dirty", "saving", "idle"]);
    const errors: string[] = [];
    session.onError((_error, kind) => errors.push(kind));
    sdk.documents.put = async () => {
      throw new Error("no disk");
    };
    session.current!.update(add("y"));
    await session.flush();
    expect(errors).toEqual(["save"]);
  });

  it("flushes the open item on dispose and refuses further use", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    const session = await openItems(sdk, options({ debounceMs: 60_000 }));
    session.current!.update(add("last"));
    await session.dispose();
    expect(storedPlan(host, "plan-a")?.items).toEqual(["last"]);
    await expect(session.pick("plan-a")).rejects.toThrow("closed");
    expect(await host.navigate({ id: "plan-a", title: "x" })).toEqual({ handled: false, ok: false });
  });
});
