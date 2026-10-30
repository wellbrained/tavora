import { TavoraError, type JsonValue } from "@tavora/sdk";
import { createMemoryHost, type MemoryHost } from "@tavora/sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createTodoStore, keepSame } from "./store";
import { addTask, LIST_ID, LIST_TITLE, parseList, updateTask } from "./todos";

// The shared package's index also brings in Vue components, which tests in Node can't load.
vi.mock("@tavora/official-ui", async () => ({ ...(await import("../../shared/src/documents")), ...(await import("../../shared/src/i18n")) }));

describe("keepSame", () => {
  it("gives back the old value when nothing changed", () => {
    const previous = { groups: [{ id: "g", tasks: [{ id: "a", done: false }] }] };
    expect(keepSame(previous, structuredClone(previous))).toBe(previous);
  });

  it("keeps the parts that did not change", () => {
    const previous = { groups: [{ id: "g", tasks: [{ id: "a", done: false }, { id: "b", done: false }] }], other: [1] };
    const next = structuredClone(previous);
    next.groups[0]!.tasks[1]!.done = true;
    const kept = keepSame(previous, next);
    expect(kept).toEqual(next);
    expect(kept).not.toBe(previous);
    expect(kept.other).toBe(previous.other);
    expect(kept.groups[0]!.tasks[0]).toBe(previous.groups[0]!.tasks[0]);
    expect(kept.groups[0]!.tasks[1]).not.toBe(previous.groups[0]!.tasks[1]);
  });

  it("sees added, removed and reordered items", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    expect(keepSame([a, b], [{ id: "b" }, { id: "a" }])).toEqual([b, a]);
    expect(keepSame([a], [{ id: "a" }, { id: "b" }])).toEqual([a, b]);
    expect(keepSame([a, b], [{ id: "a" }])).toEqual([a]);
    expect(keepSame({ x: 1, y: 2 }, { x: 1 } as { x: number; y?: number })).toEqual({ x: 1 });
    expect(keepSame({ x: 1 } as { x: number; y?: number }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });
});

/** Two panels of the same module on one shared document state. */
function twoPanels() {
  const a = createMemoryHost();
  const b = createMemoryHost({ share: a.host });
  return { a, b };
}

const seed = (host: MemoryHost, data: JsonValue) => host.documents.put({ id: LIST_ID, title: LIST_TITLE, data });
const names = (list: { groups: { name: string; tasks: { title: string }[] }[] }) => list.groups.flatMap((group) => group.tasks.map((task) => task.title));

describe("createTodoStore", () => {
  it("keeps the list it shows when a save comes back unchanged", async () => {
    const { a } = twoPanels();
    const store = await createTodoStore(a.sdk, { debounceMs: 0 });
    store.apply((data) => addTask(data, null, { id: "a", title: "Find the Ancient Crypt", createdAt: "2026-10-19T07:00:00.000Z", parentId: null }, "g"));
    await store.flush();
    const shown = store.list.value;
    store.apply((data) => updateTask(data, "a", { title: "Find the Old Crypt" }));
    const edited = store.list.value;
    expect(edited).not.toBe(shown);
    await store.flush();
    expect(store.list.value).toBe(edited);
    expect(names(a.host.documents.get(LIST_ID)!.data as never)).toEqual(["Find the Old Crypt"]);
  });

  it("shows the other panel's change", async () => {
    const { a, b } = twoPanels();
    const store = await createTodoStore(a.sdk, { debounceMs: 0 });
    const other = await createTodoStore(b.sdk, { debounceMs: 0 });
    other.apply((data) => addTask(data, null, { id: "x", title: "From the other panel", createdAt: "2026-10-19T07:00:00.000Z", parentId: null }, "g"));
    await other.flush();
    await vi.waitFor(() => expect(names(store.list.value)).toEqual(["From the other panel"]));
  });

  it("keeps both edits when two panels change the list at the same time", async () => {
    const { a, b } = twoPanels();
    const store = await createTodoStore(a.sdk, { debounceMs: 0 });
    const other = await createTodoStore(b.sdk, { debounceMs: 0 });
    store.apply((data) => addTask(data, null, { id: "one", title: "One", createdAt: "2026-10-19T07:00:00.000Z", parentId: null }, "g"));
    other.apply((data) => addTask(data, null, { id: "two", title: "Two", createdAt: "2026-10-19T07:00:00.000Z", parentId: null }, "h"));
    await Promise.all([store.flush(), other.flush()]);
    await vi.waitFor(() => expect(names(store.list.value).sort()).toEqual(["One", "Two"]));
    await vi.waitFor(() => expect(names(other.list.value).sort()).toEqual(["One", "Two"]));
    expect(names(a.host.documents.get(LIST_ID)!.data as never).sort()).toEqual(["One", "Two"]);
  });

  it("shows the stored list again and says so when a save fails", async () => {
    const { a } = twoPanels();
    seed(a.host, parseList(null) as unknown as JsonValue);
    const store = await createTodoStore(a.sdk, { debounceMs: 0 });
    a.host.answer("documents.put", async () => {
      throw new TavoraError({ code: "INTERNAL", message: "disk full" });
    });
    store.apply((data) => addTask(data, null, { id: "lost", title: "Lost", createdAt: "2026-10-19T07:00:00.000Z", parentId: null }, "g"));
    expect(names(store.list.value)).toEqual(["Lost"]);
    await store.flush();
    await vi.waitFor(() => expect(names(store.list.value)).toEqual([]));
    expect(store.error.value).toContain("disk full");
    expect(store.status.value).toBe("error");
  });
});
