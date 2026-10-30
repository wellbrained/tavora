import { describe, expect, it, vi } from "vitest";
import type { JsonValue, TavoraSDK } from "./index.js";
import { ItemNotFoundError, ItemSaveError, openItems, type ItemSessionEvent, type OpenItemsOptions } from "./store.js";
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
    const session = await openItems(a.sdk, options({ onAdd: "none", onDeleted: "fallback" }));
    await session.pick("plan-a");
    await b.sdk.documents.delete("plan-a");
    await vi.waitFor(() => expect(session.currentId).toBe("plan-b"));
    expect(names(session)).toEqual(["B"]);
    await b.sdk.documents.delete("plan-b");
    await vi.waitFor(() => expect(session.currentId).toBeNull());
  });

  it("stays on a deleted item by default and does not create it again on its own", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    seed(a.host, "a", "A");
    seed(a.host, "b", "B");
    const session = await openItems(a.sdk, options({ onAdd: "none", debounceMs: 60_000 }));
    await session.pick("plan-a");
    const events: ItemSessionEvent[] = [];
    session.onChange((event) => events.push(event));
    session.current!.update(add("unsaved"));
    await b.sdk.documents.delete("plan-a");
    await vi.waitFor(() => expect(events).toContainEqual({ type: "current", id: "plan-a", source: "remote", deleted: true }));
    expect(session.currentId).toBe("plan-a");
    expect(session.deleted).toBe(true);
    await vi.waitFor(() => expect(names(session)).toEqual(["B"]));
    await session.flush();
    await wait(20);
    expect(a.host.documents.get("plan-a")).toBeNull();
    expect(names(session)).toEqual(["B"]);
  });

  it("restoreDeleted puts the last copy back, edits included, and opens it again", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    seed(a.host, "a", "A", ["one"]);
    const session = await openItems(a.sdk, options({ debounceMs: 60_000 }));
    await session.rename("plan-a", "Renamed"); // saved
    session.current!.update(add("two")); // not saved yet
    await b.sdk.documents.delete("plan-a");
    await vi.waitFor(() => expect(session.deleted).toBe(true));
    await session.restoreDeleted();
    expect(session.deleted).toBe(false);
    expect(session.currentId).toBe("plan-a");
    expect(storedPlan(a.host, "plan-a")).toEqual({ name: "Renamed", items: ["one", "two"] });
    expect(session.current?.data).toEqual({ name: "Renamed", items: ["one", "two"] });
    expect(names(session)).toEqual(["Renamed"]);
    await session.restoreDeleted(); // nothing to restore: no-op
  });

  it("restoreDeleted rejects with CONFLICT when another panel made the item again", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    seed(a.host, "a", "A");
    const session = await openItems(a.sdk, options());
    await b.sdk.documents.delete("plan-a");
    await vi.waitFor(() => expect(session.deleted).toBe(true));
    a.host.documents.put({ id: "plan-a", title: "Theirs", data: { name: "Theirs", items: [] }, ifRevision: 0 });
    await expect(session.restoreDeleted()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(storedPlan(a.host, "plan-a")?.name).toBe("Theirs");
  });

  it("does not bring a deleted item back when picking away from it (both modes)", async () => {
    for (const onDeleted of ["keep", "fallback"] as const) {
      const a = createMemoryHost();
      const b = createMemoryHost({ share: a.host });
      seed(a.host, "a", "A");
      seed(a.host, "b", "B");
      const session = await openItems(a.sdk, options({ onAdd: "none", onDeleted, debounceMs: 60_000 }));
      await session.pick("plan-a");
      session.current!.update(add("unsaved"));
      await b.sdk.documents.delete("plan-a");
      if (onDeleted === "fallback") await vi.waitFor(() => expect(session.currentId).toBe("plan-b"));
      else {
        await vi.waitFor(() => expect(session.deleted).toBe(true));
        await session.pick("plan-b");
      }
      await session.refresh();
      await wait(20);
      expect(a.host.documents.get("plan-a")).toBeNull();
      expect(names(session)).toEqual(["B"]);
      await session.dispose();
      expect(a.host.documents.get("plan-a")).toBeNull();
    }
  });

  it("says so when the open item is deleted elsewhere, before it falls back", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    seed(a.host, "a", "A");
    seed(a.host, "b", "B");
    const session = await openItems(a.sdk, options({ onAdd: "none", onDeleted: "fallback" }));
    await session.pick("plan-a");
    const events: ItemSessionEvent[] = [];
    session.onChange((event) => events.push(event));
    await b.sdk.documents.delete("plan-a");
    await vi.waitFor(() => expect(session.currentId).toBe("plan-b"));
    const deleted = events.findIndex((event) => event.type === "current" && event.deleted && event.id === "plan-a" && event.source === "remote");
    const switched = events.findIndex((event) => event.type === "current" && event.id === "plan-b");
    expect(deleted).toBeGreaterThanOrEqual(0);
    expect(deleted).toBeLessThan(switched);
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
    const session = await openItems(a.sdk, options({ onAdd: "none", onDeleted: "fallback" }));
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

/** Holds `documents.delete` until `release()`. */
function gateDelete(sdk: TavoraSDK) {
  const remove = sdk.documents.delete.bind(sdk.documents);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  sdk.documents.delete = (async (...args: Parameters<typeof remove>) => {
    await gate;
    return remove(...args);
  }) as typeof sdk.documents.delete;
  return release;
}

describe("switching safely", () => {
  it("keeps the item open and answers failed when the previous item cannot be saved", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    seed(host, "b", "B");
    const session = await openItems(sdk, options({ onAdd: "none", debounceMs: 60_000 }));
    await session.pick("plan-a");
    session.current!.update(add("x"));
    const put = sdk.documents.put.bind(sdk.documents);
    sdk.documents.put = async () => {
      throw new Error("no disk");
    };
    await expect(session.pick("plan-b")).rejects.toBeInstanceOf(ItemSaveError);
    expect(session.currentId).toBe("plan-a");
    // The failed save rolled the edit back and reported it: nothing is left to protect, so a switch now goes through.
    expect(await host.navigate({ id: "plan-b", title: "x" })).toEqual({ handled: true, ok: true });
    expect(session.currentId).toBe("plan-b");
    sdk.documents.put = put;
  });

  it("lets a pick made during remove(current) win over remove's fallback", async () => {
    const { sdk, host } = createMemoryHost({ now: ticking() });
    seed(host, "a", "A");
    seed(host, "b", "B");
    seed(host, "c", "C"); // list: C, B, A
    const session = await openItems(sdk, options({ onAdd: "none" }));
    await session.pick("plan-a");
    const release = gateDelete(sdk);
    const removing = session.remove("plan-a");
    await session.pick("plan-c");
    release();
    await removing;
    expect(session.currentId).toBe("plan-c");
    expect(host.content?.id).toBe("plan-c");
  });

  it("has no open item while remove(current) is waiting, so nothing writes to a closed handle", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    const session = await openItems(sdk, options({ debounceMs: 60_000 }));
    const removing = session.remove("plan-a");
    expect(session.current).toBeNull();
    expect(session.currentId).toBeNull();
    await removing;
    expect(session.current).toBeNull();
  });

  it("holds panels.open until a running job is done", async () => {
    const { sdk, host } = createMemoryHost({ now: ticking() });
    seed(host, "a", "A");
    seed(host, "b", "B");
    const session = await openItems(sdk, options({ onAdd: "first" }));
    const first = session.currentId!;
    const other = first === "plan-a" ? "plan-b" : "plan-a";
    expect(session.busy).toBe(false);
    let finish!: () => void;
    const running = session.job(() => new Promise<void>((resolve) => (finish = resolve)));
    expect(session.busy).toBe(true);
    const navigating = host.navigate({ id: other, title: "x" });
    await wait(20);
    expect(session.currentId).toBe(first);
    finish();
    await running;
    expect(await navigating).toEqual({ handled: true, ok: true });
    expect(session.currentId).toBe(other);
    expect(session.busy).toBe(false);
  });

  it("tells listeners when it gets busy and when it is done", async () => {
    const { sdk } = createMemoryHost();
    const session = await openItems(sdk, options());
    const events: string[] = [];
    session.onChange((event) => events.push(event.type));
    await session.job(async () => 1);
    expect(events.filter((type) => type === "busy")).toHaveLength(2);
  });

  it("does not replay held changes onto another item picked during the job", async () => {
    const a = createMemoryHost({ now: ticking() });
    const b = createMemoryHost({ share: a.host });
    seed(a.host, "a", "A");
    seed(a.host, "b", "B");
    const session = await openItems(a.sdk, options({ onAdd: "none" }));
    await session.pick("plan-a");
    const events: ItemSessionEvent[] = [];
    session.onChange((event) => events.push(event));
    let finish!: () => void;
    const running = session.job(async () => {
      await new Promise<void>((resolve) => (finish = resolve));
    });
    await b.sdk.documents.put({ id: "plan-a", title: "A", data: { name: "A", items: ["theirs"] }, ifRevision: 1 });
    await wait(20);
    await session.pick("plan-b");
    finish();
    await running;
    await wait(20);
    expect(events.filter((event) => event.type === "current" && event.source === "remote")).toEqual([]);
    expect(session.currentId).toBe("plan-b");
  });

  it("does not cancel a pending pick when a foreign or the same id is picked", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    seed(host, "b", "B");
    const session = await openItems(sdk, options({ onAdd: "none" }));
    await session.pick("plan-a");
    const release = gateGet(sdk, "plan-b");
    const slow = session.pick("plan-b");
    await expect(session.pick("note-x")).rejects.toBeInstanceOf(ItemNotFoundError);
    expect(await session.pick("plan-a")).toBe(true); // already open
    release();
    expect(await slow).toBe(true);
    expect(session.currentId).toBe("plan-b");
  });

  it("lists the final save of the item it leaves", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    seed(host, "b", "B");
    const session = await openItems(sdk, options({ onAdd: "none", debounceMs: 60_000 }));
    await session.pick("plan-a");
    session.current!.update(add("x"));
    const release = gateGet(sdk, "plan-b");
    const switching = session.pick("plan-b");
    await wait(20); // the first save is done
    session.current!.update(add("late")); // saved by the closing dispose
    release();
    await switching;
    const stored = host.documents.get("plan-a")!;
    expect(stored.data).toEqual({ name: "A", items: ["x", "late"] });
    expect(session.items.find((item) => item.id === "plan-a")?.revision).toBe(stored.revision);
  });

  it("writes the last used item once per change", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    seed(host, "b", "B");
    const set = vi.spyOn(sdk.storage, "set");
    const session = await openItems(sdk, options({ onAdd: "none" }));
    await session.pick("plan-a");
    await session.pick(null);
    await session.pick("plan-a");
    await session.pick("plan-b");
    await session.pick("plan-b");
    expect(set.mock.calls.map(([, value]) => value)).toEqual(["plan-a", "plan-b"]);
    expect(host.storage.get("items.last.plan-")).toBe("plan-b");
  });
});

describe("restore option", () => {
  it("lets the module choose from the launch and the panel state", async () => {
    const { sdk, host } = createMemoryHost({ launch: { reason: "restore", content: null } });
    seed(host, "a", "A");
    seed(host, "b", "B");
    await sdk.panel.setState({ item: "plan-b" });
    const seen: unknown[] = [];
    const session = await openItems(
      sdk,
      options({
        onAdd: "none",
        restore: async (launch, state) => {
          seen.push(launch.reason, state);
          return (state as { item: string } | null)?.item ?? null;
        },
      }),
    );
    expect(seen).toEqual(["restore", { item: "plan-b" }]);
    expect(session.currentId).toBe("plan-b");
  });

  it("falls back to the add rule when restore answers null or a missing item", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    const nothing = await openItems(sdk, options({ onAdd: "none", restore: () => null }));
    expect(nothing.currentId).toBeNull();
    const gone = await openItems(sdk, options({ restore: () => "plan-gone" }));
    expect(gone.currentId).toBe("plan-a");
  });
});

describe("whenEmpty", () => {
  it("creates and opens the starter item once the list is empty", async () => {
    const { sdk, host } = createMemoryHost();
    const session = await openItems(sdk, options({ whenEmpty: () => ({ data: { name: "Start", items: ["hi"] }, title: "First" }) }));
    expect(session.current?.data).toEqual({ name: "First", items: ["hi"] });
    expect(names(session)).toEqual(["First"]);
    expect(host.documents.list()).toHaveLength(1);
    // a second panel finds the list filled and creates nothing
    const again = await openItems(createMemoryHost({ share: host }).sdk, options({ whenEmpty: () => ({ data: { name: "Other", items: [] } }) }));
    expect(host.documents.list()).toHaveLength(1);
    expect(again.currentId).toBe(session.currentId);
    // not when there are items already
    const filled = createMemoryHost();
    seed(filled.host, "a", "A");
    await openItems(filled.sdk, options({ whenEmpty: () => ({ data: { name: "Start", items: [] } }) }));
    expect(filled.host.documents.list()).toHaveLength(1);
  });

  it("makes one starter when two panels open at the same time", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    const whenEmpty = () => ({ data: { name: "Start", items: [] as string[] } });
    const [one, two] = await Promise.all([openItems(a.sdk, options({ whenEmpty })), openItems(b.sdk, options({ whenEmpty }))]);
    expect(a.host.documents.list()).toHaveLength(1);
    expect(one.currentId).toBe(two.currentId);
    expect(one.currentId).not.toBeNull();
  });
});

describe("adoptRemote", () => {
  it("is the open item's adoptRemote, and does nothing for none", async () => {
    const { sdk } = createMemoryHost();
    const session = await openItems(sdk, options());
    await expect(session.adoptRemote()).resolves.toBeUndefined();
  });
});

describe("re-check fixes", () => {
  it("saves an edit typed while the next item opened, or stays on the item when that save fails", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    seed(host, "b", "B");
    const session = await openItems(sdk, options({ debounceMs: 60_000 }));
    await session.pick("plan-a");
    const errors: string[] = [];
    session.onError((_error, kind) => errors.push(kind));
    const release = gateGet(sdk, "plan-b");
    const picked = session.pick("plan-b");
    await wait(0);
    session.current!.update(add("typed late"));
    host.answer("documents.put", () => {
      throw new Error("disk full");
    });
    release();
    await expect(picked).rejects.toBeInstanceOf(ItemSaveError);
    expect(session.currentId).toBe("plan-a");
    expect(errors).toContain("save");

    host.unanswer("documents.put");
    session.current!.update(add("again"));
    await expect(session.pick("plan-b")).resolves.toBe(true);
    expect(storedPlan(host, "plan-a")?.items).toEqual(["again"]);
  });

  it("lets a pick through once the disk is back, even with nothing left to save", async () => {
    const { sdk, host } = createMemoryHost();
    seed(host, "a", "A");
    seed(host, "b", "B");
    const session = await openItems(sdk, options({ debounceMs: 60_000 }));
    await session.pick("plan-a");
    host.answer("documents.put", () => {
      throw new Error("disk full");
    });
    session.current!.update(add("lost"));
    await session.flush();
    expect(session.status).toBe("error");
    host.unanswer("documents.put");
    await session.flush();
    await expect(session.pick("plan-b")).resolves.toBe(true);
    expect(session.currentId).toBe("plan-b");
  });

  it("does not let a fallback after a delete elsewhere override a pick in flight", async () => {
    const a = createMemoryHost();
    const b = createMemoryHost({ share: a.host });
    seed(a.host, "a", "A");
    seed(a.host, "b", "B");
    seed(a.host, "c", "C");
    const session = await openItems(a.sdk, options({ onDeleted: "fallback" }));
    await session.pick("plan-a");
    const release = gateGet(a.sdk, "plan-b");
    const picked = session.pick("plan-b");
    await wait(0);
    await b.sdk.documents.delete("plan-a");
    await wait(10);
    release();
    await expect(picked).resolves.toBe(true);
    await wait(20);
    expect(session.currentId).toBe("plan-b");
  });
});
